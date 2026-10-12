// sys1grep --serve [PORT] (#166): a page with a search box on 127.0.0.1. Each search runs sys1grep itself as a child,
// with the launch arguments plus what the page's controls changed, so the page cannot do what the command line cannot.
import { createServer } from 'node:http';
import { execFile, spawnSync } from 'node:child_process';
import { parseArgs, parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { FIELDS, maskOpts, maskUrl, readSettings, writeSettings } from './settings.mjs';
import { OPTIONS, REVERSE_REMOVED, fill, parseOpts } from './options.mjs';

// The settings panel's view of ~/.config/sys1grep/settings.json, one tuple per field: [the saved value (for a key, only
// whether one is saved; for url and opts, with a --sys1-api-key or a url's userinfo masked, the same way --verbose
// masks them), where the value a search uses comes from: cmd | env | settings | .env | default, the variable when
// env]. It follows sys1grep's own order (command line, environment, settings.json, .env), so the page can say when
// something it saves would not take effect.
const KEYS = new Set(['key', 'summarizerKey']);
const settingsView = cli => {
  const s = readSettings() ?? {};
  let dotenv = {};
  try { dotenv = parseEnv(readFileSync(`${homedir()}/.config/sys1grep/.env`, 'utf8')); } catch {}
  return Object.fromEntries(Object.entries(FIELDS).map(([f, v]) => {
    const names = [`SYS1GREP_${v}`, `SEMGREP_${v}`, ...(f === 'key' ? ['TYPESAFE_API_KEY'] : [])];
    const env = names.find(n => process.env[n] !== undefined && (f === 'opts' || process.env[n] !== ''));
    const saved = KEYS.has(f) ? s[f] !== undefined : f === 'opts' ? (s.opts ? maskOpts(s.opts) : null) : f === 'url' ? (s.url ? maskUrl(s.url) : null) : s[f] ?? null;
    const src = cli[f] !== undefined ? ['cmd'] : env ? ['env', env] : s[f] !== undefined ? ['settings'] : names.some(n => dotenv[n] !== undefined) ? ['.env'] : ['default'];
    return [f, [saved, ...src]];
  }));
};
// --serve itself refuses REFUSED_LAUNCH (below) at launch: the page replaces these, or their meaning comes from the
// page. The settings panel's opts run through sys1grep.mjs's own parseOpts (options.mjs, shared: #199 — three
// rounds of regex/cluster checks each missed a form parseArgs itself already handles correctly, from -nr to -rC1
// to --r), which refuses a positional (a target, #196) and a meaning/expression on its own; DENY below refuses the
// rest, by the canonical OPTIONS name parseOpts resolves a token to, however it was spelled (-r, --r, or inside a
// cluster like -rC1 or -nr all resolve to "r").
const REFUSED_LAUNCH = /^(-[eavQPlcqoziHV]|-[eavQP].+|--(question|step-to|step-reverse-to|format|color|verbose|dry-run|interactive|help|version|install-templates|quiet|null-data)(=.*)?)$/;
// --unit=zero is -z by another name (options.mjs): REFUSED_LAUNCH's bare-token test cannot single it out from every
// other --unit value, and --unit also takes its value split ("--unit zero"), so this follows parseArgs' own rule
// (string option, no short form: the last --unit/--unit= wins) to find what --unit actually resolves to at launch.
const unitAt = launch => {
  let v;
  for (let i = 0; i < launch.length; i++) {
    if (launch[i] === '--unit') v = launch[++i];
    else if (launch[i].startsWith('--unit=')) v = launch[i].slice(7);
  }
  return v;
};
// l/c/quiet/o/z/interactive/with-filename/version/format/color/verbose/dry-run/help: the page's own replacements
// for a search's output shape and tracing (REFUSED_LAUNCH's set, minus what parseOpts already refuses on its own:
// e/P/a/v/question/step-to/install-templates). r: unlike at launch, there is no target field here to keep a bare -r
// (or a --serve started with no target, which then defaults to ".") in check. sys1-url/sys1-api-key: their own
// fields.
const DENY = new Set(['l', 'c', 'quiet', 'o', 'z', 'interactive', 'with-filename', 'version', 'format', 'color',
  'verbose', 'dry-run', 'help', 'r', 'gitlog', 'sys1-url', 'sys1-api-key']);
const optsError = opts => {
  let tokens;
  try { ({ tokens } = parseOpts(opts.map(a => fill(a, 'x')))); }
  catch (e) { return e.message; }
  // #234 (#233 review on #198): --unit=zero is -z's output shape, refused at launch (unitAt above); opts resolves
  // "unit" to a plain string option DENY never sees, so it slipped through here until now.
  if (unitAt(opts) === 'zero') return "--unit=zero is not allowed (it is -z's output shape, already refused there)";
  const bad = tokens.find(k => DENY.has(k.name));
  if (!bad) return null;
  const tok = opts[bad.index]; // the original, unfilled element: a cluster like "-nr" stays "-nr", not just "-r"
  const why = bad.name === 'r' ? "it would widen the search past the launch's own targets"
    : bad.name === 'gitlog' ? "it would switch the search from the launch's targets to git log; Details has -g"
    : bad.name === 'sys1-url' || bad.name === 'sys1-api-key' ? 'use the url / key field instead'
    : 'meanings, targets and output shape go on the command line';
  return `${tok} is not allowed (${why})`;
};
const isHttpUrl = s => { try { return /^https?:$/.test(new URL(s).protocol); } catch { return false; } };
// A POST's body: the fields to change. A string or a non-empty array sets one, null, '' or [] removes it, and a field
// left out stays as it is (so the page sends a key only when one is typed). opts/url equal to their own masked form
// (settingsView's GET, resent unchanged) keep the file's real value, so a round trip never overwrites a key or
// userinfo with the mask itself.
const saveSettings = patch => {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('not a JSON object');
  const next = readSettings() ?? {};
  for (const [k, v] of Object.entries(patch)) {
    if (!Object.hasOwn(FIELDS, k)) throw new Error(`unknown field ${k}`);
    let value = v;
    if (k === 'opts' && Array.isArray(v)) {
      if (!v.every(a => typeof a === 'string')) throw new Error('opts must be an array of strings');
      // An unchanged round trip skips optsError on purpose: a file written before this refusal existed, or edited
      // by hand, could already hold something optsError would now reject (a positional, say); resending it as-is
      // must not break (sys1grep.mjs still refuses it on the next search), only a real edit is validated here.
      if (Array.isArray(next.opts) && JSON.stringify(v) === JSON.stringify(maskOpts(next.opts))) value = next.opts;
      else { const e = optsError(v); if (e) throw new Error(`opts: ${e}`); }
    }
    if (k === 'url' && typeof v === 'string' && v) {
      if (typeof next.url === 'string' && v === maskUrl(next.url)) value = next.url;
      else {
        // A url that still carries a masked username or password, whole or in part (the host, path or the other
        // half of the userinfo was edited around it), would otherwise save "***" itself as a real credential.
        // URL's username/password getters return the percent-encoded form (https://%2A%2A%2A@... is "***"
        // percent-encoded), so this decodes before comparing, or the same mask spelled that way would slip through.
        let parsed;
        try { parsed = new URL(v); } catch {}
        const decoded = s => { try { return decodeURIComponent(s); } catch { return s; } };
        if (parsed && (decoded(parsed.username) === '***' || decoded(parsed.password) === '***')) throw new Error('url: re-enter the userinfo (the part before @) in full, or remove it, before saving');
        if (!isHttpUrl(v)) throw new Error('url must be http(s)');
      }
    }
    if (k === 'summarizer' && typeof v === 'string' && /^https?:\/\//.test(v) && !isHttpUrl(v)) throw new Error('summarizer must be http(s) when it is a URL');
    if (value === null || value === '' || (Array.isArray(value) && !value.length)) delete next[k];
    else next[k] = value;
  }
  writeSettings(next);
};
// the summary's bound in sys1grep (SUMMARY_MAX): results on screen beyond it are refused
const POSTED_MAX = 200 * 1024;
const body = (req, max = 1 << 16) => new Promise((resolve, reject) => {
  let b = '', n = 0;
  req.setEncoding('utf8');
  // Past max the rest is read and dropped, not left unread: a client that sends the whole body before it reads gets the
  // answer (413) once it is done, where an unread or closed request either stalls it or resets the connection under
  // the answer (Linux drops data not yet read when a reset arrives).
  const take = c => { b += c; n += Buffer.byteLength(c); if (n > max) { req.tooLarge = true; b = ''; req.off('data', take).on('data', () => {}); reject(new Error('too large')); } };
  req.on('data', take);
  req.on('end', () => resolve(b));
  req.on('error', reject);
});

// The page's controls. toArgv() (below) turns their values into command-line tokens, in the server to run a search and
// in the browser to print the command: one function, so the two cannot drift. A value equal to its launch value is left out.
// re: what the server accepts; bool: a checkbox, neg its negation; words: one token per word; step: only with a --step-to field.
// No flag: reverse adds no option of its own, it turns the field's --step-to into --step-reverse-to.
const CONTROLS = [
  { k: 'rank', flag: '--rank', re: '^(jev|match)?$', nostep: true, def: '' },
  { k: 'level', flag: '--level', re: '^(loose|normal|strict)$' },
  { k: 't', flag: '-t', re: '^(\\d+(\\.\\d+)?)?$' },
  { k: 'T', flag: '-T', re: '^(\\d+(\\.\\d+)?)?$' },
  { k: 'C', flag: '-C', re: '^\\d*$', nostep: true },
  // #234: -A/-B (lines of context, each side), like -C; multi-step prints paths, not lines (sys1grep.mjs's own
  // conflict check), so these go inert there too.
  { k: 'A', flag: '-A', re: '^\\d*$', nostep: true },
  { k: 'B', flag: '-B', re: '^\\d*$', nostep: true },
  { k: 'dedup', flag: '--dedup', re: '^(never|auto|always)$', nostep: true, def: 'never' },
  // No def: a multi-step walk's own default unit is function (sys1grep.mjs), not line, so the control goes
  // inert (like C) rather than forcing a value back. Whatever the launch already set keeps applying unchanged.
  { k: 'unit', flag: '--unit', re: '^(line|sentence-by-jev|sentence-by-rule|function)$', nostep: true },
  // #234 (#211 item 10, owner): -o, shown only with a sentence unit (sentenceOnly, below); def: false, so it is
  // never sent (not left inert on a stale checked box) once the unit picked away from sentence hides it.
  { k: 'o', flag: '-o', neg: '--no-o', bool: true, nostep: true, sentenceOnly: true, def: false },
  { k: 'auto-scope', flag: '--auto-scope', neg: '--no-auto-scope', bool: true },
  { k: 'n', flag: '-n', neg: '--no-n', bool: true },
  { k: 'p', flag: '-p', neg: '--no-p', bool: true },
  { k: 'g', flag: '-g', neg: '--no-gitlog', bool: true, nostep: true, def: false },
  // #234: -j (concurrent requests) and --max-cost (the cost guard) apply to a walk's requests too, unlike C/A/B/o/dedup.
  { k: 'j', flag: '-j', re: '^\\d*$' },
  { k: 'max-cost', flag: '--max-cost', re: '^(\\d+(\\.\\d+)?)?$' },
  { k: 'include', flag: '--include', words: true },
  { k: 'exclude', flag: '--exclude', words: true },
  { k: 'changed-within', flag: '--changed-within' },
  { k: 'hops', flag: '--hops', re: '^[\\d.]*$', step: true, def: '0..' },
  { k: 'reverse', bool: true, step: true, def: false },
];
const FIELD = /^[eavQPS]:/; // an expression field: e:MEANING (-e), a, v, Q (-Q), P:/RE/ (-P), S: (--step-to)
// The example buttons: x as the page sends it, then the controls it sets (by k). Each fits a user's own project and also
// has something to find when --serve is started on this repository (#224): the meaning ones in the corpora under tests/
// or sys1grep's own code, the multi-step ones in its JavaScript (ENTRY and RETHROW take Python too; SRC keeps the walk
// in source files).
// hj / xj: the label and fields in Japanese (#215), for the page's EN / 日本語 switch; a regex example keeps its x.
// Pressing one puts the page in that state: the rest go back to their launch values; an S: in x turns multi-step on.
const ENTRY = '/^export (async )?function |^export const [\\w$]+ = (async )?\\(|^(async )?function main\\b|^ *def main\\b/'; // a module's entry points
// a caught error thrown on: any throw would put the entry points (which throw) at both ends, with no walk between; m: a
// walk matches a whole function at once, and ^ $ must mean a line in it (#225 review)
const RETHROW = '/throw (e|err|error)\\b|^ *raise$/m';
const SRC = '*.mjs *.cjs *.js *.jsx *.ts *.tsx *.py'; // not *.mts: tests/smoke.mts would put its search() in the walk
export const EXAMPLES = [
  { h: 'meaning, not words', hj: '言葉ではなく意味で', x: ['e:customer is angry or frustrated'], xj: ['e:顧客が怒っている、または不満を持っている'], n: true },
  { h: 'a question (-Q)', hj: '質問する (-Q)', x: ['Q:whether the server is down'], xj: ['Q:サーバーが落ちているかどうか'], n: true },
  { h: 'where an API key is read', hj: 'API キーを読んでいる箇所', x: ['e:an API key or token is read from the environment or a settings file'],
    xj: ['e:API キーやトークンを環境変数や設定ファイルから読んでいる'], n: true },
  { h: 'a request is retried', hj: 'リクエストの再試行', x: ['e:a failed request is retried'], xj: ['e:失敗したリクエストを再試行している'], n: true },
  { h: 'either meaning, with scores (-p)', hj: 'どちらかの意味（スコア付き -p）', x: ['e:customer is asking for a refund', 'e:delivery address change request'],
    xj: ['e:顧客が返金を求めている', 'e:配送先の変更依頼'], n: true, p: true },
  { h: 'exclude with -v', hj: '-v で除外', x: ['e:network or remote connection failure', 'v:a retry is happening or was attempted'],
    xj: ['e:ネットワークまたはリモート接続の失敗', 'v:リトライが行われた、または試みられた'], n: true },
  { h: 'regex and meaning together', hj: '正規表現と意味を併用', x: ['P:/catch/', 'a:the error is ignored'], xj: ['P:/catch/', 'a:エラーが無視されている'], n: true, p: true },
  { h: 'stricter (--level strict)', hj: 'より厳密に (--level strict)', x: ['e:a security risk or dangerous destructive operation'],
    xj: ['e:セキュリティ上のリスク、または危険な破壊的操作'], level: 'strict', n: true },
  { h: 'one line per template (--dedup)', hj: 'テンプレートごとに1行 (--dedup)', x: ['e:a request failed'], xj: ['e:リクエストが失敗した'], dedup: 'always', n: true },
  { h: 'one sentence at a time', hj: '1文ずつ判定', x: ['e:the author admits they made a mistake'], xj: ['e:筆者が自分の間違いを認めている'], unit: 'sentence-by-jev', n: true },
  { h: 'calls that throw or raise', hj: 'throw / raise に至る呼び出し', x: ['P:' + ENTRY, 'S:', 'P:/throw |raise /'], include: SRC },
  { h: '1 to 2 calls away', hj: '1〜2 段先の呼び出し', x: ['P:' + ENTRY, 'S:', 'P:/throw |raise /'], hops: '1..2', include: SRC },
  { h: 'what reaches it (--step-reverse-to)', hj: 'どこから呼ばれるか (--step-reverse-to)', x: ['P:' + RETHROW, 'S:', 'P:' + ENTRY], reverse: true, include: SRC },
  { h: 'throw or exit (two ends)', hj: 'throw または exit（終点が2つ）', x: ['P:' + ENTRY, 'S:', 'P:/throw |raise /', 'P:/process\\.exit\\(|sys\\.exit\\(/'], include: SRC },
];

// p: the page's values (x: the fields, then one value per control and summarize / summarize-prompt); init: the launch's.
export const toArgv = (p, init) => {
  const v = k => p[k] ?? init[k], out = [];
  const step = (p.x ?? init.x).some(f => f[0] === 'S');
  for (const f of v('x')) {
    if (f[0] === 'S') out.push(v('reverse') ? '--step-reverse-to' : '--step-to');
    else if (f.slice(2)) out.push(`-${f[0]}`, f.slice(2));
  }
  const unit = v('unit');
  for (const c of CONTROLS) {
    if (!c.flag) continue;
    // what does not apply goes back to its default, over a launch value; sentenceOnly (-o): only with a sentence unit
    const off = (c.step && !step) || (c.nostep && step) || (c.sentenceOnly && !/^sentence-by-/.test(unit));
    if (off && c.def === undefined) continue;
    const now = off ? c.def : v(c.k), was = init[c.k];
    if (now === was) continue;
    if (c.bool) out.push(now ? c.flag : c.neg);
    else if (c.k === 'rank') out.push(now ? `--rank=${now}` : '--no-rank');
    else if (now === '') continue;
    else if (c.words) for (const w of now.split(/\s+/).filter(Boolean)) out.push(`${c.flag}=${w}`);
    else out.push(c.flag.startsWith('--') ? `${c.flag}=${now}` : c.flag, ...(c.flag.startsWith('--') ? [] : [now]));
  }
  const sum = v('summarize') && !step;
  if (sum !== init.summarize) out.push(sum ? '--summarize' : '--no-summarize');
  if (sum && v('summarize-prompt')) out.push(`--summarize-prompt=${v('summarize-prompt')}`);
  return out;
};
// The launch's values, from the command line (what parseArgs cannot place is left at the default).
export const initOf = launch => {
  const fill = { '--rank': '--rank=jev', '--summarize': '--summarize=x', '--dedup': '--dedup=always', '--no-rank': '--rank=\0', '--no-summarize': '--summarize=\0' };
  const { values: o } = parseArgs({
    args: launch.map(a => fill[a] ?? a), strict: false, allowPositionals: true, allowNegative: true,
    options: { rank: { type: 'string' }, level: { type: 'string' }, t: { type: 'string' }, T: { type: 'string' }, C: { type: 'string' },
      A: { type: 'string' }, B: { type: 'string' }, j: { type: 'string' }, 'max-cost': { type: 'string' },
      dedup: { type: 'string' }, unit: { type: 'string' }, 'auto-scope': { type: 'boolean' }, n: { type: 'boolean' }, p: { type: 'boolean' },
      g: { type: 'boolean' }, include: { type: 'string', multiple: true }, exclude: { type: 'string', multiple: true },
      'changed-within': { type: 'string' }, hops: { type: 'string' }, summarize: { type: 'string' },
      'summarize-prompt': { type: 'string' } },
  });
  const rank = o.rank === undefined || o.rank === '\0' ? '' : ['jev', 'match'].includes(o.rank) ? o.rank : 'jev'; // a bare --rank swallows the next word
  return { x: [], rank, level: o.level ?? 'normal', t: o.t ?? '', T: o.T ?? '', C: o.C ?? '', A: o.A ?? '', B: o.B ?? '', j: o.j ?? '',
    'max-cost': o['max-cost'] ?? '',
    // -o: never a launch option (REFUSED_LAUNCH), so the launch can never have set it; a constant, like C/A/B above an
    // unset launch, needed only so toArgv's v('o') has an init to compare against.
    o: false,
    dedup: o.dedup ?? 'never', unit: o.unit ?? 'line',
    'auto-scope': o['auto-scope'] ?? true, n: !!o.n, p: !!o.p, g: !!o.g, include: (o.include ?? []).join(' '), exclude: (o.exclude ?? []).join(' '),
    'changed-within': o['changed-within'] ?? '', hops: o.hops ?? '0..', reverse: false, summarize: o.summarize !== undefined && o.summarize !== '\0' && o.summarize !== 'ask', // ask: the lines, unasked off a terminal
    'summarize-prompt': '' };
};

// What the page replaces or the meaning of which comes from the page: refused at launch.
// --NAME VALUE or --NAME=VALUE out of the arguments: [the rest, the value]
// --suggest=KIND:TEXT or --suggest KIND:TEXT, any number of times: pills put first among the examples (Q: a question, e: a meaning; a bare TEXT is a question)
const liftAll = (args, name) => {
  const rest = [], values = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}`) { if (i + 1 >= args.length) throw new Error(`--serve: --${name} needs KIND:TEXT (Q:a question, e:a meaning)`); values.push(args[++i]); }
    else if (args[i].startsWith(`--${name}=`)) values.push(args[i].slice(name.length + 3));
    else rest.push(args[i]);
  }
  return [rest, values];
};
const suggestOf = list => list.map(v => (/^[eQ]:/.test(v) ? [v[0], v.slice(2)] : ['Q', v])).filter(([, t]) => t.trim()).map(([k, t]) => ({ h: t, x: [`${k}:${t}`], q: k }));
const lift = (args, name) => {
  const i = args.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return [args, undefined];
  const two = args[i] === `--${name}`;
  return [args.filter((_, j) => j !== i && !(two && j === i + 1)), two ? args[i + 1] : args[i].slice(name.length + 3)];
};
const PARAMS = new Set(['x', 'summarize', 'summarize-prompt', ...CONTROLS.map(c => c.k)]);
const fromQuery = (sp, init) => { // null when a value is out of range
  const p = { x: sp.getAll('x') };
  if (!p.x.every(f => FIELD.test(f))) return null;
  for (const k of PARAMS) if (k !== 'x' && sp.has(k)) {
    const c = CONTROLS.find(c => c.k === k), s = sp.get(k);
    if (c?.bool || k === 'summarize') { if (!/^[01]$/.test(s)) return null; p[k] = s === '1'; }
    else { if (c?.re && !new RegExp(c.re).test(s)) return null; p[k] = s; }
  }
  return p.x.length ? p : { ...p, x: init.x };
};

// What every search reads (#216), shown on the page and never taken from it: the launch's own targets, or with none
// what sys1grep falls back to. none: that fallback, in words. cwd: what a relative target is relative to. -g (at
// launch or from Details) reads git log instead; the page shows that in place of these as -g goes on and off.
const targetsOf = (launch, after) => {
  const { values: o, positionals } = parseArgs({ args: launch.map(a => fill(a, 'x')), options: OPTIONS, strict: false, allowPositionals: true, allowNegative: true });
  const list = [...positionals, ...after.slice(1)], cwd = process.cwd();
  if (list.length) return { list, cwd };
  return { list, cwd, none: globalThis.SYS1GREP_GIT ? 'every file git tracks (git sys1grep)'
    : o.r ? '. (this folder, recursively: -r)' : 'stdin, which --serve leaves empty: start it with a file or folder to search' };
};

export function serve(argv) {
  const isServe = a => /^--serve(=|$)/.test(a), port = argv.filter(isServe).at(-1).slice(8); // the last one's port: npm run serve adds a bare --serve
  if (port && !(/^\d+$/.test(port) && Number(port) < 65536)) throw new Error(`--serve=${port}: not a port number`);
  const rest = argv.filter(a => !isServe(a)), dd = rest.indexOf('--');
  const before = dd < 0 ? rest : rest.slice(0, dd), after = dd < 0 ? [] : rest.slice(dd);
  // the key stays in this process (never in the page or the command shown); the summary instruction is a control, not a launch option
  const [noKey, key] = lift(before, 'sys1-api-key'), [noPrompt, prompt] = lift(noKey, 'summarize-prompt'), [launch, suggested] = liftAll(noPrompt, 'suggest');
  if (launch.some(a => /^--(no-)?reverse(=|$)/.test(a))) throw new Error(REVERSE_REMOVED);
  const bad = launch.find(a => REFUSED_LAUNCH.test(a));
  if (bad) throw new Error(`--serve: ${bad.split('=')[0]} is not for --serve (the page sets the meaning and shows the results as html)`);
  if (unitAt(launch) === 'zero') throw new Error("--serve: --unit=zero is not for --serve (it is -z's output shape, already refused there)");
  const init = { ...initOf(launch), 'summarize-prompt': prompt ?? '' }, targets = targetsOf(launch, after);
  const secret = key === undefined ? [] : [`--sys1-api-key=${key}`];
  const cli = { url: lift(launch, 'sys1-url')[1], model: lift(launch, 'sys1-model')[1], key };
  const token = randomBytes(16).toString('hex');
  const script = process.argv[1];
  // #222: a folder searched without -r fails every search ("Is a directory (use -r)"), so refuse it before listening.
  // Whether -r is in effect is asked of sys1grep itself (SYS1GREP_PROBE), so -r from SYS1GREP_OPTS or settings.json
  // opts, a later --no-r, -g and git sys1grep all count as they do in a search.
  const dir = targets.list.find(t => statSync(t, { throwIfNoEntry: false })?.isDirectory());
  if (dir) {
    const { stdout } = spawnSync(process.execPath, [script, ...launch], { input: '', encoding: 'utf8', timeout: 10_000, env: { ...process.env, SYS1GREP_PROBE: 'recursive' } });
    let p;
    try { p = JSON.parse(stdout); } catch { console.error('sys1grep: --serve: could not check whether -r is in effect'); }
    const sh = a => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
    if (p && !p.r && !p.g && !p.git) throw new Error(`--serve: ${dir} is a directory: add -r to search it (${process.env.npm_lifecycle_event === 'serve' ? 'npm run serve --' : 'sys1grep --serve'} -r ${dir.startsWith('-') ? '-- ' : ''}${sh(dir)})`);
  }
  const tpl = launch.some(a => a.startsWith('--template')) ? [] : ['--template=search'];
  const { SYS1GREP_SUMMARIZE, ...searchEnv } = process.env; // set by the user, it would turn every search into a summary
  const run = (args, signal, input = '', env = searchEnv) => new Promise(resolve => {
    const child = execFile(process.execPath, [script, ...launch, ...secret, ...args, ...after], { signal, env, maxBuffer: 1 << 28 },
      (e, out, err) => resolve({ code: e ? (typeof e.code === 'number' ? e.code : 2) : 0, out, err }));
    child.stdin.on('error', () => {});
    child.stdin.end(input); // no targets means stdin: an empty one, not a hang
  });

  const search = async (p, kind, signal) => {
    // a results search never carries --summarize: the summary is a separate step, over what's on screen (#231, /summarize below)
    const step = (p.x).some(f => f[0] === 'S');
    const args = toArgv({ ...p, summarize: false }, init);
    if (kind === 'dry') args.push('--dry-run', '--no-summarize');
    else if (!step && (p.rank ?? init.rank)) args.push('--format=html', ...tpl);
    const { code, out, err } = await run([`--color=${kind === 'results' ? 'always' : 'never'}`, ...args], signal);
    if (code > 1) return { error: err.trim() || `exit ${code}` };
    if (code === 1 && !out) return { none: true, note: err.trim() };
    return kind === 'results' && !step && (p.rank ?? init.rank) ? { html: out.replace('</head>', '<style>.bar{display:none}</style></head>') } : { text: out };
  };

  const server = createServer(async (req, res) => {
    const host = req.headers.host;
    const send = (code, type, body) => {
      res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-frame-options': 'DENY', ...(type === 'application/json' ? { 'x-content-type-options': 'nosniff' } : {}) });
      res.end(body);
    };
    // req.url can be something new URL() rejects outright (a bare "//..." parses as scheme-relative and throws
    // ERR_INVALID_URL): answered before any check below, not left to crash the process (an uncaughtException, #166).
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { return send(400, 'text/plain', 'bad request'); }
    // a page on another site (or a rebound name) must not be able to start a search
    if (host !== `127.0.0.1:${server.address().port}` && host !== `localhost:${server.address().port}`) return send(403, 'text/plain', 'forbidden');
    // Every route, the page itself included, needs this launch's token: in the query (?k=, what the startup line and
    // any browser open carry) or in a header (what the page's own fetch() calls send instead). Without it this
    // server answers nothing, not even the page, so another local account or process cannot read the page (and the
    // token it carries, and anything a search of these targets would show) merely by knowing the port.
    if (url.searchParams.get('k') !== token && req.headers['x-sys1grep-token'] !== token) return send(404, 'text/plain', 'not found');
    if (url.pathname === '/') return send(200, 'text/html', page({ init, launch, after, token, targets, suggest: suggestOf(suggested) }));
    // The settings panel. It changes a file, so beyond the token above: for a write, POST with a JSON body and this
    // request's own Host as Origin (a page on another site cannot forge that, and GET never sends Origin at all, so
    // only POST is checked). A key goes in, never out.
    if (url.pathname === '/settings') {
      const answer = (code, x) => send(code, 'application/json', JSON.stringify(x));
      try {
        if (req.method === 'POST') {
          if (req.headers.origin !== `http://${host}`) return send(403, 'text/plain', 'forbidden');
          if (!/^application\/json(;|$)/.test(req.headers['content-type'] ?? '')) return send(415, 'text/plain', 'JSON only');
          let patch;
          try { patch = JSON.parse(await body(req)); } catch { return req.tooLarge ? answer(413, { error: 'too large: settings are at most 64 KB' }) : answer(400, { error: 'not valid JSON' }); }
          try { saveSettings(patch); } catch (e) { return answer(400, { error: e.message }); }
        } else if (req.method !== 'GET') return send(405, 'text/plain', 'GET or POST');
        return answer(200, settingsView(cli));
      } catch (e) { return answer(500, { error: `~/.config/sys1grep/settings.json: ${e.message}` }); }
    }
    // #227: summarize the results the page shows, as they are: the page posts their text and only the summarize step
    // runs on it (SYS1GREP_SUMMARIZE=stdin), no search and nothing to Jev. The query carries the search those
    // results came from, so the summary is asked about its meanings. POST, so checked as the settings write is.
    if (url.pathname === '/summarize') {
      const answer = (code, x) => send(code, 'application/json', JSON.stringify(x));
      if (req.method !== 'POST') return send(405, 'text/plain', 'POST');
      if (req.headers.origin !== `http://${host}` || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) return send(403, 'text/plain', 'forbidden');
      if (!/^text\/plain(;|$)/.test(req.headers['content-type'] ?? '')) return send(415, 'text/plain', 'text only');
      const p = fromQuery(url.searchParams, init);
      if (!p || p.x.some(f => f[0] === 'S')) return send(400, 'text/plain', 'bad value');
      let text;
      try { text = await body(req, POSTED_MAX); } catch { return req.tooLarge ? answer(413, { error: `the results on screen are more than ${POSTED_MAX / 1024} KB to summarize; narrow the search` }) : answer(400, { error: 'the results did not arrive whole' }); }
      if (!text.trim()) return answer(400, { error: 'no results to summarize' });
      const ac = new AbortController();
      res.on('close', () => ac.abort());
      const { code, out, err } = await run(['--color=never', ...toArgv({ ...p, summarize: true }, init), '--format=plain'], ac.signal, text, { ...searchEnv, SYS1GREP_SUMMARIZE: 'stdin' });
      return answer(200, code ? { error: err.trim() || `exit ${code}` } : { text: out });
    }
    const kind = url.pathname.slice(1);
    if (!['results', 'dry'].includes(kind) || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) return send(404, 'text/plain', 'not found');
    const p = fromQuery(url.searchParams, init);
    if (!p) return send(400, 'text/plain', 'bad value');
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    send(200, 'application/json', JSON.stringify(await search(p, kind, ac.signal)));
  });
  server.on('error', e => { console.error(`sys1grep: --serve: ${e.message}`); process.exit(2); });
  server.listen(Number(port) || 0, '127.0.0.1', () => {
    console.log(`http://127.0.0.1:${server.address().port}/?k=${token}`);
  });
}

const json = x => JSON.stringify(x).replace(/</g, '\\u003c');
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// The Target section: one target a line, the first SHOWN of them, then a "+N more" fold with the rest; or, while -g is
// on, git log in their place (show() swaps the two).
const SHOWN = 5;
const codes = list => list.map(t => `<li><code>${esc(t)}</code></li>`).join('');
const targetList = ({ list, cwd, none }, g) => `<div id="targets" title="${esc(`relative to ${cwd}`)}"><ul class="targets" id="tg-files"${g ? ' hidden' : ''}>${none ? `<li class="note">${esc(none)}</li>`
  : codes(list.slice(0, SHOWN)) + (list.length > SHOWN ? `<li><details class="more"><summary>+${list.length - SHOWN} more</summary><ul class="targets">${codes(list.slice(SHOWN))}</ul></details></li>` : '')}</ul>`
  + `<p class="note" id="tg-git"${g ? '' : ' hidden'}>git log's commits (-g)</p></div>`;
// a labelled control with its "?" hint (the same markup as rank's): the label, then the icon and its tooltip
const hg = (name, label, text) => `<div class="withhint hintgroup" id="hg-${name}">${label.replace(/<(select|input)/, `<$1 aria-describedby="hint-${name}"`)}<span class="hintctl"><button type="button" class="qbtn" id="q-${name}" aria-expanded="false" aria-controls="hint-${name}" aria-label="more about ${label.replace(/<select.*?<\/select>/, '').replace(/<[^>]+>/g, '').trim()}">?</button><small class="hint" id="hint-${name}" role="tooltip">${text}</small></span></div>`;
const page = ({ init, launch, after, token, targets, suggest }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>sys1grep</title>
<style>
:root { --page: #eef2f7; --bg: #fff; --fg: #1f2430; --muted: #5f6b7a; --rule: #e3e8ef; --border: #7b8392; --accent: #2563eb; --accent-ink: #fff; --link: #2563eb; --input-bg: #f3f5f8; --pill-bg: #e3f6e9; --pill-fg: #17703d; --code: #1e2433; --code-fg: #d7dde7; --shadow: 0 1px 2px rgba(16,24,40,.04), 0 8px 24px rgba(16,24,40,.08); }
@media (prefers-color-scheme: dark) { :root { --page: #12141a; --bg: #1b1e26; --fg: #e7e9ee; --muted: #9aa3b2; --rule: #2b303b; --border: #707a8a; --accent: #5b8df6; --accent-ink: #0b1020; --link: #5b8df6; --input-bg: #20242e; --pill-bg: #163826; --pill-fg: #7be0a0; --code: #11141b; --code-fg: #c9d1e0; --shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.35); } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--fg); font: 14px/1.5 arial, "Hiragino Sans", "Noto Sans CJK JP", sans-serif; }
.card { background: var(--bg); border-radius: 16px; box-shadow: var(--shadow); margin: 24px auto; padding: 20px 24px; width: min(880px, calc(100% - 32px)); }
.title { display: flex; align-items: center; gap: 12px; margin: 0 0 10px; }
.title .icon { display: flex; align-items: center; justify-content: center; width: 38px; height: 38px; background: var(--accent); border-radius: 10px; flex: none; }
.title h1 { font-size: 24px; margin: 0; font-weight: 800; flex: 1; }
.title .accent { color: var(--accent); }
.gear { margin-left: auto; border: none; background: none; color: var(--muted); padding: 6px; border-radius: 8px; display: inline-flex; flex: none; }
.gear:hover, .gear:focus-visible { background: var(--input-bg); color: var(--fg); }
.row { display: flex; gap: 8px; align-items: center; margin: 6px 0; flex-wrap: wrap; }
.row input[type=text] { flex: 1; min-width: 100px; padding: 10px 16px; font-size: 15px; border: 1px solid var(--border); border-radius: 14px; background: var(--input-bg); color: var(--fg); }
select, button, input { font: inherit; color: var(--fg); }
button, select { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 6px 12px; cursor: pointer; }
#go { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); font-weight: 700; }
#est, #stop, #copy, #save { background: var(--input-bg); }
fieldset.group { border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px 12px; margin: 10px 0; min-width: 0; }
.group legend.glabel { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0 0 6px; padding: 0 4px; }
.sec { margin: 0; padding: 12px 0; } .sec + .sec { border-top: 1px solid var(--rule); }
.sech { font-size: 13px; font-weight: 700; margin: 0 0 6px; }
.exlang { display: inline-flex; gap: 2px; margin-left: 6px; vertical-align: middle; }
#ex .exlang button { background: none; color: var(--muted); border: 1px solid var(--border); border-radius: 8px; padding: 0 8px; font-size: 12px; }
#ex .exlang button[aria-pressed=true] { background: var(--input-bg); color: var(--fg); font-weight: 700; }
.targets { list-style: none; margin: 0; padding: 0; } #tg-git { margin: 0; }
details.more { margin: 0; background: none; } details.more > summary { padding: 0; color: var(--muted); }
main:has(#left:empty):not(.two) { display: none; } .targets code { font: 13px/1.6 ui-monospace, Menlo, monospace; overflow-wrap: anywhere; }
.row.edges { border-top: 1px solid var(--rule); margin-top: 10px; padding-top: 10px; }
.del { border: none; background: none; color: var(--muted); padding: 4px; border-radius: 8px; display: inline-flex; }
.del:hover { background: var(--input-bg); color: var(--fg); }
.err { color: #d93025; white-space: pre-wrap; } .note { color: var(--muted); }
.withhint { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.hintctl { position: relative; display: inline-flex; }
.qbtn { width: 16px; height: 16px; border-radius: 50%; border: 1px solid var(--border); background: var(--input-bg); color: var(--muted); font-size: 10px; line-height: 1; padding: 0; display: inline-flex; align-items: center; justify-content: center; cursor: help; }
.qbtn:hover, .qbtn:focus-visible { color: var(--fg); border-color: var(--accent); }
.hint { position: absolute; z-index: 30; left: 0; top: 100%; margin-top: 6px; width: max-content; max-width: min(360px, calc(100vw - 32px)); padding: 8px 10px; background: var(--code); color: var(--code-fg); font-size: 11px; line-height: 1.5; white-space: pre-line; text-align: left; border-radius: 8px; box-shadow: var(--shadow); display: none; pointer-events: none; }
#hg-rank .hint, #hg-summarize .hint { left: auto; right: 0; }
#hg-step .hint, #hg-edges .hint { top: auto; bottom: 100%; margin-top: 0; margin-bottom: 6px; }
@media (hover: hover) { .hintctl:hover .hint { display: block; } }
.qbtn:focus-visible + .hint, .hintgroup.open .hint { display: block; }
@media (max-width: 480px) { .hint, #hg-step .hint, #hg-edges .hint, #hg-rank .hint, #hg-summarize .hint { position: fixed; left: 16px; right: 16px; bottom: 16px; top: auto; margin: 0; max-width: none; width: auto; } }
.dlgbody { padding: 20px 24px; }
dialog#sd { background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow); width: min(560px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto; padding: 0; }
dialog#sd::backdrop { background: rgba(0, 0, 0, .45); }
.dlghead { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 10px; }
.dlghead h2 { font-size: 16px; margin: 0; }
.dlgx { border: none; background: none; color: var(--muted); font-size: 20px; line-height: 1; padding: 4px 8px; border-radius: 8px; }
.dlgx:hover, .dlgx:focus-visible { background: var(--input-bg); color: var(--fg); }
#cmd { flex: 1; margin: 0; padding: 10px 14px; background: var(--code); color: var(--code-fg); border-radius: 10px; font: 12px/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
details { margin: 6px 0; background: var(--input-bg); border-radius: 10px; } summary { cursor: pointer; color: var(--muted); padding: 8px 12px; }
summary.dot::after { content: " \\25CF"; color: var(--link); }
.grid { display: grid; gap: 12px 20px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); padding: 4px 12px 12px; }
.grid .withhint { align-items: flex-start; } .grid .withhint > label { flex: 1; min-width: 0; }
.grid label { display: flex; flex-direction: column; gap: 2px; color: var(--muted); } .grid label.chk { flex-direction: row; align-items: center; gap: 6px; }
.grid input:not([type=checkbox]), .grid select, .grid textarea { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--fg); width: 100%; font: inherit; }
main { background: var(--bg); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin: 12px 0 4px; display: grid; gap: 16px; grid-template-columns: 1fr; } main.two { grid-template-columns: 3fr 2fr; }
@media (max-width: 880px) { main.two { grid-template-columns: 1fr; } }
iframe { width: 100%; border: 0; min-height: 80px; } pre.out { white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.5 ui-monospace, Menlo, monospace; }
.c32 { color: #188038; } .c35 { color: #a142f4; } .c36 { color: #0c7a88; } .c31 { color: #d93025; } .c33 { color: #b06000; } .c01_31 { color: #d93025; font-weight: 700; } .c01_33 { color: #b06000; font-weight: 700; background: #fff3b055; }\n@media (prefers-color-scheme: dark) { .c32 { color: #81c995; } .c35 { color: #d7aefb; } .c36 { color: #78d9ec; } .c31, .c01_31 { color: #f28b82; } .c33, .c01_33 { color: #fdd663; } .err { color: #f28b82; } }\nbutton:disabled { opacity: .45; cursor: default; } #ex button { border-radius: 999px; background: var(--pill-bg); color: var(--pill-fg); border: none; } #ex .label, #ex .grp { flex-basis: 100%; font-weight: 700; color: var(--muted); margin-top: 4px; }
#right { border-left: 1px solid var(--rule); padding-left: 16px; }
</style></head><body>
<div class="card" id="card">
<div class="title" id="title"><span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="#fff" stroke-width="2.2"/><line x1="15.3" y1="15.3" x2="20.5" y2="20.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg></span><h1>sys<span class="accent">1grep</span></h1><button type="button" class="gear" id="gear" title="Settings" aria-label="Settings"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div>
<form id="f" autocomplete="off" onsubmit="return false">
<section class="sec" id="sec-target" aria-labelledby="h-target"><h2 class="sech" id="h-target" title="ターゲット / 検索対象: what every search reads, set when --serve starts; the page cannot change it">Target</h2>
${targetList(targets, init.g)}</section>
<section class="sec" id="sec-cond" aria-labelledby="h-cond"><h2 class="sech" id="h-cond" title="検索条件">Search conditions</h2>
<fieldset class="group" id="startgrp"><legend class="glabel" title="what to search for; with multi-step on, the start of the walk">start</legend><div id="fields"></div><button type="button" id="add" title="add a start" aria-label="add a start">+ start</button></fieldset>
<div class="row"><div class="withhint hintgroup" id="hg-step"><label><input type="checkbox" id="step" aria-describedby="hint-step"> multi-step</label><span class="hintctl"><button type="button" class="qbtn" id="q-step" aria-expanded="false" aria-controls="hint-step" aria-label="more about multi-step">?</button><small class="hint" id="hint-step" role="tooltip">Finds the start functions, then walks calls from them to the functions that match the end.
A call is found by name: \`name(\` in a function's body (comments and strings left out) links to every function called \`name\`. Same-named functions all link; calls not written as \`name(\` (a function passed as a value, a call through a variable) are missed.
Default: from a function to the functions it calls. reverse (--step-reverse-to): to the functions that call it.
--hops limits how many calls away an end may be. For exact relations, start --serve with --edges=FILE.</small></span></div></div>
<fieldset class="group" id="steps" hidden><legend class="glabel">end (--step-to)</legend><div id="ends"></div><button type="button" id="addend" title="add an end" aria-label="add an end">+ end</button>
<div class="row edges hintgroup" id="hg-edges"><span class="note">edges</span><span class="hintctl"><button type="button" class="qbtn" id="q-edges" aria-expanded="false" aria-controls="hint-edges" aria-label="more about edges">?</button><small class="hint" id="hint-edges" role="tooltip">--hops limits how many hops away an end may be; reverse (--step-reverse-to) searches backwards along the graph</small></span><label title="how many hops the end may be from the start, e.g. 1..2">--hops <input type="text" name="hops" size="6" aria-describedby="hint-edges"></label><label><input type="checkbox" name="reverse" aria-describedby="hint-edges"> reverse</label></div></fieldset>
<div class="row" id="ex"><span class="note label">examples <span class="exlang" role="group" aria-label="language of the examples"><button type="button" id="ex-en" lang="en" aria-pressed="true">EN</button><button type="button" id="ex-ja" lang="ja" aria-pressed="false">日本語</button></span></span></div>
</section>
<section class="sec" id="sec-opts" aria-labelledby="h-opts"><h2 class="sech" id="h-opts" title="オプション">Options</h2>
<div class="row">
<button type="submit" id="go">Search</button><button type="button" id="est" title="run with --dry-run: shows the request size and estimated cost, no results">Estimate cost</button><button type="button" id="stop" title="stop the search that is running (its process is killed)" disabled>Stop</button>
<div class="withhint hintgroup" id="hg-rank"><label>rank <select name="rank" aria-describedby="hint-rank"><option value="">off</option><option value="jev">jev</option><option value="match">match</option></select></label><span class="hintctl"><button type="button" class="qbtn" id="q-rank" aria-expanded="false" aria-controls="hint-rank" aria-label="more about rank">?</button><small class="hint" id="hint-rank" role="tooltip">off keeps file order</small></span></div>
<div class="withhint hintgroup" id="hg-summarize"><label><input type="checkbox" name="summarize" aria-describedby="hint-summarize"> summarize</label><span class="hintctl"><button type="button" class="qbtn" id="q-summarize" aria-expanded="false" aria-controls="hint-summarize" aria-label="more about summarize">?</button><small class="hint" id="hint-summarize" role="tooltip">answers in a sentence or two after the search</small></span></div>
<input type="text" name="summarize-prompt" placeholder="summary instruction" style="display:none;flex:1;min-width:160px">
</div>
<div class="row ask" id="ask" role="group" aria-labelledby="askq" hidden><span id="askq"></span><button type="button" id="ask-ok">OK</button><button type="button" id="ask-no">Not now</button></div>
<div class="row"><pre id="cmd" title="the command line for the fields and controls as they are now; pasted in a terminal it runs the same search. The API key is never in it"></pre><button type="button" id="copy" title="copy the command line to the clipboard">Copy</button></div>
</section>
<details id="d"><summary id="ds" title="詳細: the other options; a dot means one differs from its launch value">Details</summary><div class="grid">
${hg('level', '<label>level <select name="level"><option>loose</option><option>normal</option><option>strict</option></select></label>', 'how strict a match must be (--level): loose takes more lines, strict fewer')}
${hg('t', '<label>-t <input name="t" size="5" inputmode="decimal"></label>', '-t: a line matches when its probability is at least this (0 to 1)')}${hg('T', '<label>-T <input name="T" size="5" inputmode="decimal"></label>', '-T: a negated meaning holds when the probability is below this (0 to 1)')}
${hg('C', '<label>context lines (-C) <input name="C" size="3" inputmode="numeric"></label>', '-C: lines of context before and after each match')}
${hg('A', '<label>-A <input name="A" size="3" inputmode="numeric"></label>', '-A: lines of context after each match (trailing only)')}${hg('B', '<label>-B <input name="B" size="3" inputmode="numeric"></label>', '-B: lines of context before each match (leading only)')}
${hg('autoscope', '<label class="chk"><input type="checkbox" name="auto-scope"> auto-scope</label>', '--auto-scope: narrow the files by what Jev says the meaning restricts to (a language, a kind of file); off is --no-auto-scope')}
${hg('n', '<label class="chk"><input type="checkbox" name="n"> -n line numbers</label>', '-n: show line numbers')}${hg('p', '<label class="chk"><input type="checkbox" name="p"> -p scores</label>', '-p: show the probability of each meaning on the matching lines')}
${hg('dedup', '<label>dedup <select name="dedup"><option>never</option><option>auto</option><option>always</option></select></label>', '--dedup: judge one line per template (lines that differ only in ids, numbers, dates) and reuse the answer; auto does it when it pays')}
${hg('unit', '<label>unit <select name="unit"><option>line</option><option>sentence-by-jev</option><option>sentence-by-rule</option><option>function</option></select></label>', '--unit: what one question judges: a line, a sentence (found by Jev or by a rule), or a function (git grep -W\'s boundaries). A multi-step walk is by function regardless of this. zero (-z, same as --unit=zero) is refused here, like -z itself')}
${hg('o', '<label class="chk"><input type="checkbox" name="o"> -o matching sentences only</label>', '-o: with a sentence unit, print only the matching sentences, not the whole line')}
${hg('j', '<label>-j <input name="j" size="3" inputmode="numeric"></label>', '-j: concurrent requests to the API')}${hg('maxcost', '<label>--max-cost <input name="max-cost" size="5" inputmode="decimal"></label>', '--max-cost: ask before sending when the estimated price is over this many USD')}
${hg('include', '<label>--include <input name="include"></label>', '--include: only file names matching these globs, space separated. Applies to -r and git sys1grep; it narrows the launch targets, never widens them')}${hg('exclude', '<label>--exclude <input name="exclude"></label>', '--exclude: not file names matching these globs, space separated. Applies to -r and git sys1grep')}
${hg('changed', '<label>--changed-within <input name="changed-within" placeholder="2h, 7d, a date"></label>', '--changed-within: only files modified within 30m, 2h, 7d, 2w, or since a date. Applies to -r and git sys1grep')}${hg('g', '<label class="chk"><input type="checkbox" name="g"> -g git log</label>', '-g: search git log\'s commits, one record each')}
</div></details></form>
<main id="m"><div id="left" title="results"></div><div id="right" title="the summary of the results" hidden></div></main>
<dialog id="sd" aria-labelledby="sdh"><div class="dlgbody"><div class="dlghead"><h2 id="sdh">Settings</h2><button type="button" class="dlgx" id="sdx" aria-label="Close" title="Close">&times;</button></div><form id="sf" autocomplete="off" onsubmit="return false"><div class="grid">
<label>url <input name="set-url" placeholder="https://api.typesafe.ai/v1/systemone" autofocus><small class="note" id="src-url"></small></label>
<label>model <input name="set-model" placeholder="jev-latest"><small class="note" id="src-model"></small></label>
<label>key <input type="password" name="set-key" autocomplete="new-password"><small class="note" id="src-key"></small><span class="chk"><input type="checkbox" name="clear-key"> remove</span></label>
<label>opts, one argument per line <textarea name="set-opts" rows="3"></textarea><small class="note" id="src-opts"></small></label>
<label>summarizer <input name="set-summarizer" placeholder="claude"><small class="note" id="src-summarizer"></small></label>
<label>summarizerModel <input name="set-summarizerModel"><small class="note" id="src-summarizerModel"></small></label>
<label>summarizerKey <input type="password" name="set-summarizerKey" autocomplete="new-password"><small class="note" id="src-summarizerKey"></small><span class="chk"><input type="checkbox" name="clear-summarizerKey"> remove</span></label>
</div><div class="row"><button type="button" id="save">Save to ~/.config/sys1grep/settings.json</button><span class="note" id="sst"></span></div></form></div></dialog>
</div>
<script>
const CONTROLS = ${json(CONTROLS)}, INIT = ${json(init)}, LAUNCH = ${json(launch)}, AFTER = ${json(after)}, TOKEN = ${json(token)}, EXAMPLES = ${json(EXAMPLES)}, SUGGEST = ${json(suggest)};
const toArgv = ${toArgv};
const quote = (s, force) => (!force && /^[\\w@%+=:,./-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\\\''") + "'");
const shown = argv => argv.map((t, i) => (/^-[eavQP]$/.test(argv[i - 1] ?? '') ? quote(t, t[0] === '-') : /^--[a-z-]+=/.test(t) ? t.replace(/=([\\s\\S]*)/, (_, v) => '=' + quote(v)) : quote(t)));
const f = document.getElementById('f'), fields = document.getElementById('fields'), cmd = document.getElementById('cmd');
const step = document.getElementById('step'), steps = document.getElementById('steps'), ends = document.getElementById('ends');
const ALL = [...CONTROLS, { k: 'summarize', bool: true }, { k: 'rank' }, { k: 'summarize-prompt' }];
const setControls = v => { for (const c of ALL) { const el = f.elements[c.k], x = v[c.k] ?? INIT[c.k]; if (c.bool) el.checked = !!x; else el.value = x; } };
const LABELS = { e: '-e meaning', P: '-P regex', a: '-a and', v: '-v and not', Q: '-Q question' };
// A close icon, not text, so the button's accessible name comes from aria-label alone, in every browser.
const DEL_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>';
const TIPS = {
  Q: ['a question', 'the lines that answer this question, not the lines asking it, e.g. why did it fail. A question is never a regex: use -P for /regex/'],
  e: ['a meaning', 'lines that mean this, in any language; several -e are OR. e.g. an API key is read. Always a meaning: use -P for /regex/'],
  P: ['/regex/flags', 'a regex term, matched locally, no request; several -P are OR, like -e. e.g. /catch/'],
  a: ['and this meaning', 'AND onto the term before it: both must hold on the line'],
  v: ['and not this meaning', 'AND NOT onto the term before it: this must not hold (as the first field, a bare negation)'],
};
const tip = r => { const [ph, t] = TIPS[r.firstChild.value]; r.firstChild.title = r.children[1].title = t; r.children[1].placeholder = ph; };
const addField = (k = 'Q', t = '', into = fields) => {
  const r = document.createElement('div'); r.className = 'row';
  r.innerHTML = '<select>' + Object.entries(LABELS).map(([k, l]) => '<option value="' + k + '">' + l + '</option>').join('') + '</select><input type="text" placeholder="meaning"><button type="button"></button>';
  r.firstChild.value = k; r.children[1].value = t;
  tip(r); r.firstChild.onchange = () => { tip(r); show(); };
  r.children[1].oninput = show; r.children[1].onkeydown = e => { if (e.key === 'Enter') go(); };
  const x = r.children[2];
  x.className = 'del'; x.innerHTML = DEL_ICON; x.ariaLabel = 'remove'; x.title = 'remove';
  // every row gets this button; on the one row left in a group it clears the row instead of removing it, so a
  // group (start, or end while multi-step is on) is never left without a row to fill back in.
  x.onclick = () => { if (into.children.length > 1) r.remove(); else r.children[1].value = ''; show(); };
  into.append(r); show(); return r;
};
const terms = box => [...box.children].map(r => r.firstChild.value + ':' + r.children[1].value.trim()).filter(x => x.length > 2);
const read = () => {
  const p = { x: [...terms(fields), ...(step.checked ? ['S:', ...terms(ends)] : [])] };
  for (const c of ALL) { const el = f.elements[c.k]; p[c.k] = c.bool ? el.checked : el.value; }
  return p;
};
const show = () => {
  const p = read(), multi = p.x.some(x => x[0] === 'S');
  // a numbered, distinct accessible name per row ("remove start condition 2"), renumbered on every change so a
  // deletion in the middle doesn't leave a stale number on the rows after it.
  for (const [box, label] of [[fields, 'start'], [ends, 'end']]) {
    [...box.children].forEach((r, i) => { const d = r.children[2]; if (d) d.title = d.ariaLabel = 'remove ' + label + ' condition ' + (i + 1); });
  }
  steps.hidden = !multi;
  const g = p.g && !multi; // -g does not apply to a walk
  document.getElementById('tg-files').hidden = g;
  document.getElementById('tg-git').hidden = !g;
  f.elements.rank.disabled = f.elements.summarize.disabled = multi;
  f.elements['summarize-prompt'].style.display = p.summarize && !multi ? '' : 'none';
  // #234: -o is useful only with a sentence unit (owner, #211 item 10); hidden otherwise, like steps for multi-step.
  document.getElementById('hg-o').hidden = !/^sentence-by-/.test(p.unit);
  cmd.textContent = ['sys1grep', ...LAUNCH.map(t => quote(t)), ...shown(toArgv(p, INIT)), ...AFTER.map(t => quote(t))].join(' ');
  if (!ask.hidden) drawAsk();
  document.getElementById('ds').className = CONTROLS.some(c => !['rank'].includes(c.k) && !c.step && p[c.k] !== INIT[c.k]
    && !(c.nostep && multi) && !(c.sentenceOnly && !/^sentence-by-/.test(p.unit))) ? 'dot' : '';
  return p;
};
const query = p => { const q = new URLSearchParams({ k: TOKEN }); for (const x of p.x) q.append('x', x); for (const [k, v] of Object.entries(p)) if (k !== 'x') q.set(k, v === true ? '1' : v === false ? '0' : v); return q; };
const ansi = (text, into) => { // the SGR colors of --color=always, as spans; nothing but text goes in
  let cls = '';
  for (const part of text.split(/(\\x1b\\[[\\d;]*m)/)) {
    const m = /^\\x1b\\[([\\d;]*)m$/.exec(part);
    if (m) cls = m[1] === '0' || m[1] === '' ? '' : 'c' + m[1].replace(/;/g, '_');
    else if (part) { const s = document.createElement('span'); s.className = cls; s.textContent = part; into.append(s); }
  }
};
let gen = 0;
let ctl = null, running = 0;
const busy = on => { for (const id of ['go', 'est']) document.getElementById(id).disabled = on; document.getElementById('stop').disabled = !on; };
const get = async (kind, p, into, post) => {
  const mine = gen;
  running++;
  try {
    const r = await fetch('/' + kind + '?' + query(p), { ...post, signal: ctl.signal }), j = await r.json().catch(() => ({ error: 'bad answer' }));
    if (mine === gen) await show1(j, into); // an html result's iframe loads async; wait for it, so the caller's text is ever the shown text (#231)
    if (mine === gen && kind === 'results' && (j.text || j.html) && !p.x.some(x => x[0] === 'S')) onScreen = p;
    return j;
  } catch (e) {
    if (mine === gen) show1({ error: String(e) }, into);
    return { error: String(e) };
  } finally {
    running = Math.max(0, running - 1);
    if (running === 0 && mine === gen) busy(false);
  }
};
// returns a promise that resolves once into holds the shown content: immediately, except for an iframe (j.html),
// whose srcdoc loads asynchronously -- a caller that reads the shown text (the summarize POST, #231) must await it.
const show1 = (j, into) => {
  into.textContent = '';
  if (j.error) { const e = document.createElement('div'); e.className = 'err'; e.textContent = j.error; into.append(e); return; }
  if (j.none) { const e = document.createElement('div'); e.className = 'note'; e.textContent = 'no matches' + (j.note ? ' (' + j.note + ')' : ''); into.append(e); return; }
  if (j.html) {
    const i = document.createElement('iframe'); i.sandbox = 'allow-same-origin'; i.srcdoc = j.html;
    const ready = new Promise(r => { i.onload = () => { i.style.height = i.contentDocument.documentElement.scrollHeight + 'px'; r(); }; });
    into.append(i);
    return ready;
  }
  const e = document.createElement('pre'); e.className = 'out'; ansi(j.text, e); into.append(e);
};
document.getElementById('stop').onclick = () => {
  ctl.abort(); gen++; running = 0; busy(false);
  for (const el of [document.getElementById('left'), document.getElementById('right')]) if (!el.hidden && /\.\.\.$/.test(el.textContent)) el.textContent = 'stopped';
};
// #234 (Q1, measured 2026-10-12): a search over --max-cost is refused at once, naming -y and --max-cost, neither of
// which the page can set. The refusal already carries the same estimate --dry-run would show (sys1grep.mjs prices it
// the same way for both), so this reads the price out of the error instead of firing a second --dry-run request, and
// offers a button that reruns this one search, once, with --max-cost just above it -- not a change to the Details
// field, so the next search still uses what was there before.
const addCostRetry = (j, p, into) => {
  const price = /needs a terminal to confirm on/.test(j.error ?? '') && /\$([\d.]+)/.exec(j.error)?.[1];
  if (!price) return;
  const bump = (Math.round((Number(price) + 0.01) * 100) / 100).toFixed(2);
  const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Search anyway (--max-cost ' + bump + ')';
  b.onclick = () => {
    if (running) return;
    gen++; ctl = new AbortController(); busy(true); into.textContent = 'searching...';
    get('results', { ...p, 'max-cost': bump }, into);
  };
  into.append(document.createElement('br'), b);
};
const run = kind => {
  const p = show(), left = document.getElementById('left'), right = document.getElementById('right');
  if (running) return;
  const s = p.x.indexOf('S:');
  if (s === 0 || !p.x.length) { left.textContent = 'Enter a meaning.'; return; }
  if (s === p.x.length - 1) { left.textContent = 'Enter an end (--step-to).'; return; }
  gen++; ctl = new AbortController(); busy(true); onScreen = null; ask.hidden = true;
  left.textContent = 'searching...';
  const sum = kind === 'results' && p.summarize && !p.x.some(x => x[0] === 'S');
  document.getElementById('m').className = sum ? 'two' : '';
  right.hidden = !sum; right.textContent = sum ? 'summarizing...' : '';
  const mine = gen;
  // #231: one search, not two. Reserve the summarize step's slot so busy(false) does not fire in the gap between the
  // results arriving and the summarize request starting; get('summarize', ...) below takes over the reservation (both
  // happen in the same synchronous turn, so running never drops to 0 in between).
  if (sum) running++;
  get(kind, p, left).then(j => {
    if (kind === 'results' && mine === gen) addCostRetry(j, p, left);
    if (!sum) return;
    if (mine !== gen) { running = Math.max(0, running - 1); return; }
    if (!(j.text || j.html)) { show1(j, right); running = Math.max(0, running - 1); if (running === 0) busy(false); return; }
    running--;
    const frame = left.querySelector('iframe');
    const text = frame ? frame.contentDocument.body.innerText : left.textContent;
    get('summarize', { ...p, 'summarize-prompt': read()['summarize-prompt'] }, right, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: text });
  });
};
const go = () => run('results');
// #227: checking summarize while results are on screen asks whether to summarize those results as they are. OK posts
// their text (what the page shows) and only the summarizer runs; Not now leaves the box checked for the next Search.
// The search they came from is kept, so a field or control changed since is said in the question.
let onScreen = null;
const ask = document.getElementById('ask'), askq = document.getElementById('askq'), askOk = document.getElementById('ask-ok'), askNo = document.getElementById('ask-no');
const ASK = {
  en: ['Summarize the results on screen as they are?', 'The results on screen are from before the fields or options changed. Summarize them as they are anyway?', 'OK', 'Not now'],
  ja: ['表示中の結果をそのまま要約しますか？', '表示中の結果は、欄やオプションを変える前のものです。それでもそのまま要約しますか？', 'OK', '今はしない'],
};
const searchOf = p => { const q = query(p); q.delete('summarize'); q.delete('summarize-prompt'); return String(q); };
const drawAsk = () => {
  const p = read(), [q, stale, ok, no] = ASK[exLang];
  if (!p.summarize || !onScreen || running || p.x.some(x => x[0] === 'S')) { ask.hidden = true; return; }
  ask.lang = exLang; askq.textContent = searchOf(p) === searchOf(onScreen) ? q : stale; askOk.textContent = ok; askNo.textContent = no;
};
f.elements.summarize.addEventListener('change', () => { ask.hidden = !f.elements.summarize.checked; drawAsk(); });
askNo.onclick = () => { ask.hidden = true; };
askOk.onclick = () => {
  if (!onScreen || running) return;
  const left = document.getElementById('left'), right = document.getElementById('right'), frame = left.querySelector('iframe');
  const text = frame ? frame.contentDocument.body.innerText : left.textContent;
  ask.hidden = true;
  gen++; ctl = new AbortController(); busy(true);
  document.getElementById('m').className = 'two'; right.hidden = false; right.textContent = 'summarizing...';
  get('summarize', { ...onScreen, 'summarize-prompt': read()['summarize-prompt'] }, right, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: text });
};
f.onsubmit = e => { e.preventDefault(); go(); return false; };
document.getElementById('est').onclick = () => run('dry');
document.getElementById('add').onclick = () => addField('a').children[1].focus();
document.getElementById('addend').onclick = () => addField('e', '', ends).children[1].focus();
// The examples in English or Japanese (#215), remembered per browser; a blocked storage means English. --suggest's
// pills are the user's own text and stay as given.
const exRow = document.getElementById('ex'), exLangs = { en: document.getElementById('ex-en'), ja: document.getElementById('ex-ja') };
let exLang = 'en';
try { if (localStorage.getItem('exlang') === 'ja') exLang = 'ja'; } catch {}
const drawEx = () => {
  for (const k in exLangs) exLangs[k].setAttribute('aria-pressed', String(k === exLang));
  while (exRow.children.length > 1) exRow.lastChild.remove();
  let grp = null;
  for (const e of [...SUGGEST, ...EXAMPLES]) {
    const ex = exLang === 'ja' ? { ...e, h: e.hj ?? e.h, x: e.xj ?? e.x } : e;
    if (ex.x.includes('S:') && !grp) { grp = document.createElement('span'); grp.className = 'note grp'; grp.lang = exLang; grp.textContent = exLang === 'ja' ? '多段階' : 'multi-step'; exRow.append(grp); }
    const b = exButton(ex);
    if (!e.q) b.lang = exLang; // a --suggest pill is the user's text, in whatever language they wrote it
    exRow.append(b);
  }
};
for (const k in exLangs) exLangs[k].onclick = () => { exLang = k; try { localStorage.setItem('exlang', k); } catch {} drawEx(); if (!ask.hidden) drawAsk(); };
const exButton = ex => {
  const s = ex.x.indexOf('S:');
  const b = document.createElement('button'); b.type = 'button'; b.textContent = ex.h;
  b.title = ex.q ? 'suggested at launch (--suggest): ' + (ex.q === 'Q' ? 'a question (-Q)' : 'a meaning (-e)') + '; fills the page, then press Search' : 'an example: fills the page with this search, then press Search';
  b.onclick = () => {
    step.checked = s >= 0; fields.textContent = ''; ends.textContent = '';
    ex.x.forEach((t, i) => i !== s && addField(t[0], t.slice(2), s >= 0 && i > s ? ends : fields));
    if (s < 0) addField('e', '', ends);
    setControls(ex); show();
  };
  return b;
};
drawEx();
document.getElementById('copy').onclick = e => navigator.clipboard.writeText(cmd.textContent).then(() => { e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1200); });
f.addEventListener('input', show); f.addEventListener('change', show);
setControls(INIT);
addField().children[1].focus(); addField('e', '', ends);
// the settings panel: read when opened, saved on the button; a key field stays empty (a key never comes back from the server)
const sf = document.getElementById('sf'), sd = document.getElementById('sd'), sst = document.getElementById('sst'), gear = document.getElementById('gear');
const SFIELDS = ['url', 'model', 'key', 'opts', 'summarizer', 'summarizerModel', 'summarizerKey'], SKEYS = ['key', 'summarizerKey'];
const SAID = { cmd: () => 'the command line wins over this', env: n => n + ' in the environment wins over this', settings: () => 'in effect', '.env': () => 'in effect: ~/.config/sys1grep/.env', default: () => 'not set: the default' };
const fillSettings = view => {
  for (const k of SFIELDS) {
    const [saved, src, name] = view[k], el = sf.elements['set-' + k];
    if (SKEYS.includes(k)) { el.value = ''; el.placeholder = saved ? 'saved; type to replace' : 'not saved'; sf.elements['clear-' + k].checked = false; }
    else el.value = k === 'opts' ? (saved ?? []).join('\\n') : saved ?? '';
    document.getElementById('src-' + k).textContent = SAID[src](name);
  }
};
const settingsReq = async (method, body) => {
  const r = await fetch('/settings', { method, body, headers: { 'x-sys1grep-token': TOKEN, 'content-type': 'application/json' } });
  const j = await r.json().catch(() => ({ error: r.status + ' ' + r.statusText }));
  if (!r.ok) throw new Error(j.error);
  return j;
};
let bodyOverflow;
gear.onclick = () => {
  sst.textContent = '';
  settingsReq('GET').then(fillSettings, e => { sst.textContent = e.message; });
  bodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  sd.showModal();
};
document.getElementById('sdx').onclick = () => sd.close();
sd.onclick = e => { if (e.target === sd) sd.close(); };
sd.onclose = () => { document.body.style.overflow = bodyOverflow; gear.focus(); };
document.getElementById('save').onclick = () => {
  const p = {};
  for (const k of SFIELDS) {
    const v = sf.elements['set-' + k].value;
    if (SKEYS.includes(k)) { if (sf.elements['clear-' + k].checked) p[k] = null; else if (v) p[k] = v; }
    else p[k] = k === 'opts' ? v.split('\\n').map(a => a.trim()).filter(Boolean) : v.trim();
  }
  return settingsReq('POST', JSON.stringify(p)).then(view => { fillSettings(view); sst.textContent = 'saved; the next search uses it'; }, e => { sst.textContent = 'not saved: ' + e.message; });
};
// hint tooltips: hover (mouse only) and keyboard focus of the "?" are pure CSS; tap toggles .open on the icon's
// group (a tap elsewhere or Esc closes every open one), so a touch screen reaches them without a pointer that hovers.
// every "?" this page has: the four hand-written ones plus every hg()-built one in Details, so a new hg() call
// never needs this list touched by hand.
const HINTS = ['step', 'edges', 'rank', 'summarize', 'level', 't', 'T', 'C', 'A', 'B', 'autoscope', 'n', 'p', 'dedup', 'unit', 'o', 'j', 'maxcost', 'include', 'exclude', 'changed', 'g'];
const hintEls = HINTS.map(n => ({ n: n, b: document.getElementById('q-' + n), g: document.getElementById('hg-' + n) }));
// CSS places each tooltip next to its icon (left-aligned by default, right-aligned for rank/summarize, upward for
// multi-step/edges) until this measures it and moves it where it fits. Every layout read happens right-aligned to the icon: a tooltip laid
// out across the right edge, even for one measurement, makes a mobile browser widen its viewport (#214 review: the
// right column of Details cut off on a tap), and one across the left edge does not. From there a translateX puts it
// beside the icon -- left-aligned on the left half of the page, right-aligned on the right half -- and inside the 16px
// margin. An upward tooltip that would cross the top opens downward, a downward one past the bottom opens upward,
// and downward when neither fits. clientWidth/clientHeight: the layout viewport, without a classic scrollbar.
// Runs for every id in HINTS, so a hg()-built hint gets it too.
const clampHint = n => {
  const hint = document.getElementById('hint-' + n), s = hint.style, de = document.documentElement;
  s.transform = s.top = s.bottom = s.marginTop = s.marginBottom = '';
  s.left = 'auto'; s.right = '0';
  if (getComputedStyle(hint).position === 'fixed') { s.left = s.right = ''; return; } // <=480px: the bottom banner
  const W = de.clientWidth, H = de.clientHeight, ib = hint.parentElement.getBoundingClientRect(), r = hint.getBoundingClientRect();
  if (!r.width) return; // not shown yet (display: none)
  const x = Math.max(16, Math.min(ib.left + ib.right > W ? r.left : ib.left, W - 16 - r.width));
  if (x !== r.left) s.transform = 'translateX(' + (x - r.left) + 'px)';
  const down = () => { s.top = '100%'; s.bottom = 'auto'; s.marginTop = '6px'; s.marginBottom = '0'; };
  if (r.bottom <= ib.top) { if (r.top < 0) down(); }
  else if (r.bottom > H) { s.top = 'auto'; s.bottom = '100%'; s.marginTop = '0'; s.marginBottom = '6px'; if (hint.getBoundingClientRect().top < 0) down(); }
};
for (const { n, b } of hintEls) {
  b.parentElement.addEventListener('mouseenter', () => clampHint(n));
  b.addEventListener('focus', () => clampHint(n));
}
// blur(): Esc (and a tap elsewhere) must drop real keyboard focus too, or :focus-visible keeps a tap-opened hint's
// tooltip visible after .open is gone (r2 review); except: the "?" being toggled keeps focus, so Enter/Space on it
// leaves focus (and the screen reader) on the control whose aria-expanded just changed (#214 review).
const closeHints = except => { for (const { b, g } of hintEls) { b.setAttribute('aria-expanded', 'false'); g.classList.remove('open'); if (b !== except) b.blur(); } };
for (const { n, b, g } of hintEls) b.onclick = e => { e?.stopPropagation?.(); const was = g.classList.contains('open'); closeHints(b); if (!was) { b.setAttribute('aria-expanded', 'true'); g.classList.add('open'); clampHint(n); } };
document.addEventListener('click', () => closeHints());
// a resize moves the icons; a tooltip left open would keep the placement measured for the old width
window.addEventListener('resize', () => closeHints());
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHints(); });
</script></body></html>`;

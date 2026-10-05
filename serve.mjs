// sys1grep --serve [PORT] (#166): a page with a search box on 127.0.0.1. Each search runs sys1grep itself as a child,
// with the launch arguments plus what the page's controls changed, so the page cannot do what the command line cannot.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { parseArgs, parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { FIELDS, maskOpts, maskUrl, readSettings, writeSettings } from './settings.mjs';

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
    const env = names.find(n => process.env[n] !== undefined);
    const saved = KEYS.has(f) ? s[f] !== undefined : f === 'opts' ? (s.opts ? maskOpts(s.opts) : null) : f === 'url' ? (s.url ? maskUrl(s.url) : null) : s[f] ?? null;
    const src = cli[f] !== undefined ? ['cmd'] : env ? ['env', env] : s[f] !== undefined ? ['settings'] : names.some(n => dotenv[n] !== undefined) ? ['.env'] : ['default'];
    return [f, [saved, ...src]];
  }));
};
// --serve itself refuses REFUSED (below) at launch: the page replaces these, or their meaning comes from the page.
// The settings panel's opts refuses the same set, plus sys1-url/sys1-api-key (their own fields) and a bare target
// (which would become a positional). sys1grep.mjs is still the real gate (SYS1GREP_OPTS already dies on a
// positional, #196), so this is an early, specific error at save time rather than a cryptic one on the next search.
// VALUED: options this build of sys1grep.mjs takes a separate value for, so that value is not mistaken for a
// target; kept in sync with sys1grep.mjs's OPTIONS by the offline.sh cases that exercise both a VALUED option and a
// rejection.
const REFUSED = /^(-[eavQlcqoziHV]|-[eavQ].+|--(question|step-to|format|color|verbose|dry-run|interactive|help|version|install-templates|quiet|null-data)(=.*)?)$/;
const VALUED = new Set(['-j', '-A', '-B', '-C', '-M', '--unit', '--dedup', '--rank', '--edges', '--hops', '--max-columns',
  '--max-filesize', '--max-cost', '--include', '--exclude', '--changed-within', '--color', '--summarize',
  '--summarize-prompt', '--format', '--template', '--sys1-model', '--level', '-t', '-T']);
const optsError = opts => {
  for (const [i, tok] of opts.entries()) {
    if (tok === '--') return `${tok} is not allowed (it would start positionals)`;
    if (REFUSED.test(tok)) return `${tok} is not allowed (meanings, targets and output shape go on the command line)`;
    if (/^--sys1-(url|api-key)(=|$)/.test(tok)) return `${tok} is not allowed (use the url / key field instead)`;
    if (!tok.startsWith('-') && !(VALUED.has(opts[i - 1]) && !opts[i - 1].includes('='))) return `${tok} is not allowed (it would be a target, which goes on the command line)`;
  }
  return null;
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
      // An unchanged round trip skips optsError on purpose: a file written before this refusal existed, or edited
      // by hand, could already hold something optsError would now reject (a positional, say); resending it as-is
      // must not break (sys1grep.mjs still refuses it on the next search), only a real edit is validated here.
      if (Array.isArray(next.opts) && JSON.stringify(v) === JSON.stringify(maskOpts(next.opts))) value = next.opts;
      else { const e = optsError(v); if (e) throw new Error(`opts: ${e}`); }
    }
    if (k === 'url' && typeof v === 'string' && v) {
      if (typeof next.url === 'string' && v === maskUrl(next.url)) value = next.url;
      else if (!isHttpUrl(v)) throw new Error('url must be http(s)');
    }
    if (k === 'summarizer' && typeof v === 'string' && /^https?:\/\//.test(v) && !isHttpUrl(v)) throw new Error('summarizer must be http(s) when it is a URL');
    if (value === null || value === '' || (Array.isArray(value) && !value.length)) delete next[k];
    else next[k] = value;
  }
  writeSettings(next);
};
const body = req => new Promise((resolve, reject) => {
  let b = '';
  req.setEncoding('utf8');
  req.on('data', c => { b += c; if (b.length > 1 << 16) { reject(new Error('too large')); req.destroy(); } });
  req.on('end', () => resolve(b));
  req.on('error', reject);
});

// The page's controls. toArgv() (below) turns their values into command-line tokens, in the server to run a search and
// in the browser to print the command: one function, so the two cannot drift. A value equal to its launch value is left out.
// re: what the server accepts; bool: a checkbox, neg its negation; words: one token per word; step: only with a --step-to field.
const CONTROLS = [
  { k: 'rank', flag: '--rank', re: '^(jev|match)?$', nostep: true, def: '' },
  { k: 'level', flag: '--level', re: '^(loose|normal|strict)$' },
  { k: 't', flag: '-t', re: '^(\\d+(\\.\\d+)?)?$' },
  { k: 'T', flag: '-T', re: '^(\\d+(\\.\\d+)?)?$' },
  { k: 'C', flag: '-C', re: '^\\d*$', nostep: true },
  { k: 'dedup', flag: '--dedup', re: '^(never|auto|always)$', nostep: true, def: 'never' },
  { k: 'unit', flag: '--unit', re: '^(line|sentence-by-jev|sentence-by-rule)$', nostep: true, def: 'line' },
  { k: 'auto-scope', flag: '--auto-scope', neg: '--no-auto-scope', bool: true },
  { k: 'n', flag: '-n', neg: '--no-n', bool: true },
  { k: 'p', flag: '-p', neg: '--no-p', bool: true },
  { k: 'g', flag: '-g', neg: '--no-gitlog', bool: true, nostep: true, def: false },
  { k: 'include', flag: '--include', words: true },
  { k: 'exclude', flag: '--exclude', words: true },
  { k: 'changed-within', flag: '--changed-within' },
  { k: 'hops', flag: '--hops', re: '^[\\d.]*$', step: true, def: '0..' },
  { k: 'reverse', flag: '--reverse', neg: '--no-reverse', bool: true, step: true, def: false },
];
const FIELD = /^[eavQS]:/; // an expression field: e:MEANING (-e), a, v, Q (-Q), S: (--step-to)
// The example buttons, each from README, docs/use-cases.md or --help: x as the page sends it, then the controls it sets (by k).
// Pressing one puts the page in that state: the rest go back to their launch values; an S: in x turns multi-step on.
const EXAMPLES = [
  { h: 'meaning, not words', x: ['e:customer is angry or frustrated'], n: true },
  { h: 'a question (-Q)', x: ['Q:whether the server is down'], n: true },
  { h: 'either meaning, with scores (-p)', x: ['e:customer is asking for a refund', 'e:delivery address change request'], n: true, p: true },
  { h: 'exclude with -v', x: ['e:network or remote connection failure', 'v:a retry is happening or was attempted'], n: true },
  { h: 'regex and meaning together', x: ['e:/catch/', 'a:the error is ignored'], n: true, p: true },
  { h: 'stricter (--level strict)', x: ['e:a security risk or dangerous destructive operation'], level: 'strict', n: true },
  { h: 'one line per template (--dedup)', x: ['e:a request failed'], dedup: 'always', n: true },
  { h: 'one sentence at a time', x: ['e:the author admits they made a mistake'], unit: 'sentence-by-jev', n: true },
  { h: 'calls that raise', x: ['e:/^ *def main/', 'S:', 'e:/raise /'] },
  { h: '1 to 2 calls away', x: ['e:/^ *def main/', 'S:', 'e:/raise /'], hops: '1..2' },
  { h: 'who calls it (--reverse)', x: ['e:/^ *def helper/', 'S:', 'e:/^ *def main/'], reverse: true },
  { h: 'raise or exit (two ends)', x: ['e:/^ *def main/', 'S:', 'e:/raise /', 'e:/sys\\.exit/'] },
];

// p: the page's values (x: the fields, then one value per control and summarize / summarize-prompt); init: the launch's.
const toArgv = (p, init) => {
  const v = k => p[k] ?? init[k], out = [];
  const step = (p.x ?? init.x).some(f => f[0] === 'S');
  for (const f of v('x')) {
    if (f[0] === 'S') out.push('--step-to');
    else if (f.slice(2)) out.push(`-${f[0]}`, f.slice(2));
  }
  for (const c of CONTROLS) {
    const off = (c.step && !step) || (c.nostep && step); // what does not apply goes back to its default, over a launch value
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
const initOf = launch => {
  const fill = { '--rank': '--rank=jev', '--summarize': '--summarize=x', '--dedup': '--dedup=always', '--no-rank': '--rank=\0', '--no-summarize': '--summarize=\0' };
  const { values: o } = parseArgs({
    args: launch.map(a => fill[a] ?? a), strict: false, allowPositionals: true, allowNegative: true,
    options: { rank: { type: 'string' }, level: { type: 'string' }, t: { type: 'string' }, T: { type: 'string' }, C: { type: 'string' },
      dedup: { type: 'string' }, unit: { type: 'string' }, 'auto-scope': { type: 'boolean' }, n: { type: 'boolean' }, p: { type: 'boolean' },
      g: { type: 'boolean' }, include: { type: 'string', multiple: true }, exclude: { type: 'string', multiple: true },
      'changed-within': { type: 'string' }, hops: { type: 'string' }, reverse: { type: 'boolean' }, summarize: { type: 'string' },
      'summarize-prompt': { type: 'string' } },
  });
  const rank = o.rank === undefined || o.rank === '\0' ? '' : ['jev', 'match'].includes(o.rank) ? o.rank : 'jev'; // a bare --rank swallows the next word
  return { x: [], rank, level: o.level ?? 'normal', t: o.t ?? '', T: o.T ?? '', C: o.C ?? '', dedup: o.dedup ?? 'never', unit: o.unit ?? 'line',
    'auto-scope': o['auto-scope'] ?? true, n: !!o.n, p: !!o.p, g: !!o.g, include: (o.include ?? []).join(' '), exclude: (o.exclude ?? []).join(' '),
    'changed-within': o['changed-within'] ?? '', hops: o.hops ?? '0..', reverse: !!o.reverse, summarize: o.summarize !== undefined && o.summarize !== '\0',
    'summarize-prompt': '' };
};

// What the page replaces or the meaning of which comes from the page: refused at launch.
// --NAME VALUE or --NAME=VALUE out of the arguments: [the rest, the value]
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

export function serve(argv) {
  const at = argv.findIndex(a => /^--serve(=|$)/.test(a)), port = argv[at].slice(8);
  if (port && !(/^\d+$/.test(port) && Number(port) < 65536)) throw new Error(`--serve=${port}: not a port number`);
  const rest = argv.filter((_, i) => i !== at), dd = rest.indexOf('--');
  const before = dd < 0 ? rest : rest.slice(0, dd), after = dd < 0 ? [] : rest.slice(dd);
  // the key stays in this process (never in the page or the command shown); the summary instruction is a control, not a launch option
  const [noKey, key] = lift(before, 'sys1-api-key'), [launch, prompt] = lift(noKey, 'summarize-prompt');
  const bad = launch.find(a => REFUSED.test(a));
  if (bad) throw new Error(`--serve: ${bad.split('=')[0]} is not for --serve (the page sets the meaning and shows the results as html)`);
  const init = { ...initOf(launch), 'summarize-prompt': prompt ?? '' };
  const secret = key === undefined ? [] : [`--sys1-api-key=${key}`];
  const cli = { url: lift(launch, 'sys1-url')[1], model: lift(launch, 'sys1-model')[1], key };
  const token = randomBytes(16).toString('hex');
  const summarizeAsked = init.summarize;
  const script = process.argv[1];
  const tpl = launch.some(a => a.startsWith('--template')) ? [] : ['--template=search'];
  const run = (args, signal) => new Promise(resolve => {
    const child = execFile(process.execPath, [script, ...launch, ...secret, ...args, ...after], { signal, maxBuffer: 1 << 28 },
      (e, out, err) => resolve({ code: e ? (typeof e.code === 'number' ? e.code : 2) : 0, out, err }));
    child.stdin.end(); // no targets means stdin: an empty one, not a hang
  });

  const search = async (p, kind, signal) => {
    const pk = { ...p, summarize: kind === 'summary' }, step = (p.x).some(f => f[0] === 'S');
    const args = toArgv(pk, init);
    if (kind === 'dry') args.push('--dry-run', '--no-summarize');
    else if (kind === 'summary') args.push('--format=plain');
    else if (!step && (pk.rank ?? init.rank)) args.push('--format=html', ...tpl);
    const { code, out, err } = await run([`--color=${kind === 'results' ? 'always' : 'never'}`, ...args], signal);
    if (code > 1) return { error: err.trim() || `exit ${code}` };
    if (code === 1 && !out) return { none: true, note: err.trim() };
    return kind === 'results' && !step && (p.rank ?? init.rank) ? { html: out.replace('</head>', '<style>.bar{display:none}</style></head>') } : { text: out };
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), host = req.headers.host;
    const send = (code, type, body) => {
      res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-frame-options': 'DENY', ...(type === 'application/json' ? { 'x-content-type-options': 'nosniff' } : {}) });
      res.end(body);
    };
    // a page on another site (or a rebound name) must not be able to start a search
    if (host !== `127.0.0.1:${server.address().port}` && host !== `localhost:${server.address().port}`) return send(403, 'text/plain', 'forbidden');
    // Every route, the page itself included, needs this launch's token: in the query (?k=, what the startup line and
    // any browser open carry) or in a header (what the page's own fetch() calls send instead). Without it this
    // server answers nothing, not even the page, so another local account or process cannot read the page (and the
    // token it carries, and anything a search of these targets would show) merely by knowing the port.
    if (url.searchParams.get('k') !== token && req.headers['x-sys1grep-token'] !== token) return send(404, 'text/plain', 'not found');
    if (url.pathname === '/') return send(200, 'text/html', page({ init, launch, after, token }));
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
          try { patch = JSON.parse(await body(req)); } catch { return answer(400, { error: 'not valid JSON' }); }
          try { saveSettings(patch); } catch (e) { return answer(400, { error: e.message }); }
        } else if (req.method !== 'GET') return send(405, 'text/plain', 'GET or POST');
        return answer(200, settingsView(cli));
      } catch (e) { return answer(500, { error: `~/.config/sys1grep/settings.json: ${e.message}` }); }
    }
    const kind = url.pathname.slice(1);
    if (!['results', 'summary', 'dry'].includes(kind) || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) return send(404, 'text/plain', 'not found');
    const p = fromQuery(url.searchParams, init);
    if (!p) return send(400, 'text/plain', 'bad value');
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    send(200, 'application/json', JSON.stringify(await search(p, kind, ac.signal)));
  });
  server.on('error', e => { console.error(`sys1grep: --serve: ${e.message}`); process.exit(2); });
  server.listen(Number(port) || 0, '127.0.0.1', () => {
    console.log(`http://127.0.0.1:${server.address().port}/?k=${token}`);
    if (summarizeAsked) console.error('sys1grep: --serve: the summary runs the search again, one more request per search');
  });
}

const json = x => JSON.stringify(x).replace(/</g, '\\u003c');
const page = ({ init, launch, after, token }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>sys1grep</title>
<style>
:root { --bg: #fff; --fg: #202124; --muted: #5f6368; --rule: #dadce0; --link: #1a0dab; --code: #f8f9fa; }
@media (prefers-color-scheme: dark) { :root { --bg: #202124; --fg: #e8eaed; --muted: #9aa0a6; --rule: #3c4043; --link: #8ab4f8; --code: #2a2b2e; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 arial, "Hiragino Sans", "Noto Sans CJK JP", sans-serif; }
header { border-bottom: 1px solid var(--rule); padding: 12px 16px; }
.in, main { max-width: 1200px; margin: 0 auto; }
.logo { font-size: 22px; font-weight: 700; color: var(--link); margin-right: 12px; }
.row { display: flex; gap: 8px; align-items: center; margin: 6px 0; flex-wrap: wrap; }
.row input[type=text] { flex: 1; min-width: 200px; padding: 8px 14px; font-size: 15px; border: 1px solid var(--rule); border-radius: 18px; background: var(--bg); color: var(--fg); }
select, button, input { font: inherit; color: var(--fg); }
button, select { background: var(--bg); border: 1px solid var(--rule); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
#cmd { flex: 1; margin: 0; padding: 6px 10px; background: var(--code); border-radius: 4px; font: 12px/1.5 ui-monospace, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
details { margin: 6px 0; } summary { cursor: pointer; color: var(--muted); }
summary.dot::after { content: " \\25CF"; color: var(--link); }
.grid { display: grid; gap: 12px 20px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); padding: 8px 0; }
.grid label { display: flex; flex-direction: column; gap: 2px; color: var(--muted); } .grid label.chk { flex-direction: row; align-items: center; gap: 6px; }
main { padding: 0 16px 48px; display: grid; gap: 16px; grid-template-columns: 1fr; } main.two { grid-template-columns: 3fr 2fr; }
@media (max-width: 800px) { main.two { grid-template-columns: 1fr; } }
iframe { width: 100%; border: 0; min-height: 80px; } pre.out { white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.5 ui-monospace, Menlo, monospace; }
.c32 { color: #188038; } .c35 { color: #a142f4; } .c36 { color: #129eaf; } .c31 { color: #d93025; } .c33 { color: #b06000; } .c01_31 { color: #d93025; font-weight: 700; } .c01_33 { color: #b06000; font-weight: 700; background: #fff3b055; }\n@media (prefers-color-scheme: dark) { .c32 { color: #81c995; } .c35 { color: #d7aefb; } .c36 { color: #78d9ec; } .c31, .c01_31 { color: #f28b82; } .c33, .c01_33 { color: #fdd663; } }\nbutton:disabled { opacity: .45; cursor: default; } #ex button { border-radius: 999px; } #ex .grp { border-left: 1px solid var(--rule); padding-left: 8px; }
.err { color: #d93025; white-space: pre-wrap; } .note { color: var(--muted); }
#right { border-left: 1px solid var(--rule); padding-left: 16px; }
</style></head><body>
<header><div class="in"><form id="f" autocomplete="off" onsubmit="return false">
<div id="fields"></div>
<div id="steps" hidden><div class="row"><span class="note">end (--step-to)</span><button type="button" id="addend" title="add an end">+</button></div>
<div id="ends"></div>
<div class="row"><span class="note">edges</span><label>--hops <input name="hops" size="6"></label><label><input type="checkbox" name="reverse"> --reverse</label></div></div>
<div class="row"><span class="logo">sys1grep</span>
<button type="button" id="add" title="add a field">+</button>
<label><input type="checkbox" id="step"> multi-step</label>
<label>rank <select name="rank"><option value="">off</option><option value="jev">jev</option><option value="match">match</option></select></label>
<label><input type="checkbox" name="summarize"> summarize</label>
<input type="text" name="summarize-prompt" placeholder="summary instruction" style="display:none;flex:1;min-width:160px">
<button type="submit" id="go">Search</button><button type="button" id="est">Estimate cost</button><button type="button" id="stop" disabled>Stop</button></div>
<div class="row" id="ex"><span class="note">examples</span></div>
<div class="row"><pre id="cmd"></pre><button type="button" id="copy">Copy</button></div>
<details id="d"><summary id="ds">Details</summary><div class="grid">
<label>level <select name="level"><option>loose</option><option>normal</option><option>strict</option></select></label>
<label>-t <input name="t" size="5" inputmode="decimal"></label><label>-T <input name="T" size="5" inputmode="decimal"></label>
<label>context lines (-C) <input name="C" size="3" inputmode="numeric"></label>
<label class="chk"><input type="checkbox" name="auto-scope"> auto-scope</label>
<label class="chk"><input type="checkbox" name="n"> -n line numbers</label><label class="chk"><input type="checkbox" name="p"> -p scores</label>
<label>dedup <select name="dedup"><option>never</option><option>auto</option><option>always</option></select></label>
<label>unit <select name="unit"><option>line</option><option>sentence-by-jev</option><option>sentence-by-rule</option></select></label>
<label>--include <input name="include"></label><label>--exclude <input name="exclude"></label>
<label>--changed-within <input name="changed-within" placeholder="2h, 7d, a date"></label><label class="chk"><input type="checkbox" name="g"> -g git log</label>
</div></details></form>
<details id="sd"><summary>Settings</summary><form id="sf" autocomplete="off" onsubmit="return false"><div class="grid">
<label>url <input name="set-url" placeholder="https://api.typesafe.ai/v1/systemone"><small class="note" id="src-url"></small></label>
<label>model <input name="set-model" placeholder="jev-latest"><small class="note" id="src-model"></small></label>
<label>key <input type="password" name="set-key" autocomplete="new-password"><small class="note" id="src-key"></small><span class="chk"><input type="checkbox" name="clear-key"> remove</span></label>
<label>opts, one argument per line <textarea name="set-opts" rows="3"></textarea><small class="note" id="src-opts"></small></label>
<label>summarizer <input name="set-summarizer" placeholder="claude"><small class="note" id="src-summarizer"></small></label>
<label>summarizerModel <input name="set-summarizerModel"><small class="note" id="src-summarizerModel"></small></label>
<label>summarizerKey <input type="password" name="set-summarizerKey" autocomplete="new-password"><small class="note" id="src-summarizerKey"></small><span class="chk"><input type="checkbox" name="clear-summarizerKey"> remove</span></label>
</div><div class="row"><button type="button" id="save">Save to ~/.config/sys1grep/settings.json</button><span class="note" id="sst"></span></div></form></details>
</div></header>
<main id="m"><div id="left"></div><div id="right" hidden></div></main>
<script>
const CONTROLS = ${json(CONTROLS)}, INIT = ${json(init)}, LAUNCH = ${json(launch)}, AFTER = ${json(after)}, TOKEN = ${json(token)}, EXAMPLES = ${json(EXAMPLES)};
const toArgv = ${toArgv};
const quote = (s, force) => (!force && /^[\\w@%+=:,./-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\\\''") + "'");
const shown = argv => argv.map((t, i) => (/^-[eavQ]$/.test(argv[i - 1] ?? '') ? quote(t, t[0] === '-') : /^--[a-z-]+=/.test(t) ? t.replace(/=([\\s\\S]*)/, (_, v) => '=' + quote(v)) : quote(t)));
const f = document.getElementById('f'), fields = document.getElementById('fields'), cmd = document.getElementById('cmd');
const step = document.getElementById('step'), steps = document.getElementById('steps'), ends = document.getElementById('ends');
const ALL = [...CONTROLS, { k: 'summarize', bool: true }, { k: 'rank' }, { k: 'summarize-prompt' }];
const setControls = v => { for (const c of ALL) { const el = f.elements[c.k], x = v[c.k] ?? INIT[c.k]; if (c.bool) el.checked = !!x; else el.value = x; } };
const LABELS = { e: '-e meaning', a: '-a and', v: '-v and not', Q: '-Q question' };
const addField = (k = 'e', t = '', into = fields) => {
  const r = document.createElement('div'); r.className = 'row'; r.innerHTML = '<select>' + Object.entries(LABELS).map(([k, l]) => '<option value="' + k + '">' + l + '</option>').join('') + '</select><input type="text" placeholder="meaning">';
  r.firstChild.value = k; r.lastChild.value = t;
  r.firstChild.onchange = show;
  r.lastChild.oninput = show; r.lastChild.onkeydown = e => { if (e.key === 'Enter') go(); };
  if (into.children.length) { const x = document.createElement('button'); x.type = 'button'; x.textContent = '\\u00d7'; x.onclick = () => { r.remove(); show(); }; r.append(x); }
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
  steps.hidden = !multi;
  f.elements.rank.disabled = f.elements.summarize.disabled = multi;
  f.elements['summarize-prompt'].style.display = p.summarize && !multi ? '' : 'none';
  cmd.textContent = ['sys1grep', ...LAUNCH.map(t => quote(t)), ...shown(toArgv(p, INIT)), ...AFTER.map(t => quote(t))].join(' ');
  document.getElementById('ds').className = CONTROLS.some(c => !['rank'].includes(c.k) && !c.step && p[c.k] !== INIT[c.k] && !(c.nostep && multi)) ? 'dot' : '';
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
const get = async (kind, p, into) => {
  const mine = gen;
  running++;
  try {
    const r = await fetch('/' + kind + '?' + query(p), { signal: ctl.signal }), j = await r.json().catch(() => ({ error: 'bad answer' }));
    if (mine === gen) show1(j, into);
  } catch (e) {
    if (mine === gen) show1({ error: String(e) }, into);
  } finally {
    running = Math.max(0, running - 1);
    if (running === 0 && mine === gen) busy(false);
  }
};
const show1 = (j, into) => {
  into.textContent = '';
  if (j.error) { const e = document.createElement('div'); e.className = 'err'; e.textContent = j.error; into.append(e); }
  else if (j.none) { const e = document.createElement('div'); e.className = 'note'; e.textContent = 'no matches' + (j.note ? ' (' + j.note + ')' : ''); into.append(e); }
  else if (j.html) { const i = document.createElement('iframe'); i.sandbox = 'allow-same-origin'; i.srcdoc = j.html; i.onload = () => { i.style.height = i.contentDocument.documentElement.scrollHeight + 'px'; }; into.append(i); }
  else { const e = document.createElement('pre'); e.className = 'out'; ansi(j.text, e); into.append(e); }
};
document.getElementById('stop').onclick = () => {
  ctl.abort(); gen++; running = 0; busy(false);
  for (const el of [document.getElementById('left'), document.getElementById('right')]) if (!el.hidden && /\.\.\.$/.test(el.textContent)) el.textContent = 'stopped';
};
const run = kind => {
  const p = show(), left = document.getElementById('left'), right = document.getElementById('right');
  if (running) return;
  const s = p.x.indexOf('S:');
  if (s === 0 || !p.x.length) { left.textContent = 'Enter a meaning.'; return; }
  if (s === p.x.length - 1) { left.textContent = 'Enter an end (--step-to).'; return; }
  gen++; ctl = new AbortController(); busy(true);
  left.textContent = 'searching...';
  const sum = kind === 'results' && p.summarize && !p.x.some(x => x[0] === 'S');
  document.getElementById('m').className = sum ? 'two' : '';
  right.hidden = !sum; right.textContent = sum ? 'summarizing...' : '';
  get(kind, p, left);
  if (sum) get('summary', p, right);
};
const go = () => run('results');
f.onsubmit = e => { e.preventDefault(); go(); return false; };
document.getElementById('est').onclick = () => run('dry');
document.getElementById('add').onclick = () => addField('a').children[1].focus();
document.getElementById('addend').onclick = () => addField('e', '', ends).children[1].focus();
let grp = null;
for (const ex of EXAMPLES) {
  const s = ex.x.indexOf('S:'), row = document.getElementById('ex');
  if (s >= 0 && !grp) { grp = document.createElement('span'); grp.className = 'note grp'; grp.textContent = 'multi-step'; row.append(grp); }
  const b = document.createElement('button'); b.type = 'button'; b.textContent = ex.h;
  b.onclick = () => {
    step.checked = s >= 0; fields.textContent = ''; ends.textContent = '';
    ex.x.forEach((t, i) => i !== s && addField(t[0], t.slice(2), s >= 0 && i > s ? ends : fields));
    if (s < 0) addField('e', '', ends);
    setControls(ex); show();
  };
  row.append(b);
}
document.getElementById('copy').onclick = e => navigator.clipboard.writeText(cmd.textContent).then(() => { e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1200); });
f.addEventListener('input', show); f.addEventListener('change', show);
setControls(INIT);
addField().lastChild.focus(); addField('e', '', ends);
// the settings panel: read when opened, saved on the button; a key field stays empty (a key never comes back from the server)
const sf = document.getElementById('sf'), sd = document.getElementById('sd'), sst = document.getElementById('sst');
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
sd.ontoggle = () => { if (sd.open) settingsReq('GET').then(fillSettings, e => { sst.textContent = e.message; }); };
document.getElementById('save').onclick = () => {
  const p = {};
  for (const k of SFIELDS) {
    const v = sf.elements['set-' + k].value;
    if (SKEYS.includes(k)) { if (sf.elements['clear-' + k].checked) p[k] = null; else if (v) p[k] = v; }
    else p[k] = k === 'opts' ? v.split('\\n').map(a => a.trim()).filter(Boolean) : v.trim();
  }
  return settingsReq('POST', JSON.stringify(p)).then(view => { fillSettings(view); sst.textContent = 'saved; the next search uses it'; }, e => { sst.textContent = 'not saved: ' + e.message; });
};
</script></body></html>`;

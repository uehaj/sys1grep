// sys1grep --serve [PORT] (#166): a page with a search box on 127.0.0.1. Each search runs sys1grep itself as a child,
// with the launch arguments plus what the page's controls changed, so the page cannot do what the command line cannot.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';

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
const liftAll = (args, name) => [args.filter(a => !a.startsWith(`--${name}=`)), args.filter(a => a.startsWith(`--${name}=`)).map(a => a.slice(name.length + 3))];
// suggested questions: --suggest=Q:TEXT or --suggest=e:TEXT (a bare TEXT is a question), shown as pills that fill the first field
const SUGGEST = [['Q', 'why did it fail'], ['e', 'an error or a warning'], ['Q', 'who should I ask about this']];
const suggestOf = list => (list.length ? list : SUGGEST.map(([k, t]) => `${k}:${t}`)).map(v => (/^[eQ]:/.test(v) ? [v[0], v.slice(2)] : ['Q', v])).filter(([, t]) => t.trim());
const REFUSED = /^(-[eavQlcqoziHV]|-[eavQ].+|--(question|step-to|format|color|verbose|dry-run|interactive|help|version|install-templates|quiet|null-data)(=.*)?)$/;

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
  const [noKey, key] = lift(before, 'sys1-api-key'), [noPrompt, prompt] = lift(noKey, 'summarize-prompt'), [launch, suggested] = liftAll(noPrompt, 'suggest');
  const bad = launch.find(a => REFUSED.test(a));
  if (bad) throw new Error(`--serve: ${bad.split('=')[0]} is not for --serve (the page sets the meaning and shows the results as html)`);
  const init = { ...initOf(launch), 'summarize-prompt': prompt ?? '' };
  const secret = key === undefined ? [] : [`--sys1-api-key=${key}`];
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
    const send = (code, type, body) => { res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-frame-options': 'DENY' }); res.end(body); };
    // a page on another site (or a rebound name) must not be able to start a search
    if (host !== `127.0.0.1:${server.address().port}` && host !== `localhost:${server.address().port}`) return send(403, 'text/plain', 'forbidden');
    if (url.pathname === '/') return send(200, 'text/html', page({ init, launch, after, token, suggest: suggestOf(suggested) }));
    const kind = url.pathname.slice(1);
    if (!['results', 'summary', 'dry'].includes(kind) || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']) || url.searchParams.get('k') !== token) return send(404, 'text/plain', 'not found');
    const p = fromQuery(url.searchParams, init);
    if (!p) return send(400, 'text/plain', 'bad value');
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    send(200, 'application/json', JSON.stringify(await search(p, kind, ac.signal)));
  });
  server.on('error', e => { console.error(`sys1grep: --serve: ${e.message}`); process.exit(2); });
  server.listen(Number(port) || 0, '127.0.0.1', () => {
    console.log(`http://127.0.0.1:${server.address().port}/`);
    if (summarizeAsked) console.error('sys1grep: --serve: the summary runs the search again, one more request per search');
  });
}

const json = x => JSON.stringify(x).replace(/</g, '\\u003c');
const page = ({ init, launch, after, token, suggest }) => `<!doctype html>
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
.c32 { color: #188038; } .c35 { color: #a142f4; } .c36 { color: #129eaf; } .c31 { color: #d93025; } .c33 { color: #b06000; } .c01_31 { color: #d93025; font-weight: 700; } .c01_33 { color: #b06000; font-weight: 700; background: #fff3b055; }\n@media (prefers-color-scheme: dark) { .c32 { color: #81c995; } .c35 { color: #d7aefb; } .c36 { color: #78d9ec; } .c31, .c01_31 { color: #f28b82; } .c33, .c01_33 { color: #fdd663; } }\nbutton.pill { border-radius: 14px; padding: 2px 12px; color: var(--link); }
button:disabled { opacity: .45; cursor: default; }
.err { color: #d93025; white-space: pre-wrap; } .note { color: var(--muted); }
#right { border-left: 1px solid var(--rule); padding-left: 16px; }
</style></head><body>
<header><div class="in"><form id="f" autocomplete="off" onsubmit="return false">
<div id="fields" title="What to search for. Several fields are combined as the kind of each says."></div>
<div class="row" id="sug" title="Suggested questions: click one to ask it"><span class="note">Try:</span></div>
<div class="row"><span class="logo" title="sys1grep: grep by meaning">sys1grep</span>
<button type="button" id="add" title="Add a field: -a (and), -v (and not), -e (or), -Q, or --step-to">+</button>
<label title="--rank: print the results best first. jev asks Jev whether each result is relevant; match sorts by its best match probability; off keeps file order">rank <select name="rank"><option value="">off</option><option value="jev">jev</option><option value="match">match</option></select></label>
<label title="--summarize: a small model reads the matches and answers in the right column (one more search request)"><input type="checkbox" name="summarize"> summarize</label>
<input type="text" name="summarize-prompt" placeholder="summary instruction" title="--summarize-prompt: your own instruction for the summary" style="display:none;flex:1;min-width:160px">
<button type="submit" id="go" title="Run the search with the current fields and controls">Search</button><button type="button" id="est" title="--dry-run: show the files and requests and what they would cost; nothing is sent">Estimate cost</button><button type="button" id="stop" title="Stop the search that is running" disabled>Stop</button></div>
<div class="row"><pre id="cmd" title="The command line for the current fields and controls. Pasted in a terminal it runs the same search. The API key is never in it."></pre><button type="button" id="copy" title="Copy the command line to the clipboard">Copy</button></div>
<details id="d"><summary id="ds" title="The other options. A dot means one differs from its launch value.">Details</summary><div class="grid">
<label title="--level: how strict a match must be. loose takes more lines, strict fewer">level <select name="level"><option>loose</option><option>normal</option><option>strict</option></select></label>
<label title="-t: a line matches when its probability is at least this (0 to 1)">-t <input name="t" size="5" inputmode="decimal"></label><label title="-T: a negated meaning ('not X') holds when the probability is below this (0 to 1)">-T <input name="T" size="5" inputmode="decimal"></label>
<label title="-C: lines of context before and after each match">context lines (-C) <input name="C" size="3" inputmode="numeric"></label>
<label class="chk" title="--auto-scope: narrow the files by what Jev says the meaning restricts to (a language, a kind of file). Off: --no-auto-scope"><input type="checkbox" name="auto-scope"> auto-scope</label>
<label class="chk" title="-n: show line numbers"><input type="checkbox" name="n"> -n line numbers</label><label class="chk" title="-p: show the probability of each meaning on the matching lines (and the score on the cards)"><input type="checkbox" name="p"> -p scores</label>
<label title="--dedup: judge one line per template (lines that differ only in ids, numbers, dates) and reuse the answer; auto does it when it pays">dedup <select name="dedup"><option>never</option><option>auto</option><option>always</option></select></label>
<label title="--unit: what one question judges: a line, or a sentence (found by Jev or by a rule)">unit <select name="unit"><option>line</option><option>sentence-by-jev</option><option>sentence-by-rule</option></select></label>
<label title="--include: search only files whose names match these globs (space separated). Narrows the launch targets; it cannot widen them">--include <input name="include"></label><label title="--exclude: skip files whose names match these globs (space separated)">--exclude <input name="exclude"></label>
<label title="--changed-within: only files modified within 30m, 2h, 7d, 2w, or since a date">--changed-within <input name="changed-within" placeholder="2h, 7d, a date"></label><label class="chk" title="-g: search git log's commits, one record each"><input type="checkbox" name="g"> -g git log</label>
<label class="step" title="--hops: how many calls away from a start function an end may be (N, M..N or M..)">--hops <input name="hops" size="6"></label><label class="chk step" title="--reverse: walk the calls backwards"><input type="checkbox" name="reverse"> --reverse</label>
</div></details></form></div></header>
<main id="m"><div id="left" title="Results"></div><div id="right" title="The summary of the results" hidden></div></main>
<script>
const CONTROLS = ${json(CONTROLS)}, INIT = ${json(init)}, LAUNCH = ${json(launch)}, AFTER = ${json(after)}, TOKEN = ${json(token)}, SUGGEST = ${json(suggest)};
const toArgv = ${toArgv};
const quote = (s, force) => (!force && /^[\\w@%+=:,./-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\\\''") + "'");
const shown = argv => argv.map((t, i) => (/^-[eavQ]$/.test(argv[i - 1] ?? '') ? quote(t, t[0] === '-') : /^--[a-z-]+=/.test(t) ? t.replace(/=([\\s\\S]*)/, (_, v) => '=' + quote(v)) : quote(t)));
const f = document.getElementById('f'), fields = document.getElementById('fields'), cmd = document.getElementById('cmd');
const LABELS = {
  Q: ['-Q question', 'a question', 'the lines that answer this question, not the lines asking it, e.g. why did it fail'],
  e: ['-e meaning', 'a meaning', 'lines that mean this, in any language; several -e are OR. e.g. an API key is read'],
  a: ['-a and', 'and this meaning', 'AND onto the term before it: both must hold on the line'],
  v: ['-v and not', 'and not this meaning', 'AND NOT onto the term before it: this must not hold'],
  S: ['--step-to:', '', 'what is before this field is the start, what is after it the end: walk the calls from one function to another'],
};
const addField = (k = 'Q', t = '') => {
  const r = document.createElement('div'); r.className = 'row';
  const sel = document.createElement('select'), inp = document.createElement('input');
  for (const [v, [l]] of Object.entries(LABELS)) { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.append(o); }
  inp.type = 'text';
  const sync = () => { const [, ph, tip] = LABELS[sel.value]; inp.hidden = sel.value === 'S'; inp.placeholder = ph; sel.title = inp.title = tip; };
  sel.value = k; inp.value = t; sync();
  sel.onchange = () => { sync(); show(); };
  inp.oninput = show; inp.onkeydown = e => { if (e.key === 'Enter') go(); };
  r.sel = sel; r.inp = inp; r.append(sel, inp);
  if (fields.children.length) { const x = document.createElement('button'); x.type = 'button'; x.textContent = '\\u00d7'; x.title = 'Remove this field'; x.onclick = () => { r.remove(); show(); }; r.append(x); }
  fields.append(r); show(); return r;
};
const read = () => {
  const p = { x: [...fields.children].map(r => r.sel.value + ':' + (r.sel.value === 'S' ? '' : r.inp.value.trim())).filter(x => x[0] === 'S' || x.length > 2) };
  for (const c of [...CONTROLS, { k: 'summarize', bool: true }, { k: 'rank' }, { k: 'summarize-prompt' }]) { const el = f.elements[c.k]; p[c.k] = c.bool ? el.checked : el.value; }
  return p;
};
const show = () => {
  const p = read(), step = p.x.some(x => x[0] === 'S');
  for (const el of document.querySelectorAll('.step')) el.style.display = step ? '' : 'none';
  f.elements.rank.disabled = f.elements.summarize.disabled = step;
  f.elements['summarize-prompt'].style.display = p.summarize && !step ? '' : 'none';
  cmd.textContent = ['sys1grep', ...LAUNCH.map(t => quote(t)), ...shown(toArgv(p, INIT)), ...AFTER.map(t => quote(t))].join(' ');
  document.getElementById('ds').className = CONTROLS.some(c => !['rank'].includes(c.k) && p[c.k] !== INIT[c.k] && !(c.step && !step) && !(c.nostep && step)) ? 'dot' : '';
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
  if (!p.x.some(x => x[0] !== 'S')) { left.textContent = 'Enter a meaning.'; return; }
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
document.getElementById('add').onclick = () => addField('a').inp.focus();
document.getElementById('copy').onclick = e => navigator.clipboard.writeText(cmd.textContent).then(() => { e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1200); });
f.addEventListener('input', show); f.addEventListener('change', show);
for (const c of [...CONTROLS, { k: 'summarize', bool: true }, { k: 'rank' }, { k: 'summarize-prompt' }]) { const el = f.elements[c.k]; if (c.bool) el.checked = !!INIT[c.k]; else el.value = INIT[c.k]; }
const sug = document.getElementById('sug');
for (const [k, t] of SUGGEST) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'pill'; b.textContent = t;
  b.title = (k === 'Q' ? '-Q question' : '-e meaning') + ': ' + t + ' (click to search)';
  b.onclick = () => { fields.textContent = ''; addField(k, t); go(); };
  sug.append(b);
}
addField().inp.focus();
</script></body></html>`;

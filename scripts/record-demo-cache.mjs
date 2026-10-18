#!/usr/bin/env node
// Records Jev's answers to the demo's 24 example pills (#200) into one file the demo page reads (cache.json): the
// #252 cache files of a run with --cache=on, { url, files: { "<sha256>.json": { "L000_0": { "noul": p }, ... } } }.
// Each pill runs exactly as the page sends it (demo/pills.mjs), on a copy of examples/ in a temporary folder outside any
// git repository (the browser has no git, and git would add auto-scope questions and so change the requests), with a
// HOME of its own (the cache starts empty; your settings, .env and own cache are not read).
//
//   node scripts/record-demo-cache.mjs --dry-run
//       prints each pill's requests, input tokens and price, then the total; sends nothing (no key needed or read)
//   SYS1GREP_API_KEY=... node scripts/record-demo-cache.mjs --record [--out FILE] [--budget USD]
//       records into FILE (default docs/demo/cache.json), stopping before a pill once the cost so far reaches the
//       budget (default 0.05), then replays every pill with --cache=only to check each one is answered
//
// SYS1GREP_URL picks another endpoint (the tests record on tests/fake-jev.mjs this way); the file keeps that url and the
// page uses it, so the cache keys (the hash of the endpoint's host and the request) match.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_URL, PILLS, argvOf } from '../demo/pills.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: o } = parseArgs({ options: { 'dry-run': { type: 'boolean' }, record: { type: 'boolean' }, out: { type: 'string', default: `${root}/docs/demo/cache.json` }, budget: { type: 'string', default: '0.05' } } });
if (!o['dry-run'] === !o.record) {
  console.error('usage: node scripts/record-demo-cache.mjs --dry-run | --record [--out FILE] [--budget USD]');
  process.exit(2);
}
const url = process.env.SYS1GREP_URL || DEFAULT_URL, budget = Number(o.budget);
const work = mkdtempSync(`${tmpdir()}/sys1grep-demo-`), home = `${work}/home`;
mkdirSync(home);
cpSync(`${root}/examples`, `${work}/examples`, { recursive: true });
// Only what sys1grep needs: never the caller's SYS1GREP_OPTS / SYS1GREP_MODEL / SYS1GREP_CACHE, which would change the
// requests or the cache. SYS1GREP_URL is always set (to the default when not given: the same host, so the same cache
// keys), so --dry-run needs no key and never sees one.
const env = { PATH: process.env.PATH, HOME: home, SYS1GREP_OPTS: '', GIT_CONFIG_NOSYSTEM: '1', SYS1GREP_URL: url,
  ...(o.record && process.env.SYS1GREP_API_KEY ? { SYS1GREP_API_KEY: process.env.SYS1GREP_API_KEY } : {}) };
if (o.record && url === DEFAULT_URL && !env.SYS1GREP_API_KEY) { console.error('--record: set SYS1GREP_API_KEY'); process.exit(2); }
const sys1grep = (argv, cache) => spawnSync(process.execPath, [`${root}/sys1grep.mjs`, ...argv], { cwd: work, env: { ...env, SYS1GREP_CACHE: cache }, encoding: 'utf8' });
const label = pill => `${pill.lang} ${pill.name}`;
console.log(`endpoint ${url}; examples copied to ${work}`);

if (o['dry-run']) {
  let requests = 0, tokens = 0, price = 0;
  for (const pill of PILLS) {
    const r = sys1grep(argvOf(pill.p, 'dry'), 'on');
    const m = /dry run: (\d+) requests? to send.*?~(\d+) input tokens, ~\$([\d.]+)/.exec(r.stdout);
    if (r.status !== 0 || (!m && !pill.step)) { console.error(`${label(pill)}: exit ${r.status}\n${r.stderr}${r.stdout}`); process.exit(1); }
    const [n, t, usd] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
    requests += n; tokens += t; price += usd;
    console.log(`${label(pill)}: ${n} requests, ~${t} input tokens, ~$${usd.toFixed(6)}`);
  }
  console.log(`total: ${requests} requests, ~${tokens} input tokens, ~$${price.toFixed(6)} at the code's own estimate (sys1grep's --dry-run: every`
    + ` question answered no, so --dedup and the sentence joins can ask more once real answers come in); --record stops at --budget ${budget}`);
  process.exit(0);
}

let spent = 0;
for (const pill of PILLS) {
  if (spent >= budget) { console.error(`stopped before ${label(pill)}: ~$${spent.toFixed(6)} spent, --budget ${budget}`); process.exit(1); }
  // --verbose: the closing "sent to Jev ... ~$X" line, which sys1grep prints only to a terminal otherwise
  const r = sys1grep([...argvOf(pill.p), '--verbose', `--max-cost=${budget}`], 'on');
  if (r.status > 1) { console.error(`${label(pill)}: exit ${r.status}\n${r.stderr.split('\n').filter(l => !/^sys1grep: {2}|request \d/.test(l)).join('\n')}`); process.exit(1); }
  const usd = Number(/matched; .*?~?\$([\d.]+)/.exec(r.stderr)?.[1] ?? 0);
  spent += usd;
  console.log(`${label(pill)}: exit ${r.status}, ~$${usd.toFixed(6)}`);
}
const dir = `${home}/.config/sys1grep/cache`;
const files = Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => [f, JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'))]));
for (const pill of PILLS) {
  const r = sys1grep(argvOf(pill.p), 'only');
  if (r.status > 1) { console.error(`replay with --cache=only: ${label(pill)}: exit ${r.status}: ${r.stderr.trim()}`); process.exit(1); }
}
mkdirSync(dirname(resolve(o.out)), { recursive: true });
writeFileSync(o.out, `${JSON.stringify({ url, files })}\n`);
console.log(`${Object.keys(files).length} requests recorded, ~$${spent.toFixed(6)}; every pill replays from ${o.out}`);

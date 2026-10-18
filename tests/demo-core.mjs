#!/usr/bin/env node
// The browser demo's core (#200) against the CLI, in Node: the built core.mjs (scripts/demo-build.mjs) run the way the
// page's worker runs it (demo/runner.mjs, one fresh realm a run: here a worker thread), next to sys1grep.mjs itself run
// on a copy of the same files, with the same arguments and environment. Prints one line per check, its result after ":".
//   node demo-core.mjs BUILT_DIR CACHE_JSON
// CACHE_JSON: a recording made by scripts/record-demo-cache.mjs (offline.sh records one on the fake Jev).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { PILLS, argvOf, envOf } from '../demo/pills.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [built, cachePath] = process.argv.slice(2).map(p => resolve(p));
const files = JSON.parse(readFileSync(`${built}/files.json`, 'utf8')), cache = JSON.parse(readFileSync(cachePath, 'utf8'));
const CACHE_DIR = '/home/demo/.config/sys1grep/cache/';
const recorded = { ...files, ...Object.fromEntries(Object.entries(cache.files).map(([f, a]) => [CACHE_DIR + f, JSON.stringify(a)])) };

// the CLI's side: the same files under a temporary folder (outside any git repository), the same cache in its HOME
const work = mkdtempSync(`${tmpdir()}/sys1grep-demo-core-`);
const cliHome = withCache => {
  const home = mkdtempSync(`${work}/home-`);
  if (withCache) {
    mkdirSync(`${home}/.config/sys1grep/cache`, { recursive: true });
    for (const [f, a] of Object.entries(cache.files)) writeFileSync(`${home}/.config/sys1grep/cache/${f}`, JSON.stringify(a));
  }
  return home;
};
for (const [p, text] of Object.entries(files)) if (p.startsWith('/demo/')) { mkdirSync(dirname(`${work}${p}`), { recursive: true }); writeFileSync(`${work}${p}`, text); }
const homes = { true: cliHome(true), false: cliHome(false) };
const cli = (argv, withCache) => {
  const r = spawnSync(process.execPath, [`${root}/sys1grep.mjs`, ...argv], { cwd: `${work}/demo`, encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: homes[withCache], GIT_CONFIG_NOSYSTEM: '1', ...envOf(cache.url) } });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const core = (argv, withCache) => new Promise((ok, fail) => {
  const job = { argv, env: envOf(cache.url), cwd: '/demo', home: '/home/demo', files: withCache ? recorded : files };
  const w = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
import(${JSON.stringify(pathToFileURL(`${root}/demo/runner.mjs`).href)}).then(m => m.runOnce(${JSON.stringify(pathToFileURL(`${built}/core.mjs`).href)}, workerData)).then(r => parentPort.postMessage(r));`, { eval: true, workerData: job });
  w.once('message', r => { ok(r); w.terminate(); });
  w.once('error', fail);
});
let bad = 0;
const same = async (what, argv, withCache = true) => {
  const [a, b] = [cli(argv, withCache), await core(argv, withCache)];
  if (a.code === b.code && a.out === b.out && a.err === b.err) return a;
  bad++;
  console.error(`DIFF ${what}: sys1grep ${argv.join(' ')}\n  cli:  ${JSON.stringify(a)}\n  core: ${JSON.stringify(b)}`);
  return null;
};

const results = [];
for (const pill of PILLS) results.push({ pill, r: await same(`${pill.lang} ${pill.name}`, argvOf(pill.p)) });
const ok = results.filter(x => x.r && x.r.code <= 1);
console.log(`pills, bundle = CLI, answered from the recording: ${ok.length} (en ${ok.filter(x => x.pill.lang === 'en').length}, ja ${ok.filter(x => x.pill.lang === 'ja').length})`);
// -t 0 -p: every line prints, with the probabilities read from the recording (the threshold and -p change no request)
let shown = 0;
for (const pill of PILLS.filter(x => !x.step)) {
  const r = await same(`-t 0 -p: ${pill.lang} ${pill.name}`, argvOf({ ...pill.p, t: '0', T: '1', p: true }));
  if (r?.code === 0 && /\d\.\d\d/.test(r.out)) shown++;
}
console.log(`meaning pills with -t 0 -T 1 -p, bundle = CLI, lines and recorded probabilities printed: ${shown}`);
const steps = PILLS.filter(x => x.step);
let regexOnly = 0;
for (const pill of steps) if ((await same(`no recording: ${pill.name}`, argvOf(pill.p), false))?.code === 0) regexOnly++;
console.log(`multi-step pills found something with no recording at all: ${regexOnly} of ${steps.length}`);
const p0 = PILLS[0].p, x = (...f) => ({ x: f });
const FREE = [x('P:/retry|timeout/i'), { ...x('P:/catch/'), C: '1', n: true }, x('P:/def |function /', 'S:', 'P:/raise|throw/'), { ...x('P:/raise|throw/', 'S:', 'P:/^ *def main|^export function/'), reverse: true }];
let free = 0;
for (const p of FREE) if ((await same(`free regex ${p.x.join(' ')}`, argvOf(p), false))?.code <= 1) free++;
console.log(`free-typed regex searches, bundle = CLI, no recording: ${free} of ${FREE.length}`);
const miss = await same('a meaning not recorded', argvOf(x('e:a meaning nobody recorded')));
console.log(`a meaning not recorded: exit ${miss?.code}, ${/--cache=only: not cached, nothing sent/.test(miss?.err) ? 'not cached' : 'other'}`);
console.log(`estimate (--dry-run) of the first pill, bundle = CLI: ${!!(await same('estimate', argvOf(p0, 'dry')))}`);
console.log(`the first pill with --rank=jev (html, its template), bundle = CLI: ${!!(await same('rank', argvOf({ ...p0, rank: 'jev' })))}`);
console.log(`differences: ${bad}`);

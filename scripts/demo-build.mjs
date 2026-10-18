#!/usr/bin/env node
// Builds the browser demo (#200) into OUT (default docs/demo, committed; GitHub Pages serves it at /demo/): the real
// sys1grep.mjs bundled with esbuild, node:* swapped for demo/shims/ (an import of node:X with no shim fails the build),
// plus the page (serve.mjs's own, in demo mode), the worker and the files it searches. tests/offline.sh builds into a
// scratch folder and fails when docs/demo/ differs, so after a change to sys1grep.mjs, serve.mjs, demo/, examples/ or
// templates/, run this and commit docs/demo/.
//   node scripts/demo-build.mjs [OUT]
// esbuild is pinned and fetched by npx (cached after the first run), so the same sources always build the same files.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ESBUILD = 'esbuild@0.24.0';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] ?? `${root}/docs/demo`);
const SHIMS = { 'node:fs': 'fs.js', 'node:crypto': 'crypto.js', 'node:util': 'util.js', 'node:os': 'path.js', 'node:path': 'path.js', 'node:url': 'path.js', 'node:child_process': 'absent.js', 'node:zlib': 'absent.js' };

mkdirSync(out, { recursive: true });
// not minified: a change to sys1grep.mjs shows up in docs/demo/core.mjs's diff as the same lines, and Pages gzips it anyway
execFileSync('npx', ['--yes', ESBUILD, 'sys1grep.mjs', '--bundle', '--format=esm', '--platform=browser', '--target=es2022', '--legal-comments=none',
  ...Object.entries(SHIMS).map(([from, to]) => `--alias:${from}=./demo/shims/${to}`),
  '--inject:./demo/shims/globals.js', '--define:import.meta.url="file:///sys1grep/sys1grep.mjs"', '--external:./serve.mjs',
  '--log-level=warning', `--outfile=${out}/core.mjs`], { cwd: root, stdio: 'inherit' });
for (const f of ['runner.mjs', 'worker.js', 'demo.js']) copyFileSync(`${root}/demo/${f}`, `${out}/${f}`);

// what the worker puts in its in-memory file system: the bundled corpus where the page's -r examples finds it, and the
// templates where sys1grep.mjs looks for its own (import.meta.url, defined above)
const files = {};
for (const f of readdirSync(`${root}/examples`).sort()) files[`/demo/examples/${f}`] = readFileSync(`${root}/examples/${f}`, 'utf8');
for (const f of readdirSync(`${root}/templates`).sort()) files[`/sys1grep/templates/${f}`] = readFileSync(`${root}/templates/${f}`, 'utf8');
writeFileSync(`${out}/files.json`, `${JSON.stringify(files)}\n`);

// the recording (scripts/record-demo-cache.mjs) sits in OUT already when there is one: docs/demo/cache.json once
// committed, a scratch copy in the tests
const { demoPage } = await import('../serve.mjs');
writeFileSync(`${out}/index.html`, demoPage({ recorded: existsSync(`${out}/cache.json`) }));
console.log(`built ${out}`);

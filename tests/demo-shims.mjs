#!/usr/bin/env node
// demo/shims/ against Node's own: the parseArgs stand-in on argvs built from sys1grep's OPTIONS (values, positionals,
// tokens and error messages, strict and not), and the synchronous sha256 the cache keys need. Prints one line per check.
import assert from 'node:assert';
import { createHash as nodeHash } from 'node:crypto';
import { parseArgs as nodeParse } from 'node:util';
import { OPTIONS } from '../options.mjs';
import { createHash } from '../demo/shims/crypto.js';
import { parseArgs } from '../demo/shims/util.js';

const outcome = (parse, config) => {
  try { return JSON.stringify(parse(config), (k, v) => (v === undefined ? '<undefined>' : v)); } catch (e) { return `${e.code}: ${e.message}`; }
};
const words = ['-e', 'x', '-ex', '-e-x', '--e=x', '-P', '/a/', '-a', '-v', '-Q', 'why', '--question', '--question=q', '-r', '--r', '--no-r', '--no-r=1',
  '-nr', '-rn', '-rC1', '-C', '2', '-C2', '--level', 'loose', '--level=strict', '--no-level', '--no-auto-scope', '--auto-scope', '--rank=jev', '--dedup=always',
  '--step-to', '--step-reverse-to', '--include=*.js', '--include', '*.py', '-z', '--unit=function', '-o', '-q', '-y', '-M', '10', '-M10', '-h', '-V', '-g',
  '--zz', '--no-zz', '-x', '-', '--', 'file.txt', 'dir/', '--color=always', '--cache=only', '--max-cost=1', '-t', '0.3', '-T0.7', '-Qr', '-re', '-=', '-r=1', '--=x'];
let seed = 1;
const rand = n => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
const argvs = [[], ...words.map(w => [w]), ...words.flatMap(a => words.map(b => [a, b]))];
for (let i = 0; i < 3000; i++) argvs.push(Array.from({ length: 1 + rand(6) }, () => words[rand(words.length)]));
let n = 0;
for (const args of argvs) for (const config of [{ strict: true, allowPositionals: true }, { strict: false, allowPositionals: true }, { strict: true }]) {
  const c = { args, options: OPTIONS, allowNegative: true, tokens: true, ...config };
  assert.strictEqual(outcome(parseArgs, c), outcome(nodeParse, c), `parseArgs ${JSON.stringify(c.args)} ${JSON.stringify(config)}`);
  n++;
}
console.log(`parseArgs = node:util on ${n} argvs`);
const texts = ['', 'a', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(1000), '日本語のテキスト\n'.repeat(50), `api.typesafe.ai\n${JSON.stringify({ model: 'jev-latest' })}`];
for (const t of texts) assert.strictEqual(createHash('sha256').update(t).digest('hex'), nodeHash('sha256').update(t).digest('hex'), `sha256 of ${t.length} chars`);
console.log(`sha256 = node:crypto on ${texts.length} texts`);

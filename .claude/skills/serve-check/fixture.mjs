// node fixture.mjs DIR: writes DIR/target/fixture.txt, a target file that makes every meaning-based example in
// serve.mjs's EXAMPLES array match tests/fake-jev.mjs. Also writes DIR/target/fixture.jsx, a tiny source file (a
// "function main", a throw, nothing more) so the multi-step/regex examples ("on this repository") find something
// without needing DIR itself to be this repo. --serve -r DIR/target is the launch; DIR itself holds the run's own
// files (the fake's port, --serve's URL, logs, screenshots) so none of them sit inside the searched target (a
// --serve URL holds ?k=TOKEN, and a growing log would be new content a later search could match against).
// Run from the repo root: node .claude/skills/serve-check/fixture.mjs workdir/serve-check.
//
// This reads EXAMPLES from serve.mjs, so a new field in an existing example is picked up for free. A new or
// reworded EXAMPLE is not: the per-heading LINES table below is the only thing that knows how to make each example
// match the fake, and it keys off the exact English heading (`h`). An unknown heading fails loudly instead of
// silently shipping a fixture that proves nothing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { EXAMPLES } from '../../../serve.mjs';

const dir = process.argv[2];
if (!dir) { console.error('usage: node fixture.mjs DIR'); process.exit(2); }

// One line per heading: what must appear, verbatim, for the fake to score it 0.9. A "-Q" example's line is prefixed
// "the line answers: " (sys1grep.mjs turns -Q TEXT into the meaning "the line answers: TEXT", not TEXT itself).
// --dedup's example gets three lines sharing the meaning but differing by a timestamp, a kind the fake folds by
// default (#227/#229 area; tests/fake-jev.mjs's --dedup comment).
const LINES = {
  'meaning, not words': ['customer is angry or frustrated'],
  'a question (-Q)': ['the line answers: whether the server is down'],
  'where an API key is read': ['an API key or token is read from the environment or a settings file'],
  'a request is retried': ['a failed request is retried'],
  'either meaning, with scores (-p)': ['customer is asking for a refund', 'delivery address change request'],
  'exclude with -v': ['network or remote connection failure'], // the -v text must NOT be on this line
  'regex and meaning together': ['try { risky() } catch (e) { /* the error is ignored */ }'],
  'stricter (--level strict)': ['a security risk or dangerous destructive operation'],
  'one line per template (--dedup)': [
    '2024-01-01T00:00:00Z a request failed.', '2024-01-02T00:00:00Z a request failed.', '2024-01-03T00:00:00Z a request failed.',
  ],
  // lowercase "the author ...", verbatim, matching the meaning's own case; the fake's match is a plain substring check
  'one sentence at a time': ['The project shipped on time. the author admits they made a mistake. The team moved on.'],
};

const stepHeadings = new Set(EXAMPLES.filter(e => e.x.includes('S:')).map(e => e.h)); // "on this repository": no fixture line needed
const known = Object.keys(LINES), wanted = EXAMPLES.filter(e => !stepHeadings.has(e.h)).map(e => e.h);
const missing = wanted.filter(h => !known.includes(h)), stale = known.filter(h => !wanted.includes(h));
if (missing.length || stale.length) {
  if (missing.length) console.error(`fixture.mjs: no LINES entry for: ${missing.join(' | ')}`);
  if (stale.length) console.error(`fixture.mjs: LINES has a heading EXAMPLES no longer has: ${stale.join(' | ')}`);
  console.error('EXAMPLES changed in serve.mjs; update the LINES table above, then rerun.');
  process.exit(1);
}

const target = `${dir}/target`;
mkdirSync(target, { recursive: true });
const lines = wanted.flatMap(h => LINES[h]);
writeFileSync(`${target}/fixture.txt`, lines.join('\n') + '\n');
writeFileSync(`${target}/fixture.jsx`, 'export function main() {\n  try { risky(); } catch (e) { throw e; }\n}\n');
console.log(`wrote ${target}/fixture.txt (${lines.length} lines) and ${target}/fixture.jsx`);

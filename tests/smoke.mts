// Smoke test on this repository: real questions to real Jev, answers judged by Claude (claude -p) against a plain-words
// expectation. Not pass/fail like offline.sh: Jev's probabilities drift and so does the judge. A "wrong" is worth a look.
//   npm run smoke [-- --model MODEL] [--only NAME]   needs SYS1GREP_API_KEY (environment, ./.env or ~/.config/sys1grep/.env) and claude
// Each case in smoke-cases.json: args (the expression), targets, expect (what a sensible answer is), and optionally
// mustMatch / mustNotMatch (a regex over the printed matches, checked here before the judge) and expectNone (no match is right).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({ options: { model: { type: 'string', default: 'sonnet' }, only: { type: 'string' } } });
const dir = new URL('.', import.meta.url).pathname, root = `${dir}..`;
type Case = { name: string; args: string[]; targets: string[]; expect: string; mustMatch?: string; mustNotMatch?: string; expectNone?: boolean };
const cases: Case[] = JSON.parse(readFileSync(`${dir}smoke-cases.json`, 'utf8')).filter((c: Case) => !opt.only || c.name === opt.only);
const MAX_LINES = 30;

function search(c: Case): string {
  try {
    return execFileSync('node', ['--env-file-if-exists=.env', 'sys1grep.mjs', '-H', '-n', '-p', ...c.args, ...c.targets], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  } catch (e: any) {
    if (e.status === 1) return ''; // no match
    throw new Error(`sys1grep exited ${e.status}: ${String(e.stderr).trim()}`);
  }
}

function judge(c: Case, out: string): { verdict: string; why: string } {
  const lines = out.split('\n').filter(Boolean), shown = lines.slice(0, MAX_LINES).join('\n') + (lines.length > MAX_LINES ? `\n... ${lines.length - MAX_LINES} more lines` : '');
  const prompt = `You are checking a semantic grep (sys1grep) on its own repository. Expression: ${JSON.stringify(c.args)} over ${c.targets.join(', ')}.
What a sensible answer is: ${c.expect}
${c.expectNone ? 'No match is the correct answer here.\n' : ''}
What sys1grep printed (file:line:text, then the probability per meaning in [..]; 1.00 is certain, below 0.5 does not match):
${shown || '(no match)'}

Judge: are the printed lines a sensible answer to the expression, and do the probabilities look right (clear answers high, no confident hits on irrelevant lines)? Missing some valid lines is "doubtful" at worst; irrelevant lines with high probability, or a wrong answer, is "wrong".
Answer with ONLY a JSON object: {"verdict":"ok"|"doubtful"|"wrong","why":"one or two sentences"}.`;
  const res = execFileSync('claude', ['-p', '--model', opt.model!, '--tools', '', '--output-format', 'json'], { input: prompt, encoding: 'utf8', maxBuffer: 1 << 24 });
  const text: string = JSON.parse(res).result;
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}

const rows: string[] = [];
let bad = 0;
for (const c of cases) {
  let verdict = 'ok', why = '';
  try {
    const out = search(c);
    const hard = [c.mustMatch && !new RegExp(c.mustMatch).test(out) && `output lacks /${c.mustMatch}/`, c.mustNotMatch && new RegExp(c.mustNotMatch).test(out) && `output has /${c.mustNotMatch}/`,
      c.expectNone && out && 'matches printed where none are right'].filter(Boolean) as string[];
    if (hard.length) { verdict = 'wrong'; why = hard.join('; '); }
    else ({ verdict, why } = judge(c, out));
  } catch (e: any) { verdict = 'error'; why = e.message; }
  if (verdict !== 'ok') bad++;
  rows.push(`| ${c.name} | ${verdict} | ${why.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
  console.log(`${verdict.padEnd(8)} ${c.name}: ${why}`);
}
writeFileSync(`${dir}smoke-report.md`, `# Smoke test (${new Date().toISOString().slice(0, 10)}, judge ${opt.model})\n\n| case | verdict | why |\n|---|---|---|\n${rows.join('\n')}\n`);
console.log(`${cases.length - bad} of ${cases.length} ok; report in tests/smoke-report.md`);
process.exit(bad ? 1 : 0);

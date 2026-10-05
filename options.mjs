// sys1grep.mjs's own node:util.parseArgs option table and default-options gate, pulled out so serve.mjs's
// settings-panel opts validation runs the exact same parser instead of a hand-rolled regex/cluster check that kept
// missing forms the parser itself already understands (#199: -nr, -rC1, --r, -h all slipped past earlier regexes
// in turn; parseArgs splits a cluster, resolves a glued value and a long alias for a one-letter name correctly by
// construction, so there is nothing left to keep in sync by hand).
import { parseArgs } from 'node:util';

export const OPTIONS = {
  e: { type: 'string', multiple: true },
  a: { type: 'string', multiple: true },
  v: { type: 'string', multiple: true },
  question: { type: 'string', multiple: true, short: 'Q' },
  level: { type: 'string', default: 'normal' }, // strictness preset: loose / normal / strict
  r: { type: 'boolean', default: false }, // recurse into directories
  cached: { type: 'boolean', default: false }, // git sys1grep only: search the index instead of the working tree
  untracked: { type: 'boolean', default: false }, // git sys1grep only: also search untracked files (.gitignore still applies)
  l: { type: 'boolean', default: false }, // print only matching file names
  'with-filename': { type: 'boolean', short: 'H' }, // prefix file names even for one file; --no-filename: never
  t: { type: 'string' }, // positive threshold: match when p >= t (default from preset)
  T: { type: 'string' }, // negative threshold: "not X" when p < T (default from preset)
  chunk: { type: 'string', default: '30' }, // lines per request
  c: { type: 'boolean', default: false }, // count of matching lines per file (grep -c)
  quiet: { type: 'boolean', short: 'q', default: false }, // print nothing, exit status only (grep -q)
  j: { type: 'string', default: '8' }, // concurrent requests
  A: { type: 'string' }, // N lines of trailing context
  B: { type: 'string' }, // N lines of leading context
  C: { type: 'string' }, // N lines of context on both sides
  n: { type: 'boolean', default: false }, // line numbers
  z: { type: 'boolean', default: false }, // records are NUL-terminated, on input and output (grep -z); --unit=zero
  unit: { type: 'string', default: 'line' }, // line / zero / sentence-by-jev / sentence-by-rule
  o: { type: 'boolean', default: false }, // with --unit=sentence-by-*, print only the matching sentences (grep -o)
  p: { type: 'boolean', default: false }, // print each meaning's probability
  dedup: { type: 'string', default: 'never' }, // auto|always|never: judge one representative per template, reuse its answer
  rank: { type: 'string' }, // jev|match: print the results best first, scored by Jev's answer on each or by its best match
  // multi-step matching (#163): the expression before --step-to finds the start, the one after it the end
  'step-to': { type: 'boolean', multiple: true },
  edges: { type: 'string' }, // FILE: the edges to walk, one per line; default: the calls between functions
  reverse: { type: 'boolean', default: false }, // walk the edges backwards
  hops: { type: 'string', default: '0..' }, // N, M..N or M..: the hops an end may be at
  'dry-run': { type: 'boolean', default: false }, // print the files and requests, send nothing
  verbose: { type: 'boolean', default: false }, // print the files and requests to stderr while searching
  interactive: { type: 'boolean', short: 'i', default: false }, // show what --dry-run would send, search on a yes
  yes: { type: 'boolean', short: 'y', default: false }, // skip the size/cost guard's question, answering yes (#58)
  'max-columns': { type: 'string', short: 'M' }, // a unit past this many characters is skipped (rg's -M/--max-columns)
  'max-filesize': { type: 'string' }, // a target past this size (K/M/G) is listed and confirmed (rg's name)
  'max-cost': { type: 'string', default: '1' }, // ask before sending when the estimated price is over this many USD
  // which files -r finds and git sys1grep lists; with -r a file named on the command line is always searched
  include: { type: 'string', multiple: true }, // only names matching one of these globs
  exclude: { type: 'string', multiple: true }, // not names matching one of these globs
  'changed-within': { type: 'string' }, // only files modified within 30m / 2h / 7d / 2w, since a date, today, ...
  gitlog: { type: 'boolean', short: 'g', default: false }, // search git log's commits, one record each; auto-scope picks which
  'auto-scope': { type: 'boolean', default: true }, // narrow those files by what Jev says a meaning restricts to; --no-auto-scope: don't
  color: { type: 'string', default: 'auto' }, // auto / always / never
  summarize: { type: 'string' }, // pipe what would print to this LLM CLI and print its answer instead
  'summarize-prompt': { type: 'string' }, // the user's own instruction, added after the fixed one
  format: { type: 'string', default: 'plain' }, // plain / markdown / html: --rank's output, or asked of the summarizer
  template: { type: 'string' }, // --rank's or --summarize's --format=html document: a NAME under the templates dirs, or a file; list: the names
  'install-templates': { type: 'boolean', default: false }, // copy the bundled templates to ~/.config/sys1grep/templates
  'summarize-format': { type: 'string' }, // removed (--format): parsed only to say so
  // the API settings, each overriding its environment variable
  'sys1-model': { type: 'string' }, // SYS1GREP_MODEL
  'sys1-url': { type: 'string' }, // SYS1GREP_URL
  'sys1-api-key': { type: 'string' }, // SYS1GREP_API_KEY / TYPESAFE_API_KEY
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'V', default: false },
};
// --no-rank / --no-summarize: parseArgs negates booleans only, so a bare one becomes a value no real argument can
// hold (this NUL), cleared by the caller once parsed; the later of --no-rank/--rank=X (or --no-summarize/
// --summarize=X) wins, as for any option.
export const OFF = '\0';
// A bare --color / --dedup / --rank / --summarize means an implied default value, as grep's bare --color does;
// parseArgs cannot express an optional value, so this fills it in before parseArgs ever sees it. --no-filename is
// grep's name for --no-with-filename, --null-data grep's name for -z. summarizer: the TOOL a bare --summarize
// fills in (sys1grep.mjs's own SYS1GREP_SUMMARIZER-or-"claude"; a caller that only validates shape, never runs the
// result, may pass any placeholder).
export const fill = (a, summarizer) => (a === '--color' ? '--color=auto' : a === '--null-data' ? '-z' : a === '--no-filename' ? '--no-with-filename'
  : a === '--summarize' ? `--summarize=${summarizer || 'claude'}` : a === '--dedup' ? '--dedup=always' : a === '--rank' ? '--rank=jev'
  : a === '--no-rank' ? `--rank=${OFF}` : a === '--no-summarize' ? `--summarize=${OFF}` : a);
// Parses a default-options array (SYS1GREP_OPTS / settings.json opts), already fill()ed, with sys1grep.mjs's own
// parseArgs configuration, and refuses anything that is not a plain search option: a positional (a target or any
// other stray value, #196), a meaning or expression (-e/-a/-v/-Q/--step-to go on the command line, not in
// defaults), or a command (--install-templates, --template=list: these do something instead of searching). Shared
// by sys1grep.mjs's own gate and serve.mjs's settings-panel validation, so the two can never accept something the
// other would refuse. Throws (a parseArgs error, or the refusal above) with sys1grep's own wording either way;
// returns { tokens } — every parsed token, so a caller can read what option each one named (its canonical
// OPTIONS key, however it was spelled: -r, --r, or inside a cluster like -rC1 or -nr) — on success.
export function parseOpts(filledArgs) {
  const { tokens } = parseArgs({ args: filledArgs, options: OPTIONS, allowPositionals: true, allowNegative: true, tokens: true });
  const command = k => k.name === 'install-templates' || (k.name === 'template' && k.value === 'list');
  const bad = tokens.find(k => k.kind !== 'option' || ['e', 'a', 'v', 'question', 'step-to', 'cached', 'untracked'].includes(k.name) || command(k));
  if (bad) throw new Error(bad.kind !== 'option' ? `'${bad.value ?? '--'}' is not an option` : command(bad) ? `${bad.rawName}${bad.value === undefined ? '' : `=${bad.value}`} is not allowed (it does something instead of searching)` : ['cached', 'untracked'].includes(bad.name) ? `--${bad.name} is not allowed (what is searched goes on the command line)` : `${bad.name.length > 1 ? '--' : '-'}${bad.name} is not allowed (${bad.name === 'step-to' ? 'expressions' : 'meanings'} go on the command line)`);
  return { tokens };
}

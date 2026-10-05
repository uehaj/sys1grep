// sys1grep.mjs's own node:util.parseArgs option table, pulled out so serve.mjs's settings-panel opts validation
// (VALUED in serve.mjs) can derive which options take a value from the same source instead of a hand list that can
// drift from it (#199).
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
// Option names whose bare form sys1grep.mjs's fill() rewrites unconditionally to a fixed value (--color=auto,
// --dedup=always, --rank=jev, --summarize=<default summarizer>) before parseArgs ever sees it: a separate following
// token is therefore never that option's value, just a stray positional, so settings-panel opts validation must not
// treat them as taking a separate value either.
export const EQUALS_ONLY = new Set(['color', 'dedup', 'rank', 'summarize']);

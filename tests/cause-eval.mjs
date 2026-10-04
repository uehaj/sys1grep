// Finding the cause of a failed command (#156): how high the cause hypotheses below plus --rank put the cause in a
// failed job's log. Each scenario is a synthetic log, generated here from a seed: a job's background noise (the
// generator of #156, with recovered WARN / ERROR retries), one key line, and a final ERROR that names only the symptom.
// The key line is the cause for the kinds config, empty and default. For the kind missing the cause is a line that
// never came; the key line is the last one before the gap (a start with no finish), the closest a search can get.
// One search per log, with --rank=jev -p: the jev rank is the result's number; the match rank is recomputed from the
// -p columns (--rank=match's score is the highest of them), as a range when the cause ties at two decimals.
//   node tests/cause-eval.mjs [--lines=10000] [--only=ID,...] [--budget=USD] [--write=DIR] [--dry-run]
// Needs the API key (as sys1grep reads it). Costs about $0.09 a 10,000-line log; a row goes to stdout (TSV) as each
// log finishes. Before the first log, stderr gets the first log's --dry-run estimate and that times the logs. No log
// starts once the spend plus 1.3 times the larger of that estimate and the dearest log so far would pass --budget
// (default 3), so --budget=0 sends nothing; that stop exits 2, a failed sys1grep exits 1. Each log and its ranked output (ID.log,
// ID.out) stay in a temp dir, named on stderr. --dry-run sends nothing and prints each log's estimate and the total.
// --write=DIR only writes the logs there, sending nothing.
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const LINES = Number(arg('lines', 10000)), BUDGET = Number(arg('budget', 3)), only = arg('only')?.split(','), dir = arg('write');
const dry = process.argv.includes('--dry-run');
const HYPOTHESES = [ // #156's recipe, verbatim
  'a component, writer, job or feature was paused, disabled, skipped or put on hold',
  'a configuration, endpoint, region, credential or data source was changed or switched',
  'an input, file or table was empty, missing, or had fewer records or columns than expected',
  'a fallback or default value was used instead of the real one',
];
const PRICE = 0.042 / 1e6; // Jev's list price an input token, as sys1grep prices it

// [id, kind, key line [level, component, message], final lines, lines spread before the key (missing: what a finish looks like)]
const SCENARIOS = [
  ['config-1', 'config', ['INFO', 'config', 'settlement endpoint reloaded: https://settle.bank.example -> https://settle-sandbox.bank.example'],
    [['ERROR', 'export', 'bank rejected settlement file: 412 of 412 merchant ids unknown; export aborted']]],
  ['config-2', 'config', ['DEBUG', 's3', 'region override from environment: S3_REGION=eu-west-1 (profile default us-east-1)'],
    [['ERROR', 'ingest', 'NoSuchKey for 1382 of 1382 input objects; batch aborted']]],
  ['config-3', 'config', ['INFO', 'auth', "credential provider now uses profile 'audit-readonly'"],
    [['ERROR', 'load', 'insert into warehouse.sales_daily denied (403); load aborted, exit 3']]],
  ['config-4', 'config', ['INFO', 'flags', 'feature flags now read from file:///etc/app/flags.local.json'],
    [['ERROR', 'pricing', 'contract check failed: 87 SKUs priced at list price; publish aborted']]],
  ['config-5', 'config', ['DEBUG', 'db', 'resolved db-primary.internal to 10.0.4.22 (replica-2)'],
    [['ERROR', 'migrate', 'cannot execute UPDATE in a read-only transaction; migration 118 aborted']]],
  ['config-6', 'config', ['INFO', 'config', 'config push 7781 applied: report.timezone=UTC (was Asia/Tokyo)'],
    [['ERROR', 'report', 'daily report 2026-09-28 has no orders between 00:00 and 09:00; validation failed']]],
  ['empty-1', 'empty', ['INFO', 'extract', 'loaded customers_20260928.csv: 0 rows (0 bytes)'],
    [['ERROR', 'mailer', 'campaign sent 0 messages, expected at least 1000; exit 3']]],
  ['empty-2', 'empty', ['DEBUG', 'hdfs', 'partition dt=2026-09-28 lists 3 of 24 hourly files'],
    [['ERROR', 'aggregate', 'daily total 87% below the 7-day average; publish aborted']]],
  ['empty-3', 'empty', ['INFO', 'kafka', 'consumer payments-settle read 0 messages from payments.v2 in a 300 s window'],
    [['ERROR', 'settle', 'settlement total differs from the bank statement by 1204331.50; run aborted']]],
  ['empty-4', 'empty', ['INFO', 'sync', 'stock snapshot downloaded: 1204 bytes'],
    [['ERROR', 'sync', '18330 SKUs would be marked out of stock; stopped by the safety limit']]],
  ['empty-5', 'empty', ['DEBUG', 'fx', 'reference table fx_rates returned no rows for 2026-09-28'],
    [['ERROR', 'invoice', 'amount is NaN for 9812 invoices; invoicing aborted']]],
  ['empty-6', 'empty', ['INFO', 'train', 'input directory /data/in/2026-09-28 holds 2 files'],
    [['ERROR', 'train', 'validation set too small (n=31); training aborted']]],
  ['default-1', 'default', ['DEBUG', 'fx', 'no rate for JPY/USD, using 1.0'],
    [['ERROR', 'invoice', 'invoice totals differ from the ledger by 99.3%; posting aborted']]],
  ['default-2', 'default', ['INFO', 'export', 'PAGE_SIZE not set, falling back to 10'],
    [['ERROR', 'export', 'consumer rejected export: 10 of 52113 records']]],
  ['default-3', 'default', ['DEBUG', 'tenant', 'tenant t-4471 has no locale, assuming en-US'],
    [['ERROR', 'tax', 'tax engine rejected 4412 invoices: VAT id format invalid for country US']]],
  ['default-4', 'default', ['INFO', 'client', "no retry policy configured for client 'ledger', using built-in (0 retries)"],
    [['ERROR', 'recon', '312 postings missing from the ledger after commit; reconciliation failed']]],
  ['default-5', 'default', ['WARN', 'pool', 'could not read max_connections from pool.yaml, using 2'],
    [['ERROR', 'queue', 'queue full after 600 s, 18204 jobs timed out; batch aborted']]],
  ['default-6', 'default', ['INFO', 'pricing', "price list for channel 'wholesale' unavailable, serving retail prices"],
    [['ERROR', 'billing', 'margin check failed: 1882 orders below cost; billing run stopped']]],
  ['missing-1', 'missing', ['INFO', 'worker', 'worker w3 claimed shard 17'],
    [['ERROR', 'main', 'timed out after 3600 s waiting for 1 of 4 workers; exit 4']],
    ['worker w1 claimed shard 4', 'worker w1 finished shard 4 (2210 rows)', 'worker w2 claimed shard 9', 'worker w2 finished shard 9 (1984 rows)', 'worker w4 claimed shard 12', 'worker w4 finished shard 12 (2317 rows)']],
  ['missing-2', 'missing', ['INFO', 'snapshot', 'step 2/4: snapshot orders_20260928 started'],
    [['ERROR', 'restore', 'step 3/4: snapshot orders_20260928 not found; job aborted']],
    ['step 1/4: snapshot customers_20260928 started', 'step 1/4: snapshot customers_20260928 finished (4.1 GB)']],
  ['missing-3', 'missing', ['INFO', 'lock', 'lock nightly-export acquired by run ne-0927'],
    [['ERROR', 'lock', 'could not acquire lock nightly-export after 1800 s; run ne-0928 aborted']],
    ['lock nightly-export acquired by run ne-0926', 'lock nightly-export released by run ne-0926']],
  ['missing-4', 'missing', ['INFO', 'migrate', 'migration 0042_add_currency started'],
    [['ERROR', 'api', 'column orders.currency does not exist; 500 on POST /orders, deploy rolled back']],
    ['migration 0041_index_orders started', 'migration 0041_index_orders done in 14 s']],
  ['missing-5', 'missing', ['INFO', 'upload', 'part 7 of 8 upload started (64 MB)'],
    [['ERROR', 'upload', 'multipart upload incomplete: 7 of 8 parts; object not created']],
    ['part 5 of 8 upload started (64 MB)', 'part 5 of 8 uploaded', 'part 6 of 8 upload started (64 MB)', 'part 6 of 8 uploaded']],
  ['missing-6', 'missing', ['INFO', 'index', 'index products-20260928 built (1204331 docs)'],
    [['ERROR', 'search', 'freshness check failed: newest product in results is from 2026-09-27']],
    ['index products-20260927 built (1203980 docs)', 'alias products switched to products-20260927']],
];

// #156's noise, from a seeded mulberry32 instead of Python's random
function rng(seed) {
  let a = seed;
  const next = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; };
  return { random: next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: xs => xs[Math.floor(next() * xs.length)] };
}
const COMPS = ['api', 'auth', 'cache', 'db', 'fx', 'gc', 'http', 'kafka', 'ledger', 'limits', 'mail', 'metrics', 'ops', 'orders',
  'payouts', 'pricing', 'queue', 'recon', 'region', 'risk', 's3', 'scheduler', 'search', 'session', 'sms', 'sync', 'tax', 'tls', 'users', 'webhook'];
const VERBS = ['refreshed', 'rebuilt', 'rotated', 'warmed', 'compacted', 'flushed', 'rebalanced', 'reindexed', 'trimmed', 'loaded',
  'published', 'acknowledged', 'resumed', 'checkpointed', 'snapshotted', 'migrated', 'pruned', 'synced', 'validated', 'scheduled'];
const OBJS = ['index', 'partition', 'segment', 'token set', 'lease', 'manifest', 'watermark', 'bloom filter', 'route table', 'quota map',
  'consumer group', 'shard map', 'template cache', 'rule set', 'price list', 'session store', 'webhook queue', 'tax table', 'retry budget', 'limit profile'];
const ADV = ['in {n}ms', '({n} items)', 'for tenant t{n}', 'on node n{n}', 'after {n} attempts', '(generation {n})', 'at offset {n}',
  'with {n} entries', 'in background', 'ahead of schedule'];

function generate([id, , key, final, before = []], seed) {
  const R = rng(seed), out = [];
  let t = Date.UTC(2026, 8, 28, 1, 0, 0);
  const log = (level, comp, msg) => {
    t += R.int(2, 30);
    const d = new Date(t).toISOString();
    out.push(`${d.slice(0, 10)} ${d.slice(11, 23)} ${level.padEnd(5)} [${comp}] ${msg}`);
  };
  const RED = [
    ['WARN', 'api', () => `client v${R.int(1, 3)}.${R.int(0, 9)} sent deprecated field "legacy_id"`],
    ['WARN', 'db', () => `slow query on postings took ${R.int(1200, 4800)}ms`],
    ['WARN', 'tls', () => `certificate for partner-${R.int(1, 40)}.example expires in ${R.int(5, 29)} days`],
    ['WARN', 'limits', () => `tenant t${R.int(1, 900)} is at ${R.int(81, 99)}% of its daily quota`],
    ['ERROR', 'mail', () => 'smtp timeout sending statement, retry 1/3'],
    ['ERROR', 'kafka', () => `broker b${R.int(1, 6)} not leader for partition ${R.int(0, 63)}, refreshing metadata`],
    ['ERROR', 'webhook', () => `partner-${R.int(1, 40)} returned 503, will retry in ${R.int(5, 60)}s`],
    ['ERROR', 'ledger', () => 'deadlock detected, retrying transaction'],
  ];
  const at = R.int(Math.round(LINES * 0.3), Math.round(LINES * 0.7));
  const extra = new Map(before.map((m, i) => [Math.round((at * (i + 1)) / (before.length + 1)), m]));
  let keyNo = 0;
  log('INFO', 'main', `${id} starting, run_id=${id}-20260928-0100`);
  for (let i = 1; i <= LINES; i++) {
    if (i === at) { log(...key); keyNo = out.length; continue; }
    if (extra.has(i)) { log('INFO', key[1], extra.get(i)); continue; }
    const k = R.random();
    if (k < 0.06) { const [lvl, comp, f] = R.pick(RED); log(lvl, comp, f()); }
    else if (k < 0.12) log('DEBUG', 'ledger', `posting batch ${R.int(10000, 99999)} accepted (${R.int(50, 500)} entries, region ${R.random() < 0.7 ? 'primary' : 'secondary'})`);
    else log(R.random() < 0.5 ? 'DEBUG' : 'INFO', R.pick(COMPS), `${R.pick(OBJS)} ${R.pick(VERBS)} ${R.pick(ADV).replace('{n}', R.int(1, 9999))}`);
    if (i % 2000 === 0) log('INFO', 'main', `progress ${i}/${LINES}`);
  }
  for (const f of final) log(...f);
  log('INFO', 'main', 'exit code 4');
  return { text: out.join('\n') + '\n', keyNo };
}

// --rank=jev -p output: "N. [S]" then "LINENO:TEXT\t[P P P P]" rows, results apart by a blank line
function parse(stdout) {
  return stdout.split('\n\n').filter(Boolean).map(block => {
    const [head, ...rows] = block.split('\n').filter(Boolean);
    const [, rank, jev] = head.match(/^(\d+)\. \[([\d.]+)\]/);
    const lines = rows.map(r => r.match(/^(\d+):(.*)\t\[([\d. ]+)\]/)).filter(Boolean);
    return { rank: +rank, jev: +jev, nos: lines.map(m => +m[1]), text: lines[0]?.[2] ?? '',
      match: Math.max(...lines.flatMap(m => m[3].trim().split(/\s+/).map(Number))) };
  });
}

const run = promisify(execFile);
const SYS1GREP = new URL('../sys1grep.mjs', import.meta.url).pathname;
// -y: never wait on sys1grep's cost question, there is no terminal to answer it; --budget is the cap
const ARGS = ['-n', '-p', '--verbose', '--dedup', '--level', 'strict', '--rank=jev', '-y', ...HYPOTHESES.flatMap(h => ['-e', h])];
async function sys1grep(id, ...args) {
  const r = await run('node', [SYS1GREP, ...ARGS, ...args], { env: { ...process.env, SYS1GREP_OPTS: '' }, maxBuffer: 1 << 28 }).catch(e => e);
  if (r instanceof Error && r.code !== 1) { console.error(`cause-eval: ${id}: sys1grep failed (exit ${r.code})\n${(r.stderr || r.message).slice(-2000)}`); process.exit(1); }
  return r;
}
async function estimate(id, file) {
  const { stdout, stderr } = await sys1grep(id, '--dry-run', file), out = stdout + stderr;
  const tokens = out.match(/^sys1grep: dry run: .*~(\d+) input tokens/m)?.[1];
  if (!tokens) { console.error(`cause-eval: ${id}: no dry run line\n${out.slice(-2000)}`); process.exit(1); }
  return { line: out.split('\n').filter(l => /dry run:|rank:/.test(l)).join(' | '), usd: tokens * PRICE };
}
const work = dir ?? mkdtempSync(`${tmpdir()}/cause-eval-`);
mkdirSync(work, { recursive: true });
const picked = SCENARIOS.filter(s => !only || only.includes(s[0]));
let spent = 0, worst = 0, estimated = 0;
console.error(`cause-eval: logs and ranked output in ${work}`);
if (!dir) console.log(['id', 'kind', 'lines', 'results', 'jev rank', 'match rank', 'key p', 'key jev', 'top 2 jev', 'requests', 'input tokens', 'usd', 'seconds', 'top result'].join('\t'));
for (const [n, s] of picked.entries()) {
  const { text, keyNo } = generate(s, 1000 + SCENARIOS.indexOf(s));
  const file = `${work}/${s[0]}.log`;
  writeFileSync(file, text);
  if (dir) continue;
  if (dry) {
    const e = await estimate(s[0], file);
    estimated += e.usd;
    console.error(`${s[0]}: ${e.line}`);
    if (n === picked.length - 1) console.error(`cause-eval: ${picked.length} logs, ~$${estimated.toFixed(4)} estimated, nothing sent`);
    continue;
  }
  if (!worst) {
    worst = (await estimate(s[0], file)).usd;
    console.error(`cause-eval: ~$${worst.toFixed(4)} a log by ${s[0]}'s --dry-run, ~$${(worst * picked.length).toFixed(2)} for ${picked.length}; --budget ${BUDGET}`);
  }
  if (spent + worst * 1.3 > BUDGET) { console.error(`cause-eval: stopped before ${s[0]}: $${spent.toFixed(4)} spent, the next could pass --budget ${BUDGET}`); process.exit(2); }
  const t0 = Date.now();
  const { stdout, stderr } = await sys1grep(s[0], file);
  const seconds = ((Date.now() - t0) / 1000).toFixed(0);
  const sum = stderr.match(/(\d+) of \d+ lines matched; .* in (\d+) requests?, (\d+) input tokens/);
  if (!sum) { console.error(`cause-eval: ${s[0]}: no summary line\n${stderr.slice(-2000)}`); process.exit(1); }
  const tokens = +sum[3], usd = tokens * PRICE;
  spent += usd; worst = Math.max(worst, usd);
  writeFileSync(`${work}/${s[0]}.out`, stdout);
  const results = parse(stdout), key = results.find(r => r.nos.includes(keyNo));
  const lo = key && 1 + results.filter(r => r.match > key.match).length, hi = key && results.filter(r => r.match >= key.match).length;
  console.log([s[0], s[1], text.split('\n').length - 1, results.length, key?.rank ?? '-', key ? (lo === hi ? lo : `${lo}-${hi}`) : '-',
    key?.match ?? '-', key?.jev ?? '-', results.slice(0, 2).map(r => r.jev).join(' '), sum[2], tokens, usd.toFixed(4), seconds, results[0]?.text.slice(0, 100) ?? ''].join('\t'));
  if (n === picked.length - 1) console.error(`cause-eval: ${picked.length} logs, ${spent.toFixed(4)} USD`);
}

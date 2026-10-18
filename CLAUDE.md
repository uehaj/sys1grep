# sys1grep

## Tests

| command | what | needs |
|---|---|---|
| `npm run test:offline` | `tests/offline.sh`: sys1grep against a fake Jev (`tests/fake-jev.mjs`). Expression (`-e`/`-P`/`-a`/`-v`/`!`), output shapes, `-A/-B/-C`, `--level`/`-t`/`-T`, `-p`, `--color`, `--chunk`, `-j`, `-q` (including the stop at the first match), `-Q`, auto-scope and `--no-auto-scope`, `--dedup` (auto and always print what never prints on `tests/dedup`), `--step-to` and `--step-reverse-to` (hops, `--edges`, the refusals), `--cache`, `--unit=function`, `SYS1GREP_URL` and the auth header, settings.json, `--dry-run`/`--verbose` (and where each setting came from), `git sys1grep` (`--cached`, `--untracked`, `<tree>`, `-i`), `--summarize` (`=ask`, `--summarize-prompt`, llm / pi / ollama / lmstudio / URL), `--rank`, `--template` and `--format=html`, the `-M`/`--max-filesize`/`--max-cost` limits, the large-send warning, the package.json `files` list, `--serve` (page, demo corpus, launch options and refusals, cost guard, summarize endpoint), `--help`/`--version`, the browser demo (built twice, from the checkout and from its tracked files alone, byte-identical; its bundled core against the CLI on a recording made on the fake) | node, curl, git. No key, same result every run, ~5 min. The demo section builds with esbuild through `npx` (pinned in `scripts/demo-build.mjs`), so it needs the npm registry on a cold npx cache; a warm one builds with `npm_config_offline=true` |
| `OFFLINE_ONLY=PATTERN npm run test:offline` | #240: the same run's shared setup, then only the sections whose name contains PATTERN (case-insensitive, comma-separated for several; `tests/offline-sections.mjs` reads the `section 'NAME'` markers in `offline.sh`). Ends with `OK: N checks passed (only: PATTERN, K of M sections)`; no match exits 2 and lists the names; `OFFLINE_ONLY=list` just lists them. Iterate with this while editing `sys1grep.mjs`; run the plain `npm run test:offline` once before a push (CI runs it that way) | same as above; a few seconds per section |
| `npm test` | `test:offline`, then `tests/check.sh`: the same options against real Jev on the fixtures | `SYS1GREP_API_KEY` (env, `./.env`, `~/.config/sys1grep/settings.json`'s `key` or `~/.config/sys1grep/.env`); sends the fixtures to Jev, costs a little |
| `npm run scope-eval` | `tests/scope-eval.mjs`: auto-scope against real Jev on `tests/scope-corpus.tsv` (tune on this) and `tests/scope-holdout.tsv` (never tune on it): wrong / missed scopes per threshold, and the rows that differ | the key above; one small request per row (160), about 20 s |
| `npm run skill-eval -- OUT a=A/SKILL.md b=B/SKILL.md` | `tests/skill-eval/run.sh`: whether a sys1grep skill wording fires when it should (and not on a line count), and the cost per run, `claude -p` Sonnet on four questions about a generated 6,000-line log; score with `node tests/skill-eval/score.mjs OUT`. Run with `PREFLIGHT=1` first: it flags denied calls, which void a run | `CLAUDE_CONFIG_DIR` set to a logged-in config folder holding an empty `.skill-eval` file (its `skills/sys1grep` is replaced); about $0.06 a run, 16 per pair |
| `npm run dedup-eval` | `tests/dedup-eval.mjs`: `--dedup` never / auto / always against real Jev on `tests/dedup-corpus.tsv` (tune on this) and `tests/dedup-holdout.tsv` (written blind; never tune on it): result differences beyond never/never noise, cost, stability, a threshold sweep. `--dry` sends nothing and prints what a real run would cost | the key above; `--dry` first; a real run bills about 3.4M input tokens (~$0.14) on the corpus and 7.1M (~$0.30) on the holdout, 30 s each |
| `npm run smoke` | `tests/smoke.mts`: questions about this repository (`tests/smoke-cases.json`: expression, targets, what a sensible answer is, optional `mustMatch` / `mustNotMatch` / `expectNone`) sent to real Jev, the printed lines and probabilities judged by `claude -p`; verdicts ok / doubtful / wrong in `tests/smoke-report.md`. Not pass/fail: look at the `wrong` ones | the key above and `claude -p`; about 1 minute, 9 Jev searches over this repo's files and 9 `claude -p` judge calls (cents) |
| `npm run cause-eval` | `tests/cause-eval.mjs`: the cause-hypothesis recipe of README "Finding the cause of a failed command" on 24 generated failed-job logs (#156): where `--rank=jev` and `--rank=match` put the cause, cost, time, one TSV row per log. `--dry-run` sends nothing and prints the estimate; `--write=DIR` only writes the logs. The committed 24 rows came from an earlier version of the script; its `top 2 jev` column is filled only in the two rerun rows | the key above; `--dry-run` first; about $0.09 and 16–17 s a 10,000-line log, $2.2 for all 24; prints the estimate before sending, and exits 2 before a log that could pass `--budget` (default 3), the first included |
| `npm run judge` | `tests/judge.mts`: accuracy (P / R / F1 over a threshold sweep) against Claude's verdicts, written to `tests/report.md` | the key above and `claude -p`; slow, not pass/fail |

Run `OFFLINE_ONLY=PATTERN npm run test:offline` on the section a change touches while iterating; run the plain `npm run test:offline` once and `npm test` before a push. The demo at /demo/ (#200) is built by
`.github/workflows/pages.yml` at deploy time; `docs/demo/` is git-ignored except the recording `docs/demo/cache.json`,
so a PR never rebuilds or commits it. `node scripts/demo-build.mjs` builds it into `docs/demo/` for a local look.

- Never start `--serve`, or run a script that drives it (`tests/serve-page.mjs`, a browser or screenshot check), with
  the real `HOME`: the settings panel's Save writes `~/.config/sys1grep/settings.json`, and a test run once left its
  dummy model and key there (#206). Use `HOME=$(mktemp -d)` for the server and the script alike. `serve-page.mjs`
  refuses the real `HOME`; `offline.sh` fails if the real `settings.json` appears or changes during a run (it looks at
  the file's existence, size and mtime, never its content). Never print a real settings file or `.env`.
- `--serve` work: run the `serve-check` skill and put its result in the PR. A worktree-isolated subagent cannot
  set `HOME`, so it cannot run this skill end to end; the coordinator dispatches a non-isolated subagent to run it
  instead (owner decision, 2026-10-13).
- The fake scores a line 0.9 when it contains the meaning verbatim, `N` when the line also carries `@N`, else 0.05.
  It understands the judging question (`Does line L000 match the meaning: "…"?`) and the auto-scope question
  (`Does the meaning "…" restrict its matches to …?`: 0.9 when the meaning carries `@s:KEY` for that question's
  key, e.g. `@s:l_python`) and the rank question (`Is result R000 relevant to: …?`: `N` when the result carries
  `@rN`, else 0.5) and `--dedup`'s question (`Could the value of … change whether that line matches the meaning
  "…"?`: 0.9 for the kind K when the meaning carries `@k:K`, e.g. `@k:num`, else 0.05); change them together.
- `offline.sh` unsets the key variables and points `HOME` at a temp dir, so no real key reaches the fake.
- Tune auto-scope (question wording, threshold) on `scope-corpus.tsv` only. Once you have tuned on
  `scope-holdout.tsv`, write a new holdout blind (without reading the code or the corpora).
- `check.sh` asserts only clear positives and negatives: Jev's probabilities drift by about ±0.05 between runs.
  A failure there can be the model, not the code; if `test:offline` passes, rerun and look at `-p` first.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for uehaj/sys1grep, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root, and `docs/adr/` once an ADR is written (none yet). See `docs/agents/domain.md`.

## Worktrees

An unneeded worktree may be removed without asking. Unneeded means its PR is merged or closed and no session is working in it (check the session list; the pstack worktree-cleanup playbook's audit script lists merge state, PR state and the last chat per worktree). Use `git worktree remove` without `--force`, so git refuses a dirty one. Keep a worktree that has uncommitted changes, or commits that no branch and no merged PR contains.

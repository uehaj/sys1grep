---
name: serve-check
description: Check sys1grep --serve in a real browser (Chromium, via playwright-cli) against the fake Jev, with a fixed pass/fail checklist and screenshots. Use it for any change to serve.mjs, to what the page builds into a command line (toArgv, CONTROLS, EXAMPLES), to a template the page shows, or to a doc describing the page, before opening the PR.
---

## Why this exists

`tests/serve-page.mjs` runs the page's script against a fake DOM built from its own tags. It checks logic, not
what a browser draws: no real layout, no CSS, no real width, no real dialog. #214 (tooltip clipping), #222/#224/#237
(examples that never matched) were all found by looking at the page, not by a test. This skill is that look, made
repeatable.

It does not replace `tests/offline.sh` or `tests/serve-page.mjs`. They check logic fast and for free; this skill
checks what only a real browser shows, and costs a server start and a few seconds of Chromium.

## 1. Start the server safely

Never with the real `HOME` (#206: the settings dialog's Save writes `~/.config/sys1grep/settings.json`, and a run
once left its dummy model and key there).

```sh
export HOME=$(mktemp -d)                        # a scratch HOME for the --serve process (#206)

node .claude/skills/serve-check/fixture.mjs workdir/serve-check   # writes workdir/serve-check/target/{fixture.txt,fixture.jsx}

node tests/fake-jev.mjs > workdir/serve-check/fake.port 2>workdir/serve-check/fake.log & fake=$!
while [ ! -s workdir/serve-check/fake.port ]; do sleep 0.05; done
base="http://127.0.0.1:$(cat workdir/serve-check/fake.port)"

SYS1GREP_URL=$base/v1 SYS1GREP_SUMMARIZER=$base/v1 SYS1GREP_SUMMARIZER_MODEL=fake \
  node sys1grep.mjs --serve -r workdir/serve-check/target > workdir/serve-check/serve.url 2>workdir/serve-check/serve.log & serve=$!
while [ ! -s workdir/serve-check/serve.url ]; do sleep 0.05; done
U=$(cat workdir/serve-check/serve.url)   # http://127.0.0.1:PORT/?k=TOKEN

# always, even on failure:
kill $serve $fake 2>/dev/null
```

Pick a free port by not passing one (`--serve` with no `=PORT` picks one itself and prints it, same as the line
above). `-r workdir/serve-check/target` is required: a folder target without `-r` is refused (#222).
`SYS1GREP_SUMMARIZER=$base/v1` points a bare `--summarize` (the page's checkbox) at the fake's
`/chat/completions` stand-in instead of a real model; `SYS1GREP_SUMMARIZER_MODEL` is required for any URL
summarizer and the value does not matter to the fake.

The search target is `workdir/serve-check/target/`, one level under where the run's own files land
(`fake.port`, `serve.url`, the logs, the screenshots in the next step). Keep it that way: `serve.url` holds
`?k=TOKEN`, and a log that keeps growing is new content a later search could match against, so neither belongs
inside what gets searched.

`fixture.mjs` builds the target from `serve.mjs`'s own `EXAMPLES` array, so the lines it writes track what the
examples actually ask for. It fails loudly if `EXAMPLES` gained, lost, or reworded a heading it doesn't know about
(update its `LINES` table, then rerun) rather than silently shipping a fixture that proves nothing.

Wrap the whole run in a time limit (`perl -e 'alarm 120; exec @ARGV' sh -c '...'`, the `tests/offline.sh` idiom) and
kill both processes in every exit path, success or failure. Never start a `--serve` you are not prepared to stop.

## 2. Drive it with a real browser

Default: the `playwright-cli` skill, Chromium (its default browser), headless. Install it
(`npm i -g @playwright/cli`, or use `npx @playwright/cli`) if the machine doesn't have it; this does not become a
repository dependency.

Run `playwright-cli` itself with the **real** `HOME`, in a separate command from the one that started `--serve`
(step 1 exported a scratch `HOME` for that command only). The browser never writes `~/.config/sys1grep/settings.json`;
only `--serve`'s own process does, which is why #206's guard is on the server (and on `tests/serve-page.mjs`), not on
Chromium. A real `HOME` also means Playwright finds its already-downloaded browser (`~/Library/Caches/ms-playwright`
on macOS); a scratch one would need `PLAYWRIGHT_BROWSERS_PATH` pointed at the real cache, or `open` fails outright.

```sh
playwright-cli open "$U"
playwright-cli snapshot                 # refs (e3, e7, ...) for every clickable thing
playwright-cli click <ref-of-a-button>
playwright-cli resize 1280 800
playwright-cli screenshot --filename=workdir/serve-check/01-desktop-light.png
playwright-cli run-code "async page => page.emulateMedia({ colorScheme: 'dark' })"
playwright-cli screenshot --filename=workdir/serve-check/02-desktop-dark.png
playwright-cli close
```

Chrome DevTools MCP is the fallback for a page that misbehaves (console, network, DOM), when it is already
available; `serve-check`'s own run stays on `playwright-cli`.

Example buttons have no stable id (`EXAMPLES` can be reordered or get a `--suggest` pill ahead of them); take a
snapshot and click by the button's visible text, not by position.

Run `playwright-cli` with its cwd inside `workdir/` (not inside `workdir/serve-check/target/`, the search target)
or pass an absolute `--filename=`, so its own `.playwright-cli/` snapshot cache lands in a gitignored place instead
of the repo root or the searched target.

## 3. The checklist

Run every item even after one fails; the verdict is pass only if every item passed. Evidence is a screenshot (or
the matching snapshot) and, for a search, the match count the page shows.

1. The page loads: no console error, no failed request (`playwright-cli console` / `network`).
2. Sections and Target are right: "Target" shows `workdir/serve-check/target` (#216), the two language buttons
   (`EN`, `日本語`) are there.
3. One example per kind runs and shows matches: a meaning, a question (`-Q`), `-v`, `--dedup` (matches print as
   usual, one per line; `--dedup` folds the judging question Jev is asked, not what's shown — look at `--verbose`
   or the estimate for fewer judged units, not a shorter result list), a multi-step (`--step-to`; these are plain
   regex over source, not Jev, and `fixture.jsx` is there so the launch target itself has something to walk), one
   sentence at a time (`unit: sentence-by-jev`). Click the example, click Search, read the match count.
4. Both languages: click `日本語`, click an example, confirm it fills with the Japanese text and that the exact
   command shown matches the kind of search EN did (not necessarily the same example).
5. Search, Stop, Estimate cost, Copy each do something observable: Search shows results, Stop (clicked mid-search,
   or verify it's enabled only while running and disabled otherwise), Estimate cost shows a dry-run estimate and no
   results, Copy puts the `#cmd` text on the clipboard.
6. The command line shown (`#cmd`) equals what ran: copy it (it starts with `sys1grep`, not `node sys1grep.mjs`),
   run `env SYS1GREP_URL=... node sys1grep.mjs` followed by everything after that first word, against the same
   fake and target, and compare its match count to the page's.
7. Summarize on: check the "summarize" box, run a search, confirm the right panel (`#right`) shows a summary (the
   fake's `/chat/completions` stand-in answers with the request's own text upper-cased, so a visible all-caps
   answer confirms the request reached it, not just that something rendered).
8. The settings dialog (gear icon) opens, Save writes into the scratch `HOME` (never the real one — check this
   `HOME`'s `~/.config/sys1grep/settings.json`, not the real user's), closes, and every `?` hint's tooltip stays
   inside the viewport at every width below.
9. Widths 1280, 800, and 375 (mobile, #214), light and dark (`prefers-color-scheme`, emulated via
   `page.emulateMedia`): no clipped tooltip, no horizontal scrollbar, the docked/inline results panel still
   readable.
10. A no-match search (an example or meaning nothing in the fixture satisfies) shows a message in `#left`, never a
    blank panel. A failing search needs its own launch, since `SYS1GREP_URL` is fixed when `--serve` starts: either
    point it at a closed port, or launch once more with a target that holds only an `@err` fixture line (per
    `tests/fake-jev.mjs`, every search against it fails with a 400). Either way, `#left` shows a message, not a
    blank panel, and the server is still answering afterward.

## 4. Evidence out

Screenshots go in the PR body (the owner drags the PNGs in from wherever this run saved them, e.g.
`workdir/serve-check/`), never into the repository and never committed. Alongside them, paste the checklist with
each item's verdict (pass/fail) and, for a layout item, the matching `playwright-cli snapshot` YAML in a `<details>`
block — that's text, so it lands in the PR body on its own. Never paste or screenshot `~/.config/sys1grep/settings.json`
or any `.env`, real or in the scratch `HOME`.

## 5. Fail loudly

A failed item goes in the report with its screenshot and a one-line reason; "probably fine" is not a verdict. A
failing run does not block finishing the checklist — run every item, then report every failure, so one bad item
doesn't hide a second one.

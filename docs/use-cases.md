# Use cases, by job

The README's [Examples](../README.md#examples) are organised by option and run on the test fixtures. This page
is organised by the job a reader has to do. Every entry was run on real, public data on 2026-10-04 with
sys1grep 0.5.0-next.2 (commit `2d0b009`), using existing options only; thresholds were left at the default or
moved only with `--level`. The output shown is what the run printed, cut where marked `…`.

Each entry gives the job, the command, the data, what it found and missed, how a keyword search compares, and
what the run cost. Entries that did not work are in [Tried, not recommended](#tried-not-recommended).

**How the numbers were taken.** Each command was run as `node sys1grep.mjs --verbose -y ARGS`; `--verbose`
prints the summary line on stderr even when stderr is not a terminal. The token counts are the `usage.input_tokens` Jev
returned, priced at TypeSafe's list price ($0.042 per million input tokens). Times are wall-clock for the
whole run, round trips to the API included, from one machine on one day.

**Data.** Logs are the 2,000-line samples from [LogHub](https://github.com/logpai/loghub), real system logs
published for research use; Zhu et al., "Loghub: A Large Collection
of System Log Datasets for AI-driven Log Analytics", ISSRE 2023. This page quotes only a few lines of them: ten
OpenSSH lines and some message templates. Issues are public GitHub issues fetched with `gh` on 2026-10-04; refetching later gets
newer issues, so counts will differ. Git history is this repository's (229 commits at `2d0b009`). Code is this
repository's and the Python 3.13.3 standard library.

Contents:

- [Operations](#operations): what an on-call person reads first; attackers guessing real people's names
- [Support and triage](#support-and-triage): feature requests in an issue inbox; their summary; users about to leave
- [Mixed languages](#mixed-languages): one meaning over Chinese and English issues
- [Development](#development): release-note candidates; swallowed errors; TODOs that are bugs
- [Notes and decisions](#notes-and-decisions): what did we decide about X
- [Vitals over the history](#vitals-over-the-history): rework, workaround and test rates per week
- [Tried, not recommended](#tried-not-recommended)
- [Not tried](#not-tried)

## Operations

### What should the on-call person read first in this log?

```sh
curl -sO https://raw.githubusercontent.com/logpai/loghub/master/Linux/Linux_2k.log
sys1grep --dedup -n -e "an error the operator must act on" -v "a retry that later succeeded" Linux_2k.log
```

Data: LogHub `Linux_2k.log`, 2,000 syslog lines (sshd, ftpd, su, klogind, logrotate, kernel), English.

```
114 of 2000 lines matched; 2000 sent to Jev (0 folded by --dedup, …) in 69 requests, 254907 input tokens, ~$0.010706
```

Grouped by template, the 114 lines are: all 43 `logrotate: ALERT exited abnormally`, 30 of the 46 `klogind`
Kerberos failures, 40 of the 489 `sshd(pam_unix): authentication failure` lines, and the one
`kernel: Failure registering capabilities with the kernel`.

`grep -ciE 'fail|error|alert|abnormal|denied'` returns 581 lines, 489 of them the sshd brute-force noise. The
meaning keeps every logrotate alert and drops most of that noise. It is not consistent, though: lines from the
same template got different answers (40 of 489 sshd lines kept), because the lines in one request are each
other's context. Read the result as "templates worth a look", not as a count.

`--dedup` folded nothing here. Jev answered that the meaning reads numbers and URLs, so lines that differ only in
a pid or a host stayed apart. The part of the summary line cut at `…` is therefore a negative saving
(`~-N input tokens / ~$-x saved, -P%`): with nothing folded, the tokens `--dedup` spent on its own questions count
against it. `--dry-run` assumes nothing is kept apart and estimated 153 lines and ~16k
tokens; the run sent 2,000 lines and 255k tokens. Under `--dedup`, take the dry-run figure as a lower bound.

On LogHub `Apache_2k.log` (2,000 lines, 6 templates by LogHub's own `Apache_2k.log_templates.csv`) the same meaning without `-v` did fold:

```sh
sys1grep --dedup -c -e "an error the operator must act on" Apache_2k.log
574
574 of 2000 lines matched; 1461 sent to Jev (539 folded by --dedup, ~35237 input tokens / ~$0.001480 saved, 22%) in 50 requests, 125192 input tokens, ~$0.005258
```

A second run with `-p`, to see which lines, matched 578, four more than the first: the same input does not
always get the same verdicts. In that run it kept all 539 `mod_jk child workerEnv in error state` lines, all 12
`mod_jk child init` and 11 of 12 `Can't find child … in scoreboard`, and 16 of the 32 `Directory index forbidden`
lines (a client asking for a directory listing; the split is the same context effect as above).

Cost and time: $0.0107 and 2.2 s (Linux); $0.0053 and 1.8 s (Apache).

### Is an attacker guessing the names of real people, not just `admin` and `oracle`?

```sh
curl -sO https://raw.githubusercontent.com/logpai/loghub/master/OpenSSH/OpenSSH_2k.log
sys1grep -p -e '/Invalid user (?<u>\S+) from/' \
  -a '「$<u>」は人の名前（個人のアカウント）であり、admin や oracle のような役割・製品のアカウント名ではない' OpenSSH_2k.log
```

Data: LogHub `OpenSSH_2k.log`, 2,000 sshd lines, 112 of them `Invalid user NAME from` with 56 distinct names. The meaning is
Japanese, the log English. The regex sends only the `Invalid user` lines and hands the name to the meaning as
`$<u>`.

```
Dec 10 07:11:42 LabSZ sshd[24224]: Invalid user chen from 202.100.179.208	[1.00 0.77]
Dec 10 09:17:46 LabSZ sshd[24620]: Invalid user ted from 187.141.143.180	[1.00 0.62]
Dec 10 09:19:37 LabSZ sshd[24665]: Invalid user magnos from 187.141.143.180	[1.00 0.56]
Dec 10 09:19:42 LabSZ sshd[24667]: Invalid user magnos from 187.141.143.180	[1.00 0.52]
Dec 10 09:19:49 LabSZ sshd[24669]: Invalid user ingrid from 187.141.143.180	[1.00 0.80]
Dec 10 09:19:54 LabSZ sshd[24671]: Invalid user jay from 187.141.143.180	[1.00 0.77]
Dec 10 09:20:00 LabSZ sshd[24673]: Invalid user cyrus from 187.141.143.180	[1.00 0.61]
Dec 10 10:54:27 LabSZ sshd[24868]: Invalid user zhangyan from 183.62.140.253	[1.00 0.84]
Dec 10 10:55:07 LabSZ sshd[24914]: Invalid user cheng from 202.100.179.208	[1.00 0.70]
Dec 10 11:00:57 LabSZ sshd[25283]: Invalid user sandeep from 88.147.143.242	[1.00 0.86]
10 of 2000 lines matched; 112 sent to Jev in 4 requests, 14637 input tokens, ~$0.000615
```

Reading the 56 names by hand, seven are personal names: chen, cheng, ingrid, jay, sandeep, ted, zhangyan. All seven
were found. `cyrus` is a personal name and also a mail server's account; `magnos` scored just over 0.5. None of
`admin`, `oracle`, `support`, `test`, `ubuntu`, `postgres`, `nagios`, `pi` and the other role names matched.
A keyword search cannot do this without a list of first names. One source address tried five of the names
(ted, magnos, ingrid, jay, cyrus) in just over two minutes.

Cost and time: $0.0006 and 0.4 s.

## Support and triage

### Which of these issues are feature requests?

```sh
gh issue list -R ollama/ollama --state all --limit 300 --json number,title,body,labels > issues.json
jq -j '.[] | select([.labels[].name] | (index("bug") != null) != (index("feature request") != null))
       | "#\(.number) \(.title)\n\((.body // "")[:2000])\u0000"' issues.json > triage.z
sys1grep -z -e "the reporter asks for a new feature or an improvement, not a fix for something that is broken" < triage.z
```

Data: the 300 most recent `ollama/ollama` issues, of which 133 carry exactly one of the labels `bug` (101) and
`feature request` (32). The labels are the reference; the text sent is the title and the first 2,000 characters
of the body, one record per issue. (The run built `triage.z` with a Python script; this `jq` filter does the same, but
was not checked to produce the same bytes.)

```
33 of 133 records matched; 133 sent to Jev in 9 requests, 62916 input tokens, ~$0.002642
```

| method | flagged | feature requests | bugs | missed | precision | recall |
|---|---|---|---|---|---|---|
| sys1grep, the meaning above | 33 | 29 | 4 | 3 | 0.88 | 0.91 |
| keywords: `feature\|support for\|please add\|would be (nice\|great)\|add support\|request` | 60 | 17 | 43 | 15 | 0.28 | 0.53 |
| records without the bug template's `What is the issue?` heading | 41 | 32 | 9 | 0 | 0.78 | 1.00 |

The four bugs it flagged read like requests (#18352 "Can not inccrease Context to 1 M limited 256K", #18595 "macOS
0.33.0: no garbage collection for orphaned blobs — found a live 21GB orphan via manifest audit"). Of the three it missed, two are questions ("Does latest Ollama support
Parallel inference with Qwen 3.6 & 3.8 series?") and one is a bare title, `Support CLAUDE_CODE_AUTO_MODE_SERVER=1`. Keywords do
badly because bug reports say "support" and "request" too. This repository uses issue forms, so the form's own
heading already separates most of the classes; the meaning is for an inbox with no form, such as mail.

Cost and time: $0.0026 and 0.7 s.

### What are the users asking for, in five lines?

The same search, with `--summarize` handing the 33 matching issues to `claude -p --model haiku`:

```sh
sys1grep -z --summarize \
  --summarize-prompt="Five bullet points or fewer: what the reporters ask for, grouped by theme, each with its issue numbers." \
  -e "the reporter asks for a new feature or an improvement, not a fix for something that is broken" < triage.z
```

```
Hardware and Model Architecture Support: Reporters request support for K2 Horizon models, Qualcomm IQ-9075 NPU/GPU, ROCm 10 on Windows, .litertlm models, … Issues: #18698, #18445, #18435, #18102, #18097

GPU Memory and Resource Management: Reporters ask for idle GPU VRAM to be released under memory pressure, granular memory split controls for multi-GPU systems, … Issues: #18612, #18525, #18487, #18185
…
```

Five themes came back, each with issue numbers that can be checked. The answer includes #18352, one of the four
bugs above: the summary inherits the search's mistakes. Jev's part cost $0.0026; sys1grep does not report what
the summarizer cost, and we did not measure it. The run took 58.6 s, almost all of it the summarizer.

### Is any user saying they will leave for another tool?

```sh
gh issue list -R ollama/ollama --state all --limit 300 --json number,title,body > issues.json
jq -j '.[] | "#\(.number) \(.title)\n\((.body // "")[:2000])\u0000"' issues.json > issues.z
sys1grep -z -e "the user says they will stop using the tool, or have switched to another one" < issues.z
```

Data: the same 300 issues, all of them.

```
0 of 300 records matched; 300 sent to Jev in 22 requests, 156840 input tokens, ~$0.006587
sys1grep: no record reached 0.5 for "the user says they will stop using the tool, or have switched to another one"; the highest was 0.42 (standard input:239). …
```

The keyword list a person would write (`switch(ed|ing)? to|stop using|moved to|going back to|uninstall|alternative|lm ?studio|…`)
hits 15 records. Read by hand, none is a user leaving: "I
uninstalled/reinstalled Ollama", "I want to switch to the Annual subscription", "Since switching to ROCm". The
highest-scoring record (0.42, #18117) is a user who switched GPU backends. So the meaning raised no false alarm
where the keywords raised 15, but this inbox held no real case, so its recall is unmeasured.

Cost and time: $0.0066 and 0.9 s.

## Mixed languages

### One meaning over issues in Chinese and English

```sh
gh issue list -R lobehub/lobe-chat --state all --limit 200 --json number,title,body,labels > lobe.json
jq -j '.[] | "#\(.number) \(.title)\n\((.body // "")[:1500])\u0000"' lobe.json > lobe.z
sys1grep -z -p -e "ユーザーがログインできない、または認証に失敗している" < lobe.z
```

Data: the 200 most recent `lobehub/lobe-chat` issues; 34 contain Chinese, the rest are English. The meaning is
Japanese.

```
#18619 [Mobile] 内置 Ollama Cloud 服务商 API Key 认证失败 401  [0.79]
1 of 200 records matched; 200 sent to Jev in 14 requests, 93212 input tokens, ~$0.003915
```

The English meaning `"a user cannot log in, or authentication fails"` found the same single issue (0.89).
`--level loose` added one unrelated issue at 0.32. A title search for
`log ?in|sign ?in|auth|登录|登陆|认证|鉴权|401|oauth|sso` finds five titles: the one above; "Mobile web white
screen after login" (the login worked); "AUTH mode generates no service worker" (not a failure to log in); and
two failures between services, an OAuth connector that never becomes active (#18676) and an `Authorization`
header that is not passed on (#19878). Whether those two are "authentication fails" is a judgment call; the
meaning, in both languages, said no.

What this shows is that the language of the meaning did not change the result. What it does not show is better
recall than a keyword list: on this inbox the keyword list, read by a person, finds the same issue plus the two
borderline ones.

Cost and time: $0.0039 and 0.7 s (Japanese meaning); $0.0038 and 0.8 s (English).

## Development

### Which commits go into the release notes?

The README has this example on a few commits ([Records that span several lines](../README.md#records-that-span-several-lines--z)).
Here it is on every commit since the last release, checked against `CHANGELOG.md`.

```sh
git log -z --format='%h %s%n%b' v0.4.0.. | sys1grep -z -e "the change alters user-visible behaviour" -v "documentation only"
```

Data: the 58 commits from `v0.4.0` to `2d0b009`.

```
36 of 58 records matched; 58 sent to Jev in 4 requests, 23798 input tokens, ~$0.001000
```

All 31 `feat:` and `fix:` commits matched. So did five without that prefix that change behaviour, such as
`refactor: --unit=line|zero|sentence-by-jev|sentence-by-rule replaces --sentence`, `Rename to sys1grep`, and
`git sys1grep: add --cached, --untracked and <tree>...`. The 22 left out are `test:`, `ci:`, `docs:`, version
bumps and demo-link fixes. Two of those `docs:` commits name an issue (#163, #166) that the CHANGELOG lists, and
the `feat:` commits for the same issues matched, so the release notes lose nothing.

`grep -E '^[0-9a-f]+ (feat|fix)'` finds the 31. In a repository that follows Conventional Commits, grep is nearly
enough; the meaning adds the commits whose prefix undersells them.

Cost and time: $0.0010 and 0.5 s.

### Which `catch` blocks swallow the error?

```sh
sys1grep -n -p -e '/catch/' -a "the error is ignored" sys1grep.mjs serve.mjs
```

Data: this repository's `sys1grep.mjs` (2,574 lines) and `serve.mjs` (284 lines); 33 lines hold `catch`.

```
sys1grep.mjs:932:    catch { isRev = false; }	[1.00 0.87]
sys1grep.mjs:1224:    try { paths = new Set(execFileSync('git', … catch {}	[1.00 0.93]
sys1grep.mjs:1229:const gitOut = (top, ...args) => { try { return execFileSync('git', … catch { return ''; } };	[1.00 0.91]
sys1grep.mjs:1374:  try { git(['check-ignore', '-q', '.']); return new Set(); } catch {} // exit 0: dir itself is ignored	[1.00 0.80]
sys1grep.mjs:1376:  catch { return new Set(); } // not in a repository, or no git: nothing is ignored	[1.00 0.80]
sys1grep.mjs:1730:      : (() => { try { return statSync(file).size; } catch { return null; } })();	[1.00 0.83]
sys1grep.mjs:1812:  const git = (args, input) => { try { return execFileSync('git', … catch { return ''; } };	[1.00 0.85]
sys1grep.mjs:1819:    } catch (e) { console.error(`sys1grep: diff.${safe(driver)}.${x}funcname: ${safe(e.message)}; using sys1grep's own rule`); }	[1.00 0.51]
serve.mjs:244:    const r = await fetch('/' + kind + '?' + query(p), …, j = await r.json().catch(() => ({ error: 'bad answer' }));	[1.00 0.63]
9 of 2858 lines matched; 33 sent to Jev in 2 requests, 2740 input tokens, ~$0.000115
```

Eight of the nine drop the error or only log it (1819 logs and falls back), which is the job. The ninth
(`serve.mjs:244`) turns the error into a value the page shows, so it is handled. The 24 lines left out all `die`,
`warn`, rethrow, retry and then rethrow (`sys1grep.mjs:1549`), show the error (`serve.mjs:246`), or are not code
(`catch` in a help string, a keyword list). All of these swallows are
deliberate in this code base; the search finds them, it does not judge them.

A regex for an empty body, `catch\s*\{\s*\}`, finds two of the nine (1224 and 1374) and none that return a
default.

Cost and time: $0.0001 and 0.4 s.

### Which TODOs describe a known bug, not a wish?

```sh
cd "$(python3 -c 'import sysconfig; print(sysconfig.get_paths()["stdlib"])')"
sys1grep -r -n -p -e '/#.*\b(TODO|XXX|FIXME)\b/' -a "a TODO that describes a known bug, not a wish" email http asyncio json urllib
```

Data: five packages of the Python 3.13.3 standard library, 36,952 lines, 63 of them comments with TODO, XXX or
FIXME. (The run used a copy of the five directories.)

```
email/contentmanager.py:131:# XXX: This is a cleaned-up version of base64mime.body_encode (including a bug	[1.00 0.74]
email/contentmanager.py:237:        # XXX: quoprimime.body_encode won't encode newline characters in data,	[1.00 0.63]
email/generator.py:160:        # XXX logic tells me this else should be needed, but the tests fail	[1.00 0.64]
email/mime/text.py:29:        # XXX: This can be removed once #7304 is fixed.	[1.00 0.88]
email/policy.py:144:            # XXX this error message isn't quite right when we use splitlines	[1.00 0.79]
http/cookiejar.py:327:        # XXX there's an extra bit of the timezone I'm ignoring here: is	[1.00 0.64]
http/cookiejar.py:490:        # XXX: The following does not strictly adhere to RFCs in that empty	[1.00 0.50]
urllib/request.py:2062:        # XXX thread unsafe!	[1.00 0.69]
8 of 36952 lines matched; 63 sent to Jev in 4 requests, 6280 input tokens, ~$0.000264
```

All eight describe something wrong today. Among the 55 left out are wishes and design notes ("would be nice to
have pluggable cache strategies", "should probably be revised"), which is right, but also some that state a
defect: `urllib/request.py:1566` "this stuff is definitely not thread safe", `:1722` "This is not threadsafe.
Bah.", `:912` "will stupidly pick …", `:1060` "qop="auth-int" supports is shaky". Line 2062, "thread unsafe!",
matched while 1566 and 1722, which say the same, did not. Precision was high and recall about half: use it to
pick the first ones to read, not to prove none are left.

Cost and time: $0.0003 and 0.7 s.

## Notes and decisions

### What did we decide about X, and why?

```sh
sys1grep -r -n -p --include='*.md' -Q "what did we decide about reading a .env file in the current directory, and why" .
```

Data: this repository's Markdown at `2d0b009`, 10 files, 2,925 lines, English and Japanese (CHANGELOG, both
READMEs, CONTEXT, CLAUDE, RELEASING, the agent docs, `tests/report.md`). The line numbers below are that tree's;
the commit that adds this page also adds two lines to each README, before its line 300, so `README.md:737` is line 739
after it.

```
./CHANGELOG.md:210:- **Breaking:** `./.env` in the current directory is no longer read, as in 0.3.1 (see there).	[0.74]
./CHANGELOG.md:300:- **Breaking:** `./.env` in the current directory is no longer read; only the environment and	[0.53]
./CHANGELOG.md:301:  `~/.config/semgrep/.env` are. A `.env` committed to an untrusted repository could set `SEMGREP_URL` and send	[0.67]
./CHANGELOG.md:351:- `-r` skips `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`-style keys and `.ssh` / `.aws` / `.gnupg`,	[0.74]
./CHANGELOG.md:352:  since every searched line is sent to the TypeSafe API. A file named explicitly is still searched.	[0.69]
./README.ja.md:238:環境変数が優先で、足りない分は `~/.config/sys1grep/.env` から補います。カレントディレクトリの `.env` は読みません。	[0.77]
./README.ja.md:239:clone したばかりのリポジトリのものかもしれず、`SYS1GREP_URL` を通じてキーを別のサーバへ送らせ得るからです。	[0.66]
./README.md:250:Variables already in the environment win; otherwise `~/.config/sys1grep/.env` fills them in. A `.env` in the current	[0.55]
./README.md:251:directory is never read: it may belong to a repository you just cloned, and could send your key elsewhere through	[0.91]
./README.md:252:`SYS1GREP_URL`. For per-project settings, load a file yourself: `node --env-file=.env "$(command -v sys1grep)" ...`.	[0.79]
./README.md:737:The key is read in sys1grep.mjs:22 from ~/.config/sys1grep/.env, never from ./.env (sys1grep.mjs:18), ...	[0.64]
11 of 2925 lines matched; 2364 sent to Jev in 80 requests, 207135 input tokens, ~$0.008700
```

The 11 lines are the decision, the reason (an untrusted checkout's `.env` could redirect the key) and when it
was made (0.3.1), in both languages. Two of them (351, 352) are a neighbouring decision, which files `-r` skips.
`grep -rn '\.env' --include='*.md'` gives 40 lines in four files; the same answer is in them, among the setup
instructions and option lists. Here grep plus reading the 40 lines also works; sys1grep saves the reading, at
80 requests for the whole folder.

Cost and time: $0.0087 and 2.7 s.

## Vitals over the history

### How often do we rework, work around, and write tests, week by week?

```sh
sys1grep -g -p -e "a workaround, not a root-cause fix" -e "undoes a recent change" -e "comes with a test" |
  awk '/^[0-9a-f]{7,} [0-9]{4}-[0-9][0-9]-[0-9][0-9] / { h = $1 }
       match($0, /\t\[[0-9. ]+\]$/) { split(substr($0, RSTART + 2, RLENGTH - 3), p, " "); print h, p[1], p[2], p[3] }' > hits.txt
git log --date=format:%G-W%V --format='%h %ad' > weeks.txt
awk 'NR == FNR { w[$1] = $2; n[$2]++; next }
     { if ($2 >= .5) a[w[$1]]++; if ($3 >= .5) b[w[$1]]++; if ($4 >= .5) c[w[$1]]++ }
     END { for (k in n) printf "%s %7d %10d %4d %4d\n", k, n[k], a[k], b[k], c[k] }' weeks.txt hits.txt | sort
```

Data: this repository's 229 commits, 2026-09-19 to 2026-10-04. `-p` prints the three probabilities on a matching
commit's last line; a commit no meaning matched is not printed, and counts as no for all three.

```
54 of 229 records matched; 229 sent to Jev in 12 requests, 61157 input tokens, ~$0.002569
```

The table: ISO week, commits that week, then the commits that matched each meaning (workaround, undo, test).

```
2026-W38      47          0    3    2
2026-W39     149          2    3   31
2026-W40      33          2    1   12
```

Checked by hand:

- **undo**: 7. The three `Revert "…"` commits score 0.96 to 0.98. The other four are changes that take back an
  earlier one: "never read ./.env" (0.66), "landing page drops key-prefix routing" (0.59), and "Change demo link
  from sys1grep to jev-semgrep" (0.55). The fourth is a miss: the commit that replaced a README example (0.55),
  which is not an undo itself but was undone later.
- **workaround**: 4, all test fixes (for example "the #136 behaviour checks run only on git >= 2.37; older git
  skips them"). Defensible, but few enough that the rate means little on 229 commits.
- **test**: 45, but this is about the message. Most commits here add tests without saying so, and the
  proposition cannot see the diff. Sending the file list in the record (`git log -z --stat … | sys1grep -z`) should
  help; that was not tried here.

Split by the `Co-Authored-By: Claude …` trailer (`git log --format='%h %(trailers:key=Co-Authored-By,valueonly)'`,
joined the same way): 173 agent commits had 4 workarounds, 4 undos and 43 tests; 56 human commits had 0, 3 and 2.
The test gap probably says more about how the messages are written than about the work (not checked against the
diffs).

Cautions for using this as a metric: it is for a team's retrospective, not for scoring a person (once people know
the proposition, the messages change); a history whose messages say only "fix" gives the meaning nothing to read;
and the first few dozen verdicts should be checked by a person, as `tests/judge.mts` does for the fixtures.

Cost and time: $0.0026 and 0.8 s.

## Tried, not recommended

- **"Why was this change made?" as a question over commits.** `sys1grep -g -Q "why was this change made"` matched 35
  of 229 commits. At `--level loose` the scores bunch between 0.3 and 0.6: a commit with no reason ("Change demo link
  from sys1grep to jev-semgrep", 0.43) scored the same as one that explains itself ("GitHub strips scripts and
  iframes, so…", 0.44). Phrased as a proposition, `-e "the commit message gives the reason for the change, not only
  what changed"` separates them (0.88 for the second; the first falls under 0.3). It matched 146 at `--level loose`,
  114 of them at 0.5 or more; the 0.5 to 0.6 band is detailed "what" messages. Use the proposition, not `-Q`, for this
  job. ($0.0022 per run, about 1 s.)
- **"Input from the network is used without validation", one line at a time.** On `serve.mjs`, the HTTP server,
  it flagged two lines of browser-side code that read the server's own JSON (0.65, 0.56) and none of the lines that
  parse the request (`new URL(req.url …)`, `url.searchParams`), which do validate. With `--unit=function` nothing
  matched (highest 0.34). `serve.mjs` checks its input, so there was no true case to find: recall is unmeasured,
  and per line the data flow is out of view (#114). ($0.0008 per line, $0.0004 per function.)
- **"A claim without evidence" in a draft.** `--unit=sentence-by-rule -o -e "a claim stated without evidence or a
  source"` over the README's "How this differs from vector search" section (44 sentences) flagged one sentence,
  the one admitting that a number could not be reproduced. At `--level loose` it added "The argument stands on the
  wording alone" (0.48), a fair catch, but not "The probabilities are calibrated, so one threshold (0.5) works
  across queries", which is stated without a measurement. One sentence cannot show whether its evidence is in the
  next; an LLM review of the whole draft is the better tool. ($0.0001.)

## Not tried

- **File names by meaning over `find -print0`** ("looks like a backup copy") and **a CSV with regex captures**:
  no public file tree or CSV with known answers was at hand. The regex-capture mechanism is shown in the SSH entry
  above.
- **`journalctl -o json | sys1grep -z`**: the machine was a Mac, which has no journald.
- **Mail (notmuch, mu, Apple Mail), browser history, Slack or Discord exports, Claude Code session logs, meeting
  notes**: all private. They should work the same way as the issue inbox (one record per message with `-z`), but
  their output cannot be published here.
- **IMAP fetched per message, a ticket API, a delivery-time mail filter**: these hand sys1grep one message at a
  time, so there is no batch for the requests to share. Not measured.
- **Other candidates from #119**, not tried this time for lack of data, time, or budget. Nothing here says whether
  they work:
  - "the customer thanks us" over a support inbox;
  - "the assistant admitted it was wrong" over a JSONL chat export, one message per record;
  - "a decision and its reason" over ADRs and meeting notes (the `.env` entry above asks a question of the docs,
    not this proposition over a decision log);
  - a proposition over `gh pr list`, one pull request per record;
  - sys1grep after a desktop search (`mdfind`, `recoll`) that narrows the files first;
  - Loki or ClickHouse exports;
  - a side-by-side comparison with embedding search on the same data.

## Cost of this page

All the runs above, the diagnostic `--level loose` and English reruns included, used 1,569,464 input tokens, $0.066
at list price: 22 runs, 21 of them with the summary line recorded and one Apache rerun whose usage is taken to be the
same as its first run. The `--summarize` run's summarizer cost is not included.

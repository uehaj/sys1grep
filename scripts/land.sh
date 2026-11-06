#!/bin/sh
# Land an own PR in one command: record the review (scripts/reviewed.sh), wait for CI, then squash-merge.
# Run it from the PR's checkout (reviewed.sh checks that HEAD is the PR's head). The main ruleset blocks a merge
# until CI passes and the repo has no auto-merge, so this waits instead of failing on "base branch policy".
# Usage: sh scripts/land.sh PR codex|code-review FILE [SUMMARY]
set -eu
[ $# -ge 3 ] || { echo "usage: sh scripts/land.sh PR codex|code-review FILE [SUMMARY]" >&2; exit 2; }
export GH_DEBUG=
"$(dirname "$0")/reviewed.sh" "$@"
gh pr checks "$1" --watch --fail-fast --interval 20 >/dev/null || { echo "land: PR #$1's checks failed; not merged" >&2; gh pr checks "$1" >&2; exit 1; }
gh pr merge "$1" --squash
echo "PR #$1 merged: $(gh pr view "$1" --json mergeCommit -q .mergeCommit.oid | cut -c1-7)"

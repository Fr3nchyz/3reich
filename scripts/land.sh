#!/usr/bin/env bash
# Collect the deterministic landing checks; publishing and the verdict stay with the manager.
set -euo pipefail
fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ $# -ge 1 && $# -le 2 && $1 =~ ^[1-9][0-9]*$ ]] || fail 'Usage: scripts/land.sh PR_NUMBER [EXPECTED_BRANCH]'
for dependency in git npm python3; do command -v "$dependency" >/dev/null || fail "Missing command: $dependency"; done
cd "$(git rev-parse --show-toplevel)"
[[ -z $(git status --porcelain) ]] || fail 'Checkout contains local changes. Preserve them before landing.'
branch=$(git branch --show-current)
[[ $# == 1 || $2 == "$branch" ]] || fail "Check out the expected branch first: $2 (current: $branch)"
printf 'Current branch: %s\n' "$branch"
closed_check='closed-PR check skipped (no gh token)'
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  state=$(gh pr view "$1" --json state --jq .state) || fail 'Could not check PR state.'
  [[ $state == OPEN ]] || fail "PR #$1 must be open (state: $state)."
  closed_check='closed-PR check: open'
fi
printf '%s\n' "$closed_check"
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
summary=$(mktemp /tmp/land-summary.XXXXXX.md)
printf 'PR #%s; branch: %s\n%s\n' "$1" "$branch" "$closed_check" > "$summary"
# Use the PR diff, including deletions and both sides of renames.
git diff --no-renames --name-only -z origin/main...HEAD > "$scratch/files"
git diff --no-ext-diff --unified=0 origin/main...HEAD > "$scratch/diff"
python3 - "$scratch" >> "$summary" <<'PY'
import pathlib, re, sys
scratch = pathlib.Path(sys.argv[1])
files = scratch.joinpath('files').read_bytes().decode().split('\0')
engine = any(f.startswith(('src/engine/', 'src/ai/', 'src/data/')) for f in files)
scratch.joinpath('compare').write_text('yes' if engine else 'no')
shared = [f for f in files if f in ['src/engine/' + n + '.ts' for n in
          ('actions', 'action-types', 'sequence', 'turn', 'types')]]
print('Changed shared engine files: ' + (', '.join(shared) or 'none'))
print('tests/ai-stability.test.ts: ' + ('changed' if 'tests/ai-stability.test.ts' in files else 'unchanged'))
added, removed = set(), set()
for line in scratch.joinpath('diff').read_text().splitlines():
    if line.startswith(('+++', '---')) or 'TODO(verify)' not in line:
        continue
    ids = set(re.findall(r'\b[A-Z][A-Z0-9]*[0-9]+\b', line))
    if line.startswith('+'):
        added.update(ids)
    elif line.startswith('-'):
        removed.update(ids)
missing = []
for id in sorted(added - removed):
    absent = [p for p in ('docs/RULES.md', 'docs/TODO-VERIFY.md')
              if not re.search(r'\b' + re.escape(id) + r'\b', pathlib.Path(p).read_text())]
    if absent:
        missing.append(id + ' (missing from ' + ', '.join(absent) + ')')
print('New TODO(verify) ids missing from either required registry: ' + ('; '.join(missing) or 'none'))
PY
failed=0
run_gate() {
  local gate=$1 result counts
  printf 'Running %s...\n' "$gate"
  if NO_COLOR=1 npm run "$gate" > "$scratch/$gate.log" 2>&1; then result=PASS; else result=FAIL; failed=1; fi
  printf '%s: %s\n' "$gate" "$result" >> "$summary"
  counts=$(grep -E '^[[:space:]]*(Test Files|Tests)[[:space:]]' "$scratch/$gate.log" || true)
  if [[ -n $counts ]]; then printf '%s\n' "$counts" >> "$summary"; fi
  if [[ $gate == compare-games ]]; then cat "$scratch/$gate.log" >> "$summary"; fi
  # Keep full diagnostics alongside the short report, even after temporary cleanup.
  cat "$scratch/$gate.log" >> "$summary.log"
}
for gate in lint typecheck coverage build; do run_gate "$gate"; done
if [[ $(cat "$scratch/compare") == yes ]]; then
  run_gate compare-games
else
  printf '%s\n' 'compare-games: skipped (no engine/ai/data change)' >> "$summary"
fi
cat "$summary"
printf '\nSummary: %s\nGate logs: %s.log\n' "$summary" "$summary"
exit "$failed"

---
name: land-codex-pr
description: Review and land a Codex pull request or builder PR on 3reich: gates, compare-games, independent reviewer, then merge once CI is green. Use when asked to review, land or merge a PR.
disable-model-invocation: true
---

Follow docs/CODEX.md step 4 and 5 for the PR number given.

1. Read the PR's "Remaining concerns" first. A design question goes to the owner; do not guess.
2. Check out the branch in its own worktree under `3reich-wt/`. Run `npm run lint && npm run typecheck && npm test && npm run build`. If it touches `src/engine`, `src/ai` or `src/data`, also run `npm run compare-games` and compare with the PR's numbers.
3. Run the `reviewer` agent (sonnet for shared engine files, new actions, changed hashes). Do not chase its "Optional" list.
4. If the reviewer says `FIX FIRST`, send every item in one comment, or push a small fix as a new commit. Never amend or force-push.
5. On `MERGE` and green CI on the exact head sha, merge only if the owner has given the go for this PR (CLAUDE.md: ask first before merging). Then mark the PLAN row Done (see update-plan-tables) and close the issue.
6. Commit as `Fr3nchyz <37098628+Fr3nchyz@users.noreply.github.com>` with the Co-Authored-By and Claude-Session trailers.

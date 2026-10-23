# 3Reich: instructions for coding agents (Codex)

You are implementing one GitHub issue labelled `codex-task`. Claude reviews your pull request before it is merged (see `docs/CODEX.md`). Read `README.md` first: its "Working rules" apply to you in full.

## Setup

```sh
npm ci            # Node 22 (engines: ^20.19 || ^22.13 || >=24)
```

The game manuals are not in the repository and the network may not reach them. Work from the spec named in the issue (`docs/specs/NN-*.md`); it paraphrases and cites every rule you need. If the spec does not settle something, do not decide it yourself (see "When to stop").

## Hard rules

1. **Never invent a rule.** Every game rule you encode cites its source in a comment (`// Ref 12.4`, or the spec rule, e.g. `// spec 16 R18`). A value no source settles is a named constant marked `TODO(verify)` with an id that is listed in both `docs/RULES.md` (Open questions) and `docs/TODO-VERIFY.md`. Reuse the id the spec gives (e.g. AER42); never make up a new id silently, list any new one in the PR.
2. **The engine stays pure and deterministic.** `src/engine` has no DOM, no Node APIs, no clock, no `Math.random` (dice come from `src/engine/rng.ts`). The UI and the computer opponent change the game only through `legalActions` and `applyAction`. Enforced by `tsconfig.engine.json` and `tests/engine-purity.test.ts`.
3. **Files under `src/` stay at or under 300 lines of code** (ESLint `max-lines`). Split a module rather than raising the limit.
4. **Every rule gets a test** that cites the rule. Tests are Vitest, under `tests/`, following the style of the neighbouring test files.
5. **Fixed-seed hashes and recordings** (`tests/ai-stability.test.ts`, `tests/fixtures`, e2e recordings) do not change unless unavoidable. If one changes, do not just update the expected value: say which, by how much, and why, in the PR.
6. **No manual text, scans, screenshots or game files** in the repo. Paraphrase in your own words.
7. **No AI model or product names** in code, comments, docs or commit messages.
8. **Stay in scope.** Touch only the files the issue lists, plus tests and the docs rows it names. Do not edit `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.github/`, `package.json` dependencies, `vercel.json` or other specs unless the issue says so. Do not weaken, skip or delete existing tests.
9. **Shared engine files** (`actions.ts`, `action-types.ts`, `sequence.ts`, `turn.ts`, `types.ts`): change them only when the issue says so, and list the change at the top of the PR.

## Gates (all must pass before you open the PR)

```sh
npm run lint
npm run typecheck
npm test            # vitest run
npm run build
npm run compare-games   # only if you touched src/engine, src/ai or src/data
```

`npm run compare-games` plays the standard 22 computer games on `origin/main` and on your checkout and prints, per game, `identical` or the first action that differs. Paste its summary in the PR and explain every difference. If it cannot run in your environment (no `origin/main`, for example try `git fetch origin main` first, or pass `-- --base <ref>`), say so plainly in the PR instead of guessing. Do not write your own replay or diff scripts.

Browser tests (`npm run e2e`) need a Chromium and usually cannot run in your environment. Do not try to install one. If you changed `src/ui`, say in the PR which e2e specs cover it; Claude runs them.

**Mutation checks: about 10** for a small or medium ticket. For each important rule you encoded, break it on purpose (change a number, flip a condition), confirm a test fails, restore it. List each one in the PR (what you changed, which test failed). Leave no mutation in the code.

## When to stop and ask

If the spec and the issue do not settle a behaviour, or the work needs a change outside the listed files, a new action type, or a change to a fixed-seed hash you cannot explain: stop. Open the PR as a **draft** with what you have, and put the question first in the PR body under "Remaining concerns". A wrong guess costs more than a question.

## Commits and the pull request

- One branch and one pull request per issue. Base it on `main`. Title: `<ticket id>: <what it does>` (e.g. `16-0: spec 16 facts and constants`).
- Commit author: `Fr3nchyz <37098628+Fr3nchyz@users.noreply.github.com>`. Never force-push; answer review comments with new commits.
- Never merge, never push to `main`, never change secrets, deploys or repository settings.
- The PR body starts with `Closes #<issue>` and has these sections, in this order:

```markdown
## What it does
## Files changed (shared engine files first, if any)
## Rules and sources (each rule with its Ref / spec id; new or reused TODO(verify) ids)
## Tests added (file, what each test pins)
## Mutation checks (change -> failing test)
## Gate results (lint, typecheck, test counts, build: pass/fail)
## compare-games (pasted summary, every difference explained, or "not run: no engine/ai/data change")
## Fixed-seed hashes and recordings (unchanged, or which and why)
## Remaining concerns (questions, guesses, anything a reviewer should look at first)
```

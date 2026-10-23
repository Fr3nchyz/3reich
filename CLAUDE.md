# 3Reich: instructions for Claude

Read `README.md` first: it holds the working rules (cite sources, never invent a rule, pure deterministic engine, no scans or manual text). This file adds how the work is run.

## Operating mode: you are the PM of a software factory

- Break any task I give you into tickets and track them with `git bug` (`scripts/claude/session-start.sh` installs it).
- Label each ticket with its difficulty (`easy`, `medium`, `hard`) and the model best suited to it (haiku, sonnet, opus). Run tickets as subagents or dynamic workflows.
- **Who does what (cost balance).** Hand deterministic work that needs no decision to the `grunt` agent (`.claude/agents/grunt.md`, haiku): searching the code, renames, tests that copy an existing pattern, updating the PLAN and TODO tables after a merge, running the gates and summarising the output, reading CI logs. It stops and reports back when a task needs a design decision, instead of guessing. Anything that touches a rule, a fixed-seed hash, a shared engine type or a screen layout is not grunt work. Medium tickets go to sonnet; hard design to opus. Do not spend a review round on a docs-table-only change: the gates are the check.
- **Budget: at most 4 subagents running at once.** Adversarial reviewers count against it. Independent tickets run in parallel only if they touch different files.
- Every code change gets an independent read-only review in a fresh context before it is merged: the `reviewer` agent (`.claude/agents/reviewer.md`, haiku); use a sonnet reviewer for large or engine-wide changes (new actions, shared types, changed hashes). The reviewer reports only defects of correctness, the spec or these rules; its nits are optional and builders do not chase them.
- A mistake in process becomes code: a hook, gate, test or lint rule, or a proposed edit to this file. Do not just apologise.
- Keep going through tickets and make progress. Ask me only when hard-blocked.
- Still ask first before anything outward-facing or hard to reverse: merging, force-pushing, deleting branches, deploys, changing repo visibility, or spending money. Opening draft PRs is fine without asking.
- If these notes about the stack or workflow turn out wrong or incomplete, propose an edit.

## Specs

- Specs say WHAT, not how. They live in `docs/specs/` as markdown, with mermaid diagrams where they help. I review the spec before building starts; wait for "let's go".
- New feature: research and propose options, write the spec, update this file if the workflow changes, then wait for my review.

## Gates

- `.claude/settings.json` blocks `git push` until `npm run lint && npm run typecheck && npm test && npm run build` passes (`scripts/claude/pre-push-gate.mjs`).
- Commit as `37098628+Fr3nchyz@users.noreply.github.com`.

## Conventions for agents (read before building)

- Work in your own git worktree under `3reich-wt/<branch>` next to the main checkout (for example `/home/user/3reich-wt/<branch>`) (symlink `node_modules`), one branch and one pull request per ticket or tightly coupled slice. Never edit another checkout.
- Gates before every push: `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build`. Browser tests (Playwright) run in CI only nightly, on demand, or when a pull request carries the label `run-e2e`; if you change `src/ui`, run just the specs that cover it (`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PW_PORT=<free port>`, one browser job at a time, never a broad pkill).
- Commits: author `Fr3nchyz <37098628+Fr3nchyz@users.noreply.github.com>`; end the message with the `Co-Authored-By` and `Claude-Session` trailer lines the session gives you. Never amend or force-push; answer review findings with new commits and merge `origin/main` in if it moved.
- Pull request body: what it does, shared files changed, any change to fixed-seed hashes or recordings (which, and why), new `TODO(verify)` ids, tests and mutation checks, gates run; end with the generated-by line and the session URL.
- Fixed-seed hashes in `tests/ai-stability.test.ts` do not change unless unavoidable; list every change in the PR.
- **Whole-game check: one command.** For any change to `src/engine`, `src/ai` or `src/data`, run `npm run compare-games` (about a minute): it plays the standard 22 computer games (1939 seeds 1 to 10; Campaign, 1942 and 1944 seeds 1 to 4) on `origin/main` and on your checkout and prints, per game, "identical" or the first differing action and both results. Paste its summary in the PR and explain every difference. Do not write your own replay or diff scripts. The reviewer re-runs the same command and reads it.
- **Mutation checks: about 10 for small and medium tickets**, aimed at the new rules and policies (break it, see a test fail, restore). The full set (docs/MUTATION.md) only for engine-wide changes: new actions or steps, shared engine types, changed fixed-seed hashes. List them in the PR either way.
- **Codex hand-off.** Some bounded tickets go to Codex Cloud as GitHub issues labelled `codex-task` (`docs/CODEX.md`; Codex follows `AGENTS.md`). An open `codex-task` issue means the ticket is taken: do not build it. A Codex PR gets the same review as any builder's: re-run the gates and `npm run compare-games`, the independent `reviewer`, then merge once the reviewer says MERGE and CI is green (the owner's go, docs/CODEX.md step 5).
- When done, send ONE final report and stop; leave no background work running.

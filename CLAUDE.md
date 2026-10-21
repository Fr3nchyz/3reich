# 3Reich: instructions for Claude

Read `README.md` first: it holds the working rules (cite sources, never invent a rule, pure deterministic engine, no scans or manual text). This file adds how the work is run.

## Operating mode: you are the PM of a software factory

- Break any task I give you into tickets and track them with `git bug` (`scripts/claude/session-start.sh` installs it).
- Label each ticket with its difficulty (`easy`, `medium`, `hard`) and the model best suited to it (haiku, sonnet, opus). Run tickets as subagents or dynamic workflows.
- Hand mechanical work (searching the code, renames, tests that copy an existing pattern, summarising logs) to the `grunt` agent (`.claude/agents/grunt.md`, haiku). It stops and reports back when a task needs a design decision, instead of guessing.
- **Budget: at most 4 subagents running at once.** Adversarial reviewers count against it. Independent tickets run in parallel only if they touch different files.
- Every change gets an adversarial review by the next-strongest model than the one that wrote it, before it is merged.
- A mistake in process becomes code: a hook, gate, test or lint rule, or a proposed edit to this file. Do not just apologise.
- Use current best practice for this stack (TypeScript, Vite, Vitest, Node 20+).
- Keep going through tickets and make progress. Ask me only when hard-blocked.
- Still ask first before anything outward-facing or hard to reverse: merging, force-pushing, deleting branches, deploys, changing repo visibility, or spending money. Opening draft PRs is fine without asking.
- If these notes about the stack or workflow turn out wrong or incomplete, propose an edit.

## Specs

- Specs say WHAT, not how. They live in `docs/specs/` as markdown, with mermaid diagrams where they help. I review the spec before building starts; wait for "let's go".
- New feature: research and propose options, write the spec, update this file if the workflow changes, then wait for my review.

## Gates

- `.claude/settings.json` blocks `git push` until `npm run lint && npm run typecheck && npm test && npm run build` passes (`scripts/claude/pre-push-gate.mjs`).
- Commit as `37098628+Fr3nchyz@users.noreply.github.com`.

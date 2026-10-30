---
paths:
  - "src/engine/**"
  - "src/ai/**"
  - "src/data/**"
  - "tests/ai-stability.test.ts"
---

# Engine, AI and data rules (loaded only when working here)

- The engine is pure and deterministic: no DOM, no Node APIs, no clock, no `Math.random` (dice come from `src/engine/rng.ts`). The UI and the computer opponent change the game only through `legalActions` and `applyAction`.
- Every rule cites its source (`// Ref 12.4` or `// spec 16 R18`). A value no source settles is a named constant marked `TODO(verify)` with an id listed in `docs/RULES.md` and `docs/TODO-VERIFY.md`.
- Shared engine files (`actions.ts`, `action-types.ts`, `sequence.ts`, `turn.ts`, `types.ts`) are not grunt or Codex work; changes need a sonnet reviewer.
- Fixed-seed hashes in `tests/ai-stability.test.ts` do not change unless unavoidable; run `npm run rehash` only when the change is explained, and list each change in the PR.
- Run `npm run compare-games` before the PR and paste its summary. Do not write your own replay or diff scripts.

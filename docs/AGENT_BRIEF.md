# Agent brief: next work on 3Reich

## Context

3Reich is a browser recreation of Avalon Hill's 1996 Windows game *Third Reich* (itself a port of the board game *Rise and Decline of the Third Reich*). Goal: a faithful, easy-to-use version a non-technical relative can play. Stack: TypeScript, Vite, Vitest, no UI framework. Run: `npm install`, `npm run dev | test | typecheck | build`.

Read first: `docs/RULES.md` (everything verified so far, with gaps), `docs/ROADMAP.md`, `src/engine/*`, `tests/engine.test.ts`.

## Current state

Done: seeded dice (`rng.ts`); two-sided turn flow with initiative and seasons (`game.ts`); Fall 1939 nation economy (`nations.ts`); terrain effects chart (`terrain.ts`); unit/counter types (`types.ts`); a **placeholder** combat table (`combat.ts`, values are invented); a bare status page (`main.ts`).

Not done: map, units on the map, movement, real combat, production, diplomacy, scenarios, save/load, AI.

## Hard rules

1. **Do not invent rules.** If a rule or number is not in `docs/RULES.md`, put it behind a clearly named constant or interface, mark it `TODO(verify)`, and list it in a "Open questions" section in your PR. Faithfulness beats completeness.
2. **No copyrighted material.** No screenshots, scans, map art, manual text, sounds or counter art in the repo. Draw original art; encode mechanics as data in your own words.
3. The engine stays pure TypeScript with no DOM access and deterministic (seeded RNG, state passed in and out, no `Math.random`, no `Date.now` inside engine functions except the default seed).
4. Every engine change has unit tests. Typecheck, tests and build must pass before pushing.
5. Work on a branch, open a draft PR against `main`, keep PRs small and single-purpose.
6. Git author must use the GitHub noreply email `37098628+Fr3nchyz@users.noreply.github.com` (the account blocks pushes exposing a real email).

## Task list (in order)

### 1. Hex map data model and renderer  [no manual needed]
- Add `src/engine/hex.ts`: axial/offset coordinates matching a flat map of roughly 60-70 columns by 50 rows (confirm against screenshots in RULES.md; the original uses pointy-top hexes in offset rows), neighbours, distance, line, ring.
- Add `src/data/map.ts` (or JSON): hex records `{ q, r, terrain, owner?, country?, port?, city?, capital?, objective?, brp? }` and hexside features `{ from, to, kind: river | crossing-arrow | lake-all-water | national-boundary | front-boundary | qattara }`. Use `TerrainId` from `terrain.ts`.
- Generate a *placeholder* Europe/North Africa/Near East map from public-domain geography (e.g. Natural Earth) with a script in `scripts/`, document the source and licence. Mark clearly that hex-level terrain is approximate until checked against the real game.
- Renderer (SVG or canvas): terrain colours, rivers and borders, country labels, pan and zoom, hex hover/select, mini-map. Large, readable on a laptop.
- Done when: map renders at 60 fps pan/zoom, tests cover hex math and neighbour symmetry.

### 2. Units, setup and selection  [partially blocked]
- `Unit` already has strength/movement. Add stacks per hex, a unit tray for the active nation, counter drawing with original-style two-number counters in our own art.
- Placeholder Fall 1939 starting setup file; real numbers need the manual (Open question).
- Done when: you can place and select units on the map, tests cover stacking data structures (stacking limit is unknown, make it a constant).

### 3. Turn state machine  [needs RULES.md sequence of play]
- Encode the printed sequence: Year Start Sequence (strategic warfare, BRP calculation) between Winter and Spring; each game turn: Russian-Winter roll, player-turn order by initiative, then per player: declarations of war, minor-country activation, Front options (per Eastern/Western/Mediterranean front), movement, combat, unit construction, strategic redeployment, end-of-turn (Russian surrender check, save prompt). Implement as phases with `advancePhase`, leave unknown sub-rules as no-op hooks with TODOs.
- Done when: a full game turn cycles through phases in order with tests.

### 4. Economy  [partially known]
- Use `nations.ts`. Implement BRP spending limit (half the total, rounded down), spent-this-turn tracking, builds. Growth rate meaning, unit costs and build limits: Open questions until the manual is photographed.

### 5. Movement and combat  [blocked on manual]
- Do not implement beyond interfaces. Needed from the manual: movement/ZOC rules, stacking, odds computation, combat results table, attrition, exploitation, air/naval combat, DRM charts (partly read in RULES.md, values marked verify), how terrain multipliers combine.
- Replace the placeholder in `combat.ts` only when the table is provided.

### 6. Save/load and hot-seat play
- Serialize `GameState` to JSON (versioned), download/upload files, autosave to `localStorage`. Two humans on one screen.

### 7. Computer opponent
- Later; simple heuristic AI behind an interface so it can be swapped.

### 8. Polish
- Big readable UI, undo, tooltips, installable offline (PWA), GitHub Pages deploy (`.github/workflows/pages.yml` exists).

## Human tasks (blocked on the physical box or the original game)

- Photograph, sharply and flat: Reference Manual (rules, combat results table, odds, production/costs, unit lists per nation, DRM charts), Operational Manual (UI and program flow), the full map card at high resolution.
- Screenshots from the running game: setup screens for the 1942 and 1944 scenarios, the Tables menu, a combat results screen, diplomacy/declaration-of-war screens, the Actions menu.
- Confirm the box version and that the card in the box matches the 1.38 patch.

## Prompt to give another agent

```
You are working on the GitHub repo Fr3nchyz/3reich (private), a TypeScript/Vite browser recreation of Avalon Hill's 1996 PC game "Third Reich". First read README.md, docs/RULES.md, docs/ROADMAP.md and docs/AGENT_BRIEF.md in full; they contain everything known about the rules and the hard rules you must follow. Your task: <PASTE ONE TASK FROM THE LIST, e.g. "Task 1: hex map data model and renderer">. Work on a new branch, run `npm run typecheck && npm test && npm run build` before every push, open a draft PR against main, and list any unknown rules as "Open questions" in the PR description instead of guessing. Do not add copyrighted art, scans or manual text. Use author email 37098628+Fr3nchyz@users.noreply.github.com.
```

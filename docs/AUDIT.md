# Architecture and progress audit

Date: 2026-10-01. Scope: `main` at `75018b6` (about 1,000 lines: 6 engine modules, 1 UI file, 3 test files, 18 tests). No code was changed for this audit.

**Status:** backlog items 1-7 and 11 (and the B1-B4 fixes they cover) were implemented right after this audit; see `docs/ROADMAP.md`. The rest of this document is the audit as written.

Target: a faithful, deterministic recreation of **Third Reich PC (1996)** per `docs/RULES.md`, played mainly **solo against a computer opponent**, in the browser. "Ref" = PC Reference Manual, "Ops" = PC Operations Manual (see `docs/SOURCES.md`).

---

## 1. Current architecture audit

### Summary

| Aspect | What the repo does today |
|---|---|
| Layers | `src/engine/*` (pure TypeScript rules and state), `src/main.ts` (35-line DOM page). No session layer, no data folder yet. |
| Dependency direction | One way: `main.ts` imports `engine/game`, `engine/nations`, `engine/types`. Engine modules import only each other (`combat` -> `rng`; `game` -> `nations`, `types`; `nations`/`tables` -> `types`). No cycles, no DOM, no framework. |
| State | One plain-object `GameState` (`types.ts:56-70`), JSON-serializable. The only transition is `endPlayerTurn(state)` (`game.ts:29-44`), which returns a new object via spread. The UI holds it in a module `let` (`main.ts:6`) and reassigns it (`main.ts:30`). |
| Randomness | mulberry32 with the state passed in and returned (`rng.ts:2-14`); combat threads it through every roll (`combat.ts:95-139`, `168-177`). No `Math.random` anywhere. |
| Rule data | Typed constants and small pure functions, each citing a manual section: CRT and attrition (`combat.ts:14-23`, `152-160`), terrain multipliers (`terrain.ts:49-56`), costs, stacking, interception, DRMs, minor forces (`tables.ts`), 1939 economy (`nations.ts:16-32`). |
| Tests | Vitest in its default Node environment (no browser), 18 tests across `tests/engine.test.ts`, `tests/combat.test.ts`, `tests/tables.test.ts`. CI runs typecheck, tests and build (`.github/workflows/ci.yml:15-18`). |

### Blocking issues

**B1. The documented hex coordinate system is wrong**
- **Severity:** High. **Category:** Spatial.
- **Evidence:** `docs/RULES.md:28-29` says numbered columns run "diagonally down-left" and lists neighbours `(q, r-1)`, `(q-1, r-1)`, `(q, r+1)`, `(q+1, r+1)`. Ref 4.1 says the numbered hexrows run **from northwest to southeast**, and its examples agree: Dublin H22 and Rome Y22 share column 22 with Rome far to the east, which only works if the column moves east as it goes down. The hexsides the manual names also only fit northwest-to-southeast columns: Qattara `MM26-NN26` and `MM27-NN26` (Ref 4.51), Suez `MM30-LL31` (Ref 4.3).
- **Finding:** No code uses it yet, but the map digitisation and `hex.ts` were going to be built on this description.
- **Impact:** Every neighbour, distance, ZOC, supply line and interception range would be wrong, and the error would be baked into the map data.
- **Recommendation:** Use standard axial coordinates with `q` = column number and `r` = row index (A=0 ... Z=25, AA=26 ... NN=39). Neighbours of `(q, r)`: `(q±1, r)`, `(q, r-1)`, `(q+1, r-1)`, `(q-1, r+1)`, `(q, r+1)`. Fix `RULES.md`, and turn the manual's named hexside pairs into adjacency tests.

**B2. No action layer and no phase in the state**
- **Severity:** High. **Category:** Architecture / Determinism.
- **Evidence:** `endPlayerTurn` (`game.ts:29`) is the only transition. `GameState` has no phase field (`types.ts:56-70`). The UI calls the engine function directly (`main.ts:30`). The log is English sentences stored in authoritative state (`types.ts:69`, `game.ts:21,42`).
- **Finding:** There is no `Action` type, no `applyAction`, no `legalActions`, no event output and no replay.
- **Impact:** Both the UI and the computer opponent need one source of legal moves and one way to apply them. Without that, rules leak into UI handlers and AI code, and games can't be replayed or regression-tested.
- **Recommendation:** Add a JSON-serializable `Action` union, a `phase` in `GameState`, `applyAction(state, action) -> { state, events }`, `legalActions(state)` and `replay(initial, actions)`. Make `END_PLAYER_TURN` the first action. Return structured events and let the UI turn them into text.

**B3. Initiative is fixed for the whole game**
- **Severity:** High. **Category:** Rules.
- **Evidence:** `firstSide` is set once in `newGame` (`game.ts:15`) and never recalculated in `endPlayerTurn`. `sideBRPs` groups nations by `NationStatus` (`nations.ts:40-45`).
- **Finding:** Ref 11.1 recalculates the initiative at the start of **every** Game Turn: the side with the higher BRP total moves first, and a tie keeps the previous order. It also sets its own grouping: Germany+Italy against France+Britain, with US BRPs counted from Summer 1942 and Soviet BRPs once the USSR is at war with Germany. That grouping is not the same as alliance status.
- **Impact:** Turn order is right for Fall 1939 (225 vs 210) but goes wrong as soon as BRP totals cross, and in the 1944 scenario, where the Allies move first.
- **Recommendation:** Add `determineInitiative(state)` per Ref 11.1, run it at the start of each Game Turn, and test the tie and US-1942 cases.

**B4. The terrain and map model can't represent the real map**
- **Severity:** High. **Category:** Rules / Spatial.
- **Evidence:**
  - `TerrainId` (`terrain.ts:7`) treats `ocean` and `lake` as alternatives to land terrain.
  - `fortress` is a static `HexFeature` (`terrain.ts:16`, `51`).
  - `Unit.at` is a "Region id" (`types.ts:43-44`), and the `Region` placeholder from the first scaffold is still there (`types.ts:47-54`, `65`; `game.ts:18`).
- **Finding:** Ref 4.3 says a hex can be part land and part sea, and that ground and naval movement are decided **per hexside** ("land area on both sides", "blue on both sides"). Brindisi has two ocean areas (Ref 4.7). Some hexes are unplayable (Switzerland, the black islands). Fortress status changes during play (Ref 4.8): it is lost on enemy occupation, the Maginot Line is not a fortress in 1942/1944, the West Wall becomes one in 1944, and Sevastopol is conditional.
- **Impact:** Digitising the whole map into the current model would bake in errors that are expensive to find later.
- **Recommendation:** Design the map types before digitising:
  - **Hex:** playable, land terrain or none, has sea, static features, country, potential fortress.
  - **Hexside:** land-crossable, sea-crossable, river, crossing arrow, Qattara, national/front boundary.
  - **GameState:** current fortress status and hex control.
  - Delete `Region` and make `Unit.at` a hex id.

### Structural debt

**S1. Headless engine is a convention, not enforced**
- **Severity:** Medium. **Category:** Tooling.
- **Evidence:** `tsconfig.json:6` adds the `DOM` library for all of `src`, so engine code could use `document` or `localStorage` and still compile. Vitest runs in Node, but only catches DOM use in code paths that a test actually executes.
- **Recommendation:** Add an engine-only `tsconfig` without `DOM`, and a CI check that fails on `Math.random`, `Date.now`, `new Date` or DOM globals under `src/engine`.

**S2. Economy state is too thin; the spending limit is derived from the wrong number**
- **Severity:** Medium. **Category:** Rules.
- **Evidence:** `Nation` has only `brpBase`, `brpTotal` and `growthRate` (`types.ts:22-31`). `spendingLimit` halves the current total (`nations.ts:35-37`).
- **Finding:** Ref 10.0 fixes the limit once a year, after Strategic Warfare construction, for every Player Turn of that year. Halving the *current* total would shrink the limit as BRPs are spent. There are also no "spent this turn", unused BRPs, force pool or allowable builds.
- **Recommendation:** Store the year-start total and the spending limit at the Year Start Sequence, track spending per turn, and model force pools and allowable builds alongside the scenario data.

**S3. Scenario and seed are hard-coded in the engine**
- **Severity:** Medium. **Category:** Determinism / Architecture.
- **Evidence:** `newGame(seed = Date.now() >>> 0)` (`game.ts:11`) always builds 1939 (`game.ts:12-22`, `nations.ts:16-32`).
- **Finding:** `Date.now` is the only nondeterministic input in the engine. It is harmless today, but it lets callers start an unseeded game by accident.
- **Recommendation:** Make it `newGame(scenario, seed)` with the seed required. The UI picks the seed and stores it in the save file. Scenarios become data.

**S4. Rule tables can be changed at runtime**
- **Severity:** Low. **Category:** Rules.
- **Evidence:** `OFFENSIVE_CRT` (`combat.ts:14`), `ATTRITION_TABLE` (`combat.ts:152`) and `MINOR_COUNTRY_FORCES` (`tables.ts:116`) are ordinary, writable records.
- **Recommendation:** Mark them `Readonly` and `as const`, and freeze them, so a future procedure can't silently change the rules mid-game.

**S5. Missing invariant tests**
- **Severity:** Medium. **Category:** Testing.
- **Evidence:** Tests cover table lookups and single resolutions. Missing:
  - JSON round-trip of a mid-game `GameState`
  - replay determinism (same seed and actions give an identical state)
  - a d6 uniformity check on `rollD6`
  - adjacency tests built from the manual's named hexsides
- **Recommendation:** Add these with B1/B2. They are cheap and protect everything built afterwards.

**S6. Pages deploy workflow can't run on this repo**
- **Severity:** Low. **Category:** Tooling.
- **Evidence:** `.github/workflows/pages.yml`. GitHub Pages for a private repository needs a paid GitHub plan, and the hosting choice (Cloudflare Pages was suggested) is still open.
- **Recommendation:** Delete it or replace it once hosting is chosen.

### Acceptable decisions (do not refactor)

- **No UI framework or state library.** A single pure state object and a thin DOM layer suit the scale and keep the engine portable.
- **Combat functions take numbers rather than game state** (`resolveOffensiveCombat`, `resolveAttrition`). This makes them easy to test and audit against the printed tables. A state-level procedure will wrap them later.
- **Small tables written as cited functions** (`interceptionRolls`, `navalNationalityDrm`, `airNationalityDrm`) rather than data arrays. They are short, cited and tested; turning them into data adds nothing.
- **mulberry32 with an explicit state number.** It is deterministic, JSON-safe, and the stored number is all a save file needs.
- **Rules grouped by topic inside `src/engine`.** Add a `src/data/` folder when map and scenario JSON arrive; there's no need for packages or a monorepo.
- **The `MAX_ROUNDS` guard that throws** in `resolveOffensiveCombat` (`combat.ts:87`, `138`). It is effectively unreachable and stops a theoretical infinite loop.

### Rules fidelity ledger

| Rules area | Status | Notes |
|---|---|---|
| Offensive CRT, odds, counterattack loop, Exchange (Ref 12.1-12.2) | Implemented, sound | Open: odds rounding below 1:1; whether ground-support air and DAS take part in a counterattack; whether any CA result on a counterattack restarts the attack. |
| Attrition table (Ref 12.4) | Table sound; procedure missing | Hex selection, retreats and Peele's changes not built. |
| Terrain defence multipliers (Ref 4.51) | Implemented, fragile | Depends on dynamic fortress status (B4). |
| BRP and build costs, stacking limits | Data only | Enforcement not built. |
| Spending limit (Ref 10.0) | Implemented, fragile | S2. |
| Interception, naval and air DRMs | Data only | Air and naval procedures missing. |
| Minor-country forces | Data only | Open: counts are counters or factors. |
| Turn and phase sequence (Ops 5.0, Ref 11) | Partial | Sides and seasons only; initiative wrong (B3); no phases (B2). |
| Hex grid and map | Missing | Documented coordinates wrong (B1); model too coarse (B4). |
| Movement, ZOC, supply, control (Ref 4-7, 10) | Missing | |
| Scenarios (Ops 9.0) | Partial | 1939 BRPs and growth only. |
| YSS, Strategic Warfare, DoW, minors, Russian winter/surrender, air, naval, victory | Missing | |
| Computer opponent | Missing | |

### Architecture readiness: **Fundamentally sound**

The engine is already pure, headless in practice, deterministic apart from one default argument, and data-driven, with cited and tested rule tables. Dependencies flow one way and no rules sit in the UI. None of the findings call for a rewrite. B2 and S2 are missing structure rather than wrong structure. B1 and B4 are design errors caught *before* any code depends on them, but they must be fixed before the map is digitised.

---

## 2. Required refactoring

| # | Priority | Refactor | Files | Reason | Risk | Depends on | Definition of done |
|---|---|---|---|---|---|---|---|
| 1 | P0 | Correct the coordinate system; add `hex.ts` | `docs/RULES.md`, `src/engine/hex.ts`, `tests/hex.test.ts` | B1 | Low | none | RULES says northwest-to-southeast. `parseHexId`/`formatHexId` round-trip `A`..`NN`. Neighbours and distance are pure. Tests prove `MM26-NN26`, `MM27-NN26`, `NN25-NN26`, `NN26-NN27`, `MM30-LL31`, `U40-U41` are adjacent and `MM25-NN26` is not. |
| 2 | P0 | Map data types and validator (no digitising yet) | `src/engine/map.ts`, `src/engine/types.ts`, `src/engine/terrain.ts` | B4 | Medium | 1 | `Hex`, `Hexside` and `MapData` types; `validateMap()` checks every hexside is symmetric and between neighbours, ids are valid, and every playable hex has terrain. `Region` deleted; `Unit.at` is a hex id; fortress status lives in state. |
| 3 | P1 | Action layer, smallest sequence: (a) add `phase` and an `Action` union containing `END_PLAYER_TURN`; (b) `applyAction` returns `{ state, events }`; (c) `legalActions`; (d) the UI only calls `applyAction` and selectors; (e) `replay` | `src/engine/actions.ts`, `game.ts`, `types.ts`, `main.ts` | B2 | Medium | none | `main.ts` has no direct state transitions. The log becomes events. Tests: an illegal action is rejected; replay gives an identical state. |
| 4 | P1 | Initiative per Ref 11.1 | `game.ts`, `nations.ts` | B3 | Low | 3 | Recalculated at the start of each Game Turn. Tests: higher total moves first; a tie keeps the previous order; US counted from Summer 1942; USSR counted when at war with Germany. |
| 5 | P1 | `newGame(scenario, seed)` with a required seed | `game.ts`, `nations.ts`, `main.ts` | S3 | Low | none | No `Date.now` under `src/engine`; the 1939 data is passed in as a scenario object. |
| 6 | P1 | Enforce a headless engine | `tsconfig.engine.json`, `package.json`, `ci.yml`, a small check script | S1 | Low | none | CI fails if engine code uses DOM types, `Math.random`, `Date.now` or `new Date`. |
| 7 | P1 | Invariant tests | `tests/state.test.ts`, `tests/rng.test.ts` | S5 | Low | 3 | JSON round-trip, replay determinism, d6 uniformity within tolerance. |
| 8 | P2 | Economy state model | `types.ts`, `nations.ts` | S2 | Medium | 3, 5 | Year-start total and spending limit fixed at YSS; spent-this-turn tracked; force-pool types; the Ref 9.2 worked example passes as a test. |
| 9 | P2 | Freeze rule tables | `combat.ts`, `tables.ts` | S4 | Low | none | Tables are typed `Readonly` and frozen; a test asserts they are frozen. |
| 10 | P3 | Remove or replace the Pages workflow | `.github/workflows/pages.yml` | S6 | Low | hosting decision | No workflow that can't run. |
| 11 | P3 | Clear the stale TODO | `nations.ts:14` | The 1939 numbers are now confirmed by Ops 9.0 | Low | none | The comment cites Ops 9.0. |

---

## 3. Updated phase roadmap

Phases 0-2 of a generic plan are merged into **A**, because the repo is small and already mostly meets them. Map data moves up into **B**, because in Third Reich the map *is* rules data: movement, ZOC and supply can't be tested without it.

| Phase | Objective | Prerequisites | Concrete tasks | Tests that must pass | Exit criteria | Do not start before exit |
|---|---|---|---|---|---|---|
| **A. Foundations** | Deterministic action engine with correct coordinates | none | Backlog 1, 3, 4, 5, 6, 7, 9 | All existing tests, plus hex, action, initiative, round-trip, replay and d6 tests | Green-light items 1-5 below hold | Map digitising, any new UI |
| **B. Map model and data** | Faithful hex map as validated data | A | Backlog 2. Digitise the scan into `src/data/map.json` with scripts kept outside the repo. Spot-check against Ref 4.1-4.9. A **read-only map viewer** is allowed, to compare the data with the scan. | `validateMap` passes; Ref 4.1 example hexes have the right country and city; named hexsides have the right features | Every playable hex and hexside entered and validated; differences against the scan listed and resolved | Movement, supply |
| **C. 1939 scenario and turn structure** | Start a real 1939 game and step through every phase | A, B | Scenario data type and full 1939 scenario (Ops 9.0 with Peele's errata); full sequence-of-play phase machine with no-op hooks; Year Start Sequence and economy (backlog 8) | Scenario loads and validates; a full Game Turn cycles through every phase in order; Ref 9.2 example | A 1939 game can be advanced turn by turn headlessly | Combat procedures |
| **D. Movement, ZOC, stacking, supply, control** | Legal ground, air and naval movement | B, C | Ref 4-7, 10; `legalActions` lists moves | Crossing arrows, all-water and Qattara hexsides, armor ZOC +2, stacking exceptions, supply sources and lines, hex control | All movement rules for 1939 forces enforced | Combat wiring |
| **E. Combat procedures** | Battles on the map | D | Offensive, exploitation, attrition hex selection, DoW and minors, air and naval combat (Ref 12-13, 20-21) | Worked examples from the manual; advance after combat; bridgeheads | A full 1939 game can be played headlessly by scripted actions | AI |
| **F. Play UI** | Usable by a non-technical player | A-E (can overlap E) | Map, counters in our own art, tray, menus modelled on Ops 3.0; touch or mouse first, pending the device decision | UI only calls `legalActions`, `applyAction` and selectors | A human can play 1939 hot-seat in the browser | none |
| **G. Computer opponent v1** | Solo play against the computer | E, F | Rule-based AI for either side, using only `legalActions` | AI never produces an illegal action across 100 seeded games; same seed gives the same game | **First playable release: 1939 vs computer** | Other scenarios |
| **H. Fidelity and regression** | Measure and close gaps | G | Golden games, a regression test for every corrected rule, comparison against the original in DOSBox; 1942, 1944 and Campaign | Full-game replay identical; golden outputs | Open-questions list in RULES.md empty or accepted | none |

---

## Final summary

### Top 5 architectural risks
1. **The wrong coordinate system spreads into the map data** (B1): silent adjacency errors everywhere.
2. **A map model too coarse for the real map** (B4): coastal hexes, rules decided per hexside, fortresses that change during play.
3. **UI and AI built before an action layer exists** (B2): rules leak into handlers, and there's no replay.
4. **Simplifications that look right in 1939 and diverge later** (B3 initiative, S2 spending limit).
5. **Headlessness by convention only** (S1): the first `localStorage` call in the engine would go unnoticed.

### Top 5 refactors to do first
1. Fix the coordinates and add `hex.ts` with adjacency tests from the manual (backlog 1).
2. Action layer with phases, events and replay (3).
3. Map data types and validator before any digitising (2).
4. Initiative per Ref 11.1 (4).
5. Required seed and scenario argument, plus engine headlessness checks in CI (5, 6).

### Feature freeze recommendation
- **Pause:** map digitising, new UI beyond the current status page, and AI work, until Phase A exits. Map digitising may then start against the new types.
- **Keep going:** transcribing rule tables and scenario data from the manuals. It is cheap, independent, and feeds Phase C.

### Green-light criteria for UI expansion
1. `tsc -p tsconfig.engine.json` passes without the `DOM` library, and the CI check finds no `Math.random`, `Date.now`, `new Date` or DOM globals under `src/engine`.
2. `src/main.ts` changes state only through `applyAction`, and reads it only through the engine and selectors.
3. Every action is JSON-serializable, and a JSON round-trip of a mid-game state gives a deep-equal state.
4. Replaying the same seed and action log through at least one full Game Turn gives an identical state.
5. The hex helpers are pure, and the adjacency tests built from manual hexsides pass.
6. `validateMap` passes on the full map data, and the Ref 4.x spot checks pass.
7. A 1939 game advances through every phase of a full Game Turn headlessly.

# 3Reich: Technical Audit Report

**Date:** 2026-10-13
**Scope:** `Fr3nchyz/3reich`, branch `coast-rendering` at `15665ef` (that is `main` at `a0495f6` plus the open viewer change in PR #12). 19 commits, about 1,800 lines of engine, 700 of scenario data, 600 of UI, 1,850 of tests.
**Auditor's caveat:** the code under audit was written by Claude, and so was this audit. Everything below that is checkable was checked with a command (type check, test run, coverage, grep, a brute-force hex test) and is marked as measured. Judgement calls are labelled as such. An independent human review is still worth having before the project is made public.

---

## 1. Executive summary and grade

**Grade: Pass for the foundation. Not a complete implementation of the 1996 game.**

In plain words: what exists is clean, tested and honest about its gaps, and it is not AI slop. But it is roughly the first 15% of a game. You can pick a scenario, set up your forces on the map, and end turns. You cannot move, fight, supply, spend BRPs or play against a computer, because none of that exists yet. The report answers the question "is this a production-grade implementation of the 1996 game?" with **no, not yet**, and "is the base sound enough to build it on?" with **yes, with the refactors in section 5**.

| Question | Answer |
|---|---|
| Does the engine run headless? | Yes. It compiles with no browser or Node types, and a test bans clocks, `Math.random`, timers and async code. |
| Is state changed only through deterministic actions? | Yes. Every change goes through `applyAction`; replay is tested. No in-place mutation of state was found. |
| Is the hex math correct? | Yes (measured, see 2.1). |
| Are the rules implemented? | Setup, Initiative and the data tables only. Movement, ZOC, supply, BRP accounting, combat resolution and the turn steps are not. |
| Is there an AI? | No. |
| Is it ready for A3R-style expansion? | The data layer is flexible; the rules layer is hard-coded. See 2.4. |

**Biggest risks, in order:**
1. The player turn has no step cursor in the state, so turn-order enforcement (the thing that makes a wargame engine trustworthy) cannot be tested yet. It needs to exist before the first rule is added.
2. Combat and attrition resolvers and about a dozen rule tables are written and tested but not reachable from any action, so their correctness in play is unproven.
3. `setup.ts` is 433 lines and has become the place where unrelated jobs pile up. It will get worse if more rules are added to it.
4. No linter, no formatter, and no tests of the UI, so hygiene depends on discipline rather than automation.

---

## 2. Architecture scorecard

| Area | Score | Why |
|---|---|---|
| Domain isolation | **88 / 100** | Engine is separate and headless. Deductions: a type-only import cycle (`actions.ts` and `setup.ts`), game-ish logic in the UI file, and the UI importing about fifteen engine functions directly. |
| Type safety | **84 / 100** | `strict` and `noUncheckedIndexedAccess` on; no `any`, no `@ts-ignore`. Deductions: hex ids, countries and zones are plain strings, `Area` is an untagged union, and about 20 non-null assertions (`!`) in engine and UI code. |
| State management | **74 / 100** | Immutable updates, seeded RNG threaded through state, replay works. Deductions: no turn-step cursor, BRP and fortress state never change, two module-level caches, one shared mutable constant. |
| Test coverage | **80 / 100** | Engine 98.4% of lines and 87.0% of branches (measured). But `main.ts` is 0%, `mapView.ts` 23%, and the tests only cover what has been built. The 100% on `src/data` only proves the files load. |

**Measured:** `npm run typecheck` clean, `npm test` 225 tests in 14 files passing, CI runs typecheck, tests and build on every PR.

### 2.1 Hex math (measured, not read)

- `hex.ts:82-86` uses axial coordinates and `max(|dq|, |dr|, |dq+dr|)`, which is the standard correct formula for the six directions in `hex.ts:61-68`.
- I checked it by brute force: breadth-first search over `neighbors()` from a hex, out to 12 steps (469 hexes). **0 mismatches** with `distance()`. **0 asymmetries** in neighbour relations.
- The hexsides the manual names (Qattara `MM26-NN26`, `MM27-NN26`, Suez `MM30-LL31`) are adjacent under this system and exist in `map.json` (the Suez one as `LL31-MM30`, flagged `suezCanal`).
- `validateMap` (`map.ts:79-132`) requires a hexside record between every pair of adjacent playable hexes. The data has 1,755 hexes and 5,079 hexsides, 301 of them rivers.
- **Line of sight does not exist.** Third Reich has no line-of-sight rule as far as the docs in the repo say, so this is not a gap, but nothing in the repo answers it either way.

### 2.2 Determinism and mutability

- Dice: mulberry32 with the state passed in and returned (`rng.ts`). The only nondeterministic input is the seed, chosen by the UI.
- `GameState.rngState` is never advanced by any action yet, because no action rolls dice. The combat functions take and return an RNG state themselves but nothing calls them (see 3).
- I searched the engine for `splice`, `push`, `pop`, `shift`, `sort`, `delete` and `Object.assign`. Every hit works on a local array or a fresh copy (for example `setup.ts:236` sorts a spread copy; `setup.ts:358` changes a Map entry created inside the same function).
- Hidden state: two `WeakMap` caches keyed by the context object (`setup.ts:75`). They only store results of pure functions, so behaviour is unchanged, but the purity test does not forbid this kind of thing.
- `setup.ts:71` exports `EMPTY` with a mutable `Set`. Nothing mutates it today; one `.add()` in the future would corrupt every caller.

### 2.3 Separation of concerns

- `tsconfig.engine.json` compiles `src/engine` and `src/data` with `lib: ES2022` and `types: []`, so DOM and Node globals are compile errors. `tests/engine-purity.test.ts` also restricts what each engine and data file may import.
- The UI changes the game only through `applyAction` (`main.ts`). Good.
- `setup.ts:13` imports types from `actions.ts` while `actions.ts:4` imports `applySetupAction` from `setup.ts`. Type-only, so no runtime cycle, but it is a design smell: the action types belong in their own module.
- `main.ts:128-135` (`computerSetup`) holds game flow (who sets up next, a `guard < 20` loop) that belongs in the engine or an AI module.

### 2.4 Modular expansion (A3R / A World at War)

**Data is flexible, rules are not.**

What helps:
- Scenarios are data (`src/data/scenario-*.ts`) with a typed `ScenarioRule` union (`types.ts:189-199`) and four scenarios already encoded.
- `GameContext` (`context.ts`) is a clean place to hang a ruleset.

What gets in the way:
- Rule constants live as module-level values in `tables.ts`, `terrain.ts` and `combat.ts`, and `setup.ts` embeds rules directly: the London stacking exception by name (`setup.ts:205`), the Anglo-French rule keyed to `state.year < 1942` (`setup.ts:217`), the Axis owners list (`setup.ts:49`).
- `PowerId`, `ForceOwner` and `MinorCountry` are closed unions (`types.ts:4`, `85`; `tables.ts:97`). Adding a nation or an oil resource means editing core types.
- There is no interface a rules module could implement. Oil, expanded diplomacy and similar rules would have to be edited into `GameState` and the action handlers.

Verdict: expansion is possible but would be an edit, not a plugin. Cheap fix: a `RuleSet` object on `GameContext` (section 5, step 8).

---

## 3. Rule compliance matrix

"Data" means the numbers are in the repo and tested, but nothing in a game can use them yet.

| Area | Status | Evidence and gaps |
|---|---|---|
| Hex coordinates, adjacency | **Done** | `hex.ts`, measured in 2.1. |
| Map data | **Done, with open checks** | 1,755 hexes, 5,079 hexsides, validated by `validateMap`. Generated from a scan that is not in the repo, so CI cannot regenerate it. Thin coastal hexes depend on a 4% land threshold (listed in `docs/RULES.md`). |
| Scenario data (1939, 1942, 1944, Campaign) | **Done, two scenarios blocked** | 1942 and 1944 cannot start because the start-line hexes are unknown (`zones.ts`). The UI disables them. |
| Opening setup | **Done** | `setup.ts`, 34 tests. One assumption flagged: all pool counters must be placed (`setup.ts:8-9`). Bessarabia ban and a few Minor-Ally conditions are not enforced (`setup.ts:10-11`). |
| Turn sequence | **Data only** | `sequence.ts` holds the 10 Player Turn steps and sub-steps, tested against the map card. `GameState` has no step field, and `legalActions` returns only `END_PLAYER_TURN` during play (`actions.ts:39`). `playerTurnStepIds` is used by tests only. |
| Initiative (Ref 11.1) | **Partial** | Implemented and tested (`game.ts:76-94`). But BRP totals never change, so the result never changes, and "USSR at war with Germany" is approximated by "USSR is allied" (`game.ts:79-81`). |
| BRP accounting | **Data only** | `Nation.brpBase/brpTotal/growthRate` are set from the scenario. `spendingLimit` (`nations.ts:25`) is only shown in the UI. Year Start Sequence is a stub that returns the state unchanged (`game.ts:96-103`). Build costs and DoW/offensive costs exist as constants (`tables.ts:5-23`) and are used by no code. No spending, growth, strategic-warfare penalty or construction. |
| Declarations of war, minor countries | **Data only** | `MINOR_COUNTRY_FORCES` (`tables.ts:120`) and `ScenarioRule` entries exist; no action declares war. |
| Movement, stacking in play | **Not implemented** | Stacking limits are enforced during setup only (`setup.ts:196-232`). |
| ZOC | **Not implemented** | No code. |
| Supply | **Not implemented** | No code; the `UnitType` includes `airbase` and `bridgehead` (`types.ts:23-24`) with no behaviour behind them. |
| Control of hexes, fortress status | **Not implemented** | `GameState.fortresses` exists (`types.ts:244`) and is always `{}` (`game.ts:66`). |
| Offensive CRT | **Data + resolver, not wired** | `combat.ts:14-23` and `resolveOffensiveCombat` (`:95-139`) with counterattack chains, 10 tests. No action calls it. I did not re-check the table values against the printed original in this audit (no scan in this environment); they match what `docs/RULES.md` records. |
| Odds rounding | **Flagged guess** | Defender-favoured rounding below 1:1 is marked `TODO(verify)` (`combat.ts:29-32`). |
| Combat modifiers | **Partial data** | `defenseMultiplier` (`terrain.ts:39-46`: fortress 4, mountains/swamp/river/beach-invasion 3, else 2, best only). Ground support, DAS, shore bombardment and Exchange loss allocation are not implemented: an Exchange only reports that it happened. |
| Attrition | **Data + resolver, not wired** | `ATTRITION_TABLE` and `resolveAttrition` (`combat.ts:146-177`). Hex-selection and elimination are not implemented. |
| Air and naval | **Data only** | Interception and DRM tables (`tables.ts:39-95`) with `TODO(verify)` notes at `:37`, `:64`, `:106`. No air or naval phase. |
| Strategic warfare | **Data only** | `StrategicWarfare` counters exist in state and never change. |
| Computer opponent | **Not implemented** | See section 4. |
| Save and load | **Partial** | State is JSON-serialisable and `replay` exists (`actions.ts:62`). No save or load in the UI. |

---

## 4. AI opponent

**There is no AI.** What the UI calls "the computer" does one thing, at setup, using `autoSetupOwner` (`autosetup.ts:27-77`): it satisfies the scenario's requirements, then places everything else on the first legal hex, where "first" means capitals, then objectives, then cities and ports, then by hex id (`setup.ts:239-250`). That is a legal setup, not a chosen one, and the code says so in its own comments (`autosetup.ts:22-26`, `:80-82`).

In play, the UI tells the user: "The computer opponent does not play yet, so you take both sides' turns for now" (`main.ts:218`).

The requested concepts (supply defence, BRP efficiency, objective hexes, retreat paths) cannot be built until movement, supply and combat exist, because an AI can only choose among `legalActions`.

One design note: the placement-priority ranking in `setup.ts:239-250` is a heuristic living in the rules module. It should move out when a real AI module exists, so that `setup.ts` contains only legality.

---

## 5. Code hygiene and anti-patterns

### 5.1 Size

| File | Lines | Problem |
|---|---|---|
| `src/engine/setup.ts` | 433 | Over 300. Mixes four jobs: area resolution and caching (`:65-123`), placement legality (`:131-250`), requirement checking (`:252-345`), action handlers (`:347-433`). |
| `src/ui/mapView.ts` | 337 | `renderMap` is 177 lines (`:161-337`): layers, pan and zoom, tap detection, highlights and counters in one closure. |
| `src/main.ts` | 280 | `render()` is 85 lines of HTML string building (`:194-279`). Eight module-level `let` variables (`:57-66`). |
| `tests/scenario-data.test.ts` | 616 | Large, but it is table-style data checking; low priority. |
| `tests/setup.test.ts` | 436 | Same. |

Other long functions: `autoSetupOwner` 51 lines, `validateMap` 54, `applySetupAction` 54, `setupProblems` 49, `resolveOffensiveCombat` 45.

### 5.2 Duplication and weak design (this is where the "AI-written" smell is)

| Where | Finding |
|---|---|
| `setup.ts:170, 175, 178, 281` and `autosetup.ts:52` | The same `r.in.reduce((acc, a) => union(acc, resolveArea(ctx, a)), EMPTY)` is written five times. Needs one `resolveAreas(ctx, areas)` helper. |
| `setup.ts:254` and `autosetup.ts:53, 64` | The "does this unit match this requirement" test is written once as `unitMatches` and twice more inline in the auto-setup. |
| `setup.ts:98-109` and `:323` | `Area` has no tag field, so each consumer is a chain of `"country" in area` checks and `describeAreas` is a nested ternary. A tagged union (`{ kind: "country", ... }`) would let the compiler enforce exhaustiveness. |
| `setup.ts:82-90` | **Latent bug.** `resolveArea` caches by `JSON.stringify(area)` but its result also depends on the `seen` argument used for cycle detection. A result truncated by a cycle could be cached and reused by a caller with a different `seen`. Current data has one `controlledBy` use (`scenario-1944.ts:76`) and no cycle, so nothing breaks today. |
| `setup.ts:306` | `GROUND_FOR_STACKING.concat("airborne")` reuses a constant named for stacking for a different purpose. |
| `setup.ts:401, 414, 429-430` | Non-null assertions (`state.pools[owner]!`, `state.setup!`) in the core action handler, where narrowing would make them unnecessary. |
| `setup.ts:7-12` | Rule uncertainties are recorded as `TODO(verify)` in code. Good practice (9 in all, listed in `docs/RULES.md`), but they are open questions about the original game, not cleanup. |
| `actions.ts:56-58` | `default:` branch is unreachable for a closed union; harmless. |

### 5.3 Dead or not-yet-wired code

Nothing here is junk, because each item is data for a rule that is on the roadmap. But none of it is reachable from `legalActions` or `applyAction`, so none of it is exercised in a game.

| File:line | Item |
|---|---|
| `tables.ts:5` | `BRP_COSTS` (also untested) |
| `tables.ts:12` | `BUILD_COST_PER_FACTOR` |
| `tables.ts:28` | `STACKING_LIMIT_BRIDGEHEAD` (also untested) |
| `tables.ts:39, 49, 66, 86, 91` | `interceptionRolls`, `navalAdvantageDrm`, `navalNationalityDrm`, `airAdvantageDrm`, `airNationalityDrm` |
| `tables.ts:120` | `MINOR_COUNTRY_FORCES` |
| `terrain.ts:52, 67` | `NO_ATTRITION_OCCUPATION`, `MAX_OCEAN_AIR_STAGE_HEXES` (both untested) |
| `combat.ts:95, 168` | `resolveOffensiveCombat`, `resolveAttrition` |
| `sequence.ts` | `YEAR_START_SEQUENCE`, `GAME_TURN_STEPS`, `playerTurnStepIds` (tests only) |
| `actions.ts:62` | `replay` (tests only; will be needed for save and load) |
| `types.ts:23-24, 244` | `airbase` and `bridgehead` unit types; `fortresses` state |

### 5.4 Magic numbers

| File:line | Value | Verdict |
|---|---|---|
| `setup.ts:241-248` | Ranks `0, 1, 2, 3, 9` for placement priority | Name them, and move them out with the AI heuristic. |
| `setup.ts:217` | `1942` | A rule date hard-coded in a validator. Belongs in the ruleset. |
| `main.ts:129` | `guard < 20` | Name it, or loop on the state instead. |
| `tables.ts:40-45` | Interception distance cut-offs `1, 10, 18, 24, 30` | Fine as a table, but written as code. A data table is easier to compare with the printed chart. |
| `mapView.ts:10, 92, 137, 237, 300` | `SIZE = 10`, bay depth `0.62`, inset `0.78`, zoom step `1.15`, counter size `9.2 x 6` | Drawing constants; low severity. |
| `combat.ts:87` | `MAX_ROUNDS = 200` | Named. Fine. |

### 5.5 Tooling gaps

- No ESLint, Prettier or Biome config. Style and size limits are not enforced.
- CI runs typecheck, tests and build only (`.github/workflows/ci.yml`). No coverage threshold, no browser smoke test.
- The browser checks used during development (tap placement, touch, layout shift) were run by hand and are **not in the repo**, so a UI regression would pass CI.
- The map generator (`scripts/map/extract.py`, 502 lines, plus `curated.py`) needs the original scan, which is deliberately not committed. The map can be tested but not rebuilt by someone else.

### 5.6 Test quality notes

- Strong: engine-purity test, hex tests tied to named hexsides in the manual, scenario-data cross-checks against the map, setup tests including synthetic scenarios for rules the real data does not exercise. Several mutations were tried by hand during development and the tests were strengthened where they survived.
- Gap: `setup.ts:303-308` (`min-ground-factors-near`) is the one uncovered requirement check (measured). It is only used by the 1942 scenario, which cannot start yet, so it is untested and unreachable at once.
- Gap: coverage numbers for `src/data` (100%) mean the files are imported, not that their contents are right. Their correctness rests on `scenario-data.test.ts` and on the human cross-check against the manuals.

---

## 6. Prioritised action plan

Ordered so that each step makes the next one safer. Steps 1-4 are refactors and should land before the first gameplay rule.

| # | Do | Files | Why |
|---|---|---|---|
| 1 | **Add a turn-step cursor.** `GameState.step` holding a step id from `sequence.ts`; make `legalActions` and `applyAction` step-aware; reject out-of-order actions with tests for each. | `types.ts`, `actions.ts`, `sequence.ts`, new `turn.ts` | Out-of-order enforcement cannot be tested without it. Highest risk item. |
| 2 | **Split `setup.ts`** into `areas.ts` (resolution and caches), `placement.ts` (legality), `requirements.ts`, `setup-actions.ts`. Move `Action`/`GameEvent` types to `action-types.ts` to remove the type cycle. | `setup.ts`, `actions.ts`, `autosetup.ts` | 433 lines, four jobs, one import cycle. |
| 3 | **Fix `Area` and its helpers.** Tagged union, one `resolveAreas`, one shared `unitMatches`, and a cache key that includes `seen` (or stop passing `seen`). Remove the `!` assertions in `applySetupAction`. | `types.ts`, `setup.ts`, `autosetup.ts`, data files | Removes the duplication and the latent cache bug. |
| 4 | **Close the test gap**: add tests for `min-ground-factors-near`, `BRP_COSTS`, `STACKING_LIMIT_BRIDGEHEAD`, `NO_ATTRITION_OCCUPATION`, `MAX_OCEAN_AIR_STAGE_HEXES`. | `tests/setup.test.ts`, `tests/tables.test.ts` | Cheap, and makes the 98% figure honest. |
| 5 | **Economy state**: a real Year Start Sequence, BRP spending and growth, build-cost deduction, live Initiative inputs, and "at war with Germany" read from `state.wars`. | `game.ts`, `nations.ts`, `tables.ts`, `types.ts` | Initiative is currently decided by numbers that never change. |
| 6 | **Movement, ZOC, supply, control** as separate modules built on the hexside data, each with tests against known map situations (a river, Qattara, a strait). | new `movement.ts`, `zoc.ts`, `supply.ts`, `control.ts` | The core of the game. |
| 7 | **Wire combat**: a combat action that calls `resolveOffensiveCombat`, allocates Exchange losses, resolves attrition hex choice, advances `rngState`. Then air and naval. | `combat.ts`, `actions.ts`, new `exchange.ts` | Turns tested tables into game rules. |
| 8 | **Add a `RuleSet` to `GameContext`**; move stacking, year-gated rules (`setup.ts:205, 217`), cost tables and nation lists into it; widen `PowerId`. | `context.ts`, `tables.ts`, `setup.ts`, `types.ts` | The seam for A3R-style variants. Do it before more rules are added, because it gets more expensive each step. |
| 9 | **Computer opponent v1** in `src/ai/`, using only `legalActions` and `applyAction`. Move the placement ranking out of `setup.ts:239-250` into it. | new `src/ai/*`, `autosetup.ts`, `main.ts` | Needs steps 5-7 first. |
| 10 | **Tooling**: ESLint with `max-lines` 300, Prettier or Biome, a coverage threshold for `src/engine`, a Playwright smoke test in CI that taps a hex and places a counter. | `package.json`, `.github/workflows/ci.yml`, new `tests/e2e/` | Turns conventions into checks. |
| 11 | **UI cleanup**: break `renderMap` into layer, viewport and gesture modules; replace `render()` string building with small view functions; wrap `main.ts` globals in one session object. | `mapView.ts`, `main.ts` | Do alongside step 10 so the smoke test protects it. |
| 12 | **Resolve open data questions** (needs screenshots from the original game): Polish Partition Line, the 1942 and 1944 start lines, Vichy hexes, European Turkey, Eastern Europe. | `src/data/zones.ts`, `docs/RULES.md` | Unblocks two scenarios. |

**What I would not do:** delete the not-yet-wired tables and resolvers in 5.3. They are tested rule data that the roadmap will need. Instead, step 7 and the economy work should consume them, and a test could fail the build if one is still unreferenced when a release is tagged.

---

## 7. What this audit did not cover

- I did not re-check the CRT, attrition, DRM and cost numbers against the printed manuals or the original game in this session. They are as recorded in `docs/RULES.md`.
- I did not re-check the map data against the scan beyond the hex math and structural validation above. The coast-rendering check earlier in this project compared specific hexes (the Channel and the Danish straits) with the scan.
- I did not benchmark performance. Setup placement search is cached and the suite runs in about 2 seconds.
- The "Pass" grade is for code quality and architecture. It is not a statement about rule fidelity, which cannot be judged until the rules are built.

### Commands behind the measured numbers

```
npm run typecheck                       # clean
npm test                                # 225 passed, 14 files
npx vitest run --coverage               # engine 98.42% lines / 87.02% branches; main.ts 0%; mapView.ts 23.13%
vite-node hexcheck.ts                   # BFS vs distance(): 0 mismatches of 469; 0 neighbour asymmetries
grep for splice/push/sort/delete/any/@ts-ignore/TODO/non-null assertions
script: exported engine symbols with no production reference outside their own file
```

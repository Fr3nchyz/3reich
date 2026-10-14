# Roadmap

Updated 2026-10-13, after the first technical audit ([AUDIT_REPORT.md](AUDIT_REPORT.md)) and the arrival of the original game's data files ([GAME_DATA.md](GAME_DATA.md)).

**Where we are** (measured status in [PROGRESS.md](PROGRESS.md)): The foundation is sound: a pure, deterministic engine, a verified hex grid, the digitised map, four scenarios as data, the opening setup phase, a tap-to-place setup screen and 225 passing tests. About 15% of a game exists. You cannot yet move, fight, supply, spend BRPs or play against a computer.

**Primary mode:** one player against the computer, either side, on a PC or an iPad. English first; a French interface is a later version. Saves stay on the device (autosave plus a save file); no online sync.

**Rules of the road:** the engine stays pure and headless; the UI and the computer change the game only through `legalActions` and `applyAction`; every rule gets a test and a manual citation; nothing is invented (a guess is a named constant marked `TODO(verify)`); no scans, screenshots, game files or manual text are committed.

**Done so far** (the old phases A-B and part of C): hex coordinates, action layer with replay, Initiative, the map, all four scenarios as data, the opening setup phase, the sequence of play as data, tap-to-place setup.

---

## The plan in one picture

```
 1  Housekeeping ──────────────────────────────────────┐
 2  Read the original game's data (fidelity)           │ can run in parallel
 3  Engine refactors from the audit ───────────────────┘
          │
 4  Economy and turn skeleton (step cursor, BRPs, DoW)
          │
 5  Movement, ZOC, supply, control ─┐
 6  Combat, air and naval           ├─ each lands with its screen (phase 8)
          │                         │
 7  Computer opponent v1 ───────────┘
          │
 ★  Release 1: the 1939 scenario against the computer, saves, iPad
          │
 9  Fidelity and regression (original under DOSBox or Boxer)
10  1942, 1944, Campaign, difficulty levels, stronger AI
11  Ruleset seam (A3R-style variants), French interface, offline
```

(Old letters: D movement is now 5, E combat is 6, F UI is 8, G AI is 7, H fidelity is 9-10.)

---

## Phase 1: Housekeeping (small, first)

| Task | Done when |
|---|---|
| Merge the coast-rendering PR (sea drawn between land hexes that touch across water) | On `main`; the live site shows the Channel and the Danish straits |
| Merge this roadmap, the audit report and the game-data notes | On `main` |
| Settle the game-files policy below in `SOURCES.md` and `README.md` | One sentence each, no contradictions |
| Mark `docs/AUDIT.md` (the 1 October architecture audit) as historical | Header says so |

**Game-files policy (proposed).** The game files stay outside the repo. We may read them and record *facts* in our own data and words (a hex list, a table value, a rule difference), as the map was measured from the printed card. We commit decoders (code) but never their inputs or any copied asset (art, sound, text, binaries). `SOURCES.md` currently says "do not decode game assets into the repo"; reword it to say exactly this.

---

## Phase 2: Read the original game's data (fidelity; high value, low risk)

Goal: replace guesses and open questions with facts from the game itself, and unlock the 1942 and 1944 scenarios. Research plus data files plus tests; no engine design needed.

| # | Task | Source files (outside the repo) | Output | Status |
|---|---|---|---|---|
| 2.1 | Decode the control bitmaps: Vichy France, Eastern Europe, and who controls what at the start of 1942 and 1944 | `VICHY.CON`, `VICHY42.CON`, `EASTEURP.CON`, `GERM42/44.CON`, `ITALY42.CON`, `BRIT42/44.CON`, `USSR42/44.CON` | Hex lists for the unknown zones; "controlled at start" per scenario | Done: `scripts/gamedata/extract.ts` writes the zone hexes to `src/data/gamedata.ts` (not the whole bitmaps); the bitmaps agree with each owner's "controlled at start" (differences in RULES.md) |
| 2.2 | Decode the line files: the Polish Partition Line and the 1942 and 1944 scenario start lines | `NSPPLINE.BIN`, `1942LINE.BIN`, `1944LINE.BIN` | Zone hexes for the USSR, Libya and Italy lines | Done: all three lines run exactly along the borders between the bitmaps' sides; the Polish Partition Line zone is filled for 1939 and the Campaign |
| 2.3 | Check the combat, attrition, terrain, cost and DRM tables against the game's own tables | `TABLE*.TAB`, `3R2.EXE` (`RAWCHRT.RAW` turned out to be a sound) | Tests that fail if ours differ; resolve the three `TODO(verify)` table guesses (odds rounding, interception 30 boundary, unlisted naval nations) | **Done** for the CRT, odds columns (rounding below 1:1 confirmed), attrition, interception (30 confirmed in 25-30), naval advantage (corrected: 1.33 and 1.67 are decimals), naval and air nationality (unlisted nations resolved), minor forces (counters confirmed), BRP costs. Terrain multipliers and air advantage checked against the chart screens only. **Open:** naval DRM of Vichy and Free French fleets (chart says 0; the program may give -2). See `GAME_DATA.md`, "Rule tables" |
| 2.4 | Compare our map with the game's map data: coastal sliver hexes, beaches, Sicily and Sardinia, borders | `BINMAP*.BIN`, `AREA*.BIN`, `HEX.MAP`, `NUMS.MAP` | A differences report, then corrections to `map.json` (retiring the 4% land threshold) | Done for `BINMAP.BIN` (`scripts/gamedata/map.ts`, report in `MAP_COMPARISON.md`): land/sea, countries, Sicily corrected; the threshold decides no hex any more. Open: W21 and Z18 (need zone changes), 25 coastal land hexsides, beaches, coastal flags, rivers, water hexsides. `AREAADJ`/`AREADIST` not decoded (not loaded by the program); `HEX.MAP`, `NUMS.MAP` are drawing data |
| 2.5 | Compare our scenario data with the game's scenario files and the force-pool format | `39SCEN.BIN`, `42SCEN.BIN`, `44SCEN.BIN`, `CAMPSCEN.BIN`, `FORMAT.TXT` | Fix any difference in BRPs, dates, pools | Format documented in `FORMAT.TXT`; not compared |
| 2.6 | Write up the PC-specific rule differences and errata | `README.TXT`, `VIC_COND.TXT`, `PHASES.TXT`, `*OPS*.TXT` | A "PC differs from the board game" section the engine must follow; victory conditions (Ref 2.0-2.1) | README read; not written up |
| 2.7 | Read the AI's text and script resources for hints on how the original AI behaves | `AIMESS.TXT`, `AINAMES.TXT`, `SCRIPT*.*` | Notes for phase 7 | Not started |
| 2.8 | Which ports are Baltic, North Sea or Atlantic; European Turkey | Map and `.CON` files | `zones.ts` complete | Done, from our map (no game file covers them): European Turkey west of the Straits crossing arrows; ports on waters reached from the Atlantic without a Mediterranean hex. Gibraltar's inclusion is a `TODO(verify)` |

**Exit criteria:** `setupStatus` reports 1942 and 1944 as startable; `RULES.md` has no "hexes unknown" entries; the offensive CRT, attrition table and terrain multipliers are each verified by a test against an independent source.

**Findings so far** (see `GAME_DATA.md`): the `TABLE*.TAB` files are pictures of the chart screens, and the rules themselves (CRT and attrition data, odds, interception and DRM routines) are in `3R2.EXE`; all match ours except the naval advantage thresholds, now corrected. the bitmap layout is `column = q + floor(r/2) - 16`, most significant bit first. Vichy France (19 hexes) and Eastern Europe (36) fall almost entirely on the expected countries. Three of those hexes are coastal slivers that our map called sea, a direct hint that the 4% land threshold was wrong for a few hexes. The game's own map (`BINMAP.BIN`, 2.4) showed 19 such hexes; 17 are corrected, see `MAP_COMPARISON.md`. With the corrected map, `setupStatus` reports 1942 and 1944 as startable, and RULES.md has no "hexes unknown" entries.

---

## Phase 3: Engine refactors from the audit (before any new rule)

Each is a small PR, in this order.

| # | Task | Why |
|---|---|---|
| 3.1 | **Turn-step cursor**: `GameState.step` holding an id from `sequence.ts`; `legalActions` and `applyAction` step-aware; tests that reject out-of-order actions | Out-of-order enforcement cannot be tested without it. Biggest risk in the audit |
| 3.2 | **Split `setup.ts`** (433 lines) into areas, placement, requirements and action modules; move `Action` and `GameEvent` types out so `actions.ts` and `setup.ts` stop importing each other | Over the 300-line limit; one type-level import cycle |
| 3.3 | **Tagged `Area` union**, one `resolveAreas` helper, one shared `unitMatches`; fix the cache key in `resolveArea`; remove the `!` assertions in `applySetupAction` | Removes five-fold duplication and a latent bug |
| 3.4 | **Close the test gaps**: `min-ground-factors-near`, `BRP_COSTS`, `STACKING_LIMIT_BRIDGEHEAD`, `NO_ATTRITION_OCCUPATION`, `MAX_OCEAN_AIR_STAGE_HEXES` | Makes the 98% engine coverage honest |
| 3.5 | **Tooling in CI**: ESLint with `max-lines` 300, a formatter, a coverage floor for `src/engine`, a Playwright smoke test (tap a hex, place a counter). **Partly done:** ESLint, the coverage floor and the smoke test (mouse and touch) run in CI; the formatter is deliberately left out for now | Turns conventions into checks; protects the UI |
| 3.6 | **UI cleanup. Done:** `mapView.ts` is now a thin `renderMap` that wires `mapGeometry`, `mapLayers`, `mapCities`, `mapCounters`, `viewport`, `gestures` and `tap` (tap slop 6 px); `main.ts` holds no game state, which lives in one `Session` object (`ui/session.ts`, `ui/sessionActions.ts`), and `render()` is built from small view functions (`ui/statusView.ts`, `ui/setupView.ts`, `ui/statusBind.ts`, `ui/mapSync.ts`, `ui/shell.ts`). No behaviour change: the page's DOM is byte-identical to before for a scripted session. Every file under 120 lines | After 3.5, so the smoke test protects it |

**Exit criteria:** every audit "refactor" item closed; CI enforces size and coverage; nothing in `src/engine` over 300 lines.

---

## Phase 4: Economy and the turn skeleton

| # | Task | Rules |
|---|---|---|
| 4.1 | **BRP ledger**: spending limit, costs deducted, growth, a real Year Start Sequence, "no growth in 1940" from the scenario rules | Ref 9.0, 10.0, 11.x |
| 4.2 | **Initiative from live data**; "at war with Germany" read from `state.wars` | Ref 11.1 |
| 4.3 | **Declarations of war and minor countries**: DoW action with its BRP cost, forces of newly attacked minors, Minor-Ally activation, the PC rule that a DoW needs an attack or a move into the minor | Ref 13.0-17.0; PC README rule 21.4 |
| 4.4 | **Front options** chosen per front and stored in state | Ref 11.21 |
| 4.5 | **Construction and the force pool**: build units for BRPs, allowable builds with dates, replacements | Ref 11.5-11.6 |

**Exit criteria:** a game can run through several Game Turns with units on the map, BRPs changing and war being declared; replaying a recorded action list reproduces the state exactly (a test).

---

## Phase 5: Movement, ZOC, stacking, supply, control

Each item is its own module, tested on specific map situations (a river, Qattara, a strait, Sicily).

| # | Task |
|---|---|
| 5.1 | Hex **control** state and changes of ownership |
| 5.2 | **Stacking in play** and overstack elimination (steps 6g, 9j) |
| 5.3 | **Zones of control** |
| 5.4 | **Ground movement** with crossing arrows, rivers, Qattara and the Suez Canal (step 6f) |
| 5.5 | **Supply** (land, sea, fleets), unsupplied units (steps 6e, 9f-9h). Land tracing built as queries (spec 03 part 2); sea supply and the step penalties not. Supply is Ref 19 in the web text; unsupplied units there may still attack |
| 5.6 | **Strategic Redeployment** (step 9e) |
| 5.7 | **Fortress** changes: Maginot, West Wall, Sevastopol (Ref 4.8) |

**Exit criteria:** `legalActions` lists every legal move for a unit; a hand-built position per rule behaves as the manual says; property tests: no move ends overstacked.

---

## Phase 6: Combat, air and naval

| # | Task | Notes |
|---|---|---|
| 6.1 | **Ground combat** action: wire `resolveOffensiveCombat`, allocate Exchange losses, retreats | Tables already tested |
| 6.2 | **Attrition**: hex choice, elimination; PC rule that hexes are chosen one at a time | |
| 6.3 | **Exploitation** and airborne drops | PC README rules 31.1, 31.5 |
| 6.4 | **Air**: counter-air, defensive air support, air attacks on naval bases | |
| 6.5 | **Naval**: fleet movement, interception, bombardment, seaborne invasions | Uses the interception and DRM tables |
| 6.6 | **Strategic warfare** and the Murmansk and U.S. boxes | |
| 6.7 | **Russian winter and surrender**; victory conditions | |

**Exit criteria:** all ten steps of a Player Turn can be played by the engine alone; every Reference Manual rule is either implemented or listed as "not in the PC game" (the README names partisans, variants, Gibraltar and Russo-Allied cooperation).

---

## Phase 7: Computer opponent v1 (needs 4, 5, 6)

Rule-based, plays either side, only through `legalActions` and `applyAction`, in `src/ai/` (not in the rules modules). Built in layers so each is testable:

1. Setup: a sensible placement instead of "first legal hex" (front weighting, objectives, supply).
2. A position evaluator (objectives, BRPs, supply, force ratio per front).
3. Choosers per step: declarations and front options, movement, combat selection, construction, redeployment.
4. Strength levels from the original's difficulty adjustments (BRP multipliers and force-pool additions, written out in the game's README).

Read *The General* Vol. 31 No. 2 (the AI article) and the original's AI resources (2.7) before designing.

**Exit criteria:** the computer plays a complete 1939 game against itself and against a scripted opponent with no illegal action, deterministically from a seed; a human can win and can lose.

---

## Phase 8: Play UI (grows with each phase above)

Counters on the map and the setup screen exist. Each rule phase adds its screen. Our own art, national colours with no emblems, nothing behind hover, 44px touch targets, PC and iPad.

| # | Milestone | Needs |
|---|---|---|
| 8.1 | Sequence-of-play bar and step prompts | 3.1 |
| 8.2 | BRP and status panels, declaration-of-war dialog | 4 |
| 8.3 | Select, move, see legal destinations | 5 |
| 8.4 | Combat selection and result display | 6 |
| 8.5 | Save, load, autosave, export file | `replay` already exists |
| 8.6 | iPad pass: gestures, safe areas, installable | 8.3 |

---

## ★ Release 1: the 1939 scenario against the computer

Autosave, save slots and a save file, iPad support, a short in-app help page and the legal notice, on the private domain. Send it to the player for real feedback (device, scenario, side, annoyances).

---

## Phase 9: Fidelity and regression

- **Run the original under DOSBox, or Boxer on a Mac,** and keep a list of reference situations (a setup, a combat, a supply cut) with the original's answers. Each becomes a regression test.
- Golden games: recorded action lists and final states; a rule fix updates the golden file on purpose.
- A regression test for every corrected rule.

## Phase 10: More scenarios and polish

1942 and 1944 (data unblocked by phase 2), the Campaign, difficulty levels, a stronger AI, performance work, offline install.

## Phase 11: Later

- **Ruleset seam:** a `RuleSet` on `GameContext` holding stacking limits, year-gated rules, cost tables and nation lists, with `PowerId` widened, so A3R-style variants (oil, expanded diplomacy) are a ruleset rather than an edit to core types. Best done before phase 5 grows large; otherwise before phase 10.
- **French interface:** all on-screen text from one translation table with a language switch; French names for nations, unit types and well-known cities with the English game terms in brackets (BRP); engine messages as data (an id plus values) instead of English sentences.
- Public-release questions (name, replacing the map data, legal review) only if the project ever leaves private.

---

## Running this with several agents

Independent work can run in parallel; anything that changes the shared types must be serial.

| Can run in parallel | Must be serial |
|---|---|
| 2.1-2.8 (each is research, a data file and tests) | 3.1 (changes `GameState`), then everything that adds state |
| 3.4 and 3.5 (tests and tooling) while 3.2 and 3.3 are in review | 3.2 before 3.3 (same file) |
| 5.3 (ZOC) and 5.7 (fortress) once 5.1 and the step cursor exist | 4.1 before 4.2 and 4.5 |
| UI for a finished rule phase | Any change to `types.ts` that others depend on |

Working rules for an orchestrator:
- One branch and one PR per task; the orchestrator merges, workers do not.
- Each worker gets the repo rules above, the exact files it may touch and the test it must add, and reports the commands it ran.
- Changes to `types.ts` or `actions.ts` are announced first, so two workers never change the state shape at once.
- A reviewer pass by a second agent that did not write the code, before each merge, using the audit's checks.

## Waiting on the user

- Replies from the player: device, scenario, side, annoyances.
- Whether Boxer or DOSBox can run the game for reference captures (phase 9).
- Screenshots of the original's setup screens, only if phase 2 leaves a gap.

## Decisions made so the user does not have to

- Data research (2) and refactors (3) come before new rules: they are cheap and remove the largest risks.
- The AI waits until movement and combat exist; one built earlier would be thrown away.
- Release 1 is the 1939 scenario only; 1942, 1944 and the Campaign follow.
- The computer's setup stays a placeholder until phase 7.

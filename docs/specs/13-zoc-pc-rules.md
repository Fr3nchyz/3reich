# 13. Zones of control as the PC Reference Manual prints them

Status: built 2026-10-16 (tickets 13-1 to 13-3; 13-4 waits for fleets and exploitation). See "As built" at the end. Source: the PC Reference Manual, rule 7.0 (and 11.41, 12.31, 19.3, 21.42), read from a local copy; short quotes only. Replaces the ZOC part of spec 03, which was written before the manual text was available.

## Goal

Our engine and the PC game must agree on what a zone of control (ZOC) does. Today they disagree in four ways (table below), so a stack can be stopped, or supplied, where the original game says otherwise. This changes how the front line plays, so it is its own spec.

## What the manual says (checked line by line on 2026-10-16)

| # | Manual rule | Our engine today |
|---|---|---|
| 1 | 7.0: "Every ground unit exerts a Zone of Control (ZOC) on the hex it occupies." Only armor exerts an additional ZOC on the six adjacent hexes. | Infantry, armor and airborne all exert ZOC on adjacent hexes (`ZOC_UNIT_TYPES`). |
| 2 | 7.0: armor ZOC "does not extend" across an all-water hexside, across a Crossing Arrow hexside, or into a Fortress hex; it does extend out of a Fortress hex and across rivers and the Suez Canal (4.8 repeats the Fortress part). | Adjacent hexes the unit "could cross into", so Crossing Arrow hexsides count, Fortress hexes are not special. |
| 3 | 7.0: "Friendly units do not negate the effect of enemy ZOC." | A friendly ground unit cancels enemy ZOC in its hex (`ZOC_POLICY.friendlyUnitNegates`). |
| 4 | 7.0: a moving enemy ground unit pays an extra two movement factors to leave a hex in armor ZOC. 11.41: "There is no extra cost to enter an armor ZOC." Nothing says a unit must stop on entering one. | A unit entering a ZOC must stop; leaving is free. |
| 5 | 7.0 and 19.3: supply cannot be traced through a hex adjacent to an enemy armor unit; it may end in one (19.4 example: "drawn into a ZOC but never through it"); ZOC ends at the water's edge (19.31). | Supply follows our ZOC (rows 1 to 3). |
| 6 | 11.41: armor ZOC has no effect on air or naval movement. 21.42: a ground unit embarking in a port in enemy ZOC pays two MF to embark. 12.31: Exploiting units are "limited normally by the ZOC of any enemy armor in adjacent hexes". | Not modelled. |

Not stated in the manual (stay `TODO(verify)`): whether a unit that cannot pay the exit cost may leave an armor ZOC at all (read here as: it may not, so with a 1-factor step it needs 3 factors in all); whether ZOC of a non-armor unit in its own hex has any effect other than supply bookkeeping (19.3: ZOC "over the unit and/or the source" does not block supply); whether airborne units are ground units for rule 1 (read as yes, 23.0 says nothing else).

## Behaviour

- Armor (only) puts ZOC on the up-to-six adjacent hexes, minus the exceptions in row 2. Other ground units put ZOC on their own hex only.
- Leaving a hex that is in enemy ZOC costs 2 extra MF. Entering costs nothing extra and never forces a stop.
- A friendly unit in a hex does not cancel enemy ZOC there, for movement or for supply.
- Supply tracing refuses a hex in enemy ZOC unless it is the end of the line.
- The move overlay and the "why can't I go there" sentences (spec 10, ticket 10-7) say "2 extra to leave" instead of "must stop".

## Tickets

| # | What | Notes |
|---|---|---|
| 13-1 | `zoc.ts`: armor-only adjacent ZOC, Fortress and Crossing Arrow exceptions, no friendly negation; supply uses it | Named constants stay (`ZOC_POLICY`), pinned by tests citing 7.0, 19.3, 4.8. `tests/zoc.test.ts` and `tests/supply.test.ts` change on purpose. |
| 13-2 | `movement.ts`: replace "must stop" with "+2 MF to leave"; path search costs hexes by MF left | Self-play recordings change: measure and report. `reachableHexes` becomes a cost search. |
| 13-3 | UI text and overlay; computer opponent reads the new cost | Via `legalActions` only. |
| 13-4 | Embarking (21.42) and Exploitation (12.31) hooks | Waits for fleets and exploitation. |

## Done when

Each row 1 to 5 has a test citing the rule number; a mutation check breaks each rule and a test fails; self-play of all four scenarios still finishes without illegal actions, and the report states how recordings changed; `docs/RULES.md` loses the CONFLICT entry and `docs/TODO-VERIFY.md` records the three open readings above.

## Open questions (also in docs/RULES.md)

- The Exploitation example in 12.31 says a unit "would have had to stop" because of "the cost of exiting enemy ZOCs (+3 MPs)", against +2 in 7.0. Perhaps +1 for the hex plus +2, or two ZOCs; the text does not say. Build +2 (7.0) and keep this as `TODO(verify)`.

- Does the PC game apply the +2 cost exactly as printed (the manual is the printed board rule; the program may differ)? Frank can check: a lone infantry next to an enemy armor unit with 2 MF left.
- Can a unit that cannot pay +2 stay put and still be attacked normally (assumed yes)?

## As built (2026-10-16)

- `src/engine/zoc.ts`: `ARMOR_ZOC_TYPES` (armor only), `ZOC_UNIT_TYPES` stays the ground units (each exerts a ZOC on its own hex, which does nothing by itself; supply still checks these counters), `ZOC_EXIT_COST` = 2, `ZOC_POLICY.friendlyUnitNegates` = false (the switch remains for tests), `armorZocCrosses` (land hexside only: not water, not a Crossing Arrow, not Qattara; rivers and the Suez Canal count as land), `zocOfUnit(ctx, state, unit)` now needs the state to see Fortress status (`state.fortresses`), `zocExitCost`. `mustStop`, `zocStopIndex` and `zocPathProblem` are gone.
- `src/engine/movement.ts`: `reachableHexes` and `movePathProblem` charge the exit cost for leaving a hex in enemy armor ZOC, including the first step out of the start hex; entering never stops a unit. A unit that cannot pay the exit cost plus the step (3 factors for one step) cannot leave (TODO(verify)). The refusal sentence names the extra cost.
- Supply (`supply.ts`) follows through `enemyZocFor`: a line cannot pass a hex next to enemy armor, may end in one; friendly units no longer cancel.
- UI: the overlay key now reads "armor Zones of Control ... pay 2 extra movement points to leave one".
- Computer: unchanged code; it reads `reachableHexes` and so pays the exit cost. Over 30 seeds of 1939 against main: combats 829 to 760, Axis objectives held 359 to 287, Allied 601 to 673, idle Player Turns 62 to 70, churn runs 5 to 3; Campaign 10 seeds: combats 564 to 547, idle 22 to 31, churn 0 to 3; no anomaly, every game reaches game over. The seed 5 guards in `tests/ai-stability.test.ts` were loosened for this reason and say so.
- Tests: `tests/zoc.test.ts` (geometry, armor only, Fortress and Crossing Arrow, no negation), `tests/movement.test.ts`, `tests/move-options.test.ts`, `tests/mutation-survivors.test.ts`, `tests/supply.test.ts`, `tests/map-overlay.test.ts`; five mutation checks (infantry exerts ZOC, negation on, exit cost 0, Fortress exception off, Crossing Arrow carries ZOC) each fail a test.
- Not built: embarking in a port in enemy ZOC (21.42) and the Exploitation limit (12.31); both wait for fleets and exploitation.
- Supply also gets the 19.3 exception: a unit next to its source is not supplied when both stand in the ZOC of the same enemy armor unit.
- Armor ZOC does not cross a Qattara hexside either (7.0 names only water, Crossing Arrow and Fortress; Qattara is a hexside no ground unit crosses): `TODO(verify)`.
- **Fixed afterwards:** `GameState.fortresses` was never filled in, so the Fortress ZOC exception and the quadrupled defence in `attack-rules.ts` were inert; `fortress.ts` now sets it (RULES.md, "Fortress status").

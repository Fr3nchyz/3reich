# 03. Control, stacking, movement, Zones of Control and supply

Status: **draft for review. Nothing is built until you say "let's go".** Depends on spec 01 (turn steps); independent of spec 02 except where noted.

## Goal

Units can be moved on the map, only where the rules allow, and the game knows which hexes each side controls, which units are in supply, and what happens to units that are not. This is the core of the game board; combat (spec 04) builds on it.

## Behaviour (what the player or engine does)

### Control of hexes

- Every land hex has a controller (Axis, Allies or neutral). It starts from the scenario's "controlled at start" territory and changes when a side's ground unit enters or conquers a hex under the rules of Ref 7.0 and 16.0 (conquest of minors).
- The map can show control (the original does, with a key). Control changes are events in the log.

### Stacking (steps 6g and 9j)

- The setup limits (two ground units per hex, London three if all British, airborne free, five air factors per base, 36 naval factors per port) apply at all times in play.
- Overstacking can arise during movement; units over the limit are eliminated at the printed step, with the owner choosing which (Ops 5.45g, 5.48j).

### Ground and air movement (step 6f)

- A unit moves up to its movement factor in hexes, one hex per factor, along hexsides ground units may cross (the map data's land hexsides, crossing arrows in both directions, no crossing of Qattara).
- Entering terrain, rivers and mountains costs what the Terrain chart says; the cost is shown before the move is made.
- Units may not end a move in a hex that would overstack it; the move is refused with that reason.
- Air units move by their air movement factor, must end on a legal base (a city, port, capital or airbase), and cross ocean only if they can stage to another base within eight hexes (Ref 20.0).
- Fleet movement (6a to 6d) belongs to spec 04.

### Zones of Control (ZOC)

- A ground unit exerts a ZOC into every adjacent hex (not across a hexside the unit cannot cross).
- (Replaced by spec 13: armor-only ZOC; leaving a hex in enemy armor ZOC costs 2 more, entering never stops a unit.) Was: A unit entering an enemy ZOC must stop; leaving a ZOC is allowed. Friendly units negate ZOC for supply and movement as the rules say (Ref 6.0).
- The UI can show every ZOC hex for a selected side.

### Supply (steps 6e, 9f to 9h)

- Each ground unit is in supply if it can trace a path of friendly-controlled, enemy-ZOC-free hexes to a supply source (the nation's capital and the other sources of Ref 19.2 in the web text; not every friendly city, which this draft first said; the draft's "Ref 10.0" is the spending limit, supply is Ref 19.0 there, TODO(verify)), or by sea through supply fleets.
- Supply is checked at the printed steps. A unit out of supply is flagged, shown on the map, and suffers the printed penalty (per the web text, Ref 19.4, it CAN still attack but cannot move, advance after combat or be redeployed, TODO(verify) against the PC manual; and it is eliminated at the check in 9g if still unsupplied; unsupplied airbases are relocated or eliminated in 9h).
- The supply check is deterministic: given a state, it returns the same set of supplied units and the path used.

### Strategic Redeployment (step 9e)

- Units may be redeployed by rail or sea within the printed limits of Ref 11.73 to 11.76: distance or BRP cost, front limits, no redeployment into or through enemy ZOC, and supply required at the end.
- The cost in BRPs comes from spec 02.

### Fortresses and the Maginot and West Wall rules

- Fortress status changes during play (lost when first occupied by the enemy; Maginot Line, West Wall and Sevastopol conditions, Ref 4.8). The current status is part of the game state and shown on the map.

## Rules references

- Ref 4.0 to 4.8 (map, hexsides, terrain, fortresses), 5.0 (stacking), 6.0 (ZOC), 7.0 (control), 19.0 (supply; written 10.0 in the first draft, which is the spending limit), 11.7 to 11.77 (redeployment, overstacking), 16.0 (conquest), 20.0 (air movement).
- Ops 5.45, 5.45e to 5.45g, 5.48 to 5.48j.
- PC README: rule 3.35 (once initial setup requirements are met you may move any units freely), rule 14.23 (an attacking unit may attack only one hex), rule 24.23 (supply lines for conquest of minors are chosen by the program), rule 47.3 and 47.4 (Suez Canal behaviour).

## Open questions (also add to docs/RULES.md)

- Exact terrain movement costs and whether any terrain is impassable for armor (read the Terrain chart; verify against the game's own tables, see ticket T03).
- How the original treats Sicily, Sardinia and other islands for ground movement (hexsides marked "coastline only"); ticket T04 compares our map with the game's.
- What counts as a supply source for each nation in each scenario, and for conquered minors.
- Whether supply is traced by the engine automatically for display, or only when a rule needs it (proposal: always available, computed on demand and cached per state).
- The 1944 and 1942 start lines (ticket T01) decide which units start in or out of supply.

## Done when

1. `legalActions` lists every legal move of a selected unit at step 6f, and every move not listed is refused with a reason; a table-driven test covers rivers, crossing arrows, Qattara, mountains, the Channel and the Danish straits, and a stacking limit.
2. ZOC is tested: a unit entering ZOC must stop, may leave it, and is not stopped by friendly ZOC cover; a property test: no legal path passes through two consecutive enemy-ZOC hexes.
3. Supply is tested on hand-built positions: a cut line, a supply fleet, a capital as source, and a sea path; the same state always gives the same answer.
4. Unsupplied units are eliminated or flagged exactly at the printed steps and not before.
5. Control changes are covered for ordinary entry, conquest, and the Fall 1939 Poland case.
6. Strategic Redeployment limits are tested, including the front restriction and enemy-ZOC refusal.
7. Fortress status changes are tested for each kind (permanent, standard, Maginot, West Wall, Sevastopol).
8. Mutation checks: removing the ZOC stop, the overstack check, or a supply source each makes a test fail.

## As built (part 1: control, stacking and Zones of Control, roadmap 5.1 to 5.3)

Engine only: pure functions and state, no actions and no UI yet. Movement (5.4), supply (5.5), redeployment and fortress changes are not built.

- **Control** (`src/engine/control.ts`). `GameState.control` holds only the hexes whose controller differs from the scenario's "controlled at start" territory; `controllerOf(ctx, state, hex)` reads it (start territory = every owner's whole countries plus zones, no hex claimed twice, tested for 1939 and 1942). Hexes in nobody's territory (neutral minors) have no controller. `enterHexes(ctx, state, unit, hexes)` is what the movement round will call: an infantry, armor or airborne unit entering a hex held by an enemy (opposite side, or at war by the record when one party takes no side) takes it, and a hex of a minor country takes it once that minor is at war with the unit's owner; each change logs `HEX_CONTROL_CHANGED` (the UI log shows it). `sideInWar` gives the side an owner fights on now (null for neutral powers, Vichy, inactive Minor-Allies).
- **Stacking** (`src/engine/stacking.ts`). `overstacks` lists hexes, sides and kinds (ground, air, naval) over the limits of `placement.ts`, each side's units counted apart and the air limit applied only on bases (city, port, capital or an airbase counter) and the naval limit only in ports (TODO(verify): limits for air in flight or fleets at sea) (it calls `stackingProblem` unchanged, with the Anglo-French test switched off). `eliminationProblem` and `eliminateOverstack(ctx, state, side, { hex: [unit ids] })` apply steps 6g and 9j: the side's player names the units, the choice must bring every overstack of that side within its limit and take no more than needed; `defaultElimination` gives the computer a legal choice (weakest first). British and French sharing a hex before 1942 is reported separately by `angloFrenchHexes`. Not yet an action or wired to steps 6g and 9j.
- **Zones of Control** (`src/engine/zoc.ts`). `canCross` (land hexside or crossing arrow, never Qattara), `zocOfUnit`, `zocHexes(side)`, `enemyZocFor(side)` (with friendly cancellation), `mustStop`, `zocStopIndex` and `zocPathProblem` (a path may end in an enemy ZOC but not go on past one; starting in one is free), `zocSources`. Tested on a river (B42-C42), Qattara, the Channel, the Messina, Turkish and Danish arrows, Sicily, and a property test on random walks.
- **Open, all `TODO(verify)` in the code** (the rule text in `docs/RULES.md` does not settle them): which counters exert a ZOC (infantry, armor, airborne here; not replacements, bridgeheads, air, fleets); whether a friendly ground unit cancels the enemy ZOC in its hex (spec 03 says so for movement and supply; `ZOC_POLICY.friendlyUnitNegates`, switchable per call); ZOC across the Suez Canal hexsides (they are land hexsides, so it crosses); whether control changes on passing through as well as ending a move; whether conquering a minor country hands over the whole country at once (Ref 16.0); who holds uncontrolled land that no minor country owns (the Baltic States in 1939); Vichy units are treated as neutral; whether the owner may eliminate more than needed at 6g and 9j; where eliminated units go (no pool yet).

## As built (part 2: ground movement at step 6f, roadmap 5.4)

Step 6f ("Conduct normal ground/air movement", Ops 5.45f; the id and title are as printed in `sequence.ts`) is now a step the game waits at, but only while some unit of the side to move can move (`hasMoveWork`, like the other gated steps); otherwise it is passed and recorded. Air movement, fleets, supply and Strategic Redeployment are not built.

- **Action.** `MOVE { side, units, path }`: one unit or units standing together move along `path`, the hexes entered in order (start excluded). `legalActions` lists, for every movable unit, a `MOVE` to each hex it can reach with the cheapest path (ties broken by the fixed neighbour order), and for a stack of two or more also the whole stack's moves at its slowest factor. `applyAction` accepts any path that is legal, not only the listed one (a longer way round, a subset of a stack). Malformed input (not an object, units or path not arrays, ids that are not own properties such as `__proto__`, hexes off the map) is refused with an error and never throws.
- **Rules applied** (`movement.ts`, `move-action.ts`): movement factor in hexes (a unit with no movement factor, a replacement, air unit, fleet, airbase or bridgehead does not move on the ground); hexsides by `canCross` (land hexsides and crossing arrows both ways, never Qattara, never water: the Channel); an enemy-occupied hex cannot be entered (that is an attack); stop on entering an enemy ZOC through `zocPathProblem` (starting in one is free, friendly ground units cancel it by `ZOC_POLICY`); the move may not end where `stackingProblem` forbids (two ground units, Ref 26.0 Anglo-French sharing, per side and nationality), passing through full hexes is allowed; each unit moves once per Player Turn (`GameState.moves`, keyed by Game Turn and side like the combat record, so nothing clears it); control changes through `enterHexes` for the hex where the move ends (`CONTROL_ON_PASS_THROUGH` switches to every hex entered; event `UNITS_MOVED`, then `HEX_CONTROL_CHANGED`).
- **Computer.** It ends step 6f without moving (`moveOnAction` gives it the way on without building the list of moves; `src/ai/choose.ts` gives the reason). The engine lists the moves once per state (cached), about 50 ms in 1942. The self-play tests over the four scenarios pass with the step waiting.
- **UI.** `src/ui/moveTap.ts`: tap a stack of yours at 6f, its destinations are outlined, tap one to move the whole stack (or the biggest part of it that can go there; the toast says who stayed). Tapping another stack of yours chooses it instead, tapping the chosen stack lets it go, a tap elsewhere is refused in the line over the map. The move buttons are not listed. Splitting a stack is not possible by tap.
- **Open, all `TODO(verify)` in the code and listed in docs/RULES.md:** terrain costs (all 1), once per Player Turn, control on pass-through, neutral land closed (`NEUTRAL_LAND_CLOSED`), the overstack check at the end of the move instead of 6g elimination.

## As built (map overlay and phone layout)

- **Control and ZOC overlay** (button under the map, off by default; `src/ui/overlayModel.ts`, `mapOverlay.ts`, `overlayToggle.ts`). `overlayCells` groups every held land hex (`controlMap`, so `startingControl` plus changes) by the side its holder fights on (`sideInWar`; "neutral" for a nation on neither side) and lists `zocHexes` of the side not to move (`otherSide(activeSide)`), friendly cancellation not applied. Drawn as an outlined, lightly tinted inset hex (dark Axis, green Allies, dotted neutral) so it reads apart from the country tint, plus a red hatch for the ZOC hexes, under the borders-and-cities layers. The key over the map names the side whose ZOC is hatched. Pure model tested in `tests/map-overlay.test.ts`; e2e in `tests/e2e/overlay.spec.ts`. Adds no rule; the open questions above (which counters exert a ZOC, cancellation) show through unchanged.
- **Phone layout** (`src/style.css`, 640 px and narrower). The map and its toggle bar form a sticky block of about half the screen height; the status panels scroll beneath it, so choosing a chip no longer scrolls the map away (`tests/e2e/phone-layout.spec.ts`).
- **Tablet and desktop layout** (`src/style.css`, `src/ui/logView.ts`). Every screen starts from the pinned map; wide landscape screens (900 px and up, taller than 480 px, aspect 5:4 or wider) are two columns instead, the map on the left and the panels scrolling in their own column on the right, so the map never leaves the screen (`tests/e2e/wide-layout.spec.ts`). The activity log lists the newest entry first (the latest 200; `Session.log` keeps all), in its own scroll box that keeps its position when the panels redraw (`tests/log-view.test.ts`). When the map box changes shape (a window resized across the breakpoint, a tablet turned over) the viewBox is refitted about the same centre and zoom (`refitBox` in `src/ui/viewport.ts`, `tests/e2e/resize.spec.ts`); a redraw of the panels gives keyboard focus back to the same chip, mode button or the log, found by a stable key or an identical label; a choice that has gone (or a button whose label changed) leaves the focus on the panel, never on a different choice (`src/ui/focusKeep.ts`).
- **Water edges** (`src/ui/waterEdges.ts`, drawing only). The 226 hexsides between two land hexes that are not land-crossable (Otranto, the Channel, the Danish straits, Gibraltar, Messina and so on) are drawn as a blue band with a light ripple, above the hexes and under the counters and arrows; the brown national boundary is never drawn on one. The four dry Qattara sides keep their own barrier line. No rule reads this (`tests/water-edges.test.ts`, `tests/e2e/wateredges.spec.ts`).

## As built (part 2: supply tracing, roadmap 5.5)

Pure queries in `src/engine/supply.ts`; no action, no step and no UI uses them yet. Supply is Ref 19.0 in the only printed rules found (docs/RULES.md "Web research"), not 10.0 as this spec said, and it differs from the draft above in three places: (1) land sources are capitals only (a Major Power's, and a fighting minor's), not every friendly city; (2) an unsupplied unit may still attack (19.4), so the `isSupplied` hook in `attack-rules.ts` was left true, with its comment corrected; (3) enemy ZOC on the unit's own hex or on the source does not cut the line, only ZOC on a hex between does.

- `supplySources(ctx, state, side)`: capital hexes the side controls (Major Power capitals; a minor's only while it fights on the side). `supplyStatus(ctx, state, side)` returns `{ sources, supplied: [{ unitId, source, path, via }], unsupplied }`, units in numeric id order; `unsuppliedUnits` and `isUnitSupplied` are views of it. Checked: infantry, armor, airborne, airbases; naval and air units are always in supply.
- Tracing: a breadth-first search outward from the sources over land hexes the side controls with no enemy ground unit, across hexsides ground units cross (`canCross`, so Crossing Arrows count and Qattara does not), with `enemyZocFor` and its friendly cancellation (`ZOC_POLICY`). An enemy-ZOC hex is reached but not passed through unless it is a source. Fixed neighbour order, so the same state always gives the same nearest source and path. Western Allied and Soviet units trace from their own sources only (lines may cross each other's hexes); `SUPPLY_POLICY` holds the switches (`sourceFeatures`, `maxLength` null, `separateAlliedGroups`, `zoc`).
- Sea supply (19.31) is a documented stub (`seaSupplyLine` returns null): it needs fleet designation at 6e and 9f and the port rule.
- Cost: both sides together took 3 ms (1939), 7 ms (1942) and 5 ms (1944) on a fully set up board, so no cache; nothing calls it per render because the hook stays true.
- Tested on concrete positions in `tests/supply.test.ts` (29 tests): Warsaw and Rome as sources, a continuous line, ZOC on the unit and the source (no cut), a cut by enemy ZOC (Sicily chain, Poland ring), an enemy-controlled hex, an enemy unit on the line, friendly units cancelling ZOC, the Messina arrow (and the same strait without it), Sardinia, the Western and Soviet split, a length policy, determinism, malformed input, and that an unsupplied unit stays in the attacker pool. Mutation checks (each made tests fail; a first review found four that survived, the enemy unit on a source, the maximum length boundary, a null controller and the always-supplied counters, each now has a test): ZOC stop, source-in-ZOC exemption, control test, enemy-unit block, hexside crossing, sources widened to cities, friendly cancellation, the Soviet split.
- Open (all `TODO(verify)`, listed in docs/RULES.md "Open questions"): see there; the unsupplied penalties (no move, no advance, elimination at 9g, airbases at 9h) are not built.
- **Conflict to decide** (RULES.md "Open questions", first item): the web text says friendly units do not negate enemy ZOC and only armor exerts ZOC into adjacent hexes; this module and `zoc.ts` follow the draft above instead. Its section numbers also differ (control 6.0, ZOC 7.0).
- Malformed input: a state missing `units`, `nations`, `control` or `minorAllies`, or with a null unit entry, gives an empty answer; `zoc.ts` itself is not guarded for those shapes.
- **Activity log by side** (`src/ui/logSide.ts`, `logView.ts`, `style.css`): red lines for the Axis and blue for the Allies, as the product owner asked. `Session.log` is still a list of strings (and the game record and the engine are untouched); `Session.logSides` maps an entry's index to a side and is never saved, so an entry pushed without a side is simply plain and the two cannot get out of step. Every push site goes through `logLine(session, text, side)`. A line takes the side it concerns (red = Axis, blue = Allies), decided in `eventSide`: the side that owns the unit or nation it names, so a Polish unit eliminated in an Axis attack is a blue line and a German one an Axis line, whoever attacked (`UNIT_ELIMINATED`, `OVERSTACK_ELIMINATED`, `UNITS_SWEPT`, `HEX_CONTROL_CHANGED` by the taker, `UNITS_MOVED` and `UNITS_ADVANCED` by the owner of the moving units found in the position before the action); the nation declaring (`WAR_DECLARED`: the U.S. joining in Spring 1942 is written while the Axis turn ends and is still Allied), building (`UNIT_BUILT`), giving (`BRPS_GRANTED`) or paying (`BRPS_CHANGED`); the side that chose or whose turn begins (`PLAYER_TURN_STARTED`, `FRONT_OPTION_SELECTED`, `LOSSES_CHOSEN`); the attacker for the attack itself (`COMBAT_RESOLVED`). Only a line that names no owner (or units of both sides) takes the actor's side (`actorSide`: the mover, the side that set up a nation, the computer opponent's own lines, `computerSide`). `Session.logSides` is keyed by index in the append-only log: replacing the log goes through `resetLog`, which clears it too. Plain: the game-started note, "Setup is complete", the initiative line, the end of the game, "You take over...", the e2e loader's note. Colours are CSS variables `--side-axis` (#a3161f, 6.8:1 on the panel paper) and `--side-allies` (#1f4e9c, 7.0:1); the app has one light theme only. Not by colour alone: a 4 px solid bar for the Axis, a dashed one for the Allies. Screen readers get no extra word (the lines already name the nation or the side). Tests: `tests/log-side.test.ts` (19), `tests/e2e/logcolour.spec.ts` (computed colours, contrast, border styles, both computers' lines). Mutation checks: events defaulting to plain (5 fail), the computer's lines given the player's side (3 fail), losses attributed to the actor instead of the chooser (1 fails); review fixes: `WAR_DECLARED` back to the actor (2 fail), unit lines back to the attacker (1 fails).

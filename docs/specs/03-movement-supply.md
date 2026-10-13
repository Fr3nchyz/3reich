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
- A unit entering an enemy ZOC must stop; leaving a ZOC is allowed. Friendly units negate ZOC for supply and movement as the rules say (Ref 6.0).
- The UI can show every ZOC hex for a selected side.

### Supply (steps 6e, 9f to 9h)

- Each ground unit is in supply if it can trace a path of friendly-controlled, enemy-ZOC-free hexes to a supply source (a friendly city or the nation's capital, Ref 10.0), or by sea through supply fleets.
- Supply is checked at the printed steps. A unit out of supply is flagged, shown on the map, and suffers the printed penalty (it cannot attack, and it is eliminated at the check in 9g if still unsupplied; unsupplied airbases are relocated or eliminated in 9h).
- The supply check is deterministic: given a state, it returns the same set of supplied units and the path used.

### Strategic Redeployment (step 9e)

- Units may be redeployed by rail or sea within the printed limits of Ref 11.73 to 11.76: distance or BRP cost, front limits, no redeployment into or through enemy ZOC, and supply required at the end.
- The cost in BRPs comes from spec 02.

### Fortresses and the Maginot and West Wall rules

- Fortress status changes during play (lost when first occupied by the enemy; Maginot Line, West Wall and Sevastopol conditions, Ref 4.8). The current status is part of the game state and shown on the map.

## Rules references

- Ref 4.0 to 4.8 (map, hexsides, terrain, fortresses), 5.0 (stacking), 6.0 (ZOC), 7.0 (control), 10.0 (supply), 11.7 to 11.77 (redeployment, overstacking), 16.0 (conquest), 20.0 (air movement).
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

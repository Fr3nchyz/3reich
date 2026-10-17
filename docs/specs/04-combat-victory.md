# 04. Combat, air and naval operations, strategic warfare and victory

Status: **draft for review. Nothing is built until you say "let's go".** Depends on specs 01 to 03.

> **Update 2026-10-17:** the victory, surrender, conquest and Russian winter parts of this spec are written out, rule by rule and ticket by ticket, in [spec 14](14-victory-surrender-winter.md), using the PC Reference Manual's own numbers: the Russian Winter is 28.0, the Russian surrender 11.8 and 18.41, conquest of Major Powers 18.1 to 18.3 and of minors 16.0 (18.0 is the section on Major Powers). The "Ref 18.0" below is the board-game web numbering. Spec 14 supersedes the Victory and Russian Winter parts here.

## Goal

Armies, air forces and fleets can fight, and the game can end with a result. The combat tables and resolvers already exist and are tested (offensive and attrition results, terrain multipliers, naval and air modifiers); this feature connects them to actions a player can take at the right steps, and adds everything around them: which units fight, who takes losses, retreats, supply effects, strategic warfare, the Russian Winter and the victory conditions.

## Behaviour (what the player or engine does)

### Ground combat (steps 7a to 7p)

- The active side chooses the hexes to attack, the attacking units (at most two per attacking hex, PC README rule 31.5 and 14.23: each unit attacks one hex) and any ground support; the odds and every die roll are shown in the log after the roll (a preview before the roll is not built in the first slice; `attackNumbers` computes it).
- The defender's multiplier comes from terrain, fortress, rivers and crossing arrows, and beaches against a seaborne invasion; benefits do not stack (best one applies).
- The die is rolled from the game's seeded generator, the result is shown with the column and roll, counterattacks chain as the rules say, and the log records every round.
- **Exchange**: the side with fewer factors loses everything; the larger side removes at least as many factors, and the player chooses which units go (the program picks the smallest legal set for the computer).
- **Retreats and advances after combat** follow the rules (PC README rule 18.33: retreat into any eligible hex; there is no preference order).
- **Attrition combat** (7a, 7p): attrition losses and hexes vacated come from the Attrition table; the defender designates hexes one at a time (PC README rule 18.34), and occupation after attrition may not be a capital, capital-port or objective.
- **Exploitation** (7j to 7o): armor may exploit after a won battle; airborne drops in exploitation only happen if armor exploits (PC README rule 31.1).

### Air operations (7b to 7e, 7g, 7i, 7m, 7n)

- Counter-air, defensive air support, ground support, airdrops, and air attacks on naval bases, with the air advantage and nationality modifiers of the existing tables.
- Air losses break counters down to the next available size (PC README rule 28.62 to 28.64).

### Naval operations (6a to 6d, 7b to 7f)

- Fleet movement, interception and counter-interception with the printed interception table, naval combat with the naval advantage and nationality modifiers, bombardment (no losses taken from naval units, PC README rule 29.414), and seaborne invasions (landing step 7f; invasion fleets from different ports count as separate forces, PC README rule 29).

### Strategic warfare and boxes

- Submarines, ASW and SAC factors, the Murmansk and U.S. boxes, and their BRP effects at the Year Start Sequence (spec 02 holds the BRP arithmetic).

### Russian Winter and Russian surrender (II.A, 10a)

- The Winter die roll and its effects on the Eastern Front; the conditions for the Soviet surrender check at the end of a Player Turn.

### Victory and the end of the game

- At the end of the last Game Turn, or when a scenario's immediate condition is met, the engine computes the result from the scenario's victory table and reports it.
- The thresholds are in the original game's victory file and are recorded here in our own words (to be encoded as scenario data):
  - **1939** (Allied side by number of Objectives the Allies hold): Decisive 17 or more, Tactical 16, Marginal 15; Stalemate if the Allies hold 14 or fewer and the Axis 24 or fewer; Axis Marginal 25, Tactical 26, Decisive 27 or more. With the Free Siberian Transfer in effect, the Allied thresholds rise by one (18, 17, 16; Stalemate at 15 or fewer for the Allies).
  - **1942**: Allied Decisive 28 or more, Tactical 27, Marginal 26; Stalemate at 25 or fewer for the Allies and 13 or fewer for the Axis; Axis Marginal 14, Tactical 15, Decisive 16 or more. With the Free Siberian Transfer: Allied 29, 28, 27, Stalemate at 26 or fewer for the Allies.
  - **1944**: decided by when Germany is conquered: Allied Decisive in or before Winter 1944, Tactical Spring 1945, Marginal Summer 1945; Axis Marginal if Germany falls in Fall 1945, Tactical in Winter 1945, Decisive in Spring 1946; no Stalemate.
  - **Campaign**: Allied Decisive by conquering the Axis in or before Summer 1944, Tactical in Fall or Winter 1944, Marginal in Spring or Summer 1945; Stalemate if not conquered by Summer 1945; Axis Marginal by holding at least 28 Objectives at the end of Winter 1943, Tactical by conquering two Allied Major Powers, Decisive by conquering three. With the Free Siberian Transfer the Allied dates move one Game Turn earlier.
  These need checking against Ref 2.0 to 2.4 when built.

## Rules references

- Ref 12.0 (ground combat, attrition, exploitation), 12.1 to 12.4, 13.0 (war), 18.0 (Russian Winter and surrender), 20.0 (air), 21.0 (naval and invasions), 9.0 (strategic warfare), 2.0 to 2.4 (victory).
- Ops 5.46 and its letters, 5.45a to 5.45d, 5.49a.
- PC README: rules 14.23, 14.24, 18.31 to 18.34, 28.62 to 28.64, 29, 29.414, 29.437, 31.1, 31.5; "Partisans, variants, Gibraltar and Russo-Allied cooperation are not implemented in the PC game".

## Open questions (also add to docs/RULES.md)

- Whether to implement air and naval combat in one release or split (proposal: ground combat and attrition first, then air, then naval and invasions).
- Odds rounding below 1:1 and a few other table guesses are being checked against the game's own tables (ticket T03).
- Retreat details when no legal hex exists, and the stacking of retreating units.
- The exact conditions of Russian surrender and of "conquered" for a Major Power (needed for the victory table).
- Which rules of the board game the PC game dropped (the README lists many; each needs a decision recorded in docs/RULES.md).

## Done when

1. A full Player Turn of all ten steps can be played by the engine with combat in it, from a recorded list of actions, with the same result every time from the same seed.
2. Each combat result type (A, D, Ex, CA, CA1, CA2, CA3) is reached in a test, including a counterattack chain, with correct losses and retreats.
3. Terrain multipliers are tested for plain, mountains, swamp, river, fortress, beach and seaborne invasion, and "best one applies".
4. Attrition: the table lookup, designating hexes one at a time, and the no-capital-occupation rule are tested.
5. Air and naval modifiers and interception are covered by tests wired through actions.
6. Victory results for all four scenarios are tested at every threshold boundary (for example 16, 17 and 18 Objectives in 1939).
7. Mutation checks: changing a multiplier, a column boundary, a loss rule or a victory threshold each makes a test fail.

## As built (ground combat, roadmap 6.1)

Only the ground-combat slice of this spec is built. The combat step on the card is **7h** ("Resolve normal ground combat"); it is in `IMPLEMENTED_STEPS` and the engine waits there only while an attack is legal (like steps 1, 8b and 9a).

- **Actions** (`src/engine/attack.ts`, `attack-losses.ts`, `attack-rules.ts`, `combat-record.ts`):
  - `ATTACK { side, units, target }`: ground units (infantry, armor, airborne, replacement) of the side to move, each on a hex next to `target` across a hexside ground units may attack over (land on both sides or a crossing arrow, never Qattara), against an adjacent hex holding an enemy ground unit. Each unit attacks once a turn (PC README 14.23) and each hex is attacked once (`ONE_ATTACK_PER_HEX`, TODO(verify)). The odds come from attacker factors against defender factors times the multiplier (`defenseMultiplier`: plain x2, mountains/swamp x3, river or crossing arrow x3 only if every attacker is across it, fortress x4, best one applies). The die is the game's seeded generator through `resolveOffensiveCombat`, so a recorded game replays exactly. The result is applied at once. `legalActions` lists one attack per target with every unit that can reach it, plus each source hex alone; `applyAction` accepts any non-empty subset.
  - `ALLOCATE_LOSSES { side, units }`: after an Exchange (Ref 12.2) the smaller side loses everything (both, if equal) and the larger removes at least that many factors. The owner picks which units go; only sets in which no unit could be spared are legal. When only one such set exists it is taken at once. Until it is chosen nothing else (not even moving on) is legal. The chooser may be the non-active side, so `legalActions` then lists actions for that side. On the original attack the defenders count at their multiplier; on a counterattack's Exchange both sides count basic factors.
  - `ADVANCE { side, units, to }`: survivors of an attack may move into the hex the defenders left empty, once, within the stacking rules of setup (`stackingProblem`: two ground units, airborne not counted, no British with French before 1942, London). `legalActions` considers the first 12 survivors. Optional and not blocking.
- **State**: `GameState.combat` (optional; keyed by Game Turn and side so a new Player Turn starts empty).
- **Events**: `COMBAT_RESOLVED` (odds, every round), `UNIT_ELIMINATED`, `LOSSES_CHOSEN`, `UNITS_ADVANCED`.
- **Hooks for other workers** (`attack-rules.ts`, all `TODO(verify)`): `isSupplied` (supply, Ref 19 in the web text, not 10; kept true on purpose because Ref 19.4 there lets unsupplied units attack, TODO(verify) against the PC manual), `frontAllowsAttack` (Offensive Option on the Front, Ref 11.2) both return true; control of the hex taken, ZOC, fortress loss on occupation and rebuilding of eliminated units are not done.
- **Open rule questions**: whether Replacement counters attack and defend; a hex attacked only once; whether the defenders' multiplied value is what they remove when they are the larger side in an Exchange; advance after combat (who, how many, ZOC); who is "at war" for minor forces and Minor-Allies (patrons' wars are used); what happens to air units, fleets or airbases left alone in a captured hex (built as destroyed, `ALONE_NONGROUND_DESTROYED`, TODO(verify)).
- **Not built**: retreat (the offensive CRT has none; attrition retreats belong to 7a/7p), air and naval support, seaborne invasions, exploitation, attrition combat, a tap-to-attack screen (the UI shows one button per legal attack, labelled with unit ids).

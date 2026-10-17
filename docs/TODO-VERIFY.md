# TODO(verify) audit

Every place where the code marks a rule or a guess as unverified, what each one assumes, whether `docs/RULES.md` lists it as an open question, and which tests treat the guess as settled. Written for a reader who does not code. Status as of `main` 985f156.

## Summary

1. **57 distinct assumptions** sit behind the 74 `TODO(verify)` marker lines in `src/`. Repeats (the same constant named in several files) are merged into one row.
2. **12 are not in `docs/RULES.md` open questions at all** (rows marked MISSING below). A further **5 are listed only in part** (rows marked PARTLY). The 12 missing ones have a matching line added to the open-questions list.
3. **The 10 that most affect play:** the zone-of-control rules (armor only? does a friendly unit cancel it?), air and fleets destroyed with no roll when a port's last infantry falls, survivors advancing after a win, terrain costing 1 everywhere, a stack moving at its slowest unit's speed, neutral land being closed, one attack per hex, unsupplied units attacking and the supply sources, unspent BRPs being dropped at year end, and one move per unit per turn. Details in the "Top 10" section.
4. **Tests that treat guesses as settled:** several tests pin an open assumption without saying so. The worst is `tests/zoc.test.ts` (lines 64-66), which asserts that infantry, armor and airborne all project zones of control; the RULES.md CONFLICT line says the printed text gives that only to armor. The full list is in part 3.
5. **Questions for Frank** (who knows the original game) are at the end. Ten of them cover most of the open play rules.

## Part 1. Every assumption, by area

Columns: ID, where in `src/` (file and line), the named constant or branch, what is assumed in plain English, and whether `docs/RULES.md` "Open questions" covers it. "Listed" means the matching line is named in the open questions; the quote is given.

### Ground combat

| ID | Where | Name | What is assumed | In RULES.md open questions? |
|---|---|---|---|---|
| G1 | `src/engine/attack-rules.ts:19` (TODO at :16; also `src/ui/hexCard.ts:56`) | `GROUND_COMBAT_TYPES` | Replacement counters attack and defend like other ground units. | Listed: "whether Replacement counters attack and defend like other ground units (they do now)" (line 173). |
| G2 | `src/engine/attack-rules.ts:26` (TODO at :23) | `ONE_ATTACK_PER_HEX` | A hex can be attacked only once per Player Turn. The manual text is not in the repo; the PC README only says each unit attacks one hex. | Listed: "whether a hex may be attacked only once per Player Turn (`ONE_ATTACK_PER_HEX`...)" (line 173). |
| G3 | `src/engine/attack-rules.ts:33` (TODO at :30; also TODO at `attack.ts:17`, `attack.ts:149`, `attack-losses.ts:48`, `action-types.ts:28`) | `ADVANCE_AFTER_COMBAT` | Survivors that attacked may move, once, into the hex the defenders left, within the stacking rules. Who may advance, how many, and whether zone of control applies are not in the repo's rule text. | Listed: "the advance after combat (`ADVANCE_AFTER_COMBAT`: who may advance, how many, ZOC...)" (line 173). |
| G4 | `src/engine/attack-rules.ts:44` (TODO at :40) | `ALONE_NONGROUND_DESTROYED` | Air units, airbases and fleets left alone in a hex are destroyed when the last ground defender goes, with no dice roll. The product owner confirmed it; the PC manual has not been checked. Side effect: one infantry unit can wipe an ungarrisoned port's air units and fleets (Scapa Flow, Wilhelmshaven and others). The computer does the same to the human's units. | Listed: "what happens to air units, fleets or airbases left alone in a hex ... (`ALONE_NONGROUND_DESTROYED`...)" (line 173), including the side effect. |
| G5 | `src/engine/attack-rules.ts:51` (TODO at :49) | `isSupplied` (stub, always true) | An unsupplied unit keeps its full strength and may attack. | Listed: "the stubs `isSupplied` (kept true: Ref 19.4 lets unsupplied units attack)" (line 173); also line 160 "unsupplied units attack". |
| G6 | `src/engine/attack-rules.ts:54` (TODO at :53) | `frontAllowsAttack` (stub, always true) | Every Front allows its side to attack; the Offensive Option check (Ref 11.2) is not wired. | Listed: "the stubs ... `frontAllowsAttack` (Offensive Option on the Front, Ref 11.2), which allow everything" (line 173). |
| G7 | `src/engine/attack-rules.ts:75` (TODO at :73) | `isEnemy` | Two owners fight when their sides are at war. Alliance wars (Ref 13.0) are not modelled. | Listed: "alliance wars of Ref 13.0 are not modelled" (line 173). |
| G8 | `src/engine/attack.ts:19` | Not-built list | Air and naval support, seaborne invasions and exploitation (7j-7o) are not built. | PARTLY: exploitation (12.3) and air and naval (20-21) appear as "not yet encoded" (line 177). Seaborne invasions are not listed. |
| G9 | `src/engine/attack-losses.ts:89` and `:116` (`exchangeCost`, `applyOutcome`) | Exchange arithmetic | In an Exchange, when the defenders are the larger side, they remove factors at their multiplied (terrain) value. | Listed: "in an Exchange, whether the defenders remove factors at their multiplied value when they are the larger side" (line 173). |
| G10 | `src/engine/attack.ts:149` | Control on advance | An advance into an emptied hex changes its control the same way a move does. | Listed: "control of a hex taken" (line 173). |

### Movement, zones of control, control of hexes, stacking

| ID | Where | Name | What is assumed | In RULES.md open questions? |
|---|---|---|---|---|
| M1 | `src/engine/movement.ts:29` (TODO at :20 and :28; also `src/ui/moveText.ts:11`) | `TERRAIN_MOVE_COST` | Entering any terrain costs 1 movement point. Mountains and swamps are not dearer. The repo's terrain chart gives defence only. | Listed: "the cost of entering terrain (the repo's rule text gives defence only, so every hex costs 1: `TERRAIN_MOVE_COST`)" (line 174). |
| M2 | `src/engine/movement.ts:32` (TODO at :21 and :31; also `src/ui/moveText.ts:34`, `src/engine/move-options.ts:13`) | `ONE_MOVE_PER_TURN` | Each ground unit moves at most once per Player Turn. | Listed: "whether each unit moves once per Player Turn (`ONE_MOVE_PER_TURN`, on now)" (line 174). |
| M3 | `src/engine/movement.ts:54` (TODO at :22 and :53) | `NEUTRAL_LAND_CLOSED` | Land of a minor country not at war with the mover, and land held by a power that takes no side, cannot be entered. | Listed: "land that is closed to movement (`NEUTRAL_LAND_CLOSED`...)" (line 174). |
| M4 | `src/engine/movement.ts:39` (TODO at :35 and :77) | `STACK_MOVES_AT_SLOWEST_UNIT` | A stack moves at the factor of its slowest unit. | Listed: "whether a stack moves at its slowest unit's factor and may be split" (line 174). |
| M5 | `src/engine/movement.ts:45` (TODO at :42) | `MIXED_NATIONS_MOVE_TOGETHER` | Units of different nations (for example Germans with Italians) may move as one group. Before 1942 only British and French are kept apart (Ref 26.0). | Listed: "units of different nations may move as one group (`MIXED_NATIONS_MOVE_TOGETHER`, fact 3)" (line 174). |
| M6 | `src/engine/movement.ts:51` (TODO at :48 and :114) | `STACKING_CHECKED_ONE_AT_A_TIME` | Stacking at the end of a move is checked one unit at a time, each one seeing those before it. | Listed: "stacking at the end of a move is counted one unit at a time (`STACKING_CHECKED_ONE_AT_A_TIME`, fact 9)" (line 174). |
| M7 | `src/engine/move-action.ts:23` (TODO at :20) | `CONTROL_ON_PASS_THROUGH` (off) | Control of a hex changes only where a move ends, not on hexes the unit only passes through. | Listed: "whether control changes on hexes only passed through (`CONTROL_ON_PASS_THROUGH`, off now...)" (line 174). |
| M8 | `src/ui/moveText.ts:29` (`cannotMoveReason`; TODO at :27) | Replacements | Replacement counters do not move on the ground (they print no movement factor). | MISSING. Line 174 covers the moving types but never asks about replacements. |
| M9 | `src/engine/zoc.ts` (`ARMOR_ZOC_TYPES`, spec 13) | Armor only reaches the adjacent hexes; airborne counts as a ground unit for the rule that every ground unit holds its own hex. | Built from Ref 7.0 on 2026-10-16. Open: airborne as a ground unit; armor ZOC across a Qattara hexside (7.0 names only water, Crossing Arrow, Fortress). | Listed in docs/RULES.md (ZOC entry). |
| M10 | `src/engine/zoc.ts` (`ZOC_POLICY`, `ZOC_EXIT_COST`) | Friendly units do not negate enemy ZOC; leaving a hex in enemy armor ZOC costs 2 more. | Built from Ref 7.0 on 2026-10-16. Open: +2 in 7.0 against +3 in the 12.31 example; a unit that cannot pay the exit cost plus its step cannot leave. | Listed in docs/RULES.md (ZOC entry). |
| M11 | `src/engine/zoc.ts:19` | Air, naval and airborne ZOC | A zone of control does not stop air movement, naval movement or airborne drops. | MISSING. Line 174 says these are "not built", which is not the same as asking whether ZOC applies. |
| M12 | `src/engine/zoc.ts:37` (`canCross`; TODO at :34) | Coast hexsides | 25 hexsides where the coast reaches only one end are land-crossable in the original but not on our map (and K32-K33 the reverse). | Listed: "Open: 25 hexsides where the coast reaches only one end are crossable by land" (line 191). |
| M13 | `src/engine/stacking.ts:14` | Ref 26.0 sharing ban | The British and French ban on sharing a hex before 1942 is a restriction on where a move may end, not a reason to eliminate counters. | MISSING. Line 174 says "Anglo-French sharing is refused only where a move ends" as a built fact, not as a question. |
| M14 | `src/engine/stacking.ts:16` | Overstack elimination | When a hex is over its limit, the owner may eliminate only enough counters to bring it within the limit (steps 6g and 9j). | MISSING. Line 174 says overstack elimination "is not wired"; it does not ask what the manual allows. |
| M15 | `src/engine/stacking.ts:50` | Air and fleet limits | Air units in flight and fleets at sea have no stacking limit of their own; only air units at a base and fleets in a port are limited. | MISSING. |
| M16 | `src/engine/control.ts:16` | Control on entry | Control changes when a ground unit enters an enemy-controlled hex. Whether a unit that is later overrun keeps the hex is not settled. | PARTLY. Passing through is listed (`CONTROL_ON_PASS_THROUGH`, line 174). "Later overrun keeps the hex" is not. |
| M17 | `src/engine/control.ts:19` | Ref 16.0 minor conquest | Conquering a minor country hands over the whole country at once (capital and all objectives), and uncontrolled land such as the Baltic States changes hands the same way. | MISSING. The number Ref 16.0 is not mentioned anywhere in the open questions. |
| M18 | `src/engine/control.ts:25` (TODO at :24) | `CONTROL_CHANGING_TYPES` | Only infantry, armor and airborne can take control of a hex. Replacements cannot move; air units and fleets never take a hex. | MISSING. |
| M19 | `src/engine/control.ts:61` (`sideInWar`; TODO at :58) | Vichy forces | Vichy France is neutral (takes no side) until its forces are attacked. | MISSING. "Vichy" appears in the open questions only for the naval DRM and the British-through-Vichy supply limit. |

### Economy and grants

| ID | Where | Name | What is assumed | In RULES.md open questions? |
|---|---|---|---|---|
| E1 | `src/engine/yearstart.ts:26` (TODO at :23) | `KEEP_UNUSED_BRPS` (off) | BRPs a nation did not spend by the end of the year are dropped, not kept in its new total. They only feed the growth. | Listed: "`KEEP_UNUSED_BRPS` (`yearstart.ts`): whether BRPs a nation did not spend by year end also stay in its new total" (line 163). |
| E2 | `src/engine/yearstart.ts:55` and `:56` | "Unused BRPs" | The whole BRP total at year end (including Minor-Ally BRPs and grants received) is the base for growth. | Listed: "whether growth is taken on the whole total (including Minor-Ally BRPs and grants received)" (line 164). |
| E3 | `src/engine/yearstart.ts:42` (TODO at :40) | `minorAllyBrps` | Each Minor-Ally's own BRP value; the scenario gives only the sum for all of them. | Listed: "Each Minor-Ally's own BRP value" (line 165). |
| E4 | `src/engine/yearstart.ts:15` | Not built | Strategic warfare, the BRPs of conquered countries, and Germany's +15 and the U.S.S.R.'s -15 for Moscow and Leningrad are not built. | PARTLY. Line 177 lists "strategic warfare (9)" only. The +15 and -15 and the conquered-country BRPs are not listed. |
| E5 | `src/engine/brps.ts:33` (`charge`) | Automatic declarations | A charge the rules make without the player choosing (an automatic declaration of war) does not count towards the nation's spending limit. | MISSING. |
| E6 | `src/engine/grants.ts:16` | Grant blocking | A grant cannot travel while an enemy unit stands next to either capital (except for the U.S.S.R.), and each 20 BRPs granted count as one Strategic Redeployment. | MISSING. Line 175 asks to confirm the cap and the timing rules, not this blocking rule. |
| E7 | `src/engine/frontoptions.ts:17` | Offensive Option payer and timing | Any Major Power of the side with enough BRPs pays for an Offensive Option; the cost counts towards the spending limit; a choice cannot be changed within step 3. | Listed: lines 166 (which Major Power pays), 167 (counts towards the limit) and 168 (can it be changed in step 3). |
| E8 | `src/engine/frontoptions.ts:27` (TODO at :26) | `DEFAULT_FRONT_OPTION` (defensive) | A Front with no choice made is under the Defensive Option (no attacks). | Listed: "The Option for a Front with no choice (built: Defensive)" (line 169). |

### Computer opponent policy (not rules; tuned by play-testing)

| ID | Where | Name | What is assumed | In RULES.md open questions? |
|---|---|---|---|---|
| C1 | `src/ai/grant.ts:14-15` (TODO at :12) | `GRANT_RECEIVER_BELOW` (60), `GRANT_STEP` (10) | When the computer grants BRPs, and in what steps. | Listed: "the grant thresholds (`GRANT_RECEIVER_BELOW`, `GRANT_STEP`)" (line 176). |
| C2 | `src/ai/geo.ts:17` (TODO at :15) | `OBJECTIVE_FEATURES` | Which hexes are worth taking: capitals, capital ports and objectives. | Listed: "`OBJECTIVE_FEATURES`: capital, capital-port, objective" (line 176). |
| C3 | `src/ai/assault.ts:19-24` (TODO at :12) | `ATTACK_MIN_COLUMN`, `ATTACK_SUPERIORITY`, `ATTACK_MIN_COLUMN_SUPERIOR`, `ATTACK_MAX_EXCHANGE_FACTORS`, `ATTACK_MAX_PER_TURN` | How good the odds must be, how many factors an Exchange may cost, and how many attacks per turn. | Listed: "Attacks at 7h (`src/ai/assault.ts`)..." (line 176). |
| C4 | `src/ai/declare.ts:23` (TODO at :13) | `DECLARATION_PLANS` | The dates the computer declares war: Italy on France and Britain from Summer 1940, Germany on the U.S.S.R. from Summer 1941. | Listed: "the declaration plans and their dates (`DECLARATION_PLANS`...)" (line 176). |
| C5 | `src/ai/declare.ts:56-57` (TODO at :52) | `STAGING_ENABLED`, `STAGING_LEAD_TURNS` | Units with no route to an objective wait at the border of a neutral country the computer plans to attack, starting two Game Turns before the date. | Listed: "`STAGING_LEAD_TURNS` = 2 Game Turns ... switch `STAGING_ENABLED`" (line 176). |
| C6 | `src/ai/build.ts:19` (TODO at :17) | `BUILD_PRIORITY` | The order in which the computer builds unit types. | Listed: "the build priority list (`BUILD_PRIORITY`)" (line 176). |
| C7 | `src/ai/move.ts:31-35` (TODO at :17) | `MOVE_MIN_PROGRESS`, `MOVE_MAX_UNITS_PER_TURN`, `MOVE_MAX_ENEMY_RATIO`, `MOVE_KEEP_CAPITAL_GARRISON`, `MOVE_NO_RETURN_TURNS` | How far a move must make progress, how many units move per turn, how many enemy factors a unit may stand beside, the capital garrison, and the no-return rule. | Listed: all five named in line 176. |
| C7b | `src/ai/lines.ts`, `src/ai/doomed.ts` | `MOVE_PREFER_SUPPLY`, `LOSSES_CUT_OFF_FIRST`, `ATTACK_DOOMED_IGNORE_EXCHANGE` | While the supply effects are on: the computer prefers moves that keep a stack supplied, gives up first in an Exchange the units the end of the turn will eliminate for supply, and lets units that will be eliminated for supply attack without the Exchange limit. Policy, not rules; measured in spec 05. | Listed: the computer policy bullet. |

### Supply

| ID | Where | Name | What is assumed | In RULES.md open questions? |
|---|---|---|---|---|
| S1 | `src/engine/supply.ts:23` | Supply sources and tracing | Which sources count (capitals only as land sources, minor capitals only if they fight on that side, captured capitals supply their captor), which sources are not built yet, the numbering (Ref 19.x vs 10.0), French and British limits, any maximum line length, and whether a unit's own hex must be friendly. | Listed: the supply bullet (line 160), which names each item. |
| S2 | `src/engine/supply.ts:116` (`seaSupplyLine`; TODO at :113) | Sea supply (19.31) | Designation of fleets, naval factors as capacity, port pairs, transfer points (Gibraltar, Kiel, Istanbul) and interception. Currently a stub that supplies nothing by sea. | Listed: "sea supply (19.31) is a stub" (line 160). |
| S3 | `src/engine/supply-effects.ts` (`SUPPLY_EFFECTS_ENABLED`, off) | Supply effects | Whether a unit unsupplied at the end of its Player Turn is eliminated (19.4) or only one also unsupplied at its start (11.74, built); supply read once at the start of the Player Turn (19.1 says after naval movement). With only capitals as main sources, Germany's units die within a turn once Berlin falls: does the original give another source? | Listed: the "Supply effects" bullet. |

### Fleets and naval warfare (spec 12, draft; not in `src/` yet, so not counted in the summary above)

Added 2026-10-16 from `docs/specs/12-fleets-naval.md` (rows N1 to N34; the spec's releases are I to IV, so no id collides). The rule numbers are the spec's (R1 to R21); the rule text is the PC Reference Manual 19.31 and 21.x, paraphrased. Each row has a matching bullet in `docs/RULES.md` ("Fleets and naval warfare open items"). Related existing rows: G4 (the sweep that destroys fleets), M15 (fleet stacking at sea), S2 (the sea-supply stub).

| ID | Where | Name | What is assumed | In RULES.md open questions? |
|---|---|---|---|---|
| N1 | spec 12 R1 | `FLEET_COUNTER_SIZES` = 1, 2, 6, 9 | Which partial fleet counters exist. The manual's own example uses 9, 6, 2 and 1; whether 3, 4, 5, 7 or 8 exist is not stated. | Listed ("Fleets and naval warfare open items"). |
| N2 | spec 12 R1, R12 | Combining and break-down | Whether partial fleets may be combined outside Strategic Redeployment, and whether the total lost may exceed the amount owed when the right small counter is missing (the manual says more is lost). | Listed ("Fleets and naval warfare open items"). |
| N3 | spec 12 R2 | Port capacity | 36 factors per port, 9 for Malta, Suda Bay and Famagusta; 72 for a hex with two ports, of which our map has none. | Listed ("Fleets and naval warfare open items"). |
| N4 | spec 12 R3 | `PORT_FRONTS` | The Front of the water each port opens on. Batum, Vigo, Cadiz, Rostock, Gibraltar and Istanbul touch water of two Fronts in our data; Stettin, La Coruna and Haifa touch no water hexside; Marseilles and Constanta are on one Front by land and another by water. | Listed ("Fleets and naval warfare open items"). |
| N5 | spec 12 R3 | Black Sea and Baltic Fronts | Which Front the Black Sea ports count as (read: Eastern for the northern ones) and that Suez city is a two-Front port for escorts only. | Listed ("Fleets and naval warfare open items"). |
| N6 | spec 12 R4 | `mayBasePort` | Base bans for fleets: Free French and Vichy; the German and Italian ban before they are allied against the same Major Power. | Listed ("Fleets and naval warfare open items"). |
| N7 | spec 12 R5 | One function per Game Turn | A fleet does one thing in a full Game Turn, read as Game Turn (the manual's words), not Player Turn; a fleet that intercepted in the other side's earlier Player Turn cannot supply in its own. | Listed ("Fleets and naval warfare open items"). |
| N8 | spec 12 R6 | Second designation | A fleet designated at step 6e may be designated again at 9f for its unused factors. | Listed ("Fleets and naval warfare open items"). |
| N9 | spec 12 R6 | Capacity charged when named | A unit named in a designation uses the fleet's capacity even if it later moves back to a normal supply line. | Listed ("Fleets and naval warfare open items"). |
| N10 | spec 12 R7 | Port and destination in a zone | Whether the fleet's port must be supplied at designation or at the final check, and whether a port or destination in an enemy armor zone still works (read as for a unit or a source: yes). | Listed ("Fleets and naval warfare open items"). |
| N11 | spec 12 R7 | One-hex islands | Which islands are playable one-hex islands for supply and invasion. Malta and Scapa Flow are named in Ref 4.9; the map data has no list and a guess from hexsides fails for Sardinia. | Listed ("Fleets and naval warfare open items"). |
| N12 | spec 12 R7 | Libyan ports | Libyan ports supply Axis units with no fleet (as built in `supply-sources.ts`), against the last paragraph of Ref 31.0, which says supply must still come by Axis fleets to the ports. | Listed ("Fleets and naval warfare open items"). |
| N13 | spec 12 R7 | Africa 18-factor limit | The 18-factor limit on German supply in Africa and Malta's naval and air factors (Ref 31.0) is not built; fleets make it possible. | Listed ("Fleets and naval warfare open items"). |
| N14 | spec 12 R8 | Supply read at 6e | Supply is read once when 6e is left (replacing the record taken at the start of the turn), not only at the start; eliminations stay at the end of the Player Turn. | Listed ("Fleets and naval warfare open items"). |
| N15 | spec 12 R9 | "Nearest" port | The nearest friendly port for a displaced fleet is measured by the shortest sea route (not straight distance or land). | Listed ("Fleets and naval warfare open items"). |
| N16 | spec 12 R9 | Equal distance | First slice breaks ties by the lowest hex id; the manual lets the owner choose. | Listed ("Fleets and naval warfare open items"). |
| N17 | spec 12 R9 | Fleet on a mission | A fleet away on a mission when its port falls is treated as in port (as air, Ref 20.2); a displaced fleet keeps its function for the Game Turn. | Listed ("Fleets and naval warfare open items"). |
| N18 | spec 12 R9 | Other captures | Attrition occupation, conquest and the fall of France use the same displacement; the special Vichy and Italian fleet rules are out of scope. | Listed ("Fleets and naval warfare open items"). |
| N19 | spec 12 R10 | `ONE_BASE_CHANGE_PER_TURN` | A fleet changes base once in a Movement Phase. | Listed ("Fleets and naval warfare open items"). |
| N20 | spec 12 R10 | Pass Option test | How the four-hex distance from enemy planes is measured along the course, and that the enemy-fleet test is about the fleet's Front. | Listed ("Fleets and naval warfare open items"). |
| N21 | spec 12 R10 | What is one force | One `MOVE_FLEET` action is one force; fleets from different ports are separate forces for interception (Peele). | Listed ("Fleets and naval warfare open items"). |
| N22 | spec 12 R10 | Suez Canal | Passable by fleets only while the hexes beside it are friendly; the damage clock and the PC differences (Peele 47.3 and 47.4) are not built. | Listed ("Fleets and naval warfare open items"). |
| N23 | spec 12 R11 | Interception distance | Counted as the length of the shortest sea route from the base to the interception hex. | Listed ("Fleets and naval warfare open items"). |
| N24 | spec 12 R11 | Who may intercept | The interceptor must be based on the same Front as the course; fleets in the U.S. Box count as distance 30+ and may intercept only once the U.S.A. is at war. | Listed ("Fleets and naval warfare open items"). |
| N25 | spec 12 R12 | `NAVAL_LOSS_CHOICE` | The owner chooses which fleets lose factors (people), automatic for the computer; the manual says only to use the fewest partial units. | Listed ("Fleets and naval warfare open items"). |
| N26 | spec 12 R13 | Non-participants | Fleets at a base that took no part in a naval battle are not hurt (only Counter-Air hurts non-participants). | Listed ("Fleets and naval warfare open items"). |
| N27 | spec 12 R12 | 18-factor multiplier | The multiplier for a loser with 18 or more factors is read as its factors divided by nine. | Listed ("Fleets and naval warfare open items"). |
| N28 | spec 12 R12 | Italy row N | That the program's row argument for Italy's modifier is the battle hex's row was read by hand, not reproduced by the script (docs/GAME_DATA.md). | Listed ("Fleets and naval warfare open items"). |
| N29 | spec 12 R14 | Air attacks on ports | Counter-Air before ship attack including at Malta (Peele), and who picks the fleet factors lost. | Listed ("Fleets and naval warfare open items"). |
| N30 | spec 12 R15 | Air against fleets at sea | Whether the Option matters (Ref 20.431 says no, 20.52 names Offensive and Attrition) and that supply carriers are as immune to planes as to fleets. | Listed ("Fleets and naval warfare open items"). |
| N31 | spec 12 R19 | Naval missions and Options | Naval missions use `frontAllowsAttack` (the Offensive Option of the Front that receives the action), not wired. | Listed ("Fleets and naval warfare open items"). |
| N32 | spec 12 R16 to R18, R20 | Outlined rules | Shore Bombardment, Sea Transport, Seaborne Invasion and the U.S. Box rules are only outlined; their open items are listed when the addendum is written. Fleets in the U.S. Box are inert in release I. | Listed ("Fleets and naval warfare open items"). |
| N33 | spec 12 R5 | Supply fleet and Strategic Redeployment | Whether a fleet that carried supply may be redeployed: Ref 21.3 excepts only escort jobs from the bar, Ref 11.72 says a fleet that gave sea supply cannot be redeployed. Nothing is built; recommended when SR exists: the stricter reading (cannot). | Listed ("Fleets and naval warfare open items"). |
| N34 | spec 12 R8 | `ELIMINATE_ONLY_IF_CUT_OFF_AT_START` (`src/engine/supply-effects.ts`) | Which list the end-of-turn elimination reads once supply is re-read at 6e: the list taken when 6e was left replaces the at-start list, so only units cut off then and still cut off at the end are eliminated (Ref 19.4 says any unit unsupplied at the end, Ref 11.74 says unsupplied at the start and the end; already open as the supply-effects item in RULES.md, now with a spec-12 id). | Listed ("Supply effects"). |

### Air units (spec 09)

| ID | Where | Name | What is assumed | In RULES.md open questions? |
|---|---|---|---|---|
| A1 | `src/engine/air-missions.ts` (`designateProblem`, `airInRangeOf`) | Nationality of ground support | Any air unit of the side to move may fly ground support to any hex the side can attack, whatever the nations of the planes and of the attackers. The rule text (Ref 20.41) has not been checked for a nationality match. | Listed ("Ground support and nationality"). |

### Map data and scenario rules

| ID | Where | Name | What is assumed | In RULES.md open questions? |
|---|---|---|---|---|
| D1 | `src/data/islands.ts:10` | Sicily's coastal slivers | DD19 and EE19 are land in the original. | Listed as VERIFIED on line 187 ("the coastal slivers ... DD19 and K25 are land in the game too"). The code marker is stale and can be removed. |
| D2 | `src/data/zones.ts:56` | Atlantic ports | Gibraltar (AA7), on the strait, counts as an Atlantic port. No German fleet can start there, so it does not matter yet. | Listed: "whether Gibraltar (on the strait) counts as an Atlantic port" (line 178). |
| D3 | `src/data/scenario-1939.ts:59`, `src/data/scenario-campaign.ts:67` | Germany's free Eastern Front Offensive | The free Offensive Option (Ref 29.0) is for the Fall 1939 turn only. | Listed: "whether Germany's free Eastern Front Offensive Option (Ref 29.0) is for the first turn only" (line 170). |
| D4 | `src/data/scenario-1942.ts:160` | German units in Libya (1942) | Germany may start only 7 factors (one 4-6 armor and one 3-3 infantry) west of the start line in Libya. | Listed: "whether the original lets more German units start in Libya" (line 179). |

### Setup, war, construction and minor forces (other)

| ID | Where | Name | What is assumed | In RULES.md open questions? |
|---|---|---|---|---|
| O1 | `src/engine/setup.ts:18` | Force Pool at setup | Every Force Pool counter must be placed at setup; the manual does not say a nation may hold some back. | Listed: "a nation must place every Force Pool counter at setup (the manual does not say it may hold some back)" (line 184). |
| O2 | `src/engine/setup.ts:20` | Bessarabia ban | Germany may not set up in Bessarabia in Fall 1939 (Ref 29.0). The ban is not enforced yet. | Listed: "Germany's ban on setting up in Bessarabia in Fall 1939 (Ref 29.0) is not enforced yet" (line 184). |
| O3 | `src/engine/tables.ts:92` | `navalNationalityDrm` for Vichy and Free French fleets | A Vichy or Free French fleet gets the same naval DRM (0) as France. The original routine may give it -2. | Listed: line 171 ("Vichy and Free French naval nationality DRM"). The Web research table (line 148) also states the chart value. | |
| O4 | `src/engine/war.ts:12` and `src/engine/minors.ts:9` | Minor forces | When a minor country is attacked, its forces appear; the rules for who places them, where, and how they stack are not in the text. Also unsettled: the rule that a declaration on a minor must be followed by a move or attack that turn (or be revoked and the BRPs lost), and the 35-BRP price when that brings war with a Major Power. | PARTLY. Line 177 lists "minor countries' set-up and activation (14-17)" and "DoW and alliances (13)" generically. The revocation rule and the 35-BRP price are not listed. |
| O5 | `src/engine/war.ts:89` | Neutral Major Powers joining a side | A neutral Major Power that is at war joins its own side (Italy for the Axis; the U.S.A. and U.S.S.R. for the Allies). Other alliances are not built. | Listed: "a neutral Major Power (Italy in 1939) has no side in the engine" (line 176), and "DoW and alliances (13)" (line 177). |
| O6 | `src/engine/construction.ts:16` | Unit construction placement | A new unit must stand in a supplied hex that its nation controlled at the start of the turn and that is not in an enemy zone of control (Ref 11.64). Not built; currently any empty hex in the home territory with no enemy next to it. | MISSING. |

### User interface (display only, or stands in for an engine rule)

| ID | Where | Name | What is assumed | In RULES.md open questions? |
|---|---|---|---|---|
| U1 | `src/ui/attackPreview.ts:67` | `PreviewModifier` (column shift) | The original game may apply a column shift to a ground attack, beyond the factor and terrain modifiers the engine uses. The engine has no such source today. | MISSING. |
| - | `src/ui/moveText.ts:11`, `:27`, `:34`; `src/ui/hexCard.ts:56` | Display text | These repeat rows M1 (terrain cost, so "3 hexes" is true), M8 (replacements do not move), M2 (one move per turn) and G1 (replacements fight). They add no new assumption. | See M1, M8, M2, G1. |

## Part 2. What the open-questions list says, and what is missing

- **Listed in full** (40 rows): every row above whose status says "Listed". The open-questions list in `docs/RULES.md` (lines 156-193) names each one, either by constant or by the question itself.
- **Listed in part** (5 rows): G8, M10, M16, E4 and O4. The main question is named; the sub-question in the row is not.
- **MISSING** (12 rows): M8, M11, M13, M14, M15, M17, M18, M19, E5, E6, O6 and U1. Each has a matching question added to the end of `docs/RULES.md` as one line, citing the constant or file. No existing line was changed.
- **Stale marker** (1 row): D1. The map audit has already settled Sicily's slivers, but the code comment still says TODO(verify). Remove the marker.

## Part 3. Tests that treat an open assumption as settled

A test "pins" an open assumption when it asserts the current guess as if it were the rule. The column "Test comment says open?" says whether the test itself warns about this.

| Assumption (row) | Test (file:line) | Test comment says open? | Note |
|---|---|---|---|
| TERRAIN_MOVE_COST (M1) | `tests/movement.test.ts:34-35` | Yes: "terrain costs 1 everywhere until the chart is read (TODO(verify) in movement.ts)". | Pins 1 for every terrain. |
| ONE_MOVE_PER_TURN (M2) | `tests/movement.test.ts:164-166` | No. "one move per unit per Player Turn" is asserted as settled. | `tests/move-options.test.ts:246` does flag it. |
| ONE_ATTACK_PER_HEX (G2) | `tests/ground-combat.test.ts:269-270`; `tests/lone-units.test.ts:58` | No. The header cites "PC README 14.23", but that section says each unit attacks one hex, not that a hex is attacked once. | Pins an open question under a citation that does not support it. |
| ADVANCE_AFTER_COMBAT (G3) | `tests/ground-combat.test.ts:303` | Yes (describe name: "the rule text is not in the repo"). | |
| ALONE_NONGROUND_DESTROYED (G4) | `tests/lone-units.test.ts:45-46`; `tests/attack-preview.test.ts:147` | Yes (describe name, TODO(verify)). | |
| ZOC_POLICY.friendlyUnitNegates (M10) | `tests/movement.test.ts:127`; `tests/mutation-survivors.test.ts:75-96`; `tests/zoc.test.ts:139`; `tests/map-overlay.test.ts:69` | Yes in all four. The mutation-survivors comment says the tests "pin the CURRENT assumptions, not settled rules". | |
| ZOC_POLICY.friendlyUnitNegates (M10) | `tests/supply.test.ts:119-122` | No. Asserted as "spec 03; ZOC_POLICY", and the test also checks the off setting. | Pins the open question as settled. |
| ZOC_UNIT_TYPES (M9) | `tests/zoc.test.ts:64-66` | No. Asserts infantry, armor and airborne exert a ZOC, and that air, fleets and replacements do not. | The printed text (RULES.md line 158) gives the ZOC to armor only. **The most important unflagged pin.** |
| NEUTRAL_LAND_CLOSED (M3) | `tests/move-selection.test.ts:180` | Yes (in the comment). | |
| STACK_MOVES_AT_SLOWEST_UNIT (M4) | `tests/move-options.test.ts:142-148` | Yes ("TODO(verify, Ref 5.45f; spec 10 engine fact 8)"). | |
| MIXED_NATIONS_MOVE_TOGETHER (M5) | `tests/move-options.test.ts:196-199` | Yes (describe name: "open assumptions kept as named constants"). | |
| STACKING_CHECKED_ONE_AT_A_TIME (M6) | `tests/move-options.test.ts:206-210` | Yes (same describe name). | |
| CONTROL_ON_PASS_THROUGH (M7) | `tests/movement.test.ts:200-201` | Yes (test name, TODO(verify)). | |
| Control of a minor at war (M17 area) | `tests/control.test.ts:113` | Yes ("Ref 16.0, TODO verify"). | |
| Anglo-French sharing (M13) | `tests/stacking.test.ts:79` | Yes ("Ref 26.0, TODO verify"). | |
| Replacements fight (G1) | `tests/ground-combat-edges.test.ts:103` | Yes (describe name). | |
| KEEP_UNUSED_BRPS (E1) | `tests/year-start.test.ts:55-57` | Yes (test name). | |
| minorAllyBrps per ally (E3) | `tests/year-start.test.ts:79-82` | Yes (test name). | |
| Vichy and Free French naval DRM (O3) | `tests/tables.test.ts:80-91` | Partly. The comment cites the TODO, but the expected table sets Vichy and Free French to 0 as the answer. | Pins the chart value that the open question is about. |
| Grant cap of 40 BRPs (E6 area) | `tests/grants.test.ts:41` | No. "is capped at 40 BRPs" asserts the value as settled. | `tests/mutation-survivors.test.ts:126` does flag the source as web-sourced. |
| DEFAULT_FRONT_OPTION (E8) | `tests/front-options.test.ts:112` | Yes (test name). | |
| Captured minor capitals (S1) | `tests/supply.test.ts:38` | Yes ("TODO(verify) captured minor capitals"). | |
| Computer policy values (C1-C7) | `tests/ai-move.test.ts:53`; `tests/ai-assault.test.ts:80`; `tests/ai-choosers.test.ts:99,137`; `tests/ai-staging.test.ts:42` | No. These are tuning values, not rules, so pinning them is expected. | Not a rules problem. |

Two comments in tests claim to settle an old TODO: `tests/combat.test.ts:40` (rounding below 1:1) and `tests/tables.test.ts:25` (the 25-30 band). Those are resolved, not open.

## Top 10 for play

Ranked by how much a wrong guess would change a game. Each is an open question today; the ones in RULES.md are already listed.

1. **Zone of control** (M9, M10): whether only armor projects it, and whether a friendly unit cancels it. Listed (line 158), and the tests in `tests/zoc.test.ts` pin the current reading without a warning.
2. **Air units and fleets lost with no roll** (G4): when the last infantry leaves a port, its air units and fleets go. Listed (line 173).
3. **Survivors advance after a win** (G3): who advances, how many, and whether ZOC applies. Listed (line 173).
4. **Terrain costs one point everywhere** (M1): mountains and swamps may be dearer. Listed (line 174).
5. **A stack moves at its slowest unit's speed** (M4). Listed (line 174).
6. **Neutral land is closed** (M3): which countries' land a unit may enter before war. Listed (line 174).
7. **One attack per hex per turn** (G2). Listed (line 173); the test cites the wrong section.
8. **Unsupplied units attack, and which supply sources count** (G5, S1): the Libyan, Egyptian and Malta sources are not built. Listed (lines 160 and 173).
9. **Unspent BRPs are dropped at year end** (E1). Listed (line 163).
10. **One move per unit per turn** (M2). Listed (line 174). Fundamental, and the test in `tests/movement.test.ts` pins it without a warning.

## Questions for Frank (who knows the original game)

1. Zones of control: does only armor project a zone into the hexes next to it? Does a friendly unit in a hex cancel an enemy zone there? Must a unit stop on entering one?
2. When the last ground defender of a port or city is destroyed, do its air units and fleets disappear, stay, or rebase?
3. Do mountains and swamps cost more movement points than plains?
4. In a stack, does every unit move at the speed of the slowest one?
5. Can a hex be attacked twice in one turn? Can one unit attack more than one hex?
6. After a winning attack, can the attackers move into the emptied hex? How many, and do zones of control and stacking limits apply?
7. Can a unit enter a neutral country's land, or land of a country that has not joined the war?
8. Can an unsupplied unit still attack? Which cities and ports supply units in Libya, Egypt, Malta and Sevastopol?
9. Do BRPs left unspent at the end of a year carry over?
10. Can a unit move twice in one turn with points left over?

Also worth asking, if time allows: for fleets (spec 12), how the game asks you to supply units by sea, what happens to a fleet when its port is taken, which Front the Black Sea and Baltic ports are on, how interception distance is counted, and whether Libyan ports supply by themselves; whether replacement counters move and fight; what forces a minor country gets when attacked and where they go; whether an automatic declaration of war counts towards the spending limit; and whether a grant is blocked when an enemy stands next to a capital.

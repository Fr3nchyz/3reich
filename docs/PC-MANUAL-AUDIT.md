# Engine against the PC Reference Manual (audit of 2026-10-16)

The PC Reference Manual text (local copy, never committed) was read for 14 rule questions: 214 extracted rows, of which 174 are stated and 23 partly stated in the manual and 15 are not stated. The engine was then checked row by row (Q1, zones of control, is spec 13). Most rows match or are for features not built yet; the mismatches are below. Rule numbers are the manual's own. Key mismatches were re-read in the manual text by the project manager; the rest are as reported by the audit and should be re-read before a ticket is built. Nothing here changes the code; each line becomes a ticket after the product owner picks the order.

## Mismatches (engine does something different from the printed rule)

| # | Rule (manual) | What the manual says | What the engine does | Size | Proposed ticket |
|---|---|---|---|---|---|
| 1 | 7.0, 11.41 | Only armor extends ZOC to adjacent hexes; friendly units do not cancel enemy ZOC; leaving an armor ZOC costs 2 MF; nothing forces a stop | Infantry, armor and airborne all project ZOC; friendly units cancel it; entering a ZOC forces a stop | Large (changes the front line) | Spec 13, tickets 13-1 to 13-3 |
| 2 | 11.71 | The U.S.S.R. may not Grant BRPs at all | It may grant once at war with Germany (`grants.ts:37`) | Small | Remove the U.S.S.R. as a giver; test with the rule number |
| 3 | 11.71 | A Major Power may spend at most half its yearly allotment on grants in the year | Only the per-turn spending limit applies (`grants.ts:40`) | Small | Yearly grant tally in the state; test |
| 4 | 12.1 (22.0) | Replacements may not attack except as part of a Counterattack | They attack on any turn (`attack-rules.ts:19,110`) | Small | Exclude Replacements from the attacker pool unless counterattacking; the Counterattack result itself is not built yet, so for now they cannot attack at all |
| 5 | 12.21 | Units unsupplied at the start of their turn cannot advance after combat (airborne that dropped cannot either) | No supply check on advance (`attack.ts:82-101,147-170`) | Small, but needs "supplied at start of turn" recorded | Record supply at turn start; refuse advance |
| 6 | 19.4 | Unsupplied units can neither move nor advance, and are eliminated at turn end | Supply is never consulted by movement or advance (`supply.ts` not wired) | Medium | Wire supply into the movement and end-of-turn steps (see also open item A) |
| 7 | 20.1 | A captured airbase moves to its owner's Capital at once; air units on it move to the nearest friendly base within 8 hexes, else are eliminated | The loner sweep destroys the airbase and the air units with no roll (`attack-rules.ts:119`, `ALONE_NONGROUND_DESTROYED`) | Medium, belongs to spec 09 | Spec 09 ticket on rebasing; keep the sweep until air units exist |
| 8 | 21.1 | A fleet in a port that becomes enemy-controlled is displaced to the nearest friendly port on its Front, else eliminated | Swept (destroyed) with the loner sweep | Medium, belongs to spec 12 | Spec 12 ticket 12-4 |
| 9 | 17.2 | Germany may send forces into an uninvaded inactive Axis Minor-Ally without declaring war (a Garrison) | Germany cannot enter (`movement.ts` `NEUTRAL_LAND_CLOSED`) | Medium | Garrison move for Axis Minor-Allies (spec on minors) |
| 10 | 24.0 | The Axis pays no declaration cost to enter Persia | Persia is a declaration target at 10 BRPs (`war.ts:37,59-62`) | Small | Persia special case; test |
| 11 | 9.2 | Each active Minor-Ally's BRP value is added at the Year Start Sequence | The sum is added only while every Minor-Ally active at the start is still active, otherwise nothing (`yearstart.ts:42-46`) | Small, needs each Minor-Ally's value (only Bulgaria's 10 is known) | Needs the table of values; ask Frank |
| 12 | 11.2 | Each at-war country designates an Option on each Front | One Option per Front for the whole side | Unknown (may be equivalent in practice) | Check with Frank before changing |
| 13 | Op Manual 5.42 | Front Options can be changed during the step until it is left | A choice cannot be changed in step 3 (`frontoptions.ts:73`) | Small | Allow change until the step is left |
| 14 | 5.0, Op Manual 5.45g | Stacking limits do not bind while moving; overstack is checked after movement and the owner chooses which units are eliminated | A move that would end over the limit is refused | Design choice: refusing is friendlier; keep, but record it | Document in spec 03 (no change proposed) |
| 15 | 12.1 | A unit may be attacked once per turn (except Exploitation); a hex has no stated cap | One attack per hex (`ONE_ATTACK_PER_HEX`) | Near equivalent while exploitation is not built | Revisit with Exploitation |

## Points that do not match what we assumed

- **Unsupplied elimination (A):** 19.4 says units unsupplied at the end of their Player Turn are eliminated; 11.74 says only units unsupplied at the start and the end. The manual contradicts itself. Ask Frank which one the PC game follows.
- **Exchange (12.2):** the attacker must match the terrain-multiplied value of the defender, unless the defender rolled the Exchange while Counterattacking. The engine's valuation when the defender is the larger side is still `TODO(verify)`; 12.2 does not settle it.
- **Automatic declarations (13.0, scenario texts):** the U.S. automatic declaration costs 35 BRPs; whether it counts toward the spending limit is not stated (the engine does not count it).
- **Replacements:** their rule (22.0) has no body text in the manual files we have; ZOC and stacking behaviour for them is inferred.
- **Not stated anywhere in the manual:** whether a unit must stop on entering a ZOC (spec 13 builds "no stop"), how a stack with mixed speeds moves, the maximum supply line length, and the exit-cost wording (+2 in 7.0, +3 in the 12.31 example).

## Confirmed matches worth knowing

Unused BRPs are lost except through growth (`KEEP_UNUSED_BRPS` is right); one move per turn; terrain never slows a unit (cost 1 per hex is right); the grant cap of 40 per turn, the 20-BRP-per-SR rule and the no-grants-back rule; the spending limit being half the total; the Exchange loss rules; declaration costs of 35 and 10; London's three British units.

## Next steps

Order of work, smallest first: items 2, 3, 4, 10, 13 (small, pure engine, each with a test and a mutation check); then items 5 and 6 together with the supply wiring; then spec 13. Items 7 to 9 and 11 are folded into the air, naval and minor-country specs. Items 12 and 14 and the open questions go to Frank.

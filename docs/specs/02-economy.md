# 02. Economy: BRPs, the Year Start Sequence, declarations of war and construction

Status: **partly built** (part 1: the BRP ledger, the spending limit and declarations of war; see "As built" at the end). The Year Start Sequence, front options, construction, grants and the other parts wait for your "let's go". Depends on spec 01 (turn steps).

## Goal

Make Base Resource Points (BRPs) real. Today each nation has BRP numbers from the scenario but nothing ever changes them, so the Initiative never changes, nobody can declare war, and nothing can be built. This feature adds the money side of the game: what each nation has, what it can spend, what spending costs, how totals grow each year, and the decisions that cost BRPs (declaring war, front options, building units, grants).

## Behaviour (what the player or engine does)

### Totals and spending

- Each Major Power has a BRP total that changes only through the rules below; the log shows every change with its reason.
- At most half of a nation's total (rounded down) may be spent in one Player Turn (Ref 10.0; already coded as `spendingLimit`). The player cannot commit more than that and the UI shows what remains.
- Totals never go negative. An action that would overspend is refused with a message naming the limit.

### Year Start Sequence (between a Winter and the next Spring turn)

In this order (Ops 6.0, Ref 9.0 to 9.3):

1. **A. Strategic warfare is resolved** (not at scenario start): submarine, ASW and SAC factors on each side are compared and BRP losses applied.
2. **B. Initial BRP totals are calculated**: each Major Power's new total from its base, growth rate and conquests or losses; nations with "no growth" scenario rules (for example the 1940 year in 1939 and Campaign) get none.
3. **C. Strategic warfare factors are constructed** (also at scenario start in 1942 and 1944).

### Initiative

At the start of every Game Turn the order of the sides comes from live totals (Ref 11.1; the rule is coded, but now its inputs change). "The USSR is at war with Germany" is read from the list of wars, not approximated.

### Declarations of war and minor countries (step 1 and 2 of a Player Turn)

- A Major Power may declare war on another Major Power (35 BRPs) or on a Minor Country (10 BRPs), subject to the scenario rules (for example no war on countries neutral at the start in 1944) and the PC rule that a declaration on a minor must be followed that turn by a move into it or an attack on it, or it is revoked and the BRPs are lost (PC README, rule 21.4).
- Declaring war updates the list of wars, which later decides alliances, who may attack whom, and the Initiative.
- A minor country that is newly attacked gets its defending forces from the Minor Country Forces chart, set up for the defender; Minor-Allies are activated and their forces set up (step 2, Ref 14.0 to 17.0).
- Scenario rules with a date, such as the automatic U.S. declaration in Spring 1942 (35 BRPs), happen at their step without a player action. The U.S. units that wait in the U.S. Box at setup then enter play.

### Front options (step 3)

Each side chooses, per Front, the option that governs its attacks that turn (for example the Offensive Option costs 15 BRPs; the Attrition and Defensive options cost nothing). The choice is recorded and limits what combat actions are legal later in the turn (Ref 11.21).

### Construction (step 8)

- A nation may build units from its Allowable Builds, paying the printed BRP cost per factor, within its spending limit, and no earlier than the unit's "in or after" date.
- Newly built units go to the Force Pool and are placed on the map by the rules of Ref 11.5 to 11.6 (the placement rules are part of this feature).
- Replacements, air, naval and strategic-warfare factors have their own costs (already in `tables.ts`).

### Grants and transfers (step 9a to 9c)

BRP grants between allies, Lend-Lease and Murmansk convoy grants move BRPs between nations within the printed limits (Ref 11.71, 11.72). Murmansk convoys also create exposure to strategic warfare, which belongs to the combat spec.

### Difficulty levels

The PC game adjusts BRP bases and growth, and adds counters to the Force Pools, for each difficulty level (the table is in the game's README). The data model must allow a scenario start to be adjusted this way; applying the levels is part of the computer-opponent spec.

## Rules references

- Ref 9.0 to 9.3 (strategic warfare, Year Start Sequence, BRP growth), 10.0 (spending), 11.1 (Initiative), 11.21 (front options), 11.5 to 11.6 (construction), 11.7 to 11.72 (grants, Lend-Lease, Murmansk), 13.0 (declarations of war), 14.0 to 17.0 (minor countries and allies), 26.0, 29.0, 35.0 (national special rules).
- Ops 5.41, 5.41a, 5.42, 5.47, 5.48, 6.0; scenario pages (Ops 9.0).
- PC README: rule 21.4 (declarations on minors), difficulty-level table, "no BRP value is listed for Bulgaria; it is worth 10 BRPs".

## Open questions (also add to docs/RULES.md)

- The exact BRP growth and loss arithmetic (what is a nation's "base", how conquest changes it, rounding): the manual text must be read line by line before this is built; the game's own data files may settle the numbers.
- What happens when a Major Power is conquered or surrenders (France, Italy, the USSR): BRP transfer rules and Vichy France.
- Whether BRP spending in one Player Turn is a single pool across all uses or tracked per use.
- Eastern Europe's 25 BRPs after Fall 1939 (Ref 29.0): who receives them and when.
- Which of the strategic-warfare rules belong here and which in the combat spec (proposal: factors and BRP effects here, the naval and air missions there).

## Done when

1. A scripted game can run through at least three Game Turns of the 1939 scenario with BRPs changing only through documented events, and a log line explains each change.
2. Spending beyond the half-total limit is refused in a table-driven test across every action that costs BRPs.
3. The Year Start Sequence runs between Winter and Spring only, steps A to C in order, with the scenario's start-of-game exceptions, tested for 1939, 1942 and 1944.
4. The Initiative changes when totals cross, tested both ways and on a tie, including the U.S. entering from Summer 1942 and the USSR counting only once at war with Germany.
5. Declaring war: costs, scenario bans, the "must follow with an attack or move" revocation, and the automatic U.S. declaration, each have a test; minor-country forces appear on the map as the chart says.
6. Construction: cost, date gating, the spending limit and placement are tested; building a unit before its date is refused.
7. Replay of a recorded game reproduces every total exactly (no drift), and a property test shows total BRPs are conserved except through listed events.
8. Mutation checks: changing a cost, a growth rate, the rounding, or removing a date gate each makes a test fail.

## As built (part 1)

- **Ledger** (`src/engine/brps.ts`): `spend` takes BRPs within the Player Turn's limit and refuses an overspend with a message naming the limit; `charge` is for charges the rules make by themselves (stops at zero); every change is a `BRPS_CHANGED` event with its reason.
- **Spending limit** (Ref 10.0, from the rulebook text found online): half the nation's total at the start of the year, fractions rounded down, **fixed for the year** (`Nation.spendLimit`), not half of the current total. `Nation.spent` counts what has been spent in the current Player Turn and resets when a Player Turn begins. At scenario start the limit is half the printed total (10.0 says it applies in the first year too).
- **Declarations of war** (`src/engine/war.ts`, step 1): `DECLARE_WAR { by, on }`, 35 BRPs against a Major Power, 10 against a minor country, within the limit. `by` is a Major Power of the side taking its turn (neutral Major Powers cannot declare yet). Targets are Major Powers of the other alignment (Germany and Italy are Axis; Britain, France, the U.S.A. and the U.S.S.R. are Allied, even while neutral), not out of the game and not Vichy, and minor countries that are not already at war with a Major Power and not active Minor-Allies. A scenario with the "no war on neutrals" rule (1944) offers none. Step 1 is waited at only while the side to move could declare something.
- **Scenario declarations**: the U.S. in the Allied Spring 1942 turn (35 BRPs, charged outside the limit, the U.S. joins the Allies). `TODO(verify)`: whether such a charge counts towards the limit, and the U.S. units in the U.S. Box entering play.
- **Initiative** now reads "the U.S.S.R. is at war with Germany" from the list of wars (Ref 11.1) instead of from its status.
- **Not built yet** (`TODO(verify)` in `war.ts`): the minor's forces appearing when it is attacked (step 2); the rule that a declaration on a minor must be followed that turn by a move into it or an attack on it, or it is revoked and the BRPs are lost; the 35-BRP price when a declaration on a minor or colony brings war with a Major Power; neutral Major Powers joining a side.

### What the rulebook text settles (Advanced Third Reich 9.0 to 11.7, found online; see docs/RULES.md "Web research")

- Year Start Sequence (9.2): a nation's Base grows by its unused BRPs from the previous year times its Growth Rate (fractions rounded down); strategic-warfare losses below zero are the only way to reduce a Base; the initial total adds the BRPs of active Minor-Allies, of attacked minors the nation intervened in, and of conquered countries and colonies not held at scenario start; a conquered Major Power gives the conqueror half of its starting BRPs, rounded down; Germany gains 15 for each of Moscow and Leningrad it holds, and the U.S.S.R. loses 15 for each it does not hold (unless surrendered); the 1940 Base equals the 1939 Base. Four worked examples (Germany 195, 225, 285, 305) would let a test check the arithmetic, but the page quotes them only in part; they need the printed manual.
- Spending limit (10.0): see above. Grants (11.71): up to 40 BRPs a turn to an allied Major Power, none by a Major Power not yet at war, and not more than half the yearly allotment on grants. Construction (11.6) costs per factor match `BUILD_COST_PER_FACTOR`; fleets only in 9-factor units at 27 BRPs; Turkey, Spain, Vichy France, Sweden and the Free French can never rebuild a fleet (11.62).

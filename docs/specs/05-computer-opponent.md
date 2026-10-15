# 05. The computer opponent

Status: **draft for review. Nothing is built until you say "let's go".** Depends on specs 01 to 04.

## Goal

A player can play a whole game alone against the computer, taking either side. The computer plays by exactly the same rules as the human: it can only do what the engine lists as legal, so it can never cheat or break a rule.

## Behaviour (what the player or engine does)

- **Where it lives.** A separate module (`src/ai/`) that reads the game state and `legalActions`, and answers with one action at a time through `applyAction`. Nothing in the rules modules knows the computer exists.
- **Deterministic.** The same state, side, strength and seed give the same moves, so any game can be replayed and any bad move reproduced.
- **Layers, built in this order, each testable on its own:**
  1. **Setup**: place forces sensibly (front-line weighting, objectives, supply) instead of the placeholder "first legal hex".
  2. **Evaluation**: a score of a position (objectives held, BRPs, supply, force ratio per Front, fleets and air).
  3. **Choosers per step**: declarations of war and front options, movement, combat selection, construction, redeployment, each picking among the legal actions by evaluation.
  4. **Strength levels**: Novice to Difficult, using the original's adjustments (BRP bases and growth, extra Force Pool counters), which are written in the game's README and applied to the scenario at the start.
- **Strategic understanding** it must show in play: keep supply lines, defend objectives, be efficient with BRPs, retreat to preserve units, and not leave armies to be cut off.
- **Pace.** A computer turn finishes in a few seconds on an iPad; the screen shows what it is doing and the log records it. The human can read what the computer did after the fact.
- **Fallback.** If the computer cannot choose (no scored action), it ends the step; it never loops.

## Rules references

- The legal-action API in `src/engine/actions.ts`; the sequence in specs 01 to 04.
- The Operations Manual's computer-opponent notes, the difficulty table in the game's README, and the AI design article in *The General*, vol. 31 no. 2 (see docs/SOURCES.md).
- The original program's own AI text resources, to be read before design (roadmap 2.7).

## Open questions (also add to docs/RULES.md)

- How much of the original's behaviour to copy, and how to tell: the player has never played the original, so strength levels need real play-testing.
- Search style: rule-based scoring (proposal for the first release) against a lookahead search; the first release uses rule-based because the game's branching factor is large.
- Whether the computer sees hidden information the rules hide (nothing is hidden in this game; confirm).
- How to test strength: self-play matches over fixed seeds with recorded win rates per level.

## Done when

1. The computer plays a complete 1939 game as either side with no illegal action attempted, deterministically from a seed, and finishes within a time budget per turn on a typical phone or iPad.
2. Computer against computer, over 20 fixed seeds, always reaches a result, with no stalls or infinite loops.
3. A scripted human opponent can beat the computer at Novice and the computer beats a passive opponent at Normal (win rates recorded in a test file).
4. Each layer has unit tests on hand-built positions (a sensible setup, an obviously better move chosen, a supply-cut avoided).
5. The module imports nothing from the UI, and the engine imports nothing from it (checked by the engine purity test).
6. Mutation checks: removing the supply term or the objective term from the evaluation changes the moves in a test position and fails a test.

## As built (first slice: layer 3 for the steps that wait today)

- `src/ai/` imports only the engine (`tests/ai-boundary.test.ts`; the engine cannot import it, `tests/engine-purity.test.ts`). `chooseAction(ctx, state, {seed})` returns `{action, why}` taken from `legalActions` only, or null when nothing waits (setup, game over). It is a pure function: ties are broken by a hash of the seed and the action, so the same state and seed give the same move. `playOne`/`playSide` apply decisions through `applyAction`; Setup (layer 1) is still the placeholder: the browser uses the engine's automatic setup through `src/ui/session.ts`, tests use `autoSetup`; a front-weighted placement is not built.
- Step 1: declares only on a plan in `DECLARATION_PLANS` (Italy on France and Britain from Summer 1940, Germany on the U.S.S.R. from Summer 1941) and only if legal. Step 8b: a plain priority list (keeping back the BRPs a pending declaration plan needs, `plannedReserve`, so the plans can fire) (`BUILD_PRIORITY`), the biggest counter of the first kind on offer, in the legal hex nearest an enemy ground unit; the engine lists only builds within the spending limit. Step 9a: 10 BRPs at a time to an ally whose total is under `GRANT_RECEIVER_BELOW` while the giver has twice as many. Step 10b: ends the turn. Every other waiting step, and any step the chooser has nothing for, is ended, so it never loops. Step II.B never waits, so it has no chooser.
- All priorities, dates and thresholds are the computer's own policy, marked `TODO(verify)`, to be tuned by play-testing; none of them is a rule.
- Browser: the side the player did not pick is the computer's. `src/ui/computerLoop.ts` plays a slice of one step per tick (about 60 ms of work, then a pause of `COMPUTER_DELAY_MS` after a finished step, a short one inside a long step), `src/ui/computerPlay.ts` logs each choice as "Computer (Axis): reason", and the status area shows "Computer is playing the ... turn..." with no buttons while it moves. Taps on the map are ignored then.
- Not built: evaluation (layer 2), movement/combat choosers (those steps do not exist yet), strength levels (layer 4), computer against computer over 20 seeds with win rates.

## As built (movement, attacks and the self-play runner)

- Step 6f (`src/ai/move.ts`, `geo.ts`): of the engine's `legalActions` it takes the MOVE that brings a stack closest, by ground hexes, to the nearest capital or objective held by the enemy (a breadth-first distance from those hexes over hexsides ground units cross, not through neutral land the unit may not enter), at least `MOVE_MIN_PROGRESS` closer; it prefers the larger stack, keeps a lone garrison on its own capital, does not end beside enemy factors worth more than `MOVE_MAX_ENEMY_RATIO` times its own, and stops after `MOVE_MAX_UNITS_PER_TURN` units. Supply is not considered. It does not build the engine's whole move list: it takes the stacks farthest from their target first and searches only those (`reachableHexes`, the same routes `legalActions` lists), about 4 ms a decision. Each unit keeps its target until reached or lost and does not go back to a hex it left in the last two Game Turns; this memory (`AiConfig.memory`, `src/ai/memory.ts`) is kept by the caller per game, and without it the choice depends on the position alone.
- Step 7h (`src/ai/assault.ts`): the best ATTACK whose odds column (from `attackNumbers`, terrain included) is at least `ATTACK_MIN_COLUMN` (1-1 where the attackers hold three times the defenders printed factors) and whose worst Exchange costs at most `ATTACK_MAX_EXCHANGE_FACTORS`; better odds first, then objectives, then the larger force. It advances into a hex the defenders left with the largest legal set, chooses the first legal Exchange loss set, and otherwise ends the step. All of it is computer policy, marked `TODO(verify)` and listed in docs/RULES.md.
- `npm run selfplay` (scripts/selfplay/, docs/SELFPLAY.md) plays whole games computer against computer and reports per Game Turn; the Vitest runner tests replay each recording to the same final state.

## As built (idle play: waiting at the border, move cap, big Exchanges)

Why units stood still (measured with `npm run selfplay`, 1939 seed 1: the Axis moved one unit in Spring 1941): (1) once the West was won, every enemy objective left on the Axis units' land lay behind a sea (Britain) or a neutral country's closed land (the U.S.S.R., not yet at war), so the distance field gave them no target and they idled for the Game Turns until the planned declaration (36 of 36 units "no path"); (2) from 1942 on, the cap of 40 units per Player Turn went to the stacks farthest from their target, every turn, and left the rest standing; (3) the Exchange limit of 8 factors kept a 26-factor stack from attacking a fortified hex at 2-1; (4) the rest is legitimate: Allied garrisons on islands or in colonies with no land route to anything (no sea movement is built), and fronts held by full hexes and enemies at 1-1.

- **Waiting at the border** (`stagingTargets` in `src/ai/geo.ts`, `plannedTargets` in `declare.ts`, `move.ts`). A stack with no way to any enemy objective now heads for the capitals and objectives of the neutral Major Power its side has a declaration plan against (`DECLARATION_PLANS`: the U.S.S.R. for the Axis in the 1939 and Campaign scenarios), counting that country's land as open for the distance only. It still moves only where `reachableHexes` lets it today, so it stops beside the border and enters nothing before the declaration (Ref 13.0, step 1, is unchanged). The Allies have no plan, so their stranded garrisons stay. Nothing is declared earlier than before, and no declaration on a minor country is made: the minor's forces do not appear when it is attacked yet (docs/specs/02, not built), so a declaration on a minor would be a free conquest by an unbuilt rule.
- **Cap and caches.** `MOVE_MAX_UNITS_PER_TURN` is 80 (was 40). The nearest-objective field is kept in `AiMemory.nearest` for the Game Turn, keyed by the set of enemy-held objectives so a capture renews it, and the ground-distance search checks each hex's closed status once; selfplay time is unchanged (8 games, all scenarios: 93.4 s before, 93.3 s after, with the legality check on) although more units move. The order stays "farthest first" (nearest first was tried: it lowered the Axis result, objectives held 78 against 134 over 12 seeds).
- **Big Exchanges.** At 2-1 or better the Exchange limit is `ATTACK_MAX_EXCHANGE_FACTORS_STRONG` = 16 (8 below 2-1). This changed the golden test "also needs an acceptable Exchange" in `tests/ai-assault.test.ts` (25 against 5x2 used to stay home).
- **Measured** (computer against computer, seeds 1 to 12 for 1939 and 1 to 6 for the others; "idle" is a Game Turn in which both sides together moved fewer than 3 units and made no attack; no anomaly in any game): 1939 idle Game Turns 5 to 1, units moved 4443 to 4922, combats 302 to 338, Axis-held objectives at the end 114 to 143 in total; Campaign idle 12 to 1, combats 258 to 334; 1942 idle 3 to 0, units moved 3589 to 5024, combats 149 to 266; 1944 idle 0 to 0, combats 156 to 167. The self-play report now lists units moved by each side, each side's ground units, and the idle Player Turns (a side with 10 or more ground units that neither moved nor attacked); the ones left are Allied garrisons with nowhere to go.
- **Not done:** a stalemate breaker (a side whose whole army stands behind full hexes at 1-1 odds still waits: seed 5 of the 1939 scenario in the West); moving units that have no plan target and no land route toward the front; Italy cannot declare on France and Britain while neutral (engine: a neutral Major Power has no side, `declarationTargets`), so its plan never fires in the 1939 scenario.
- Tests: `tests/ai-staging.test.ts` (positions where the old chooser idled, the border stop, the cache), `tests/ai-stability.test.ts` (fixed-seed action hashes, which change on purpose when the policy changes, and the Axis moving through Fall 1940 to Spring 1941 in seeds 1 to 3).

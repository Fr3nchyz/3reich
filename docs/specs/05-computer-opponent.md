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

- Step 6f (`src/ai/move.ts`, `geo.ts`): of the engine's `legalActions` it takes the MOVE that brings a stack closest, by ground hexes, to the nearest capital or objective held by the enemy (a breadth-first distance from those hexes over hexsides ground units cross, not through neutral land the unit may not enter), at least `MOVE_MIN_PROGRESS` closer; it prefers the larger stack, keeps a lone garrison on its own capital, does not end beside enemy factors worth more than `MOVE_MAX_ENEMY_RATIO` times its own, and stops after `MOVE_MAX_UNITS_PER_TURN` units. Supply is not considered. One `legalActions` call per decision (about 15-40 ms at 6f on a desktop; the list is cached per state), so a Player Turn costs about a second.
- Step 7h (`src/ai/assault.ts`): the best ATTACK whose odds column (from `attackNumbers`, terrain included) is at least `ATTACK_MIN_COLUMN` and whose worst Exchange costs at most `ATTACK_MAX_EXCHANGE_FACTORS`; better odds first, then objectives, then the larger force. It advances into a hex the defenders left with the largest legal set, chooses the first legal Exchange loss set, and otherwise ends the step. All of it is computer policy, marked `TODO(verify)` and listed in docs/RULES.md.
- `npm run selfplay` (scripts/selfplay/, docs/SELFPLAY.md) plays whole games computer against computer and reports per Game Turn; the Vitest runner tests replay each recording to the same final state.

# How good are the unit tests? A mutation test

Date: 2026-10-15. Code: `main` at commit 6098913 (branch t41-mutation). Written for the product owner; no programming needed.

## What was done, in plain words

A mutation test damages the game rules on purpose, one tiny change at a time (a `>` turned into `>=`, a `+1` added, an `if` removed), and then runs the unit tests. If a test fails, the damage was **noticed** ("killed"). If every test still passes, the damage went **unnoticed** ("survived"): the tests do not really guard that rule. The share of damage that was noticed is the **score**. This is an objective measure that does not depend on anyone's opinion of the tests.

## Result

About one damage in three was tried (527 changes) across the 13 rule modules. Before this work 455 of them were noticed (86.3%); after the new tests 469 (89.0%). The 1,230 existing tests are therefore good at the rules they name, with some real holes (below).

**The 89.0% is not an estimate of the true score.** It is in-sample: the new tests were written for survivors found in the sampled third, and the other two thirds were not re-run, so the 'after' figure is flattered. The honest first figure is 86.3%. An independent reviewer's full, unsampled run on `grants.ts` alone (128 changes) missed 12, a score of 90.6% (this work's sample put grants.ts at 73.2% before and 87.8% after). One survivor outside the sample was found that way, `grants.ts:27` (`g.to === to` replaced by `true`, which would apply the 40-BRP cap per giver instead of per receiver); it now has a test.

| Module | Tried | Noticed before | Missed before | Score before | Missed after | Score after |
|---|---|---|---|---|---|---|
| combat.ts (odds, results, attrition) | 26 | 22 | 4 | 84.6% | 2 | 92.3% |
| tables.ts | 29 | 28 | 1 | 96.6% | 1 | 96.6% |
| attack-rules.ts | 45 | 40 | 5 | 88.9% | 4 | 91.1% |
| attack-losses.ts | 54 | 50 | 4 | 92.6% | 4 | 92.6% |
| terrain.ts | 5 | 5 | 0 | 100% | 0 | 100% |
| zoc.ts | 36 | 33 | 3 | 91.7% | 3 | 91.7% |
| stacking.ts | 63 | 55 | 8 | 87.3% | 6 | 90.5% |
| control.ts | 24 | 19 | 5 | 79.2% | 5 | 79.2% |
| movement.ts | 48 | 38 | 10 | 79.2% | 10 | 79.2% |
| war.ts | 47 | 44 | 3 | 93.6% | 1 | 97.9% |
| construction.ts | 40 | 34 | 6 | 85.0% | 5 | 87.5% |
| grants.ts | 41 | 30 | 11 | 73.2% | 5 | 87.8% |
| supply.ts | 69 | 57 | 12 | 82.6% | 12 | 82.6% |
| **All** | **527** | **455** | **72** | **86.3%** | **58** | **89.0%** |

"Missed" counts survivors plus changes no test even runs. The weakest modules are grants, movement, control and supply.

Number changes (`+1` / `-1` on whole numbers) are not made by the tool above, so a second small script tried them: 137 changes in 11 modules (all of attack-rules, attack-losses, terrain, zoc, stacking, movement, construction, grants, supply; a fixed sample of 11 in combat.ts and 10 in tables.ts). 105 were noticed (77%). The 32 missed were mostly list-order numbers or limits that are never reached (see below); 3 were rule boundaries and are fixed (grants from Spring 1942, the 1942 Anglo-French date, new counters' ids). The table cells themselves are well guarded: every one of the 21 sampled cells was noticed.

## The 15 most worrying changes that still go unnoticed (after the fixes)

Each says: changing X to Y in a rule is not noticed by any test, so the rule could break silently. "Equivalent" would mean the change cannot alter play at all; each of these 15 was looked at and none is equivalent as far as reading the code can tell, except that item 14 cannot change a cost today (explained there).

1. `attack-losses.ts:63`: dropping the check that an attacker still exists, so a unit wiped out in an Exchange might still be offered the advance into the emptied hex (Ref 12.1, 12.2).
2. `movement.ts:77`: letting a stack enter a hex held by units of the other side that are not at war with it, or ignoring who is an enemy (two changes; Ref 6.0, 7.0).
3. `stacking.ts:32`: counting anything that is not a ground or air counter, not only fleets, as naval factors against the 36-factor port limit (Ref 5.0).
4. `stacking.ts:121`: the computer's overstack clean-up no longer gives back units it need not eliminate, so it loses more than the limit forces (Ref 5.0, Ops 5.45g).
5. `construction.ts:93`: using up the Allowable Build of every kind of counter, not only the one built (Ref 11.6; line 43 hides it in part).
6. `control.ts:72`: treating a nation with no side as an enemy by the war list instead of by side (Ref 7.0 and the war rules).
7. `war.ts:51`: in a scenario with "no war on neutrals" (1944), also hiding nations that do have a side from the declaration list (Ref 13.0).
8. `construction.ts:56`: building a counter in a hex that does not suit it (for example a fleet inland) (Ref 11.6).
9. `attack-rules.ts:67`: counting Major Powers that are not in the war as the backers of a minor country's army, so it fights the wrong enemies (Ref 13.0).
10. `control.ts:36`: when working out who controls a hex, `and` turned into `or` between its three conditions (Ref 7.0).
11. `control.ts:78` and `:81`: mistaking a counter's country for a minor country or the other way round when working out who controls a hex (Ref 7.0).
12. `construction.ts:43`: offering a build that has no price in the cost chart as available (Ref 11.6; the 'none left' half of that line is the equivalent pair listed below).
13. `supply.ts:173`, `:198`, `:94`: skipping the side check or the empty-sources check when tracing supply (Ref 19.0); these are probably only protection against bad input.
14. `movement.ts:148` and `:157`: choosing a longer route or a different one among equal routes. Today every hex costs 1, which is an open question (`TODO(verify)` in movement.ts, docs/RULES.md) and not a rule, so the change cannot alter a cost; it will matter once terrain costs differ.
15. `supply.ts:77`, `:79` and `stacking.ts:35`, `:67`: only the order in which supply sources and overstacks are listed. Harmless for the rules but it can change a replay.

## Survivors that are equivalent (the change cannot alter the game)

Checked by reading the code, not by a proof:
- `combat.ts:42` (attack of 0 already gives "no column" the long way) and `:116` (200 rounds are never reached); `tables.ts:73` (0 enemy factors gives the same answer either way).
- `attack-rules.ts:78` (a check repeated by the next line), `:86` and `:140` (every pair of neighbouring hexes on the real map has a hexside record, so "no record" never happens).
- `attack-losses.ts:134` (the "everyone dies" branch gives the same result without it, checked), `:14` (the 100-set cap is never reached), `:54` (an empty log note), `:166` (error wording).
- `grants.ts:35`, `:51`, `:62`, `:65`, `:59` (guards repeated elsewhere or error wording only).
- `movement.ts:41` (`> 0` against `>= 0`: a movement of 0 is rounded down to 0 either way), `:79` (a constant switch), `stacking.ts:60` (any year from 1942 acts alike), `construction.ts:97` (ids only need to differ), `construction.ts:49`, `zoc.ts:40`, `:53`, `:55` (map-edge and bad-input guards).
- **Survives under the current open-rule setting, not equivalent:** `movement.ts:152` (`here !== start`). It cannot be noticed while `ZOC_POLICY.friendlyUnitNegates` is true (a mover's own counter cancels enemy ZOC in its start hex; docs/RULES.md lists that as open). With the setting false the change makes the stack reach 0 hexes instead of 23. A test under that alternative setting now notices it; it records behaviour under an open question and asserts no rule.
- `construction.ts:93`/`:43` `count > 0` form a pair of identical checks: either alone is enough.

## What was fixed with new tests (all in `tests/mutation-survivors.test.ts`, and `tests/combat.test.ts`)

Each was an unnoticed change; the same change was re-run after the tests and is now noticed.

| Rule | Where | Test |
|---|---|---|
| A counterattack that rolls D ends the battle with the attackers eliminated; A eliminates the defenders (Ref 12.1-12.2) | combat.ts:142 | seed sweep |
| Attrition roll reads the right row of the table (Ref 12.4) | combat.ts:187 | boundary test in combat.test.ts |
| A hexside flagged Qattara cannot be attacked across (Ref 4.51) | attack-rules.ts:86 | uses a doctored map |
| A Major Power not in the war is not in the attacker pool (spec 04) | attack-rules.ts:105 | Italy neutral, then at war |
| Any whole number of BRPs from 1 is a grant, 0, negatives and fractions are not (Ref 11.71) | grants.ts:60 (2 changes) | amounts 1, 0, -1, 0.5, NaN |
| The "no handing back" block names one giver and one receiver (Ref 11.71) | grants.ts:36 (9 changes) | three givers/receivers |
| Each grant records its own pair exactly once | grants.ts:75 (9 changes) | repeated and mixed grants |
| France and the U.S. may grant from Spring 1942, not Fall 1941 | grants.ts:38 | boundary, found by the number script |
| The Anglo-French shared-hex list is only for hexes with both, in order, and ends in 1942 (Ref 26.0) | stacking.ts:84, :85 (16 changes) | 5 hexes, 1941 vs 1942 |
| Only the side to move may build (Ref 11.6) or declare war (Ref 13.0); a declaration costing exactly the BRPs left is allowed | construction.ts:80, war.ts:62, :73 | exact-boundary BRPs 10/35 |
| Two counters built in a row are two different counters | construction.ts:97 | ids and count |
| ZOC: a stack next to an enemy reaches beyond it (Ref 6.0). Pins the current assumptions (friendly unit cancels ZOC, every hex costs 1), both open in docs/RULES.md | movement.ts:152 (4 of 5 changes) | M32 beside Poland |
| The same, with `friendlyUnitNegates` false (an alternative setting of an open question, not a rule) | movement.ts:152 (the 5th change, checked by hand) | start hex inside the ZOC |
| The 40-BRP grant cap is counted per receiver (TODO(verify): web-sourced text, Ref 11.71) | grants.ts:27 (outside the sample) | USA to Britain, then to U.S.S.R. |

Note: `war.ts:73` and `construction.ts:80` are noticed only through their error wording (each test says so in a comment), because a second check refuses the same action anyway. The new tests are 18 `it` blocks in `tests/mutation-survivors.test.ts`. No behaviour of the engine was changed; no test exposed a bug.

Also added to `tests/combat.test.ts` (independent evidence, written by hand and not computed by a formula): a table of 36 odds columns, including exact boundaries (1 vs 4, 2 vs 6, 1 vs 1, 5 vs 1, 3 vs 2, 10 vs 3, 2 vs 7, 99 vs 100, 24 and 25 vs 100), and the attrition columns at 1, 10, 11, 20, 21 ... 60, 61, 100, 1000 and below 1.

No rule question needed to be opened in `docs/RULES.md`.

## Method and limits

- Tool: Stryker 9 with its vitest runner, kept outside the repository (it was installed in a scratch folder; nothing was added to `package.json`). Its settings are in `scripts/mutation/stryker.config.json`; the slow whole-game and screen-label tests are skipped by `scripts/mutation/vitest.quick.config.ts`. Number changes: `scripts/mutation/numbers.mjs`.
- Changes made: operators, comparisons, true/false, conditions, removed blocks, and method calls. Left out as uninteresting: text strings, regular expressions, lists and objects, and constants evaluated only once at start (14 more).
- Sampling: the full run needed over an hour on this shared machine, so only every third change was tried: 527 of about 1,580. The sample was taken by a four-line local edit of Stryker's planner in the scratch install (keep a mutant only when its id divided by 3 leaves remainder 0), which is not in the repository, so the exact sample cannot be reproduced; a new full run is the reproducible alternative. Only 5 changes were tried in terrain.ts and 26 in combat.ts because most of their lines are tables, text or comments. Fixes were re-checked on every change on the lines concerned, not only the sample.
- A timed-out run counts as noticed (3 cases).
- Because slow whole-game tests were skipped, some "missed" changes may be noticed by them, but only by accident, not by a test that names the rule.
- "Noticed" means some test failed, not that the test explains the rule. A high score is not a guarantee: tests that only copy a table next to the table (as the odds and CRT "change detector" tests do) score well and prove little, which is why the hand-written boundary tests were added.
- Equivalent changes were judged by reading; a few may be wrong. The user interface and the computer opponent were not tested this way.
- To repeat one module (about 10 minutes with 2 workers): install Stryker in a folder outside the repository (`npm i @stryker-mutator/core@9 @stryker-mutator/vitest-runner@9 typescript vitest@2.1.9`), then from the repository root run `<that folder>/node_modules/.bin/stryker run scripts/mutation/stryker.config.json --mutate src/engine/<file>.ts`. It writes `.stryker-tmp` (ignored by git). It does not touch `package.json`.
- Number changes: `node scripts/mutation/numbers.mjs src/engine/<file>.ts`. **It rewrites the source file in place and restores it afterwards. Run it only in a throwaway worktree; if it is killed half-way, run `git checkout -- src`.**
- Open rules: tests that rest on a still-open rule are marked `TODO(verify)` in the test file and say so; they pin the current assumption, not a settled rule.

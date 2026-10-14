# Progress baseline (2026-10-13)

Measured on `main` after the merge of PRs #20 to #23. "The plan" is `docs/ROADMAP.md`. This page is the checkpoint to compare against next time.

## In one paragraph

The game can be opened in a browser, any of the four scenarios (1939, Campaign, 1942, 1944) can be chosen, and the player sets up their nations' forces on a corrected map by tapping, while the computer places the other side's forces. After setup the game starts, but nothing more can be done except ending turns: **movement, combat, supply, money (BRPs), declarations of war, and the computer opponent are not built yet.** The foundation is solid and heavily checked against the original game's own data; the playable game is still ahead.

## Measured facts

| What | Value |
|---|---|
| Scenarios that can be set up | all four (1939, Campaign, 1942, 1944); automatic setup places 110, 110, 178 and 194 counters |
| Map | 1,755 hexes, 5,079 hexsides; corrected against the original game's map data (17 coastal hexes turned to land, Sicily joined, two countries fixed, 26 lake/estuary sides no longer crossable) |
| Rule tables checked against the original | combat results, attrition, odds rounding, interception, naval and air modifiers, minor-country forces: all match except naval advantage, which was corrected |
| Automated tests | 328 passing; engine code 99.2% of lines covered |
| Checks on every change | lint (300-line file limit), type check, tests with a coverage floor, production build, and a browser test (mouse and touch) |
| Code size | about 3,900 lines of app, engine and data code (the engine is about 1,900), about 3,100 lines of tests |
| Specs written (awaiting your review) | 01 turn steps, 02 economy, 03 movement and supply, 04 combat and victory, 05 computer opponent |

## Against the plan (`docs/ROADMAP.md`)

| Phase | Status |
|---|---|
| 1 Housekeeping | Done |
| 2 Read the original game's data | 2.1, 2.2, 2.3, 2.4, 2.8 done. **Not done:** 2.5 compare scenario files, 2.6 write up the PC-vs-board-game rule differences, 2.7 read the AI resources |
| 3 Engine refactors | 3.2 setup split, 3.4 test gaps, 3.5 tooling, 3.6 UI split done; 3.3 done (tagged `Area` union, no `!` assertions left in setup). 3.1 turn-step cursor done (spec 01 built; see `docs/specs/01-turn-steps.md`, "As built") |
| 4 Economy and turn skeleton | Part 1 built: BRP ledger, the yearly spending limit, declarations of war at step 1 (35 / 10 BRPs), the U.S. entering in Spring 1942, Initiative reading real wars. Part 2 built: construction at step 8b (costs, dates, home-territory placement as an approximation until supply and control exist) and BRP grants at 9a. Not built: Year Start Sequence arithmetic, front options (spec 02, "As built") |
| 5 Movement, ZOC, supply | Spec written (03); not built |
| 6 Combat, air, naval | Tables and resolvers exist and are verified; spec written (04); not wired to actions |
| 7 Computer opponent | Spec written (05); not built (today's "computer" only places forces) |
| 8 Play screens | Setup screen done (mouse and touch); everything else waits for rules |
| Release 1 (1939 vs the computer) | Not reached |

Roughly: the data, map, scenarios, setup and checking tools are done; the game rules themselves (phases 4 to 7) are the large remaining part.

## Known gaps and risks

- **"Place the rest for me" bug:** fixed in a separate pull request (T08), waiting for your merge.
- **Review coverage was uneven.** #19, #20, #21 and #23 each got an independent adversarial review and their findings were fixed; **#22 (the map corrections) was merged without its review finishing** (a usage limit interrupted it). The map changes were checked by their author against the game data and the scan, and CI is green, but no second pair of eyes finished the job. Reviews were done by a fresh instance of the same model, not a stronger one.
- **Manual citations:** Ref 21.51 (naval) and Ref 20.44 (air) were checked against the Reference Manual text found online and are right (`RULES.md`, "Web research").
- **Legal and policy:** PR #21 (merged) includes code that reads the rules out of the game's program file. The repo contains no game code, text or art, but the README's legal note still says the rules come from the manuals; that line needs your decision and an update.
- **Open rule questions** (details in `docs/RULES.md`): who holds Greek hex EE27 in the original; why V39 is left out in 1944; Germany's Libya limit (7 factors, a reading of the page); six ground factors at each of Leningrad and Moscow; the Qattara no-setup rule; naval modifier for Vichy and Free French fleets; 25 coastal hexsides and a few beach details on the map.
- **Visual style:** the map and counters now follow the owner's pick of the "printed board" look (pale country tints, terrain marks, cardboard counters with unit symbols). Menus and status panels are still plain.

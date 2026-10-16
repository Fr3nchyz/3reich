# Progress baseline (2026-10-15)

Measured on `main` after the merge of PR #65 (choosing which units of a stack move). "The plan" is `docs/ROADMAP.md`; "the designs" are the specs in `docs/specs/`. This page is the checkpoint to compare against next time. The previous baseline (2026-10-13) said about 15% of a game existed.

## In one paragraph

You can open the game in a browser, pick any of the four scenarios (1939, Campaign, 1942, 1944), set up your forces by tapping (the computer sets up the other side), and then play the ground war: declare war, build units, receive grants, move, attack, take losses and advance. The computer can play either side, and you can watch two computers play each other. Air units, fleets, supply penalties, minor-country activation, strategic warfare, victory and surrender are not built, so a game cannot yet be won or lost by the rules. Roughly a third of a complete game exists (an estimate, not a measurement).

## Measured facts

| What | Value |
|---|---|
| Scenarios | all four can be set up and played from; automatic setup places 110, 110, 178 and 194 counters |
| Map | 1,755 hexes, 5,079 hexsides; corrected against the original game's map data; water edges drawn between land hexes that touch across a strait |
| Steps of the Sequence of Play that wait for the player or computer | 9 of about 50: Year Start part B, Determination of Player-Turn Order, 1 (declarations of war), 3 (front options), 6f (ground movement), 7h (ground combat), 8b (construction), 9a (BRP grants), 10b (save prompt). The rest are passed automatically |
| Automated tests | 1,387 unit tests and about 320 browser runs (mouse and touch). A sampled mutation test of the engine (`docs/MUTATION.md`) catches about 86 to 90 percent of deliberate breakages; weakest: control, movement, supply, grants |
| Checks on every change | lint (300-line file limit), type check, tests with a coverage floor, production build, browser tests |
| Code size | engine about 4,300 lines, screens about 2,600, computer opponent about 600 |
| Specs | 01 turn steps (built), 02 economy (mostly built), 03 movement and supply (partly), 04 combat and victory (ground combat built), 05 computer opponent (partly), 06 watch mode (built), 07 tap-to-attack (approved; tickets 07-1 to 07-7 merged, 07-9 layout and browser pass and 07-10 docs remain), 08 iPad zoom (built), 09 air units (approved with decision D1: displace; tickets 09-1 bases and range queries and 09-6 pure air combat resolver built, nothing wired; the rest not built), 10 stack unit selection (approved; tickets 10-1 engine query, 10-2 selection model, 10-3 session and tap flow, 10-4 Move card, 10-5 unit badges and 10-6 take back built; 10-7 why-not sentences and destination list, 10-8 layout and keyboard checks, 10-9 docs remain), 11 save and load (approved; not built) |

## Against the plan (`docs/ROADMAP.md`)

| Phase | Status |
|---|---|
| 1 Housekeeping | Done |
| 2 Read the original game's data | Done for the tables, map, start lines and scenarios. Not done: 2.5 compare scenario files, 2.6 write up PC-vs-board-game rule differences, 2.7 read the AI resources |
| 3 Engine refactors and tooling | Done (formatter deliberately left out) |
| 4 Economy and turn skeleton | Built: BRP ledger, spending limit, declarations of war, Initiative, Year Start part B, front options, construction, grants. Not built: strategic warfare, BRPs from conquest, setting up a minor's forces, Minor-Ally activation |
| 5 Movement, ZOC, supply, control | Built: control, stacking, zones of control, ground movement. Supply is calculated (pure queries) but not wired into the turn. Not built: supply penalties, strategic redeployment, fortress changes, air movement |
| 6 Combat, air, naval | Ground combat built (odds, Exchange losses, advance). Not built: attrition, exploitation, air, naval, strategic warfare, Russian winter, surrender, victory |
| 7 Computer opponent | Declares, builds, grants, moves toward objectives, attacks at good odds; setup is still a placeholder; no evaluator, no strength levels |
| 8 Play screens | Setup, map, movement, attack, log, watch mode done. Hex card, odds preview, tap-to-attack with loss and advance cards, iPad zoom buttons and choosing which units of a stack move are built. Not done: take back a move, save and load (last in the queue by the owner's choice), a pass on a real iPad |
| Release 1 (1939 vs the computer) | Not reached |

## Known gaps and risks

- **Review coverage was uneven.** #22 (the map corrections) was merged without its review finishing (a usage limit interrupted it). Later pull requests each got an independent adversarial review, by a fresh instance of the same model, not a stronger one.
- **Legal and policy:** PR #21 includes code that reads the rule tables out of the game's program file. The repo contains no game code, text or art, but the README's legal note still says the rules come from the manuals; that line needs the owner's decision and an update.
- **Open rule questions** (details in `docs/RULES.md` and `docs/FEEDBACK.md`): do friendly units cancel enemy zones of control and does every ground unit or only armor exert one; may an unsupplied unit attack; are unused BRPs kept at Year Start; may a hex be attacked more than once per turn; the fate of ports' air units and fleets when one infantry unit enters (air units alone in a hex are destroyed: confirmed by the product owner, not checked against the PC manual); who holds Greek hex EE27 in 1942; Germany's Libya limit; six ground factors at each of Leningrad and Moscow; naval modifier of Vichy and Free French fleets; a few coastal hexsides and beaches on the map.
- **Computer play is weak:** the idle stretch before the war on the U.S.S.R. is mostly gone (units with nothing in reach wait at the border of the power the computer plans to declare on; spec 05 "idle play"). Stalls remain: from Summer 1941 on the Axis still stands still in some games in front of fortified French hexes it will not assault (the Exchange limit), the computer has no stalemate breaker, makes no Front Option choices, and Italy never declares in the 1939 scenario.
- **Slow computer moves:** a rare computer action can hold the screen for about half a second; the watch-mode "turbo repaint" browser test fails about one run in four because of it (a fix is in progress).
- **Not tried on a real iPad.** Everything is tested in Chromium at iPad sizes; real Safari behaviour (touch, pinch, scrolling) is unverified.
- **Visual style:** the map and counters follow the owner's pick of the "printed board" look. The owner still finds the map less clear than the board and the DOS game; waiting for Frank's view.

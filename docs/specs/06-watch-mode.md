# 06. Watch two computers play

Status: requested by the product owner ("permit two computers to play against each other, so I can monitor progress"). Depends on spec 05 and on the self-play runner (docs/SELFPLAY.md).

## Goal

From the scenario menu the player can pick a third choice next to "play Axis" and "play Allies": **Watch the computer play both sides**. The computer plays the whole game, the player only looks: the map and the log update as it goes, and the game can be paused, slowed down, sped up, stepped, saved and replayed.

## Behaviour

- **Start.** Choose a scenario, choose the watch option, optionally type a seed (a random one is shown, so a game can be repeated; a whole number from 0 to 4294967295) and a number of Game Turns (1 to 99, or empty for the whole scenario), press the start button. A value that cannot be used is flagged next to the field (aria-invalid and a short message) and the game does not start. The options fold away once the game starts, so the map keeps its height; choosing the mode again brings them back. Both sides are set up with the engine's automatic setup (the same code the single-player computer uses for its side), then the computer plays whichever side is to act, one action at a time, through the same chooser (`chooseAction`) and the same `applyAction` as the single-player computer.
- **Same game as the self-play runner.** The same scenario and seed give the same actions as `npm run selfplay`, so a watched game can be repeated headless.
- **What is shown.** A bar that stays in view above the panels (beside the map on wide screens, under the pinned map on phones) with the controls and one status line: scenario, Game Turn (season and year), side to move, step, number of actions, and which side is acting. The map and the nation table update after every action; the log (newest first) says what each side did. The "Control and zones" overlay works as usual.
- **Stopping points.** The game ends when the scenario ends (End of game panel: BRPs per nation, counters and hexes controlled per side) or, if the player typed one, after that many Game Turns.
- **Stuck.** If the computer has no action to take, the engine refuses its action, it throws, or it makes more than 1000 actions without leaving a step (or 8000 within one Game Turn: the self-play runner's limits), watching stops with "The computer got stuck at step X". The state stays on screen to inspect. The computer never loops: the limits above stop it. The work is cut into slices of about 40 ms so the page can repaint between them; one slow computer action is not cut short, so a single action can still hold the page for about half a second.

## Controls

| Control | What it does |
| --- | --- |
| Pause / Play | Stops or resumes the run. Pause also stops a "Step to next turn" that is still running. |
| Speed | Slow (one action per 600 ms), Normal (150 ms), Fast (20 ms), Turbo (as fast as the time slices allow, with a repaint between slices). |
| Step one action | Pauses, then plays exactly one action. |
| Step to next turn | Pauses, then plays until the Game Turn changes (or the game ends). |
| Save game record | Downloads `<scenario>-seed<n>.json`: the self-play recording format (`format`, `scenario`, `seed`, `actions`, ...). `replay(ctx, newGame(scenario, seed), actions)` reproduces the game. |
| Take over as Axis / Allies | Turns the running game into a normal single-player game at this point; the player takes that side and the computer keeps the other. Only offered between actions, which is always the case in the browser: the click is handled between two actions. Still offered after the chosen Game Turn limit, not after the end of the scenario. |
| Stop watching | Leaves the watched game and starts a fresh single-player game, as the page does when it opens (the watched game is not kept; save the record first if it is wanted). Focus goes to the Mode menu. No confirmation question is asked. |

Taps on the map only select and inspect (hex info, pan, zoom); the player cannot act in the game.

## What it does not do

- No new rules and no changes to the engine. The computer's play is as weak as spec 05 says; watching is for monitoring it, not for judging strength.
- No loading of a saved record into the browser (replay is by `replay()` in tests or scripts).
- No different strength for each side, no hidden moves, no stepping backwards.
- Take over does not undo anything: it continues from the exact state, including a step half done.

## As built

- **Pure rules**: `src/ui/watchController.ts` (speeds, step modes, stuck limits, end of game; unit-tested with mutation checks). **Glue**: `watchPlay.ts` (new watched session, `watchSlice`, record, take over), `watchLoop.ts` (timer), `watchBar.ts` (bar, panel), `watchMenu.ts` (seed and Game Turn fields), `watchSummary.ts`, `watchRecord.ts`. The computer's one action is `computerAct` in `computerPlay.ts`, shared with the single-player ticks (so the same seed and scenario give exactly the self-play runner's actions: a test compares them). The setup uses `placeTheRest`, the single-player computer's own setup path.
- The mode is the third entry of the "Mode" menu ("Watch the computer play both sides"); the seed, a "Random seed" button and an optional "Stop after N Game Turns" field appear with it. The bar (Pause/Play, Step one action, Step to next turn, Speed) sits under the map; Save game record, Take over as Axis / Allies and Stop watching are in a panel at the top of the status column, kept as the same elements across redraws so a click is never lost at Fast or Turbo.
- Stuck limits are the runner's: 1000 actions at one step, 8000 in one Game Turn, no action, a refused action, an exception. The slice at Turbo and for "Step to next turn" is 40 ms (one slow action can still take about half a second).
- "Stop watching" starts a fresh single-player game (the menu's state at page load) and moves focus to the Mode menu. Take over keeps the exact state, including a step half done; the computer's memory of its movement targets is kept.
- The End of game counting (BRPs, counters, hexes) is `watchSummary.ts`, a copy of the logic of `scripts/selfplay/stats.ts` (holdings and forces): that file belongs to the Node-side script, so it is not imported into the browser bundle. `tests/watch-shared.test.ts` compares the two (counts, record keys, anomaly kinds) so they cannot drift apart; moving the logic into `src` and importing it from both would remove the copy. The status line is read aloud only when the state changes (running, paused, ended, stuck).
- The hex info line now also lists the counters in the hex ("Units: 2 x 2-infantry (Poland), ..."); a full unit panel is a separate task.
- In watch mode each ground move is logged as it happens (single-player folds them into one line per step).
- Tests: `tests/watch-controller.test.ts`, `tests/watch-play.test.ts`, `tests/watch-record-file.test.ts` (replays a downloaded record; run by the e2e), `tests/e2e/watch.spec.ts`. The e2e runs on a `PW_PORT` of your choice (default 4789).

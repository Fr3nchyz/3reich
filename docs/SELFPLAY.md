# Self-play: computer against computer

A headless runner that plays whole games with the computer on both sides, to test the engine and the computer and to see how a game goes. It uses only the pure engine and `src/ai`: the engine's automatic setup for every nation, then `chooseAction` for whichever side is to act, applied through `applyAction`, until the turn limit or the end of the scenario. It touches no UI code.

## Usage

```sh
npm run selfplay -- --scenario <1939|campaign|1942|1944|all> --turns <N|end> --seed <n> [--games k] [--out dir] [--no-verify] [--supply-effects on|off]
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--scenario` | One scenario, or `all` for the four | `1939` |
| `--turns` | Game Turns to play from the scenario's start, or `end` for the whole scenario | `4` |
| `--seed` | The seed of the first game (it drives the dice and the computer's tie-breaks) | `1` |
| `--games` | Run this many consecutive seeds (`seed`, `seed+1`, ...) per scenario | `1` |
| `--out` | Output folder (git-ignored) | `selfplay-out/` |
| `--no-verify` | Skip checking each chosen action against `legalActions` (faster; the engine still refuses illegal ones) | checks |
| `--supply-effects` | Play with the supply effects (Ref 19.4, 11.74, 12.21: cut-off units cannot move or advance and are eliminated at the end of their turn) `on` or `off`, set in the game's context (`GameContext.supplyEffects`) | the shipped `SUPPLY_EFFECTS_ENABLED` (off) |

The same seed always gives the same game (the runtime is the only thing that varies). The exit code is 1 when any game had an anomaly, 2 for a bad command line (a `--seed` outside 0 to 4294967295, an empty value, an `--out` that is a file, a flag, the repository itself or outside it), 3 if the run itself crashed. `--out` folders get a `.gitignore` of their own, and a folder that already holds files is overwritten file by file after a warning.

Examples: `npm run selfplay -- --scenario 1942 --turns end --seed 1` (about 25 s); `npm run selfplay -- --scenario all --turns end --seed 1 --games 10 --no-verify` (the four scenarios, ten seeds each).

## Output

For each game, in the output folder:

- `<scenario>-seed<n>.json`: the recorded action list (setup and play, in order) with the scenario, the seed and `supplyEffects` (whether the supply effects applied). Replay it with the engine in the context the recording names: `replay(recordingContext(recording), newGame(scenario, seed), recording.actions)` (`scripts/selfplay/args.ts`) gives the identical final state (a test checks this for every scenario, and for a game with the effects on). `supplyEffects: true` is written only when the effects were on; a recording without it (effects off, older ones, the browser's watch mode) replays with them off, the setting every such game was played with.
- `<scenario>-seed<n>.md`: a Markdown report with a final summary, the list of anomalies, and per Game Turn: BRP totals per nation, BRPs spent (by nation and by war / construction / grants / Front Options), wars declared, units built, grants, units moved (and by which side, with each side's ground units), ground combats (attacker eliminated / defender eliminated / Exchange), units and factors lost per side, hexes that changed hands, hexes and capitals/objectives held per side, units and factors per side, and the Front Options chosen.
- `comparison-<scenario>-seed<n>x<k>.md`: the one-page table of all games of the run (also printed), with the runtime of each.

The report counts, among the units lost, those eliminated for being out of supply at the end of their Player Turn ("Unsupplied lost ax / al", in the summary, per Game Turn and in the comparison table); the report's command line names the `--supply-effects` setting it ran with.

Measurements made with it, effects off against on and the computer's supply rules, are in spec 05 ("As built: the computer and supply").

The report's summary also lists the *idle* Player Turns: those in which a side with 10 or more ground units on the map neither moved a unit nor attacked (the comparison table counts them). It counts every ground unit, including ones that can reach nothing (a garrison on an island), so a few idle Allied turns are normal; a long run of idle turns for a side with units on the main front is what to look into. The summary also lists *churn*: a side that moves 5 or more units without a single attack for 3 or more Game Turns in a row, which is what a computer that marches without fighting looks like (a march to a border before a declaration of war shows up here too).

## Old against new: `npm run compare-games`

```sh
npm run compare-games [-- --base <git ref>] [--quick]
```

Plays the standard 22 games to their end (1939 seeds 1 to 10; Campaign, 1942 and 1944 seeds 1 to 4) on the base (default `origin/main`, checked out in a temporary worktree that is removed afterwards) and on the current checkout, uncommitted changes included, both at once. It then compares every recorded action of each pair. One line per game: `identical`, or the index of the first action that differs with the old and the new action, and the result of each side. `--quick` plays six games (1939 seeds 1 to 3, seed 1 of the others). It takes about a minute (`--quick`: 10 to 25 s). Exit code 1 when a game of the checkout has an anomaly its base game did not have (anomalies already on the base are listed but do not fail), 2 for a bad command line; differences are reported, not failures. Builders paste its summary in the pull request and the reviewer re-runs it (CLAUDE.md).

## Anomalies

A run never loops and never throws. It stops the game and lists the problem when it sees:

| Kind | Meaning |
| --- | --- |
| `stuck` | the computer has no action to take while the game waits |
| `refused` | the engine refused the action the computer chose |
| `illegal-choice` | the chosen action is not on the `legalActions` list (checked unless `--no-verify`) |
| `setup` | setup finished but the game did not start |
| `exception` | the computer or setup threw |
| `no-progress` | more than 1000 actions at one step |
| `turn-budget` | more than 8000 actions in one Game Turn |
| `negative-brp` | a nation's BRP total went below zero |
| `overstack` | a hex is over its stacking limit when a Player Turn ends |

The Vitest tests provoke each of these with a replacement chooser (`tests/selfplay.test.ts`).

## What it is for

Watching a change to the engine or the computer play out over many Game Turns, comparing seeds, and finding stalls. It is not a measure of play strength: the computer's movement and attack choices are simple policy (docs/RULES.md, "Computer opponent policy"), and Front Options and strategic choices are not made by the computer yet, so every Front stays on the default Option.

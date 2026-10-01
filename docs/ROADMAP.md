# Roadmap

**Primary mode: one player against the computer**, choosing either side. Two players on one screen comes for free once the engine exists, but is not the focus. Saves stay on the device (autosave plus a save file for backups); no online sync is planned.

Because the computer must play by the rules on its own, the engine enforces every rule. It exposes two operations used by both the UI and the AI: **list legal actions** for the current phase, and **apply an action**.

1. **Scaffold** (done): TypeScript + Vite project, seeded RNG, two-sided turn flow, tests, CI.
2. **Rules tables** (done): combat results, attrition, terrain, BRP costs, stacking, interception, naval/air modifiers, minor-country forces, 1939 economy. See `docs/RULES.md`.
3. **Map data**: digitize the reference-map scan (see `docs/SOURCES.md`) into `src/data/map.json` keyed by hex id (`K21`), with hex math (`src/engine/hex.ts`): terrain per hex, cities/ports/capitals/objectives, rivers, borders, fronts.
4. **1939 scenario data** from the Operations Manual (BRPs, territory, setup rules, force pools, allowable builds), with Peele's errata.
5. **Action engine and phases**: the full sequence of play as a phase machine; `legalActions(state)` and `applyAction(state, action)`.
6. **Economy procedures**: Year Start BRP calculation, spending limits, grants, construction (Ref 9-11).
7. **Movement, ZOC, stacking, supply** (Ref 4-7, 10).
8. **Combat procedures**: wire combat to the map; exploitation, attrition hex selection, air and naval combat (Ref 12, 20-21).
9. **UI**: map with pan/zoom, counters in our own art, unit tray, status and tables menus modelled on the original layout; large and readable, touch and mouse.
10. **Computer opponent v1**: rule-based, plays either side, with per-front and per-nation goals (see the AI article in The GENERAL, `docs/SOURCES.md`).
11. **Saving**: autosave every phase, named save slots, save/load to a file.
12. **First playable release: 1939 scenario vs the computer.**
13. **1942, 1944 and Campaign scenarios.**
14. **Stronger AI and difficulty levels.**
15. **Polish**: undo, tooltips, installable on the iPad home screen and offline (PWA), hosting with a private link.

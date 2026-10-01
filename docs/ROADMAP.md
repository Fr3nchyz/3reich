# Roadmap

1. **Scaffold** (done): TypeScript + Vite project, seeded RNG, two-sided turn flow, tests, CI.
2. **Rules tables** (done): combat results, attrition, terrain, BRP costs, stacking, interception, naval/air modifiers, minor-country forces, 1939 economy. See `docs/RULES.md`.
3. **Map data**: digitize the reference-map scan (see `docs/SOURCES.md`) into `src/data/map.json` keyed by hex id (`K21`), with hex math (`src/engine/hex.ts`): terrain per hex, cities/ports/capitals/objectives, rivers, borders, fronts.
4. **Scenarios**: 1939, 1942, 1944 and the 1939-1946 Campaign from the Operations Manual (BRPs, territory, setup rules, force pools, allowable builds), with Peele's errata.
5. **Phases**: the full sequence of play (Year Start Sequence, player turn steps 1-10) as an explicit phase machine.
6. **Economy procedures**: Year Start BRP calculation, spending limits, grants, construction (Ref 9-11).
7. **Movement, ZOC, stacking, supply** (Ref 4-7, 10).
8. **Combat procedures**: wire combat to the map; exploitation, attrition hex selection, air and naval combat (Ref 12, 20-21).
9. **UI**: map with pan/zoom, counters in our own art, unit tray, status and tables menus modelled on the original layout; large and readable.
10. **Hot-seat play and save/load.**
11. **Computer opponent** (see the AI article in The GENERAL, `docs/SOURCES.md`).
12. **Polish**: undo, tooltips, installable offline (PWA), GitHub Pages deploy.

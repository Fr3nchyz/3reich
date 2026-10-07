# Roadmap

**Primary mode: one player against the computer**, choosing either side. Two players on one screen comes for free once the engine exists, but is not the focus. Saves stay on the device (autosave plus a save file for backups); no online sync is planned.

The engine enforces every rule and exposes one API used by both the UI and the AI: `legalActions(state)` and `applyAction(state, action)`. Phases follow `docs/AUDIT.md`.

| Phase | Goal | Status |
|---|---|---|
| **A. Foundations** | Correct hex coordinates (`hex.ts`), action layer with events and replay, Initiative per Ref 11.1, scenario + required seed, headless-engine checks, invariant tests, map data types and validator | Done |
| **B. Map data** | Digitise the reference-map scan into `src/data/map.json` against `validateMap`; spot-check Ref 4.1-4.9; a read-only map viewer to compare with the scan | Done (open checks in RULES.md) |
| **C. Scenarios and turn structure** (in progress; scenario data, opening setup and the sequence of play as data are done) | All four scenarios (territory, setup, force pools, allowable builds, build dates) with Peele's errata (**data done**; the zones the map card does not draw are listed in RULES.md); the opening setup phase (**done**, with a placeholder automatic setup) and the sequence of play as data (**done**); the Player Turn phases themselves arrive with their rules; Year Start Sequence and economy state (year-start totals, spending, construction) | |
| **D. Movement, ZOC, stacking, supply, control** | Ref 4-7, 10, through `legalActions` | |
| **E. Combat procedures** | Offensive and exploitation, attrition hex selection, DoW and minor countries, air and naval combat (Ref 12-13, 20-21) | |
| **F. Play UI** (started: tap-to-place setup, zoom to the nation, counters on the map; works with mouse and touch) | Map, counters in our own art, unit tray, status and tables menus modelled on the original; touch and mouse. National markers are plain colours and names, with no Nazi symbols (flags included). Nothing important behind hover or right-click, so an iPad version stays cheap. | |
| **G. Computer opponent v1** | Rule-based, plays either side, only through `legalActions` | |
| | **First playable release: 1939 scenario vs the computer**, with autosave, save slots and save files | |
| **H. Fidelity and regression** | Golden games, a regression test for every corrected rule, comparison with the original in DOSBox; 1942, 1944 and Campaign scenarios; stronger AI and difficulty levels; offline install and hosting | |
| | **French interface (a later version; the English one comes first, and the player is a French speaker)**: all on-screen text from one translation table with a language switch, French names for nations, unit types and well-known cities with the English game terms kept in brackets (BRP), and the engine's messages as data (an id plus values) rather than English sentences, so they can be shown in either language | |

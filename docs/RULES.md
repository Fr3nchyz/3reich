# Rules reference

Target: Avalon Hill's **Third Reich PC** (1996, DOS/Windows 95, patch v1.38), a port of the board game *Rise and Decline of the Third Reich* (4th edition), with the differences listed in Peele's errata.

## Source priority

1. Peele's errata and PC-vs-board-game differences (overrides the manuals).
2. PC Reference Manual (rules) and Operations Manual (UI, scenarios).
3. The reference map card (map and charts).
4. In-game screenshots and video.
5. Board-game 4th edition, only where 1-4 are silent.

Links and download notes: [SOURCES.md](SOURCES.md). Cite manual sections (e.g. "Ref 12.2", "Ops 9.0") in code comments.

## Encoded so far

| File | Content | Source |
|---|---|---|
| `src/engine/combat.ts` | Offensive CRT, odds columns, full CA/CA1-3 counterattack loop, Exchange semantics; Quarterly Attrition table (#C units eliminated, #H hexes vacated) | Ref 12.1-12.2, 12.4; map card |
| `src/engine/terrain.ts` | Defence multipliers (x2 baseline, x3 mountain/swamp/river/crossing arrow/beach vs seaborne, x4 fortress, not cumulative); attrition-occupation exclusions; basing | Ref 4.5-4.8; terrain chart |
| `src/engine/tables.ts` | BRP costs (DoW 35/10, Offensive option 15, per-factor build costs), stacking limits, interception table, naval and air DRMs, minor-country forces | Map card; Ref 5.0, 13.0 |
| `src/engine/nations.ts` | 1939 BRPs and growth rates; spending limit = half total, rounded down | Ops 1939 scenario; status screen |
| `src/engine/game.ts` | Two sides, seasons, Axis moves first in 1939 | Ops 1939 scenario |

## Map

- Hex map of Europe, North Africa and the Near East. Pointy-top hexes in horizontal rows.
- **Coordinates:** rows are lettered top to bottom `A`-`Z`, then `AA`, `BB`, ... `NN` (40 rows). Columns are numbered and run **diagonally down-left** (a column number stays the same as you step down-left). Row `A` spans columns 24-66; row `NN` spans 10-37. Hexes are named row+column, e.g. `K21` (Plymouth), `AA25` (Brindisi), `U40-U41` (Kerch Strait hexside), `P25` (Maginot hex).
- This is an axial system: with `q` = column, `r` = row index, the six neighbours of `(q, r)` are `(q±1, r)`, `(q, r-1)`, `(q-1, r-1)`, `(q, r+1)`, `(q+1, r+1)`.
- Fronts: Western, Eastern, Mediterranean (front-boundary hexsides drawn in red on the map).
- Off-map boxes: United States, Murmansk Convoy (Allies / Axis halves), Lend-Lease.
- Named exceptions in Ref 4.3-4.9: Qattara hexsides (NN25-NN26, NN26-NN27, MM26-NN26, MM27-NN26), crossing arrows (Denmark x3, Scotland, Turkish Straits x2, Kerch, Messina), Brindisi and Plymouth port sides, W52 Caspian peninsula ignored, DD28 islands, Malta and Gibraltar permanent fortresses, Maginot (Metz, Strasbourg, P25) not fortresses in 1942/1944, West Wall (Stuttgart, Frankfurt, Bonn, Essen) fortresses from 1944 if Axis-held, Sevastopol conditional.

## Scenarios (Ops 9.0)

Four: 1939 (Fall '39-Summer '42, 12 turns max), 1942, 1944, Campaign (1939-1946). Each lists per nation: BRPs at start, growth rate, territory controlled at start, setup requirements, force pool (counter pictures), allowable builds. 1939: Italy 75/20%, France 85/30%, Britain 125/40%, Germany 150/50%, USSR 90/30%, USA 270/60%. Order of deployment: Poland, Italy, France, Britain, USSR, Germany. USA auto-declares war on Germany in Allied Spring '42. Apply Peele's errata to the 1939 setup text.

## Discrepancies to keep in mind

- The in-game status screen at 1939 setup shows "Initiative - Allies", but the Ops manual says "The Axis moves first" in 1939. The engine follows the manual.
- The printed interception table lists "25-30" and "30+"; 30 is treated as 25-30.
- Odds below 1:1: the manual says "fractions are ignored"; the engine rounds in the defender's favour (board-game convention). Verify in play.

## Open questions

- Rest of the Reference Manual not yet encoded: movement and ZOC (Ref 4-7), supply (10), front options (11), exploitation (12.3), DoW and alliances (13), minor countries (14-17), Russian winter and surrender (18), air and naval (20-21), strategic warfare (9), special national rules.
- Force pools and allowable builds per scenario (pictures in the Ops manual; transcribe by eye).
- Victory conditions (Ref 2.0-2.1).
- Hex-by-hex map data (see AGENT_BRIEF task 1).

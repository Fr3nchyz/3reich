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
| `src/engine/terrain.ts` | Land terrain and static hex features; defence multipliers (x2 baseline, x3 mountain/swamp/river/crossing arrow/beach vs seaborne, x4 fortress, not cumulative); attrition-occupation exclusions; basing | Ref 4.5-4.8; terrain chart |
| `src/engine/tables.ts` | BRP costs (DoW 35/10, Offensive option 15, per-factor build costs), stacking limits, interception table, naval and air DRMs, minor-country forces | Map card; Ref 5.0, 13.0 |
| `src/engine/hex.ts` | Hex ids (`K21`, `AA25`), axial neighbours, distance, hexside ids (`MM26-NN26`) | Ref 4.1 |
| `src/engine/map.ts` | Map data model (land/sea per hex, crossability per hexside, fortress kinds) and `validateMap` | Ref 4.1-4.9 |
| `src/engine/game.ts` | New game from a scenario and a required seed; Game Turn order; Initiative per Ref 11.1; Year Start Sequence hook (empty) | Ref 11.1; Ops 5.1-5.3 |
| `src/engine/actions.ts` | `legalActions`, `applyAction` (returns events), `replay` | (engine API) |
| `src/engine/nations.ts` | Spending limit = half the total, rounded down | Ref 10.0 |
| `src/data/map.json` (+ `map.ts`) | The full map: 1,755 playable hexes (1,320 with land), 5,079 hexsides. Per hex: land terrain, sea, beach/city/port/capital/objective, name, fortress kind, country, front, US Box entry. Per hexside: land/sea crossability, river, crossing arrow, Qattara, Suez Canal, national and front boundaries | Reference map scan via `scripts/map/`; Ref 2.1, 4.1-4.9 |
| `src/ui/mapView.ts` | Read-only SVG map (pan, zoom, pinch, hover info, front overlay) drawn in our own style | (UI) |
| `src/data/scenario-1939.ts` | 1939 scenario: dates, first side, BRPs, growth rates, statuses (Italy, USSR, USA neutral) | Ops 9.0; status screen |

## Map

- Hex map of Europe, North Africa and the Near East. Pointy-top hexes in horizontal rows.
- **Coordinates (Ref 4.1):** rows are lettered top to bottom `A`-`Z`, then `AA`, `BB`, ... `NN` (40 rows). Numbered hexrows run **diagonally from northwest to southeast**: a hex keeps its number as you step down-right. Row `A` spans numbers 24-66; row `NN` spans 10-37. Hexes are named row+number, e.g. `K21` (Plymouth), `AA25` (Brindisi), `U40-U41` (Kerch Strait hexside), `P25` (Maginot hex). Ref 4.1 examples: Lisbon V8, Marrakech EE2, Dublin H22, Rome Y22, Berlin L31, Helsinki D41, Moscow H47, Perma D61.
- This is the standard axial system: `q` = hexrow number, `r` = row index (A = 0 ... Z = 25, AA = 26 ... NN = 39). The six neighbours of `(q, r)` are `(q±1, r)`, `(q, r-1)`, `(q+1, r-1)`, `(q-1, r+1)`, `(q, r+1)`. The hexsides the manual names (Qattara, Suez, Kerch) are adjacency tests in `tests/hex.test.ts`. An earlier version of this file said the hexrows run down-left; that was wrong (see `docs/AUDIT.md`, B1).
- Fronts: Western, Eastern, Mediterranean (front-boundary hexsides drawn in red on the map).
- Off-map boxes: United States, Murmansk Convoy (Allies / Axis halves), Lend-Lease.
- Named exceptions in Ref 4.3-4.9: Qattara hexsides (NN25-NN26, NN26-NN27, MM26-NN26, MM27-NN26), crossing arrows (Denmark x3, Scotland, Turkish Straits x2, Kerch, Messina), Brindisi and Plymouth port sides, W52 Caspian peninsula ignored, DD28 islands, Malta and Gibraltar permanent fortresses, Maginot (Metz, Strasbourg, P25) not fortresses in 1942/1944, West Wall (Stuttgart, Frankfurt, Bonn, Essen) fortresses from 1944 if Axis-held, Sevastopol conditional.

### How the map data was made

`scripts/map/extract.py` reads the 300 dpi scan of the reference map (not in the repo; see `docs/SOURCES.md`) and writes `src/data/map.json`. It is reproducible: the same scan gives a byte-identical file.

1. **Grid:** a hexagon template is matched across the scan and a cubic lattice fitted to 1,792 detected hex centres (median error 1 px). The 8 Ref 4.1 example cities land on their stated hexes.
2. **Hexes:** land terrain and sea are measured from the printed colours. Solid black and grey areas are unplayable (Ref 4.2-4.3).
3. **Hexsides:** colours on both sides decide land and sea crossability; blue lines are rivers; thick black lines are borders; red lines are front boundaries.
4. **Curated by eye** (`scripts/map/curated.py`): the 197 printed city names and symbols, country seeds, crossing arrows, Qattara, Suez, fortresses, US Box entry hexes, and a few corrections.
5. **Derived:** countries by flood fill inside borders; fronts per country, split where a red line divides one (East Prussia, Bessarabia are Eastern), with Mediterranean colonies (Gibraltar, Malta, Cyprus, Corsica) on that front; all-sea hexes get the front of their sea.

Checks (`tests/map-data.test.ts`): `validateMap`, one connected map, Ref 4.1 and 4.7 example hexes, the 42 Objectives of Ref 2.1 each on its stated Front, Athens and Stockholm as the only capital-ports, the 8 crossing arrows, Qattara, Suez, fortresses, Switzerland unplayable.

## Scenarios (Ops 9.0)

Four: 1939 (Fall '39-Summer '42, 12 turns max), 1942, 1944, Campaign (1939-1946). Each lists per nation: BRPs at start, growth rate, territory controlled at start, setup requirements, force pool (counter pictures), allowable builds. 1939: Italy 75/20%, France 85/30%, Britain 125/40%, Germany 150/50%, USSR 90/30%, USA 270/60%. Order of deployment: Poland, Italy, France, Britain, USSR, Germany. USA auto-declares war on Germany in Allied Spring '42. Apply Peele's errata to the 1939 setup text.

## Discrepancies to keep in mind

- The in-game status screen at 1939 setup shows "Initiative - Allies", but the Ops manual says "The Axis moves first" in 1939, and Ref 11.1 agrees (Axis 225 vs Allies 210). The engine follows the manuals.
- Ref 11.1 totals are not alliance totals: Italy's BRPs always count for the Axis (the status screen's 225 includes neutral Italy), US BRPs count from Summer 1942, Soviet BRPs once the USSR is at war with Germany. The engine approximates "at war with Germany" by the USSR having joined the Allies until declarations of war are modelled.
- The printed interception table lists "25-30" and "30+"; 30 is treated as 25-30.
- Odds below 1:1: the manual says "fractions are ignored"; the engine rounds in the defender's favour (board-game convention). Verify in play.

## Open questions

- Rest of the Reference Manual not yet encoded: movement and ZOC (Ref 4-7), supply (10), front options (11), exploitation (12.3), DoW and alliances (13), minor countries (14-17), Russian winter and surrender (18), air and naval (20-21), strategic warfare (9), special national rules.
- Force pools and allowable builds per scenario (pictures in the Ops manual; transcribe by eye).
- Victory conditions (Ref 2.0-2.1).
- Map details to confirm against the original game (DOSBox) or a clean copy of the printed map:
  - Coastal "sliver" hexes where a coastline only clips a corner (S42, V39, H26, J29, EE19, KK25, CC28): currently land.
  - Beaches (36 detected from the tan coastal strip): the full list should be checked.
  - Spelling of small-print minor city names (e.g. Ragusa, Mumanis, Kaf).
  - Fronts of all-sea hexes are inferred from which sea they belong to; enclosed waters (Adriatic, Aegean, Azov, Gulf of Bothnia) take the front of their coasts.

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
| `src/engine/context.ts` | `GameContext` (map + scenario), passed with the state to `legalActions`, `applyAction` and `replay` so the engine imports no data | (engine API) |
| `src/engine/setup.ts`, `autosetup.ts` | Opening setup phase: owners deploy in the scenario's order; placement legality (territory, base suitability, stacking, Anglo-French rule, factor limits), requirement checks before Done, setup status per scenario; a placeholder automatic setup | Ops 4.0, 4.1, 7.0; Ref 5.0, 17.3, 26.0, 29.0 |
| `src/engine/sequence.ts` | The Sequence of Play as typed data: Year Start Sequence, Game Turn steps, the ten Player Turn steps and their sub-steps, with Ops section ids | Map card; Ops 5.0 |
| `src/data/map.json` (+ `map.ts`) | The full map: 1,755 playable hexes (1,320 with land), 5,079 hexsides. Per hex: land terrain, sea, beach/city/port/capital/objective, name, fortress kind, country, front, US Box entry. Per hexside: land/sea crossability, river, crossing arrow, Qattara, Suez Canal, national and front boundaries | Reference map scan via `scripts/map/`; Ref 2.1, 4.1-4.9 |
| `src/ui/mapView.ts` | Read-only SVG map (pan, zoom, pinch, hover info, front overlay) drawn in our own style | (UI) |
| `src/data/scenario-1939.ts`, `scenario-1942.ts`, `scenario-1944.ts`, `scenario-campaign.ts` | The four scenarios: dates, first side, BRPs, growth rates, statuses; per owner the territory controlled at start, opening setup requirements, force pool and allowable builds (counter by counter, with "in/after" build dates); order of deployment; wars and Minor-Allies at start; Year Start Sequence and Strategic Warfare at start; machine-readable scenario rules; prose rules not yet applied | Ops 9.0 pp. 20-27; Ref 17.3, 26.0, 29.0, 35.0; Peele errata; status screen |
| `src/data/counters.ts`, `axis-minors.ts`, `zones.ts` | Shared shorthand for counters, the Axis Minor-Allies' pools and setup areas, and the zones the map card does not outline (islands, mainland France, unplaced regions) | Ops 9.0; Ref 17.3 |

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

All four are encoded as data: 1939, 1942, 1944 and Campaign. Each lists per owner the territory controlled at start, setup requirements, force pool (counter pictures on the page) and allowable builds, read off the manual pages counter by counter.

| | 1939 | 1942 | 1944 | Campaign |
|---|---|---|---|---|
| Duration | Fall '39 - Summer '42 (12 turns) | Spring '42 - Winter '44 (12) | Spring '44 - Spring '46 (9) | Fall '39 - Summer '45 (24) |
| Moves first | Axis | Axis | Allies | Axis |
| Germany BRPs / growth | 150 / 50% | 290 (245 + 45 for Minor-Allies) / 50% | 370 (325 + 45) / 50% | 150 / 50% |
| Britain | 125 / 40% | 160 / 40% | 220 / 40% | 125 / 40% |
| USSR | 90 / 30% (neutral) | 110 / 30% | 130 / 30% | 90 / 30% (neutral) |
| USA | 270 / 60% (neutral) | 270 / 60% | 400 / 60% | 270 / 60% (neutral) |
| Italy | 75 / 20% (neutral) | 90 / 20% | out of the game | 75 / 20% (neutral) |
| France | 85 / 30% | Vichy, inactive German Minor-Ally | out | 85 / 30% |
| Victory conditions | Ref 2.0-2.1 | Ref 2.0, 2.2 | Ref 2.0, 2.3 | Ref 2.0, 2.4 |

- **Order of deployment.** 1939 and Campaign: Poland, Italy, France, Britain, USSR, Germany. 1942: USA, Britain, Free France, USSR, Italy, Germany, Finland, Rumania, Bulgaria, Hungary, Vichy France. 1944: USA, Britain, Free France, USSR, Germany, Finland, Rumania, Bulgaria, Hungary.
- **Build dates.** The Campaign, 1942 and 1944 pages star some builds ("in/after 1942", "in/after Summer '42", "in/after 1943", "in/after 1944"); these are `from` on the counter. The 1939 page has none.
- **Cross-checks between pages.** The 1942 Italian and Soviet pools plus builds equal the Campaign's pools plus builds with its dated builds included, counter for counter; the 1942 US pool and builds equal the Campaign's; the Minor-Allies' pools equal the Minor Country Forces chart; Poland's pool does too.
- **Scenario rules by machine.** US automatic declaration (35 BRPs, Allied Spring '42; 1939 and Campaign), no Allied Seaborne Invasion in Summer '42 (1939 only), no BRP growth in the 1940 YSS (1939 and Campaign), no war on a country neutral at the start (1944), units east of the Polish Partition Line eliminated after the Axis Fall '39 turn.
- **Year Start Sequence at the start.** None in 1939 and Campaign. 1942 and 1944: only Strategic Warfare construction; Germany starts with 6 submarine factors (1942); the USA with 2 ASW and 3 SAC and Britain with 2 ASW and 2 SAC (1944).
- Peele's errata applied to the German 1939 setup text: no 20-factor allowance for Finland, Hungary, Rumania and Bulgaria, but no more than 5 factors in Finland.

### Zones: territory the map card does not outline

Several pages name territory that the printed map does not draw: the "scenario start line" (the U.S.S.R. east/west, Libya east/west of Tobruk, Italy north/south in 1944), the Polish Partition Line, the Vichy France hexes, and a few regions. They are `zones` in each scenario, with `hexes: null` until known. `tests/scenario-data.test.ts` lists exactly which zones are unresolved, so the open questions below cannot drift. Islands (Corsica, Sicily, Sardinia, Rhodes) and mainland France are read off the digitised map.

## Opening setup and the sequence of play

**Setup** (Ops 4.0-4.1, 7.0). A new game starts in the `setup` phase. Each owner in the scenario's order of deployment places its Force Pool one counter at a time (`SETUP_PLACE`), may take counters back (`SETUP_REMOVE`), and presses Done (`SETUP_DONE`); after the last owner the first Player Turn begins. A placement is legal if:

- the hex is in the owner's territory (countries and zones controlled at start, plus the "may also set up in" permissions such as Germany's Finland, Hungary, Rumania and Bulgaria); counters named by an all-in requirement (Poland: all in Poland; Italy: fleets in Mediterranean ports; the U.S. Box) are confined to its areas;
- it suits the counter: ground units on land, air units on a city, port or capital, fleets in a port (Ref 4.7);
- stacking holds (Ref 5.0): two ground units per hex (three in London if all British; airborne never count), 5 air factors per base, 36 naval factors per port; before 1942 British and French units do not share a hex (Ref 26.0);
- a maximum such as Peele's five factors in Finland is not exceeded.

Done is legal when every counter is placed and every requirement is met: the units the page names ("at least", Ops 4.1), the 20 German factors on the Eastern Front (Western Front hexes next to Poland count for the opening setup; units in Rumania or Turkey do not), the Soviet cities, and so on. `setupStatus` says whether a scenario can be set up yet: 1939 and Campaign can; 1942 and 1944 wait on the zones in "Open questions". `autoSetup` (and `autoSetupOwner`, which finishes one nation and keeps counters already placed) produces a legal, not sensible, setup. In the app you set up your own nations by tapping (pick a counter, tap a yellow hex; a Place / Take back switch; or let the game place the rest) and the computer sets up the other side with that placeholder until it chooses its own.

**Sequence of play** (`sequence.ts`, from the map card, with the Ops 5.0 section for each step). The engine plays only the steps whose rules are implemented; the rest follow as their rules are written:

| Step | Status |
|---|---|
| Year Start Sequence (A strategic warfare, B BRP totals, C SW construction) | Hook only; not run |
| II.B Determination of Player-Turn Order (Ref 11.1) | Done |
| II.A Russian-Winter roll; Player Turn steps 1-10 and their sub-steps | Not yet; a Player Turn is one End Turn action |

The U.S. units that set up in the U.S. Box in Spring '42 (1939 and Campaign) are not placed yet: that belongs with the Declaration of War rules.

## Discrepancies to keep in mind

- The in-game status screen at 1939 setup shows "Initiative - Allies", but the Ops manual says "The Axis moves first" in 1939, and Ref 11.1 agrees (Axis 225 vs Allies 210). The engine follows the manuals.
- Ref 11.1 totals are not alliance totals: Italy's BRPs always count for the Axis (the status screen's 225 includes neutral Italy), US BRPs count from Summer 1942, Soviet BRPs once the USSR is at war with Germany. The engine approximates "at war with Germany" by the USSR having joined the Allies until declarations of war are modelled.
- The printed interception table lists "25-30" and "30+"; 30 is treated as 25-30.
- Odds below 1:1: the manual says "fractions are ignored"; the engine rounds in the defender's favour (board-game convention). Verify in play.

## Open questions

- Rest of the Reference Manual not yet encoded: movement and ZOC (Ref 4-7), supply (10), front options (11), exploitation (12.3), DoW and alliances (13), minor countries (14-17), Russian winter and surrender (18), air and naval (20-21), strategic warfare (9), special national rules.
- **Zones whose hexes are unknown** (they are drawn by the original program and are not on the printed map card). A screenshot of each setup screen with the red lines visible would settle them:
  - 1939 / Campaign: the **Polish Partition Line** (German units east of it are eliminated at the end of Fall 1939).
  - 1942: the **scenario start line** (U.S.S.R. east/west; Libya at Tobruk, with Tobruk and east British, west Italian), and the **Vichy France** hexes of European France (Ref 35.0), which also fix the German-held rest of France.
  - 1944: the **scenario start line** (U.S.S.R. east/west; Italy north/south).
  - 1942 and 1944: **European Turkey** (Bulgarian setup, Ref 17.3), the extent of **Eastern Europe** (Hungarian and Rumanian setup), and which ports count as **Baltic, North Sea and Atlantic** ports for German fleets. The map data does not tag ports by sea.
- The Britain "Controlled at start" lists in 1942 and 1944 leave out Egypt, but the setup text places British units there (1942) and Egypt is British in 1939. Egypt is encoded as British in all four scenarios.
- The 1942 USSR setup: "at least six ground factors must set up in and/or adjacent to Leningrad and Moscow". Encoded as one total across both; the page does not say whether it applies to each city.
- Sicily's hexes (DD19, DD20, DD21, EE19, EE20, EE21) are the Italian land hexes there; DD19 and EE19 are coastal slivers (see below).
- Setup assumptions to check against the original: a nation must place every Force Pool counter at setup (the manual does not say it may hold some back); partial air units at setup (Ops 4.11) are not offered; "double city" air stacking (10 and 15 factors) is not on the map data, so every base holds 5; Germany's ban on setting up in Bessarabia in Fall 1939 (Ref 29.0) is not enforced because Bessarabia's hexes are not marked; Axis Minor-Allies' "Axis-controlled hexes only" (Ref 17.3) is carried in the data but not yet checked.
- Victory conditions (Ref 2.0-2.1).
- Map details to confirm against the original game (DOSBox) or a clean copy of the printed map:
  - Coastal "sliver" hexes where a coastline only clips a corner (S42, V39, H26, J29, EE19, KK25, CC28): currently land. DD19 (Sicily's west tip) looks like another.
  - The Strait of Messina: DD21 (Messina) and DD22 touch, and the map marks Sicily's hexes as joined to the mainland by hex adjacency, while many hexsides between hexes of one island are marked "coastline only" (not crossable by land). Check how the original treats Sicily and Sardinia before writing movement.
  - Beaches (36 detected from the tan coastal strip): the full list should be checked.
  - Spelling of small-print minor city names (e.g. Ragusa, Mumanis, Kaf).
  - Fronts of all-sea hexes are inferred from which sea they belong to; enclosed waters (Adriatic, Aegean, Azov, Gulf of Bothnia) take the front of their coasts.

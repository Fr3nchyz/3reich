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
| `src/engine/combat.ts` | Offensive CRT, odds columns, full CA/CA1-3 counterattack loop, Exchange semantics; Quarterly Attrition table (#C units eliminated, #H hexes vacated) | Ref 12.1-12.2, 12.4; map card; verified against the game's data (`GAME_DATA.md`, "Rule tables") |
| `src/engine/terrain.ts` | Land terrain and static hex features; defence multipliers (x2 baseline, x3 mountain/swamp/river/crossing arrow/beach vs seaborne, x4 fortress, not cumulative); attrition-occupation exclusions; basing | Ref 4.5-4.8; terrain chart; the game's terrain chart screen |
| `src/engine/tables.ts` | BRP costs (DoW 35/10, Offensive option 15, per-factor build costs), stacking limits, interception table, naval and air DRMs, minor-country forces | Map card; Ref 5.0, 13.0; verified against the game's data (`GAME_DATA.md`, "Rule tables") |
| `src/engine/hex.ts` | Hex ids (`K21`, `AA25`), axial neighbours, distance, hexside ids (`MM26-NN26`) | Ref 4.1 |
| `src/engine/map.ts` | Map data model (land/sea per hex, crossability per hexside, fortress kinds) and `validateMap` | Ref 4.1-4.9 |
| `src/engine/game.ts` | New game from a scenario and a required seed; Game Turn order; Initiative per Ref 11.1 | Ref 11.1; Ops 5.1-5.3 |
| `src/engine/yearstart.ts`, `frontoptions.ts`, `minors.ts` | Year Start Sequence part B (Base growth, Minor-Ally BRPs, spending limit); Front Options at step 3; a minor country's forces as counters | Ref 9.2, 10.0, 11.21, 14.0; Ops 6.0 |
| `src/engine/actions.ts` | `legalActions`, `applyAction` (returns events), `replay` | (engine API) |
| `src/engine/nations.ts` | Spending limit = half the total, rounded down | Ref 10.0 |
| `src/engine/context.ts` | `GameContext` (map + scenario), passed with the state to `legalActions`, `applyAction` and `replay` so the engine imports no data | (engine API) |
| `src/engine/setup.ts`, `autosetup.ts` | Opening setup phase: owners deploy in the scenario's order; placement legality (territory, base suitability, stacking, Anglo-French rule, factor limits), requirement checks before Done, setup status per scenario; a placeholder automatic setup | Ops 4.0, 4.1, 7.0; Ref 5.0, 17.3, 26.0, 29.0 |
| `src/engine/attack.ts`, `attack-losses.ts`, `attack-rules.ts`, `combat-record.ts` | Ground combat at step 7h: `ATTACK` (adjacent enemy hex, one attack per unit), odds from factors and the defender multiplier, seeded dice through `resolveOffensiveCombat`, Exchange loss allocation (`ALLOCATE_LOSSES`), `ADVANCE` into the emptied hex with the setup stacking rules | Ref 12.1-12.2, 4.5, 5.0, 26.0; PC README 14.23 |
| `src/engine/sequence.ts` | The Sequence of Play as typed data: Year Start Sequence, Game Turn steps, the ten Player Turn steps and their sub-steps, with Ops section ids | Map card; Ops 5.0 |
| `src/data/map.json` (+ `map.ts`) | The full map: 1,755 playable hexes (1,320 with land), 5,079 hexsides. Per hex: land terrain, sea, beach/city/port/capital/objective, name, fortress kind, country, front, US Box entry. Per hexside: land/sea crossability, river, crossing arrow, Qattara, Suez Canal, national and front boundaries | Reference map scan via `scripts/map/`; Ref 2.1, 4.1-4.9 |
| `src/ui/mapView.ts` (+ `mapGeometry`, `mapLayers`, `mapCities`, `mapCounters`, `mapStyle`, `viewport`, `gestures`, `tap`) | Read-only SVG map (pan, zoom, pinch, hover info, front overlay) drawn in our own style; `mapView` wires the pieces together | (UI) |
| `src/main.ts`, `src/ui/session*.ts`, `statusView.ts`, `setupView.ts`, `statusBind.ts`, `mapSync.ts`, `shell.ts`, `format.ts` | The page: one `Session` per game, its tap and button handlers, and the HTML for the status area. No rules; every change goes through engine actions | (UI) |
| `src/data/scenario-1939.ts`, `scenario-1942.ts`, `scenario-1944.ts`, `scenario-campaign.ts` | The four scenarios: dates, first side, BRPs, growth rates, statuses; per owner the territory controlled at start, opening setup requirements, force pool and allowable builds (counter by counter, with "in/after" build dates); order of deployment; wars and Minor-Allies at start; Year Start Sequence and Strategic Warfare at start; machine-readable scenario rules; prose rules not yet applied | Ops 9.0 pp. 20-27; Ref 17.3, 26.0, 29.0, 35.0; Peele errata; status screen |
| `src/data/counters.ts`, `axis-minors.ts`, `zones.ts` | Shared shorthand for counters, the Axis Minor-Allies' pools and setup areas, and the zones the map card does not outline (islands, mainland France, the Polish Partition Line, Eastern Europe, European Turkey, the Baltic, North Sea and Atlantic ports) | Ops 9.0; Ref 17.3, 29.0; original game files |
| `src/data/gamedata.ts` | Facts decoded from the original game's files by `scripts/gamedata/extract.ts`: the hexes each control bitmap marks and the hexsides each line runs along. Generated; never edited by hand | `*.CON`, `NSPPLINE.BIN`, `1942LINE.BIN`, `1944LINE.BIN` (see [GAME_DATA.md](GAME_DATA.md)) |

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

Several pages name territory that the printed map does not draw: the "scenario start line" (the U.S.S.R. east/west, Libya east/west of Tobruk, Italy north/south in 1944), the Polish Partition Line, the Vichy France hexes, and a few regions. They are `zones` in each scenario. Every zone now has hexes; `tests/scenario-data.test.ts` fails if one goes back to `hexes: null`. Where each comes from:

| Zone | Source | Hexes |
|---|---|---|
| Islands (Corsica, Sicily, Sardinia, Rhodes), mainland France | Our digitised map | 1, 6, 5, 1; 57 |
| 1942 U.S.S.R. east / west of the start line | `USSR42.CON` / `GERM42.CON` (the Soviet land hexes each marks) | 389 / 92 (Leningrad, Moscow, Sevastopol Soviet; Kiev, Kharkov, Odessa German) |
| 1942 Libya east of Tobruk (inclusive) / west | `BRIT42.CON` / `ITALY42.CON` | 8 / 53 |
| 1942 Vichy France (without Corsica) / German-held France | `VICHY42.CON` / `GERM42.CON` less Vichy | 17 / 40 |
| 1944 U.S.S.R. east / west of the start line | `USSR44.CON` / `GERM44.CON` | 443 / 37 (Smolensk, Kharkov and the Crimea Soviet; Minsk, Kiev, Dnepropetrovsk, Odessa German) |
| 1944 Italy south (mainland) / north (without Rhodes) | `BRIT44.CON` less Sicily and Sardinia / `GERM44.CON` less Rhodes | 10 / 26 |
| Eastern Europe (Baltic States, Poland east of the line, Bessarabia) | `EASTEURP.CON` | 18 + 11 + 5 |
| Poland east of the Polish Partition Line (1939, Campaign) | `EASTEURP.CON` (its Polish hexes) | 11 |
| European Turkey | Our map: Turkish land reached from Istanbul without taking the two Straits crossing arrows | 3 (Z32, Z33, AA31) |
| Baltic, North Sea and Atlantic ports | Our map: ports on waters reached from the open Atlantic without entering a Mediterranean-Front hex (so not the Mediterranean, Black Sea, Azov or Caspian) | 30 |

The line files are the independent cross-check, since they are separate files from the bitmaps: inside each country, every hexside of `1942LINE.BIN`, `1944LINE.BIN` and `NSPPLINE.BIN` lies exactly between the two zones, and every land-crossable hexside between them is on the line (`tests/gamedata.test.ts`, on the committed zones; `scripts/gamedata/extract.ts`, on the whole bitmaps). The bitmaps were used for the hexes because they give each side directly; a flood fill across the lines agrees except where our map has a coast the original does not. The extractor also compares each owner's "controlled at start" with its bitmap: the whole countries, which come from the printed pages, agree apart from the differences under "Discrepancies"; for the zones, which are taken from the bitmaps, that comparison only confirms the extraction.

The original also marks a few coastal hexes that our map calls sea (listed under "Discrepancies"). They are committed with their zone and join it as soon as the map work makes them land of the zone's country, without regenerating anything; only the test that lists them, and any test of a map-defined island those hexes belong to, need updating then.

## Opening setup and the sequence of play

**Setup** (Ops 4.0-4.1, 7.0). A new game starts in the `setup` phase. Each owner in the scenario's order of deployment places its Force Pool one counter at a time (`SETUP_PLACE`), may take counters back (`SETUP_REMOVE`), and presses Done (`SETUP_DONE`); after the last owner the first Player Turn begins. A placement is legal if:

- the hex is in the owner's territory (countries and zones controlled at start, plus the "may also set up in" permissions such as Germany's Finland, Hungary, Rumania and Bulgaria); counters named by an all-in requirement (Poland: all in Poland; Italy: fleets in Mediterranean ports; the U.S. Box) are confined to its areas;
- it suits the counter: ground units on land, air units on a city, port or capital, fleets in a port (Ref 4.7);
- stacking holds (Ref 5.0): two ground units per hex (three in London if all British; airborne never count), 5 air factors per base, 36 naval factors per port; before 1942 British and French units do not share a hex (Ref 26.0);
- a maximum such as Peele's five factors in Finland is not exceeded.

Done is legal when every counter is placed and every requirement is met: the units the page names ("at least", Ops 4.1), the 20 German factors on the Eastern Front (Western Front hexes next to Poland count for the opening setup; units in Rumania or Turkey do not), the Soviet cities, and so on. `setupStatus` says whether a scenario can be set up yet: all four can, now that every zone has hexes. `autoSetup` (and `autoSetupOwner`, which finishes one nation and keeps counters already placed) produces a legal, not sensible, setup: named placements first, then the rest in the areas a "rest-in" requirement names, then in the owner's own territory (so Germany does not fill Helsinki, Finland's only air base), then anywhere allowed. In the app you set up your own nations by tapping (pick a counter, tap a yellow hex; a Place / Take back switch; or let the game place the rest) and the computer sets up the other side with that placeholder until it chooses its own.

**Sequence of play** (`sequence.ts`, from the map card, with the Ops 5.0 section for each step). The engine plays only the steps whose rules are implemented; the rest follow as their rules are written:

| Step | Status |
|---|---|
| Year Start Sequence (A strategic warfare, B BRP totals, C SW construction) | B done (`yearstart.ts`); A and C not built |
| II.B Determination of Player-Turn Order (Ref 11.1) | Done |
| II.A Russian-Winter roll; Player Turn steps 1-10 and their sub-steps | Not yet; a Player Turn is one End Turn action |

The U.S. units that set up in the U.S. Box in Spring '42 (1939 and Campaign) are not placed yet: that belongs with the Declaration of War rules.

## Discrepancies to keep in mind

- The in-game status screen at 1939 setup shows "Initiative - Allies", but the Ops manual says "The Axis moves first" in 1939, and Ref 11.1 agrees (Axis 225 vs Allies 210). The engine follows the manuals.
- Ref 11.1 totals are not alliance totals: Italy's BRPs always count for the Axis (the status screen's 225 includes neutral Italy), US BRPs count from Summer 1942, Soviet BRPs once the USSR is at war with Germany. The engine approximates "at war with Germany" by the USSR having joined the Allies until declarations of war are modelled.
- The printed interception table lists "25-30" and "30+". The game's own interception routine puts 30 in the 25-30 band, as the engine does (`GAME_DATA.md`, "Rule tables").
- Odds below 1:1: the manual says only "fractions are ignored". The game's own odds routine rounds in the defender's favour (1-4 from a ratio of 1/4, 1-3 from 1/3, 1-2 from 1/2), as the engine does.
- Naval advantage: the chart's "1.33:1" and "1.67:1" are decimals in the game, not 4/3 and 5/3. The game compares the fleet ratio with 1.33 and 1.67, so 5 factors against 3 is +1, not +2, and exactly 1.67:1 is also +1. The engine used to read them as 4/3 and 5/3; it now follows the game (changed in roadmap 2.3, evidence: the game's naval chart screen and its naval routine, reproduced by `scripts/gamedata/tables.ts`). Ref 21.51 gives the DRM to a force with "at least a third more naval factors" and does not mention 1.67; the game's 1.33 differs from a third more (4/3) only for ratios from 1.33 up to 4/3, which needs at least 100 enemy factors (first case 133 against 100: +1 in the game, 0 by Ref 21.51).
- The Minor Country Forces chart counts counters, not factors (its columns are counter pictures, and some entries are odd numbers of 2-factor counters).
- The original game's control bitmaps against the scenario pages and our map (checked by `scripts/gamedata/extract.ts`; the sliver list is also pinned in `tests/gamedata.test.ts`):
  - `BRIT42.CON` and `BRIT44.CON` mark all of Egypt British, which settles the Egypt question: the printed "Controlled at start" lists leave Egypt out, but Britain holds it.
  - `GERM42.CON` marks all of mainland France, the 17 Vichy hexes included, while `VICHY42.CON` marks those same hexes Vichy. The data gives them to Vichy (the page and Ref 35.0), and German-held France is `GERM42.CON`'s France less Vichy's.
  - `GERM42.CON` and `GERM44.CON` mark CC30; it is Greek on the corrected map (Lesbos), so it needs no exception. EE27 (Greek land on the corrected map) is in neither German bitmap, though the data gives all of Greece to Germany: TODO(verify) who holds EE27 in the original.
  - Hexes the bitmaps mark that our map called sea were coastal slivers; the map correction (MAP_COMPARISON.md) made all of them land except W21 (Corsica's north tip) and Z18 (Sardinia), which are not in a committed zone.

## Web research (2026-10-13)

Looked for the printed rules on the web. The only rules text found is the Advanced Third Reich rulebook on RulesPal (<https://rulespal.com/advanced-third-reich/rulebook>; its numbering matches our "Ref" numbers; the page is cut off partway). It was read through a page-summarising tool, and the passages below were fetched twice with the same result. Facts only; no rule text is stored in the repo.

| Question | Finding | Status |
|---|---|---|
| Ref 20.44 | Exists, in Air Combat: a side mixing nationalities uses the lowest modifier. Air nationality chart: Germany, U.S., Britain 0; Russia, Italy, France -1; all others -2 (matches `GAME_DATA.md`). | Confirmed |
| Ref 21.51 | Exists, in Naval Combat: the larger force gets the DRM with "at least a third more naval factors" (scale +1 at 1.33:1 up to +5 at 4:1 or more), plus the Naval Nationality chart. | Confirmed |
| Naval nationality chart | Germany +2; U.S., Britain, Sweden +1; French (including Vichy and Free French) 0; Italy -1 if the battle is in or south of row N; Russia, Turkey, Spain, Italy -2. The chart lists Italy twice; the engine reads the -2 as "north of row N". | Matches the engine |
| Vichy and Free French fleet DRM | Same as France, 0 (the chart row above). | Settled for the printed rules; the PC program is still unchecked |
| Supply (Ref 19.x on the web; spec 03 and the code comments said "Ref 10.0", which is the spending limit) | Same Advanced Third Reich rulebook page (read in two parts through a summarising tool, facts only): 19.1 supply is checked in the Movement Phase after naval movement and at the end of the Player Turn; 19.2 sources: a Major Power's capital (and a minor country's capital if it has its own forces) supplies its controlling side without limit on units; also supplied ports (designated fleet), fortresses (units inside only), Malta, Sevastopol, Libyan and Egyptian ports, Tunis and Beirut (French), Moscow and the east map edge down to Z53 (Soviets), the U.S.A. when London and Paris are lost, Greek islands, Tangiers, Konigsberg and Durazzo (1939 and Campaign); 19.3 a line of friendly-controlled hexes (of the Major Power or its allies) to a source with no enemy ZOC on any hex of it; ZOC on the unit or the source does not block it (supply may enter a ZOC, not pass through one); a line may cross a Crossing Arrow; naval and air units are always in supply; Western Allied and Soviet supply are not traced from each other's sources; French units in Europe trace only from Paris until 1942; 19.31 sea supply: a designated fleet, one ground unit or airbase per naval factor, land ends friendly and ZOC-free, transfer points Gibraltar, Kiel, Istanbul; 19.4 an unsupplied unit keeps its full factor and CAN attack (also counts for Attrition); it cannot move, exploit, advance after combat, occupy an Attrition hex or be redeployed; still unsupplied at the end of its Player Turn it is eliminated after construction (11.74); unsupplied airbases relocate or are eliminated (11.75). Not found: a maximum line length; whether friendly units cancel ZOC for supply. | Built as pure queries in `supply.ts` (spec 03 "As built"); the attack hook stays true |
| Germany in Libya | Ref 31.0 is a supply cap: no more than 18 German combat factors (all types) may be supplied from any Libyan source or by sea through a North African port west of the Suez Canal while the Allies control Malta; each Allied naval or air factor at Malta lowers it by one, never below 4; Italian and Spanish units do not count. This is not the 1942 setup limit (7 factors on our scenario page). Not modelled yet. | Setup limit not found online; supply cap to build with supply |
| 1942 U.S.S.R. six ground factors (Leningrad, Moscow) | Not found in any online text; it is on the scenario card. | Open |
| Greek hex EE27 in 1942 | Not found. Only 5.58 turned up: Leningrad and Sevastopol are Russian-controlled at the start of the 1942 and 1944 scenarios (matches our data). | Open |

Also noticed: the printed Ref 11.62 says Turkey, Spain, Vichy France, Sweden and the Free French may never rebuild a fleet, even as active Minor-Allies (a rule for the economy spec).

## Open questions

- **Supply (`supply.ts`, spec 03 "As built"), all `TODO(verify)`:** the numbering (spec 03 says Ref 10.0; the web text says 19.0); that the PC game follows the web text (capitals only as land sources, unsupplied units attack, eliminated at the end of the Player Turn); which minor capitals count ("if it has its own armed forces": built as a minor that fights on the side now, so Poland and active Minor-Allies); whether a captured capital supplies its captor (built yes for Major Powers); sources not built (Soviet east edge to Z53, Libyan, Egyptian, Tunis and Beirut ports, Malta, Sevastopol, fortresses, Greek islands, Tangiers, Konigsberg and Durazzo, the U.S.A. fallback, the 18-factor Libya cap of Ref 31.0); French-from-Paris and British-through-Vichy limits; any maximum line length (none found, none applied); whether a friendly unit cancels enemy ZOC for supply (built yes, `ZOC_POLICY`); whether the unit's own hex must be friendly-controlled (built yes); sea supply (19.31) is a stub; which counters are checked (ground units and airbases; replacements and bridgeheads are not); units in off-map boxes (always in supply, not listed); the effects of being unsupplied (no movement, no advance after combat, no redeployment, elimination at the end of the turn, airbases at 9h) are not built or wired.

- **Year Start Sequence and Front Options (spec 02, part 3), all `TODO(verify)`:**
  - `KEEP_UNUSED_BRPS` (`yearstart.ts`): whether BRPs a nation did not spend by year end also stay in its new total. Built as no: they only feed the growth and are then dropped.
  - Whether growth is taken on the whole total (including Minor-Ally BRPs and grants received), as built, or on something narrower.
  - Each Minor-Ally's own BRP value: `minorAllyBrps` adds the scenario's summed figure (Germany's 45) only while every Minor-Ally active at the start is still active, otherwise nothing. Only Bulgaria's 10 is known (PC README).
  - Which Major Power pays for an Offensive Option (built: the action names a payer from the side).
  - Whether that cost counts towards the spending limit (built: yes).
  - Whether a Front Option can be changed within step 3 (built: no, one choice per Front, no refunds).
  - The Option for a Front with no choice (built: Defensive).
  - Whether Germany's free Eastern Front Offensive Option (Ref 29.0) is for the first turn only (built: Fall 1939 only).
- **Vichy and Free French naval nationality DRM.** The printed rule is settled: the Reference Manual's chart in 21.51 has the row "French (including Vichy & Free French)" at 0 (see "Web research" below). What is still open is only whether the PC program does the same: its naval routine gives 0 only to France's nation number; a fleet carrying Vichy's or Free France's own number (40, 41 in `FORMAT.TXT`) would get -2. The engine keeps the chart's 0 (`TODO(verify)` on `navalNationalityDrm`). A naval battle with a Vichy or Free French fleet in the original would settle it.
- **Mixed nationalities, for the naval and air rules when they are written:** Ref 20.44 gives an air force that mixes nationalities the lowest modifier among them (confirmed, see "Web research" below). The game's air and naval nationality routines were read by hand to do the same (the lowest DRM among a group's units; not reproduced by the script). For naval combat the printed text found online has no such sentence in section 21, so a mixed-nationality fleet is still undecided; check the Reference Manual's 21.x before encoding.
- **Ground combat open items** (TODO(verify), built in `attack*.ts`, spec 04 "As built"): whether Replacement counters attack and defend like other ground units (they do now); whether a hex may be attacked only once per Player Turn (`ONE_ATTACK_PER_HEX`, on now; the PC README only says each unit attacks one hex, 14.23); the advance after combat (`ADVANCE_AFTER_COMBAT`: who may advance, how many, ZOC; now any survivors that attacked, once, within the stacking rules); in an Exchange, whether the defenders remove factors at their multiplied value when they are the larger side (they do now); who is at war when minor forces are involved (a minor force fights whoever its side's Major Powers are at war with; alliance wars of Ref 13.0 are not modelled); what happens to air units, fleets or airbases left alone in a hex whose ground defenders are eliminated (nothing now: they stay and block the advance); the stubs `isSupplied` (kept true: Ref 19.4 lets unsupplied units attack) and `frontAllowsAttack` (Offensive Option on the Front, Ref 11.2), which allow everything (the first on purpose, the second until that engine lands); control of a hex taken, loss of fortress status on occupation, and rebuilding of eliminated units.
- **Computer opponent policy (not rules; spec 05, `TODO(verify)` in `src/ai/`).** The computer's own choices, to be tuned by play-testing: the build priority list (`BUILD_PRIORITY`), the declaration plans and their dates (`DECLARATION_PLANS`, Italy on France and Britain from Summer 1940, Germany on the U.S.S.R. from Summer 1941), the BRPs kept back for a pending plan (`plannedReserve`), and the grant thresholds (`GRANT_RECEIVER_BELOW`, `GRANT_STEP`). Also open: a neutral Major Power (Italy in 1939) has no side in the engine, so it cannot declare war until it is on one; the plans for Italy only fire once it is at war on the Axis side.
- Rest of the Reference Manual not yet encoded: movement and ZOC (Ref 4-7), supply (19; tracing is built as queries, not yet wired to steps), front option effects on combat (11.21; the choice itself is built, see below), exploitation (12.3), DoW and alliances (13), minor countries' set-up and activation (14-17), Russian winter and surrender (18), air and naval (20-21), strategic warfare (9), special national rules.
- Zones still to confirm: whether Gibraltar (on the strait) counts as an Atlantic port (it does in the data; no German fleet can start there), and whether the original tags any other port to a different sea than our map's fronts suggest (`BINMAP*.BIN` is not decoded yet).
- Two setup permissions read from the pages rather than stated outright: Free French units set up in British-controlled territory within the area the page names, because they "function as British in all respects" (Ref 35.0); and Germany may set up in Libya west of the 1942 start line, held to the 7 factors of the one 4-6 armor and one 3-3 infantry the page names there. TODO(verify): whether the original lets more German units start in Libya.
- TODO(verify): V39 (in the Crimea) is in neither side's bitmap in 1944, though it is marked German in 1942, so it is land in the original; why 1944 leaves it out is not known. It is in neither start-line zone, so nobody sets up there. D43 (next to Leningrad), also in neither bitmap, is Finnish land after the map correction, so it needs no zone.
- The 1942 USSR setup: "at least six ground factors must set up in and/or adjacent to Leningrad and Moscow". Encoded as one total across both. A review of the original game reports that its text says six ground factors must set up next to both Leningrad and Moscow, which leans towards six at each; not changed yet.
- A review of the original game reports that it refuses setup in the Qattara Depression. Our setup does not forbid it yet.
- Sicily's hexes (DD19, DD20, DD21, EE19, EE20, EE21) are the Italian land hexes there; DD19 and EE19 are coastal slivers (see below). `BRIT44.CON` marks both, which suggests the original treats them as land too.
- Setup assumptions to check against the original: a nation must place every Force Pool counter at setup (the manual does not say it may hold some back); partial air units at setup (Ops 4.11) are not offered; "double city" air stacking (10 and 15 factors) is not on the map data, so every base holds 5; Germany's ban on setting up in Bessarabia in Fall 1939 (Ref 29.0) is not enforced yet, though Bessarabia's hexes are now known (the five Rumanian hexes of `EASTEURP.CON`, east of the Partition Line); Axis Minor-Allies' "Axis-controlled hexes only" (Ref 17.3) is carried in the data but not yet checked.
- Victory conditions (Ref 2.0-2.1).
- Map details, now checked against the original game's own map data (`BINMAP.BIN`; full report in [MAP_COMPARISON.md](MAP_COMPARISON.md)):
  - Verified: the land or sea status of every hex except W21 and Z18. The coastal slivers S42, V39, H26, J29, EE19, KK25, CC28, DD19 and K25 are land in the game too; 17 more slivers the 4% threshold had made sea are now land with the game's country. The threshold no longer decides any hex.
  - Verified: the front of every hex, all-sea hexes included; the country of every land hex (D43 is Finnish, CC30 Greek, both corrected); the Objectives, fortresses, swamps, crossing arrows and the Qattara hexsides.
  - Verified: Sicily is joined by land inside (DD20-DD21, DD19-EE19 and EE19-EE20 corrected) and to the mainland only by the Messina crossing arrow DD21-DD22.
  - Open: W21 (Corsica) and Z18 (Sardinia) are land in the game; making them land changes the `corsica` and `sardinia` zones, so it waits for the zone work.
  - Open: 25 hexsides where the coast reaches only one end are crossable by land in the game but not on our map, and K32-K33 the reverse. Whether Ref 4.3's "land on both sides" means anywhere along the hexside needs a decision before movement is written.
  - Open: 9 beaches the game has and we do not (D35, K30, V35, W43, CC26, DD3, GG36, KK33, LL19); 55 land hexes the game gives water hexsides but our map does not call coastal; what the game's water hexsides mean for fleets (306 more than our sea hexsides); 45 rivers on our map and 7 in the game that the other lacks; Tirane is a city in the game, not a capital; three Persian edge hexes (CC47, EE46, GG45) are playable in the game but missing from our map.
  - Spelling of small-print minor city names (e.g. Ragusa, Mumanis, Kaf): the game files hold no city names, so this stays open.

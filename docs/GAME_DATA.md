# Original game data: what is in it and what we have decoded

The player supplied the original 1996 PC game files (a DOS game; 405 files, about 11 MB, with `3R2.EXE` and `DOS4GW.EXE`). They live **outside** this repo and are never committed. This page records what the files are and how the formats work, in our own words, so decoders can be written and the facts checked. See the policy in [ROADMAP.md](ROADMAP.md) phase 1.

## What is in the folder

| Kind | Files (examples) | Use |
|---|---|---|
| Rules text and errata | `README.TXT`, `VIC_COND.TXT`, `PHASES.TXT`, `NUMPHASE.TXT`, `*OPS*.TXT` | PC differences from the board game, difficulty levels, victory conditions |
| Scenario editor notes | `FORMAT.TXT` | Documents the force-pool file format and the nation and unit-type numbering |
| Scenario data | `39SCEN.BIN`, `42SCEN.BIN`, `44SCEN.BIN`, `CAMPSCEN.BIN`, `SCRIPT*.*` | BRPs, dates, setup |
| Control and line maps | `*.CON`, `NSPPLINE.BIN`, `1942LINE.BIN`, `1944LINE.BIN` | Territory at the start of each scenario |
| Map data | `BINMAP.BIN` (and older `BINMAP1/2/3/8.BIN`), `AREAADJ.BIN`, `AREADATA.BIN`, `AREADIST.BIN` | The game's own map: decoded, see below and [MAP_COMPARISON.md](MAP_COMPARISON.md) |
| Screen drawing | `HEX.MAP`, `NUMS.MAP` | A one-bit hexagon mask and digit glyphs, not map data |
| Chart screens | `TABLE1.TAB` ... `TABLE11.TAB`, `TABLE8A.TAB` | Pictures of the charts the game shows from its Tables menu (see "Rule tables" below) |
| Program | `3R2.EXE` | The game itself; holds the CRT and attrition tables as data and the odds, interception and DRM rules as code (see "Rule tables") |
| AI text | `AIMESS.TXT`, `AINAMES.TXT` | Hints about the original AI |
| Art, sound, video | `*.IMG`, `*.PCX`, `*.RAW`, `*.FLC`, `*.JSF`, `*.BNK`, `*.HMP` | Not used. Our art is our own |

## Decoded formats

**Control bitmaps (`*.CON`, 280 bytes each).** 40 rows (A to NN), 7 bytes per row, most significant bit first. A set bit marks a hex. For row index `r` and bit position `col` (0 to 55): `q = col - floor(r / 2) + 16`. Checked against our map: `VICHY.CON` has 19 hexes and 18 are French land hexes; `EASTEURP.CON` has 36 and 34 fall in Poland, the Baltic States or Rumania. The misses were coastal sliver hexes that our map called sea; since the map comparison (2.4) all 36 East Europe hexes are Polish, Baltic or Rumanian land, and the one Vichy miss left is W21 (a proposal in [MAP_COMPARISON.md](MAP_COMPARISON.md)).

What each one marks (land hexes on our map):

| File | Marks |
|---|---|
| `GERM42.CON` | German control at the start of 1942: Germany, the Baltic States, Belgium, Denmark, the Netherlands, Norway, Luxembourg, Poland, Yugoslavia, Greece, all of mainland France (Vichy included) and 92 Soviet hexes |
| `ITALY42.CON` | Italy, Albania and Libya west of Tobruk |
| `BRIT42.CON` | Britain (with Gibraltar, Malta, Cyprus), Egypt, Iraq, Lebanon-Syria, Palestine, Transjordan and Libya from Tobruk east (8 hexes) |
| `USSR42.CON` | The Soviet side of the 1942 start line (389 hexes) |
| `VICHY42.CON` | Vichy France at the start of 1942: 17 hexes of southern France, Corsica, Morocco, Algeria, Tunisia |
| `VICHY.CON` | The same European hexes (Vichy France when France falls): 19 marked, 17 in mainland France and 2 in Corsica (X20, and W21, which our map still calls sea), so 18 are land on our map |
| `GERM44.CON` | As `GERM42.CON` with Albania, Italy north of the line (with Rhodes) and 37 Soviet hexes |
| `BRIT44.CON` | Britain's 1942 lands plus all of Libya, French North Africa, Corsica, Sicily, Sardinia and Italy south of the line |
| `USSR44.CON` | The Soviet side of the 1944 start line (443 hexes) |
| `EASTEURP.CON` | Eastern Europe (Ref 29.0): the Baltic States, Poland east of the Partition Line, Bessarabia |

**Line files (`NSPPLINE.BIN`, `1942LINE.BIN`, `1944LINE.BIN`).** Byte 0 is the entry count, byte 1 is zero, then one 3-byte entry per hex: bitmap column (same layout as above), row index, and a 6-bit mask of the hexsides of that hex which the line runs along. Mask bit to direction (our axial directions): bit 0 north-east, 1 east, 2 south-east, 3 south-west, 4 west, 5 north-west (bits 3 and 4 cannot be told apart by contiguity alone). The Polish Partition Line decodes to a single unbroken path of 28 hexsides, which is the strongest check that the layout is right. The 1942 line decodes to 49 hexsides in pieces (14 loose ends) and the 1944 line to 43 (8 loose ends): they stop at coasts and at the Finnish border. The second check is that inside each country every line hexside lies exactly between the two sides' control bitmaps (U.S.S.R. and Libya in 1942, U.S.S.R. and Italy in 1944, Poland and Rumania for the Partition Line): 110 hexsides, none off the border. It also settles the bit order. Of all 720 ways to map the six mask bits to the six directions, only north-east, east, south-east, south-west, west, north-west puts every one of them on a border (`tests/gamedata.test.ts` tries them all). Contiguity alone cannot tell bits 3 and 4 apart, and the Polish line uses neither. Read the other way round, the 1942 line runs off the bottom of the map at NN22 and leaves hexsides off the border at Tobruk and in the Crimea.

**Map (`BINMAP.BIN`, 44,880 bytes).** The only map file the program loads (its name is in `3R2.EXE`; the `AREA*` files and the other `BINMAP` files are not). One 22-byte record per hex, 2,040 records stored **column by column**: 51 bitmap columns of 40 rows, so record `i` is column `floor(i / 40)` and row `i mod 40`, and the hex is `q = column - floor(row / 2) + 16`, the same layout as the control bitmaps. Fields (bytes numbered from 0; little-endian words):

| Bytes | Meaning | Evidence |
|---|---|---|
| 0-5, 9, 19-21 | Always zero (room for play-time data) | Zero in all records |
| 6 | AI area number, 1-67 (0: none) | `AREADATA.BIN` hex counts match it for 67 of 68 areas |
| 7, 8 | The record's own row (1 = A) and hexrow number | 1,762 records name the hex at their position; all 1,755 of our hexes have one |
| 10-11 (word) | Bits 0-5: nation the hex belongs to on the map, numbered as in `FORMAT.TXT`. Bits 6-11: the major power that owns it at the start (colonies: their owner; Libya and Albania: Italy). Bit 12: East Europe partition hexes | Nations agree with our countries on every land hex but two (fixed); bit 12 marks exactly the 36 hexes of `EASTEURP.CON` |
| 12-13 (word) | Bits 0-5: hexsides across which the hex has water. Bits 6-11: water hexsides marked from this side only (the neighbour marks them in bits 0-5; meaning not settled). Bits 12-15: front of the water: 1 Western, 2 Eastern, 4 Mediterranean, plus 8 on Black Sea and Sea of Azov hexes | All-sea hexes have all six bits; fronts agree with ours on every hex |
| 14-15 (word) | Bits 0-5: hexsides ground units may cross. Bits 6-11: hexsides with a crossing arrow. Bits 12-15: front of the land (same coding); zero for an all-sea hex | Seen from both records, 6,758 land bits agree and 26 do not: those are 13 hexsides between the four Swiss hexes and their neighbours, which mark them crossable while the Swiss records do not; the arrow bits are exactly the eight crossing arrows of Ref 4.6 |
| 16 | Bits 0-5: river hexsides. Bit 6: capital. Bit 7: objective | 42 objective bits, on our 42 Objectives |
| 17 | High four bits: one terrain code, 1 clear, 2 mountain, 3 small island, 4 beach, 5 swamp, 6 fortress, 7 Malta, 8 Qattara, 9 all sea (a beach or fortress code hides the hex's other terrain). Bit 0: port. Bit 1: city symbol. Bits 2-3: set on five hexes, meaning not known | The 11 fortress codes are the fortresses of Ref 4.8, the 8 swamp codes our swamps |
| 18 | The starting owner again (same as bits 6-11 of bytes 10-11) | Equal in every record |

Hexside bit order, in all masks: bit 0 north-east, 1 east, 2 south-east, 3 south-west, 4 west, 5 north-west. This settles the order the line files left open (bits 3 and 4). Besides the 1,755 hexes of our map, records exist for the four Swiss hexes (with no crossable hexside: unplayable), three Persian land hexes on the eastern edge (CC47, EE46, GG45) and 15 padding records that name another hex (A1 repeated, MM56, MM57).

**Older map files (`BINMAP1.BIN`, `BINMAP2.BIN`, `BINMAP3.BIN`, `BINMAP8.BIN`, 46,920 bytes).** Same 2,040-record layout with 23-byte records that start with the hex id in text; the fields that follow are close to `BINMAP.BIN` but shifted, and the program does not load them. Only used to confirm the record order.

**Areas (`AREADATA.BIN`, 748 bytes).** 68 records of 11 bytes, one per AI area: front (1, 2 or 4), nation, column range, row range, number of hexes, then four small counts not identified. Not loaded by the program.

**Not decoded: `AREAADJ.BIN` (9,384 bytes) and `AREADIST.BIN` (136,680 bytes).** `AREAADJ` reads as 68 records of 69 little-endian words (a constant first word, then mostly `0x1Ef0`/`0x1Ff0`-like values), but the table is not symmetric and its zero entries fall on the anti-diagonal, so it is not a plain adjacency or distance matrix. `AREADIST` is 2,040 x 67 bytes, one byte per hex and area, but a hex's byte for its own area is not the smallest. Neither file is loaded by the program, so they do not affect play.

**Force-pool files (from `FORMAT.TXT`).** Nation numbers 0 to 42 (Ocean, France, Britain, U.S., U.S.S.R., Germany, Italy, then the minors); colour numbers 1 to 8; turn number is `(year - 1939) + season` with spring 0 to winter 3; unit types are numbered per nation.

## Rule tables (roadmap 2.3)

Checked with `npx vite-node scripts/gamedata/tables.ts <game-folder>`. The script reads only, prints a report and compares against our engine's tables. It exits 0 when nothing differs except the known open items (the Vichy and Free French naval DRM below), 1 on any new difference or when a check cannot find what it looks for, and 2 on a usage error. `--png <dir>` renders the chart screens for viewing; it refuses a folder inside this checkout, which protects this checkout only, so keep the images out of any other copy of the repo yourself. `--no-program` skips the checks against `3R2.EXE`, which live in their own module (`scripts/gamedata/exe-checks.ts`) so they can be dropped without touching the chart checks; whether to keep them is an open question for the project owner.

**`TABLE*.TAB` are pictures, not lookup tables.** Each file is a 16-colour PCX image (version 5 header, RLE, four 1-bit planes, 300 dpi in the header), between 224x195 and 552x456 pixels. The program loads them by number from its Tables menu. What each shows, read off the rendered image:

| File | Chart |
|---|---|
| `TABLE1.TAB` | Air-combat DRMs: air advantage, air force nationality |
| `TABLE2.TAB` | Quarterly attrition resolution table |
| `TABLE3.TAB` | BRP costs: declarations of war, offensive option, cost per factor |
| `TABLE5.TAB` | Offensive combat results table |
| `TABLE6.TAB` | Unit-type legend (how to read a counter) |
| `TABLE7.TAB` | Interception table |
| `TABLE8.TAB`, `TABLE8A.TAB` | Map legend, in the flat and the relief map styles |
| `TABLE9.TAB` | Minor country forces |
| `TABLE10.TAB` | Naval-combat DRMs: naval advantage, naval nationality |
| `TABLE11.TAB` | Terrain effects chart |

There is no `TABLE4.TAB`. The numbers on these screens are the same as the printed map card's.

**`RAWCHRT.RAW` and `CHART.RAW` are sounds, not charts.** Both are headerless unsigned 8-bit samples centred on 128 with small sample-to-sample steps, like the game's other sound effects (`HEIL.RAW`, `EXPLODE.RAW`). Read as greyscale at 320 pixels wide they show noise with no row structure; their autocorrelation has no row period, only a short pitch-like period. They are probably the sounds played when a chart opens.

**`3R2.EXE` holds the rules themselves.** It is a DOS/4GW linear executable (`LE` header at 0x2C90, 4 KB pages, two objects: code at linear 0x10000 and data at 0x110000). Once the objects are loaded at their bases and the internal fixups applied, these can be read (addresses are linear). Items marked *(script)* are reproduced by `exe-checks.ts`, which compares them with our engine; items marked *(by hand)* were read from a disassembly during the investigation and are not reproduced by the script:

- **Offensive CRT** at 0x94834: 48 bytes, 6 rows (die roll 1-6) of 8 columns (1-4 to 5-1). Codes: 1 A, 2 D, 3 Ex, 4 CA, 5 CA1, 6 CA2, 7 CA3 *(script)*. The lookup routine copies this block and reads `[roll - 1][column]` *(by hand)*.
- **Attrition** right after it: hexes to vacate at 0x94864 and units to eliminate at 0x9488E, 42 bytes each, 6 rows (die roll) of 7 columns *(script)*. The column is `(factors - 1) / 10` rounded down, capped at the seventh; 0 factors means no attrition *(by hand)*.
- **Odds column**: a routine takes attack divided by defence as a single-precision number and returns a column index: below 1/4 is "attacker eliminated", then 1-4 from 1/4, 1-3 from 1/3, 1-2 from 1/2, 1-1 from 1, 2-1 from 2, 3-1 from 3, 4-1 from 4, 5-1 from 5 *(script)*. A defence of 0 is shown as 5-1 *(by hand)*.
- **Counterattacks**: the combat routine switches on the result code; CA1, CA2 and CA3 store the column index of 1-1, 1-2 and 1-3 *(script)*, and CA recomputes the odds with the roles swapped *(by hand)*.
- **Interception**: distance 1 succeeds automatically; otherwise the highest successful roll is 5 up to 10 hexes, 4 up to 18, 3 up to 24, 2 up to 30 and 1 beyond *(script)*, and one die is rolled *(by hand)*.
- **Naval advantage**: the ratio of the larger to the smaller fleet total, in single precision, compared with the decimal constants 1.33 and 1.67, then with 2, 3 and 4, for +0 to +5 *(script)*.
- **Naval nationality**: by nation number (the `FORMAT.TXT` list): Germany +2; Britain, U.S. and Sweden +1; France 0; Italy -1 when the routine's second argument is 13 (row N's index) or more, otherwise -2; every other number -2 *(script)*. That the second argument is the battle hex's row, and that for a fleet of several nations the routine uses the lowest value among its units, were read by hand.
- **Air force nationality**: a switch on the nation number: Britain, U.S. and Germany 0; France, U.S.S.R. and Italy -1; every other number -2 *(script)*. Taking the lowest value in a group was read by hand; Ref 20.44 states that rule for air.

### Differences report

| Our table | Status | Evidence |
|---|---|---|
| `OFFENSIVE_CRT`, `ODDS_COLUMNS` | Matches the game, every cell | `TABLE5.TAB`; CRT data in `3R2.EXE` |
| `oddsColumn` (including below 1:1) | Matches the game for every attack and defence from 1 to 80 | Odds routine in `3R2.EXE` |
| CA1-CA3 forced columns | Match the game | Combat routine in `3R2.EXE` (script) |
| `ATTRITION_TABLE`, `attritionColumn` | Match the game, every cell; the column bands match by hand | `TABLE2.TAB`; attrition data in `3R2.EXE` (script), its routine (by hand) |
| `defenseMultiplier` | Matches the chart | `TABLE11.TAB` (the code was not located) |
| `BRP_COSTS`, `BUILD_COST_PER_FACTOR` | Match the chart | `TABLE3.TAB` |
| `interceptionRolls` | Matches the game; 30 hexes is in the 25-30 band | `TABLE7.TAB`; interception routine in `3R2.EXE` (script) |
| `navalAdvantageDrm` | **Differed and corrected**: we read 1.33:1 and 1.67:1 as 4/3 and 5/3, so 5 against 3 gave +2; the game gives +1. Ref 21.51 says only "a third more" for +1; it differs from the game's 1.33 only from 133 against 100 upwards | `TABLE10.TAB`; naval routine in `3R2.EXE` (script); Ref 21.51 |
| `navalNationalityDrm` | Matches, Italy's row N rule included; the -2 default only ever applies to nations the chart lists at -2 | `TABLE10.TAB`, `TABLE9.TAB`; naval routine in `3R2.EXE` (script; the row argument by hand) |
| `navalNationalityDrm` for Vichy and Free French | Could not verify: the chart says 0, but the routine names only France's number (1), so fleets numbered 40 or 41 would get -2. Not known which number those fleets carry | `TABLE10.TAB`; `FORMAT.TXT`; naval routine in `3R2.EXE` |
| `airAdvantageDrm` | Matches the chart | `TABLE1.TAB` (the code was not located) |
| `airNationalityDrm` | Matches the game | `TABLE1.TAB`; air routine in `3R2.EXE` (script) |
| `MINOR_COUNTRY_FORCES` | Matches the chart, all 114 entries; entries count counters | `TABLE9.TAB` |

## Not decoded yet

`AREAADJ.BIN`, `AREADIST.BIN` (see above), and the scenario `.BIN` files. The game's files hold no bitmap for European Turkey or for which sea a port is on, so those two zones are read off our map (see RULES.md "Zones").

## Reproducing the checks

```sh
npx vite-node scripts/gamedata/extract.ts <game-folder>
```

`scripts/gamedata/formats.ts` holds the decoders (bytes in, hex ids out; tested on made-up bytes in `tests/gamedata.test.ts`) and `scripts/gamedata/checks.ts` the border check shared with the tests. `scripts/gamedata/extract.ts` reads the bitmaps and line files from the game folder, prints a short report (hexes per country, hexes our map calls sea, loose ends of each line), runs the cross-checks that need the whole bitmaps, rewrites `src/data/gamedata.ts`, and then checks each owner's "controlled at start" against its bitmap. It exits with status 1 if a check fails. Running it again on the same files gives a byte-identical file. The tests use only the committed `gamedata.ts`.

### What is committed and what is not

Committed, in `src/data/gamedata.ts`: the hexes of the 11 zones the scenarios use (the start-line halves, Vichy and German-held France, Eastern Europe), as hex ids, plus the three lines as hex ids with the hexsides the line runs along. A zone's list holds the land hexes of its country that the bitmap marks, plus the few marked hexes next to them that our map calls sea; the islands that are zones of their own are left out.

Not committed: the control bitmaps themselves, or any list that rebuilds them. That means no per-owner lists, no `VICHY.CON` list, and no list of the other marked sea hexes. The checks that need them (no hex on two sides, `VICHY.CON` against `VICHY42.CON`, each owner's territory against its bitmap) run in the extractor.

`scripts/gamedata/tables.ts` reproduces the chart checks, and with `exe-checks.ts` the items marked *(script)* above (`npx vite-node scripts/gamedata/tables.ts <game-folder>`).

The map decoder is separate: `npx vite-node scripts/gamedata/map.ts <game-folder>` decodes `BINMAP.BIN` (decoder in `scripts/gamedata/binmap.ts`, tested on made-up bytes in `tests/binmap.test.ts`) and prints every difference with our map as Markdown; `docs/MAP_COMPARISON.md` holds the result.

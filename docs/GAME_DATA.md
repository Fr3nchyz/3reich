# Original game data: what is in it and what we have decoded

The player supplied the original 1996 PC game files (a DOS game; 405 files, about 11 MB, with `3R2.EXE` and `DOS4GW.EXE`). They live **outside** this repo and are never committed. This page records what the files are and how the formats work, in our own words, so decoders can be written and the facts checked. See the policy in [ROADMAP.md](ROADMAP.md) phase 1.

## What is in the folder

| Kind | Files (examples) | Use |
|---|---|---|
| Rules text and errata | `README.TXT`, `VIC_COND.TXT`, `PHASES.TXT`, `NUMPHASE.TXT`, `*OPS*.TXT` | PC differences from the board game, difficulty levels, victory conditions |
| Scenario editor notes | `FORMAT.TXT` | Documents the force-pool file format and the nation and unit-type numbering |
| Scenario data | `39SCEN.BIN`, `42SCEN.BIN`, `44SCEN.BIN`, `CAMPSCEN.BIN`, `SCRIPT*.*` | BRPs, dates, setup |
| Control and line maps | `*.CON`, `NSPPLINE.BIN`, `1942LINE.BIN`, `1944LINE.BIN` | Territory at the start of each scenario |
| Map data | `BINMAP*.BIN`, `AREAADJ.BIN`, `AREADATA.BIN`, `AREADIST.BIN`, `HEX.MAP`, `NUMS.MAP` | The game's own map (not yet decoded) |
| Chart screens | `TABLE1.TAB` ... `TABLE11.TAB`, `TABLE8A.TAB` | Pictures of the charts the game shows from its Tables menu (see "Rule tables" below) |
| Program | `3R2.EXE` | The game itself; holds the CRT and attrition tables as data and the odds, interception and DRM rules as code (see "Rule tables") |
| AI text | `AIMESS.TXT`, `AINAMES.TXT` | Hints about the original AI |
| Art, sound, video | `*.IMG`, `*.PCX`, `*.RAW`, `*.FLC`, `*.JSF`, `*.BNK`, `*.HMP` | Not used. Our art is our own |

## Decoded formats

**Control bitmaps (`*.CON`, 280 bytes each).** 40 rows (A to NN), 7 bytes per row, most significant bit first. A set bit marks a hex. For row index `r` and bit position `col` (0 to 55): `q = col - floor(r / 2) + 16`. Checked against our map: `VICHY.CON` has 19 hexes and 18 are French land hexes; `EASTEURP.CON` has 36 and 34 fall in Poland, the Baltic States or Rumania. The misses are coastal sliver hexes that our map calls sea.

**Line files (`NSPPLINE.BIN`, `1942LINE.BIN`, `1944LINE.BIN`).** Byte 0 is the entry count, byte 1 is zero, then one 3-byte entry per hex: bitmap column (same layout as above), row index, and a 6-bit mask of the hexsides of that hex which the line runs along. Mask bit to direction (our axial directions): bit 0 north-east, 1 east, 2 south-east, 3 south-west, 4 west, 5 north-west (bits 3 and 4 cannot be told apart by contiguity alone). The Polish Partition Line decodes to a single unbroken path of 28 hexsides, which is the strongest check that the layout is right. The 1942 and 1944 lines decode to several segments.

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

`BINMAP*.BIN` (about 44.9 KB, not a fixed number of bytes per hex as first guessed), `AREAADJ.BIN`, `AREADATA.BIN`, and the scenario `.BIN` files.

## Reproducing the checks

`scripts/gamedata/tables.ts` reproduces the chart checks, and with `exe-checks.ts` the items marked *(script)* above. The control-bitmap and line-file decoders are still throwaway scripts kept outside the repo; when phase 2 turns them into code, they go in `scripts/gamedata/`, take the game folder as an argument, and write only derived facts (hex lists) into `src/data/`.

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
| Tables | `TABLE1.TAB` ... `TABLE11.TAB`, `RAWCHRT.RAW` | Combat, attrition and other charts (not yet decoded) |
| AI text | `AIMESS.TXT`, `AINAMES.TXT` | Hints about the original AI |
| Art, sound, video | `*.IMG`, `*.PCX`, `*.RAW`, `*.FLC`, `*.JSF`, `*.BNK`, `*.HMP` | Not used. Our art is our own |

## Decoded formats

**Control bitmaps (`*.CON`, 280 bytes each).** 40 rows (A to NN), 7 bytes per row, most significant bit first. A set bit marks a hex. For row index `r` and bit position `col` (0 to 55): `q = col - floor(r / 2) + 16`. Checked against our map: `VICHY.CON` has 19 hexes and 18 are French land hexes; `EASTEURP.CON` has 36 and 34 fall in Poland, the Baltic States or Rumania. The misses were coastal sliver hexes that our map called sea; since the map comparison (2.4) all 36 East Europe hexes are Polish, Baltic or Rumanian land, and the one Vichy miss left is W21 (a proposal in [MAP_COMPARISON.md](MAP_COMPARISON.md)).

**Line files (`NSPPLINE.BIN`, `1942LINE.BIN`, `1944LINE.BIN`).** Byte 0 is the entry count, byte 1 is zero, then one 3-byte entry per hex: bitmap column (same layout as above), row index, and a 6-bit mask of the hexsides of that hex which the line runs along. Mask bit to direction (our axial directions): bit 0 north-east, 1 east, 2 south-east, 3 south-west, 4 west, 5 north-west (bits 3 and 4 cannot be told apart by contiguity alone). The Polish Partition Line decodes to a single unbroken path of 28 hexsides, which is the strongest check that the layout is right. The 1942 and 1944 lines decode to several segments.

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

## Not decoded yet

`AREAADJ.BIN`, `AREADIST.BIN` (see above), the `TABLE*.TAB` files, and the scenario `.BIN` files.

## Reproducing the checks

`npx vite-node scripts/gamedata/map.ts <game-folder>` decodes `BINMAP.BIN` (decoder in `scripts/gamedata/binmap.ts`, tested on made-up bytes in `tests/binmap.test.ts`) and prints every difference with our map as Markdown; `docs/MAP_COMPARISON.md` holds the result. The other decoders used so far were throwaway scripts kept outside the repo. When phase 2 turns them into code, they go in `scripts/gamedata/`, take the game folder as an argument, and write only derived facts (hex lists) into `src/data/`.

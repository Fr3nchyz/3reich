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
| Tables | `TABLE1.TAB` ... `TABLE11.TAB`, `RAWCHRT.RAW` | Combat, attrition and other charts (not yet decoded) |
| AI text | `AIMESS.TXT`, `AINAMES.TXT` | Hints about the original AI |
| Art, sound, video | `*.IMG`, `*.PCX`, `*.RAW`, `*.FLC`, `*.JSF`, `*.BNK`, `*.HMP` | Not used. Our art is our own |

## Decoded formats

**Control bitmaps (`*.CON`, 280 bytes each).** 40 rows (A to NN), 7 bytes per row, most significant bit first. A set bit marks a hex. For row index `r` and bit position `col` (0 to 55): `q = col - floor(r / 2) + 16`. Checked against our map: `VICHY.CON` has 19 hexes and 18 are French land hexes; `EASTEURP.CON` has 36 and 34 fall in Poland, the Baltic States or Rumania. The misses are coastal sliver hexes that our map calls sea.

**Line files (`NSPPLINE.BIN`, `1942LINE.BIN`, `1944LINE.BIN`).** Byte 0 is the entry count, byte 1 is zero, then one 3-byte entry per hex: bitmap column (same layout as above), row index, and a 6-bit mask of the hexsides of that hex which the line runs along. Mask bit to direction (our axial directions): bit 0 north-east, 1 east, 2 south-east, 3 south-west, 4 west, 5 north-west (bits 3 and 4 cannot be told apart by contiguity alone). The Polish Partition Line decodes to a single unbroken path of 28 hexsides, which is the strongest check that the layout is right. The 1942 and 1944 lines decode to several segments.

**Force-pool files (from `FORMAT.TXT`).** Nation numbers 0 to 42 (Ocean, France, Britain, U.S., U.S.S.R., Germany, Italy, then the minors); colour numbers 1 to 8; turn number is `(year - 1939) + season` with spring 0 to winter 3; unit types are numbered per nation.

## Not decoded yet

`BINMAP*.BIN` (about 44.9 KB, not a fixed number of bytes per hex as first guessed), `AREAADJ.BIN`, `AREADATA.BIN`, the `TABLE*.TAB` files, and the scenario `.BIN` files.

## Reproducing the checks

The decoders used so far were throwaway scripts kept outside the repo. When phase 2 turns them into code, they go in `scripts/gamedata/`, take the game folder as an argument, and write only derived facts (hex lists) into `src/data/`.

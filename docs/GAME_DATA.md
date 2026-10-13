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

What each one marks (land hexes on our map):

| File | Marks |
|---|---|
| `GERM42.CON` | German control at the start of 1942: Germany, the Baltic States, Belgium, Denmark, the Netherlands, Norway, Luxembourg, Poland, Yugoslavia, Greece, all of mainland France (Vichy included) and 92 Soviet hexes |
| `ITALY42.CON` | Italy, Albania and Libya west of Tobruk |
| `BRIT42.CON` | Britain (with Gibraltar, Malta, Cyprus), Egypt, Iraq, Lebanon-Syria, Palestine, Transjordan and Libya from Tobruk east (8 hexes) |
| `USSR42.CON` | The Soviet side of the 1942 start line (389 hexes) |
| `VICHY42.CON` | Vichy France at the start of 1942: 17 hexes of southern France, Corsica, Morocco, Algeria, Tunisia |
| `VICHY.CON` | The same 18 European hexes (Vichy France when France falls) |
| `GERM44.CON` | As `GERM42.CON` with Albania, Italy north of the line (with Rhodes) and 37 Soviet hexes |
| `BRIT44.CON` | Britain's 1942 lands plus all of Libya, French North Africa, Corsica, Sicily, Sardinia and Italy south of the line |
| `USSR44.CON` | The Soviet side of the 1944 start line (443 hexes) |
| `EASTEURP.CON` | Eastern Europe (Ref 29.0): the Baltic States, Poland east of the Partition Line, Bessarabia |

**Line files (`NSPPLINE.BIN`, `1942LINE.BIN`, `1944LINE.BIN`).** Byte 0 is the entry count, byte 1 is zero, then one 3-byte entry per hex: bitmap column (same layout as above), row index, and a 6-bit mask of the hexsides of that hex which the line runs along. Mask bit to direction (our axial directions): bit 0 north-east, 1 east, 2 south-east, 3 south-west, 4 west, 5 north-west (bits 3 and 4 cannot be told apart by contiguity alone). The Polish Partition Line decodes to a single unbroken path of 28 hexsides, which is the strongest check that the layout is right. The 1942 line decodes to 49 hexsides in pieces (14 loose ends) and the 1944 line to 43 (8 loose ends): they stop at coasts and at the Finnish border. The second check, which also settles bits 3 and 4, is that inside each country every line hexside lies exactly between the two sides' control bitmaps (U.S.S.R. and Libya in 1942, U.S.S.R. and Italy in 1944, Poland and Rumania for the Partition Line). Swapping bits 3 and 4 breaks that at Tobruk and in the Crimea.

**Force-pool files (from `FORMAT.TXT`).** Nation numbers 0 to 42 (Ocean, France, Britain, U.S., U.S.S.R., Germany, Italy, then the minors); colour numbers 1 to 8; turn number is `(year - 1939) + season` with spring 0 to winter 3; unit types are numbered per nation.

## Not decoded yet

`BINMAP*.BIN` (about 44.9 KB, not a fixed number of bytes per hex as first guessed), `AREAADJ.BIN`, `AREADATA.BIN`, the `TABLE*.TAB` files, and the scenario `.BIN` files. The game's files hold no bitmap for European Turkey or for which sea a port is on, so those two zones are read off our map (see RULES.md "Zones").

## Reproducing the checks

```sh
npx vite-node scripts/gamedata/extract.ts <game-folder>
```

`scripts/gamedata/formats.ts` holds the decoders (bytes in, hex ids out; tested on made-up bytes in `tests/gamedata.test.ts`). `scripts/gamedata/extract.ts` reads the bitmaps and line files from the game folder, prints a short report (hexes per country, hexes our map calls sea, loose ends of each line) and rewrites `src/data/gamedata.ts`, which holds only the derived hex and hexside lists. Running it again on the same files gives a byte-identical file. The tests use only the committed `gamedata.ts`.

# Rules to verify

The goal is fidelity to the original game. The original manual is the source of truth, so nothing below is final until it has been checked against it. Anything marked TODO is a placeholder in code today.

## Things we need from the manual

- [ ] Powers, their starting positions, and turn order (code currently assumes Germany, Italy, USSR, Britain, France, USA)
- [x] Edition: the 1996 Avalon Hill *Third Reich* for Windows, based on the board game *Rise and Decline of the Third Reich*. (Not the 1992 DOS *Computer Third Reich*, a different game.) Still to confirm with the family: the exact box/version, and how the PC game differs from the board game.
- [ ] Map: regions/hexes, terrain, borders, ports, capitals, resource centers
- [ ] Unit types, strengths, movement allowances, stacking limits
- [ ] Combat results table and odds calculation (TODO: code has a placeholder table)
- [ ] Economy/production system and how units are built
- [ ] Diplomacy, neutrals/minor countries, and how they join the war
- [ ] Weather/seasonal effects and the game calendar (code currently starts Fall 1939)
- [ ] Victory conditions and scenarios
- [ ] Fog of war / AI opponent behaviour (if the PC version had them)

## How to help

Photograph or scan the manual (or the box contents) and add the images to a private folder; we transcribe rules into this file as structured notes, then encode them as data and tests.

## Reference material found online

- Wargame Academy *Third Reich* Amplified 4th Edition rulebook (a fan-maintained board-game rule set, so a close guide but not the PC manual): http://www.wargameacademy.org/3R4/3R4-rulebook-070908.pdf
- The Gamer's Guide to Third Reich: https://www.wargamer.fr/pdf/the-gamers-guide-to-third-reich-avalon-hill.pdf
- The PC game's own manual was not found online. The box contents, which the family owns, are the best source.

We encode mechanics (numbers, tables, procedures) as data and tests in our own words. We do not copy manual text or art into this repo.

## Observed from the big-box contents (seller photos)

Box: "Third Reich PC", Avalon Hill, 1996, "Computer Game of World War II Grand Strategy". Contents visible: CD-ROM, a *Reference Manual*, a folded chart/play-aid card, a DOS/Windows 95 install sheet, a registration card, a parts list and an order form. **No board-style map is visible**; the PC game draws its map on screen. A separate player's manual may exist; the photos only show the Reference Manual.

Notes on the chart card (our own wording; boundaries and values marked "verify" were hard to read in the photos):

- **Sequence of play** (partial, from the visible lines): a player turn runs through supply checks and unsupplied-unit elimination, SR (strategic redeployment), Murmansk convoy grants and ASW escorts, fleet/air movement with interception, counter-interception, normal ground/air movement, overstacked-unit elimination, an Eastern Front factor check, then a **Combat phase** (attrition combat; offensive naval/air missions; counter-air; defensive air support (DAS); ground combat), ending with a possible **Russian surrender** check and a save-game prompt. Then the second player's turn repeats the steps.
- **Interception table** (distance from base -> die results that allow interception): 1 hex -> automatic; 2-10 -> 1-5; 11-18 -> 1-4; 19-24 -> 1-3; 25-30 -> 1-2; over 30 -> 1. (verify the boundaries.)
- **Naval combat DRM chart**: a naval-advantage modifier by force ratio (about +1 to +5 as the ratio grows from 1:2 up to 4:1 or better; verify) and a nationality modifier (Germany best, then US/Britain/Sweden, then France, with Italy, USSR, Turkey and Spain lowest; Italy depends on the battle's map row; verify exact values).
- **Air combat DRM chart**: an air-advantage modifier plus a nationality modifier (Germany best, USSR next, all others lowest; verify).

What this tells us: the PC game follows the board game's structure closely (Murmansk Box, bridgeheads, DAS, SR, Eastern Front factors), so the board-game rules are a good starting point for the engine.

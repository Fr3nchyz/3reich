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

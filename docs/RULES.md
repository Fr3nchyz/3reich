# Rules to verify

The goal is fidelity to the original game. The original manual is the source of truth, so nothing below is final until it has been checked against it. Anything marked TODO is a placeholder in code today.

## Things we need from the manual

- [ ] Powers, their starting positions, and turn order (code currently assumes Germany, Italy, USSR, Britain, France, USA)
- [ ] Which edition is being matched (the PC release vs. the board game it was based on, and which version)
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

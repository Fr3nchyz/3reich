# Rules to verify

The goal is fidelity to the original game. The original manual is the source of truth, so nothing below is final until it has been checked against it. Anything marked TODO is a placeholder in code today.

## Things we need from the manual

- [ ] Powers, their starting positions, and turn order (code currently assumes Germany, Italy, USSR, Britain, France, USA)
- [x] Edition: the 1996 Avalon Hill *Third Reich* for Windows, based on the board game *Rise and Decline of the Third Reich*. (Not the 1992 DOS *Computer Third Reich*, a different game.) Still to confirm with the family: the exact box/version, and how the PC game differs from the board game.
- [ ] Map: regions/hexes, terrain, borders, ports, capitals, resource centers
- [~] Unit types (known, see below); still need: per-nation unit mixes, stacking limits, movement rules
- [ ] Combat results table and odds calculation (TODO: code has a placeholder table)
- [ ] Economy/production system and how units are built
- [ ] Diplomacy, neutrals/minor countries, and how they join the war
- [ ] Weather/seasonal effects and the game calendar (code currently starts Fall 1939; the box says the campaign runs from the invasion of Poland to the fall of Berlin, so the real start date needs confirming)
- [ ] Victory conditions (the four scenarios are listed below)
- [ ] AI opponent behaviour (the box advertises a "Sophisticated A.I." for solo play; no fog of war mentioned)

## How to help

Photograph or scan the manual (or the box contents) and add the images to a private folder; we transcribe rules into this file as structured notes, then encode them as data and tests.

## Reference material found online

- Wargame Academy *Third Reich* Amplified 4th Edition rulebook (a fan-maintained board-game rule set, so a close guide but not the PC manual): http://www.wargameacademy.org/3R4/3R4-rulebook-070908.pdf
- The Gamer's Guide to Third Reich: https://www.wargamer.fr/pdf/the-gamers-guide-to-third-reich-avalon-hill.pdf
- The PC game's own manual was not found online. The box contents, which the family owns, are the best source.

We encode mechanics (numbers, tables, procedures) as data and tests in our own words. We do not copy manual text or art into this repo.

## Observed from the big-box contents (seller photos)

Box: "Third Reich PC", Avalon Hill, 1996, "Computer Game of World War II Grand Strategy". System requirements printed on the box: 486 or better, MS-DOS 5.0+ / Windows 95 compatible, 8 MB RAM, VGA, CD-ROM. Contents (confirmed from a second set of photos): CD-ROM, a *Reference Manual*, an *Operational Manual*, a **folded paper map card**, install sheet, registration card, parts list and order form. (An earlier note here said there was no map; that was wrong.)

The folded card carries a hex map of Europe, North Africa and the Near East, split into **Western Front**, **Mediterranean Front** and **Eastern Front**, with national-boundary and front-boundary lines, a unit/force display area, inset boxes for off-map areas, and national flags. Below the map it prints the **Sequence of Play**, a **Map Legend**, a **Unit Types** key and a **Terrain Effects Chart**. So the PC game is a hex-and-counter game on the board game's map.

Full year/turn structure as printed (headings only, our wording):

- **I. Year Start Sequence** (between each Winter and Spring turn): resolve strategic warfare (not at scenario start), calculate initial BRP totals (not at scenario start), construct strategic-warfare factors.
- **II. Game Turn**: possible Russian-Winter die roll; determine player-turn order; then each player's turn in order: declarations of war; set up forces for newly attacked minors and activate minor allies; select Front options; movement and combat for attacked-but-unconquered minors; voluntary destruction of units; **Movement phase**; **Combat phase**; **Unit construction phase** (free Siberian transfer, construct units, possible Vichy activation/deactivation attempt); **Strategic redeployment phase** (BRP grants, Lend-Lease grants, rail/sea redeployment); **end-of-player-turn phase**. Then the second player's turn repeats.
- Terrain types listed on the chart: beach, capital, capital-port, city, coastline, crossing arrow, fortress, lake, mountains, objective, ocean, plain, Qattara Depression, river, swamp, plus national and front boundaries. Effects are now recorded below from the in-game chart.

Notes on the chart card (our own wording; boundaries and values marked "verify" were hard to read in the photos):

- **Sequence of play** (from the first set of photos): a player turn runs through supply checks and unsupplied-unit elimination, SR (strategic redeployment), Murmansk convoy grants and ASW escorts, fleet/air movement with interception, counter-interception, normal ground/air movement, overstacked-unit elimination, an Eastern Front factor check, then a **Combat phase** (attrition combat; offensive naval/air missions; counter-air; defensive air support (DAS); ground combat), ending with a possible **Russian surrender** check and a save-game prompt. Then the second player's turn repeats the steps.
- **Interception table** (distance from base -> die results that allow interception): 1 hex -> automatic; 2-10 -> 1-5; 11-18 -> 1-4; 19-24 -> 1-3; 25-30 -> 1-2; over 30 -> 1. (verify the boundaries.)
- **Naval combat DRM chart**: a naval-advantage modifier by force ratio (about +1 to +5 as the ratio grows from 1:2 up to 4:1 or better; verify) and a nationality modifier (Germany best, then US/Britain/Sweden, then France, with Italy, USSR, Turkey and Spain lowest; Italy depends on the battle's map row; verify exact values).
- **Air combat DRM chart**: an air-advantage modifier plus a nationality modifier (Germany best, USSR next, all others lowest; verify).

What this tells us: the PC game follows the board game's structure closely (Murmansk Box, bridgeheads, DAS, SR, Eastern Front factors), so the board-game rules are a good starting point for the engine.

## Map plan

The map is the biggest piece of game data. We will not copy the printed artwork. Plan: draw our own map from public-domain geography, laid out on a hex grid that matches the original's structure (hex coordinates, terrain per hex, borders, ports, objectives). The family's physical copy is the check: someone compares our hex grid against the printed map, region by region, and flags differences.

## From the back of the box

- **Scope:** the entire war in Europe, six years, from the invasion of Poland to the fall of Berlin; Portugal to Moscow, Norway to North Africa. All air, ground and sea forces of the historical belligerents **plus Spain and Turkey**. Described as a faithful adaptation of the Avalon Hill board game.
- **Players:** two humans, or one human against the computer AI.
- **Four scenarios:** 1939, 1942, 1944, and the full Campaign 1939-1946.
- **In the box:** a 40-page operations manual, a 48-page reference manual, and a 15" x 22" full-colour reference map of Europe.
- **Screens shown on the box:** a hex map with unit counters, colour-coded national territory, a declaration-of-war screen, a mini-map in the corner, and a national flag bar. Good targets for our UI.

The operations manual (how to play the program) and reference manual (the rules) are the two documents we most need photographed.

## From in-game screenshots (MobyGames)

**Interface:** a hex map you scroll with arrow buttons; a bottom bar with Done, Tables, Status, Actions and Exit buttons; a tray showing the active nation's units and remaining air factors; a calendar ("FALL 1939"); the nation's flag; a phase label ("SETUP PHASE"); a mini-map. Map text labels cities, rivers and countries; minor countries show their BRP value (e.g. Netherlands 10, Belgium 15, Luxembourg 5, Hungary 10).

**Unit types:** infantry, armor, replacement, airborne, bridgehead, airbase (ground), fleets, and air units. A counter shows two numbers: for ground units, the attack-and-defense factor (one number for both) then the movement factor (3-4 infantry, 5-6 armor, 3-3 airborne, replacement 1); air units show air factor then movement (e.g. 5-4); fleets show one combat factor (e.g. 9). Counter colours identify nations: Germany black, Italy light grey, USSR dark gold, USA olive, Britain orange, France cyan, neutrals light orange.

**Fall 1939 status screen (the 1939 scenario setup):**

| Nation | Status | BRP base/total | Spending limit | Growth |
|---|---|---|---|---|
| France | Allied | 85 | 42 | 30% |
| Britain | Allied | 125 | 62 | 40% |
| USA | Neutral | 270 | 135 | 60% |
| USSR | Neutral | 90 | 45 | 30% |
| Germany | Axis | 150 | 75 | 50% |
| Italy | Axis | 75 | 37 | 20% |

Axis total 225, Allied total 210 (neutral powers count for neither). Spending limit is half the total, rounded down. Initiative: Allies. Each of the Eastern, Western and Mediterranean Fronts has an option chosen per side (shown as "Pass" at setup). The game is therefore two sides (Axis vs Allies), not six powers taking turns; the engine was changed to match. Per-nation "allowable builds" (units that can still be built) are also listed on this screen; not transcribed yet.

**Terrain Effects Chart** (from the in-game table):

| Terrain | Combat | Movement |
|---|---|---|
| Beach | Defenders tripled against Seaborne Invasion, otherwise doubled | Ground units can be landed by Seaborne Invasion |
| Capital | Can't be chosen for Attrition advance | Only use is as an air base |
| Capital-port | Can't be chosen for Attrition advance | Use as an air and naval base |
| City | None | Can be an air base |
| Coastline | No attacks or movement between hexes joined only by coastline | same |
| Crossing arrow | Defenders tripled against attacks across the hexside | Ground units may cross the marked hexsides in both directions |
| Fortress | Defense quadrupled; can't be taken by Attrition or Isolation | ZOC has no effect on fortress hexes |
| Front boundary | Units crossing or attacking across must follow the Option chosen on the Front entered | same |
| Lake | Nothing allowed across all-water hexsides | same |
| Swamp | Defense tripled | None |
| Mountains | Defense tripled | None |
| National boundary line | Can't attack or move across while the country is neutral; a Declaration of War is needed first; no effect if already at war or conquered | same |
| Objective | Can't be chosen for Attrition advance | Can be used as a base |
| Ocean | Only special naval and air combat | Crossed only by fleets, and air units that can stage 8 hexes or less over it to another base |
| Plain | Double defense | None |
| Qattara Depression | Nothing across completely-Qattara hexsides | same |
| River | Defense tripled against attacks from across the river | None |

Still unknown: how multiple multipliers combine (river plus mountain, say).

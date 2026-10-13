import type { HexId } from "../engine/hex";
import type { Zone } from "../engine/types";
import { ORIGINAL_ZONES } from "./gamedata";
export { FRANCE_MAINLAND, ISLANDS } from "./islands";
import { MAP } from "./map";

/**
 * Zones: territory the scenario pages name but the printed map card does not outline. Small
 * islands and mainland France are read off the digitised map. The scenario start lines, Vichy
 * France, Eastern Europe and the Polish Partition Line come from the original game's control
 * bitmaps (src/data/gamedata.ts, written by scripts/gamedata/extract.ts; see docs/GAME_DATA.md).
 * European Turkey and the Baltic, North Sea and Atlantic ports are worked out from the map.
 * A test checks every zone's hexes are land hexes of its countries.
 */

/**
 * A zone of the original game: its hexes that are land of `countries` on our map. The original
 * also marks a few coastal hexes our map calls sea; they stay out until the map work (ticket T04)
 * makes them land of one of these countries, and then join without regenerating anything.
 * tests/gamedata.test.ts lists them.
 */
export function fromOriginal(id: keyof typeof ORIGINAL_ZONES, countries: readonly string[]): HexId[] {
  // Only land hexes have a country (validateMap checks it), so this keeps land hexes only.
  return ORIGINAL_ZONES[id].filter((h) => countries.includes(MAP.hexes[h]?.country ?? ""));
}

/**
 * Ref 29.0: Poland east of the Polish Partition Line: the Polish part of Eastern Europe
 * (EASTEURP.CON). The line in NSPPLINE.BIN runs exactly along its western edge (tests/gamedata.test.ts).
 */
export const POLAND_EAST_OF_PARTITION_LINE: Zone = {
  countries: ["poland"],
  description: "Poland east of the Polish Partition Line (Ref 29.0)",
  hexes: fromOriginal("eastern-europe", ["poland"]),
};

export const REGIONS = {
  "european-turkey": {
    countries: ["turkey"],
    // The Turkish land west of the Straits: the hexes reached from Istanbul over land without taking
    // the two Straits crossing arrows (Ref 4.6). The game's files hold no Turkey bitmap, so this is
    // read off our map; tests/gamedata.test.ts repeats the derivation.
    description: "European Turkey, west of the straits (Ref 17.3)",
    hexes: ["AA31", "Z32", "Z33"],
  },
  "eastern-europe": {
    countries: ["baltic-states", "poland", "rumania"],
    description: "Eastern Europe as created by Ref 29.0: the Baltic States, Poland east of the Partition Line and Bessarabia (EASTEURP.CON)",
    hexes: fromOriginal("eastern-europe", ["baltic-states", "poland", "rumania"]),
  },
  "baltic-north-atlantic-ports": {
    countries: ["baltic-states", "belgium", "britain", "france", "germany", "norway", "poland", "spain", "sweden", "ussr"],
    // Ports on waters reached from the open Atlantic without passing through a Mediterranean-Front
    // hex, so the Mediterranean, the Black Sea, the Sea of Azov and the Caspian are out. Read off
    // our map's fronts (tests/gamedata.test.ts repeats the derivation); the game's map file (BINMAP.BIN)
    // holds no sea tag for ports. Bilbao (S15) is a city, not a port, on the corrected map. TODO(verify): Gibraltar (AA7), on the
    // strait itself, counts here; no German fleet can start there, so it does not matter yet.
    description: "Ports on the Baltic Sea, the North Sea and the Atlantic (Ops 4.12)",
    hexes: [
      "B29", "C33", "D44", "E38", "F24", "F26", "F40", "J30", "J32", "J35", "J36", "K21", "K24", "K25", "K28", "K29", "K32", "L22",
      "L24", "L25", "M21", "N18", "N19", "O19", "Q18", "R12", "S11", "Z7", "AA7",
    ],
  },
} satisfies Record<string, Zone>;

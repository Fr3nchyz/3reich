import type { HexId } from "../engine/hex";
import type { Zone } from "../engine/types";
import { CONTROL_BITMAPS } from "./gamedata";
import { MAP } from "./map";

/**
 * Zones: territory the scenario pages name but the printed map card does not outline. Small
 * islands and mainland France are read off the digitised map. The scenario start lines, Vichy
 * France, Eastern Europe and the Polish Partition Line come from the original game's control
 * bitmaps (src/data/gamedata.ts, decoded by scripts/gamedata/extract.ts; see docs/GAME_DATA.md).
 * European Turkey and the Baltic, North Sea and Atlantic ports are worked out from the map.
 * A test checks every zone's hexes are land hexes of its countries.
 */

/**
 * The hexes a control bitmap of the original game marks that are land hexes of `country` on our
 * map, less `except`. A few hexes the bitmaps mark are sea on our map (coastal slivers); they
 * drop out here, and tests/gamedata.test.ts lists them.
 */
export function fromBitmap(bitmap: keyof typeof CONTROL_BITMAPS, country: string, except: readonly HexId[] = []): HexId[] {
  return CONTROL_BITMAPS[bitmap].filter((id) => {
    const h = MAP.hexes[id];
    return !!h?.land && h.country === country && !except.includes(id);
  });
}

export const ISLANDS = {
  corsica: { countries: ["france"], description: "Corsica (Ajaccio)", hexes: ["X20"] },
  // TODO(verify): DD19 and EE19 are coastal slivers on the digitised map (see docs/RULES.md).
  sicily: { countries: ["italy"], description: "Sicily", hexes: ["DD19", "DD20", "DD21", "EE19", "EE20", "EE21"] },
  sardinia: { countries: ["italy"], description: "Sardinia (Cagliari)", hexes: ["AA18", "AA19", "Y19", "Y20", "Z19"] },
  rhodes: { countries: ["italy"], description: "Rhodes", hexes: ["FF30"] },
} satisfies Record<string, Zone>;

export const FRANCE_MAINLAND: Zone = {
  countries: ["france"],
  description: "European France without Corsica",
  hexes: [
    "L24", "M19", "M21", "M23", "M24", "N18", "N19", "N20", "N21", "N22", "N23", "N24", "O19", "O20", "O21", "O22", "O23", "O24",
    "P18", "P19", "P20", "P21", "P22", "P23", "P24", "P25", "Q18", "Q19", "Q20", "Q21", "Q22", "Q23", "Q24", "R17", "R18", "R19",
    "R20", "R21", "R22", "S16", "S17", "S18", "S19", "S20", "S21", "T16", "T17", "T18", "T19", "T20", "T21", "U17", "U18", "U19",
    "U20", "V19", "V20",
  ],
};

/**
 * Ref 29.0: Poland east of the Polish Partition Line. EASTEURP.CON marks it; the line in
 * NSPPLINE.BIN runs exactly along its western edge (tests/gamedata.test.ts).
 */
export const POLAND_EAST_OF_PARTITION_LINE: Zone = {
  countries: ["poland"],
  description: "Poland east of the Polish Partition Line (Ref 29.0)",
  hexes: fromBitmap("EASTEURP", "poland"),
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
    hexes: [...fromBitmap("EASTEURP", "baltic-states"), ...fromBitmap("EASTEURP", "poland"), ...fromBitmap("EASTEURP", "rumania")],
  },
  "baltic-north-atlantic-ports": {
    countries: ["baltic-states", "belgium", "britain", "france", "germany", "norway", "poland", "spain", "sweden", "ussr"],
    // Ports on waters reached from the open Atlantic without passing through a Mediterranean-Front
    // hex, so the Mediterranean, the Black Sea, the Sea of Azov and the Caspian are out. Read off
    // our map's fronts (tests/gamedata.test.ts repeats the derivation); the game's files that might
    // tag ports by sea (BINMAP*.BIN) are not decoded yet. TODO(verify): Gibraltar (AA7), on the
    // strait itself, counts here; no German fleet can start there, so it does not matter yet.
    description: "Ports on the Baltic Sea, the North Sea and the Atlantic (Ops 4.12)",
    hexes: [
      "B29", "C33", "D44", "E38", "F24", "F26", "F40", "J30", "J32", "J35", "J36", "K21", "K24", "K25", "K28", "K29", "K32", "L22",
      "L24", "L25", "M21", "N18", "N19", "O19", "Q18", "R12", "S11", "S15", "Z7", "AA7",
    ],
  },
} satisfies Record<string, Zone>;

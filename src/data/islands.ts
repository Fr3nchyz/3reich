import type { Zone } from "../engine/types";

/**
 * Zones read off the digitised map: the small islands and mainland France. A test checks they
 * are land hexes of the right country. Kept apart from zones.ts so that the game-data extractor
 * can leave these islands out of the zones it writes without reading its own output.
 */
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

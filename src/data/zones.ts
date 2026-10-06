import type { Zone } from "../engine/types";

/**
 * Zones that every 1942-style scenario shares. Small islands and mainland France are read off
 * the digitised map (a test checks they are land hexes of the right country). Zones with
 * `hexes: null` are lines or regions the original program draws that the printed map card
 * does not show; see docs/RULES.md "Open questions".
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

export const UNPLACED_REGIONS = {
  "european-turkey": {
    countries: ["turkey"],
    description: "European Turkey, west of the straits (Ref 17.3)",
    hexes: null,
  },
  "eastern-europe": {
    countries: ["baltic-states", "poland", "rumania"],
    description: "Eastern Europe as created by Ref 29.0: the Baltic States, Poland east of the Partition Line and Bessarabia",
    hexes: null,
  },
  "baltic-north-atlantic-ports": {
    countries: [],
    description: "Ports on the Baltic Sea, the North Sea and the Atlantic. The map data does not tag ports by sea.",
    hexes: null,
  },
} satisfies Record<string, Zone>;

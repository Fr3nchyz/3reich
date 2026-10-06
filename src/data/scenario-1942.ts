import type { Scenario } from "../engine/types";
import { axisMinorSetups } from "./axis-minors";
import { air, airborne, armor, fleet, from, inf, nation, nationSetup, replacement } from "./counters";
import { ISLANDS, UNPLACED_REGIONS } from "./zones";

/**
 * 1942 scenario. Source: Ops 9.0 "1942 SCENARIO" (pp. 22-24), with Ref 17.3 for the Minor-Allies'
 * setup and Ref 35.0 for Vichy France.
 *
 * Duration Spring '42 - Winter '44 (12 Game Turns maximum). The Axis moves first. The USA, Britain
 * and the USSR are at war with Germany and Italy; Finland, Rumania, Hungary and Bulgaria are active
 * German Minor-Allies; France is Vichy, an inactive German Minor-Ally. Victory: Ref 2.0 and 2.2.
 */
export const SCENARIO_1942: Scenario = {
  id: "1942",
  name: "1942 Scenario",
  start: { year: 1942, season: "spring" },
  end: { year: 1944, season: "winter" },
  firstSide: "axis",
  nations: {
    // "290 (245 Base, plus 45 for Finland, Rumania, Hungary and Bulgaria)".
    germany: nation("germany", "axis", 245, 50, 290),
    italy: nation("italy", "axis", 90, 20),
    ussr: nation("ussr", "allied", 110, 30),
    britain: nation("britain", "allied", 160, 40),
    usa: nation("usa", "allied", 270, 60),
    // France is Vichy: it has no BRPs of its own (Ref 35.0: Vichy never yields BRPs to Germany).
    france: nation("france", "vichy", 0, 0),
  },

  deploymentOrder: ["usa", "britain", "free-france", "ussr", "italy", "germany", "finland", "rumania", "bulgaria", "hungary", "vichy-france"],

  warsAtStart: [
    ["usa", "germany"],
    ["usa", "italy"],
    ["britain", "germany"],
    ["britain", "italy"],
    ["ussr", "germany"],
    ["ussr", "italy"],
    // The Allies are also at war with the active Minor-Allies.
    ...(["usa", "britain", "ussr"] as const).flatMap((a) =>
      (["finland", "rumania", "hungary", "bulgaria"] as const).map((m): [typeof a, typeof m] => [a, m]),
    ),
  ],
  minorAllies: [
    { owner: "finland", of: "germany", active: true },
    { owner: "rumania", of: "germany", active: true },
    { owner: "hungary", of: "germany", active: true },
    { owner: "bulgaria", of: "germany", active: true },
    { owner: "vichy-france", of: "germany", active: false },
  ],

  zones: {
    corsica: ISLANDS.corsica,
    "european-turkey": UNPLACED_REGIONS["european-turkey"],
    "eastern-europe": UNPLACED_REGIONS["eastern-europe"],
    "baltic-north-atlantic-ports": UNPLACED_REGIONS["baltic-north-atlantic-ports"],
    // The "scenario start line": a line the program draws at setup. It is not on the printed map
    // card and the manuals do not list its hexes.
    "ussr-east-of-start-line": { countries: ["ussr"], description: "The U.S.S.R. east of the 1942 scenario start line", hexes: null },
    "ussr-west-of-start-line": { countries: ["ussr"], description: "The U.S.S.R. west of the 1942 scenario start line", hexes: null },
    "libya-east-of-start-line": { countries: ["libya"], description: "Libya east of Tobruk (inclusive)", hexes: null },
    "libya-west-of-start-line": { countries: ["libya"], description: "Libya west of Tobruk", hexes: null },
    // Ref 35.0: Vichy France is the part of European France the program marks as Vichy.
    "vichy-france": { countries: ["france"], description: "European Vichy France (without Corsica)", hexes: null },
    "occupied-france": { countries: ["france"], description: "European France outside Vichy France, under German control", hexes: null },
  },

  // "Only SW Construction is allowed in the 1942 YSS. Germany begins with 6 SW Submarine factors already built."
  startingYss: "sw-construction-only",
  startingStrategicWarfare: { germany: { submarines: 6, asw: 0, sac: 0 } },

  rules: [],

  forces: {
    usa: nationSetup({
      controlledAtStart: ["usa"],
      // "All U.S. units set up in the U.S. Box ... in Spring '42."
      setup: [{ kind: "all-in", types: "all", in: [{ box: "us-box" }] }],
      forcePool: [inf(3, 4, 10), armor(5, 6, 1), fleet(9, 4), air(5, 4, 2)],
      allowableBuilds: [inf(3, 4, 5), airborne(3, 3, 1), armor(5, 6, 4), fleet(9, 3), air(5, 4, 3), replacement(7)],
    }),

    britain: nationSetup({
      // The printed list leaves Egypt out, but Britain sets up units there, so it is British-controlled.
      controlledAtStart: ["britain", "egypt", "iraq", "lebanon-syria", "palestine", "transjordan"],
      controlledZones: ["libya-east-of-start-line"],
      setup: [
        { kind: "place", type: "infantry", strength: 1, count: 1, in: [{ country: "lebanon-syria" }] },
        { kind: "place", type: "infantry", strength: 1, count: 1, in: [{ hex: "GG19" }] }, // Malta
        { kind: "place", type: "infantry", strength: 1, count: 1, in: [{ hex: "AA7" }] }, // Gibraltar
        { kind: "place", type: "fleet", strength: 9, count: 2, in: [{ hex: "AA7" }] },
        // "in Egypt and/or in Libya east of the scenario start line"
        { kind: "place", type: "infantry", strength: 3, count: 2, in: [{ country: "egypt" }, { zone: "libya-east-of-start-line" }] },
        { kind: "place", type: "armor", strength: 4, count: 1, in: [{ country: "egypt" }, { zone: "libya-east-of-start-line" }] },
        { kind: "place", type: "fleet", strength: 9, count: 3, in: [{ country: "egypt" }, { zone: "libya-east-of-start-line" }] },
        { kind: "place", type: "air", strength: 5, count: 1, in: [{ country: "egypt" }, { zone: "libya-east-of-start-line" }] },
      ],
      forcePool: [inf(3, 4, 6), inf(1, 3, 3), armor(4, 5, 3), fleet(9, 9), air(5, 4, 2)],
      allowableBuilds: [
        inf(3, 4, 1),
        armor(4, 5, 1),
        fleet(9, 1),
        air(5, 4, 2),
        replacement(6),
        from(airborne(3, 3, 1), 1942, "summer"), // "* in/after Summer '42"
      ],
    }),

    "free-france": nationSetup({
      controlledAtStart: [],
      setup: [{ kind: "all-in", types: "all", in: [{ country: "lebanon-syria" }] }],
      forcePool: [inf(2, 3, 2)],
      allowableBuilds: [],
    }),

    ussr: nationSetup({
      controlledAtStart: [],
      controlledZones: ["ussr-east-of-start-line"],
      // "At least six ground factors must set up in and/or adjacent to Leningrad (D44) and Moscow (H47)."
      setup: [{ kind: "min-ground-factors-near", hexes: ["D44", "H47"], min: 6 }],
      forcePool: [inf(2, 3, 7), inf(1, 3, 15), airborne(2, 3, 2), armor(3, 5, 6), fleet(9, 3), air(5, 4, 2)],
      allowableBuilds: [inf(3, 3, 20), inf(2, 3, 3), armor(4, 5, 4), air(5, 4, 1)],
    }),

    italy: nationSetup({
      // Sicily, Sardinia and Rhodes are part of Italy on the map.
      controlledAtStart: ["italy", "albania"],
      controlledZones: ["libya-west-of-start-line"],
      setup: [
        { kind: "place", type: "infantry", strength: 1, count: 1, in: [{ country: "albania" }] },
        { kind: "place", type: "infantry", strength: 1, count: 2, in: [{ zone: "libya-west-of-start-line" }] },
        { kind: "all-in", types: ["fleet"], in: [{ ports: "mediterranean" }] },
      ],
      forcePool: [inf(3, 3, 2), inf(2, 3, 4), inf(1, 3, 6), airborne(2, 3, 1), armor(2, 5, 2), fleet(9, 6), air(5, 4, 2)],
      allowableBuilds: [replacement(6)],
    }),

    germany: nationSetup({
      controlledAtStart: ["germany", "baltic-states", "belgium", "denmark", "netherlands", "norway", "luxembourg", "poland", "yugoslavia", "greece"],
      controlledZones: ["occupied-france", "ussr-west-of-start-line"],
      setup: [
        { kind: "all-in", types: ["fleet"], in: [{ zone: "baltic-north-atlantic-ports" }, { box: "murmansk-box" }] },
        { kind: "place", type: "armor", count: 1, in: [{ zone: "libya-west-of-start-line" }] },
        { kind: "place", type: "infantry", count: 1, in: [{ zone: "libya-west-of-start-line" }] },
      ],
      mayAlsoSetUpIn: [
        { areas: [{ country: "bulgaria" }, { country: "finland" }, { country: "hungary" }, { country: "rumania" }] },
        { areas: [{ box: "murmansk-box" }], types: ["fleet", "air"] },
      ],
      forcePool: [inf(3, 3, 28), armor(4, 6, 8), fleet(9, 3), air(5, 4, 4)],
      allowableBuilds: [airborne(3, 3, 1), armor(4, 6, 4), air(5, 4, 2), replacement(8), from(armor(5, 6, 2), 1943)],
    }),

    ...axisMinorSetups("1942"),

    "vichy-france": nationSetup({
      controlledAtStart: ["morocco", "algeria", "tunisia"],
      controlledZones: ["vichy-france", "corsica"],
      setup: [
        { kind: "place", type: "infantry", strength: 2, count: 1, in: [{ country: "morocco" }, { country: "algeria" }, { country: "tunisia" }] },
        { kind: "rest-in", in: [{ zone: "vichy-france" }, { zone: "corsica" }] },
      ],
      forcePool: [inf(2, 3, 6), fleet(9, 1)],
      allowableBuilds: [], // "none (other than losses that occur while Vichy is active)"
    }),
  },

  notes: [
    "The Axis moves first. The 'scenario start line' divides the U.S.S.R. between Germany (west) and the Soviets (east), and Libya at Tobruk between Britain (east, inclusive) and Italy (west). The program draws it at setup; it is not on the printed map card, so its hexes are not yet known.",
    "The printed 'Controlled at start' list for Britain leaves out Egypt, but Britain's setup places units there, so Egypt is encoded as British.",
    "Britain's Free French (2-3 infantry x2) are set up by the Allied player in Lebanon-Syria. Free French units function as British in all respects (Ref 35.0).",
    "Vichy France is an inactive German Minor-Ally. Its European hexes are chosen by the program (Ref 35.0) and are not on the printed map. Vichy may build only to replace losses that occur while it is active.",
    "At least six Soviet ground factors must set up in and/or adjacent to Leningrad and Moscow. The page does not say whether the six are counted across both cities together; this encodes them as a single total.",
    "Germany may place units in the Murmansk Convoy Box (fleets and air units only), and its fleets must start in Baltic Sea, North Sea or Atlantic ports (Ops 4.12).",
    "Germany's 290 BRPs include 45 for Finland, Rumania, Hungary and Bulgaria. Only SW Construction is allowed in the 1942 Year Start Sequence. Victory conditions are in Ref 2.0 and 2.2 and are not encoded yet.",
  ],
};

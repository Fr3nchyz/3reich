import type { Scenario } from "../engine/types";
import { axisMinorSetups } from "./axis-minors";
import { air, airborne, armor, fleet, from, inf, nation, nationSetup, replacement } from "./counters";
import { fromOriginal, ISLANDS, REGIONS } from "./zones";

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
    "european-turkey": REGIONS["european-turkey"],
    "eastern-europe": REGIONS["eastern-europe"],
    "baltic-north-atlantic-ports": REGIONS["baltic-north-atlantic-ports"],
    // The "scenario start line" the program draws at setup. It is not on the printed map card; the
    // game's control bitmaps for 1942 give each side's hexes, and 1942LINE.BIN runs exactly along the
    // border between them (tests/gamedata.test.ts).
    "ussr-east-of-start-line": { countries: ["ussr"], description: "The U.S.S.R. east of the 1942 scenario start line (USSR42.CON)", hexes: fromOriginal("1942/ussr-east-of-start-line", ["ussr"]) },
    "ussr-west-of-start-line": { countries: ["ussr"], description: "The U.S.S.R. west of the 1942 scenario start line (GERM42.CON)", hexes: fromOriginal("1942/ussr-west-of-start-line", ["ussr"]) },
    "libya-east-of-start-line": { countries: ["libya"], description: "Libya east of Tobruk, inclusive (BRIT42.CON)", hexes: fromOriginal("1942/libya-east-of-start-line", ["libya"]) },
    "libya-west-of-start-line": { countries: ["libya"], description: "Libya west of Tobruk (ITALY42.CON)", hexes: fromOriginal("1942/libya-west-of-start-line", ["libya"]) },
    // Ref 35.0: Vichy France is the part of European France the program marks as Vichy. VICHY42.CON
    // marks it with Corsica, which is its own zone here. GERM42.CON marks all of mainland France,
    // Vichy included, so German-held France is GERM42's France less Vichy's.
    "vichy-france": {
      countries: ["france"],
      description: "European Vichy France without Corsica (VICHY42.CON)",
      hexes: fromOriginal("1942/vichy-france", ["france"]),
    },
    "occupied-france": {
      countries: ["france"],
      description: "European France outside Vichy France, under German control (GERM42.CON less VICHY42.CON)",
      hexes: fromOriginal("1942/occupied-france", ["france"]),
    },
  },

  // "Only SW Construction is allowed in the 1942 YSS. Germany begins with 6 SW Submarine factors already built."
  startingYss: "sw-construction-only",
  startingStrategicWarfare: { germany: { submarines: 6, asw: 0, sac: 0 } },

  rules: [],

  forces: {
    usa: nationSetup({
      controlledAtStart: ["usa"],
      // "All U.S. units set up in the U.S. Box ... in Spring '42."
      setup: [{ kind: "all-in", types: "all", in: [{ kind: "box", box: "us-box" }] }],
      forcePool: [inf(3, 4, 10), armor(5, 6, 1), fleet(9, 4), air(5, 4, 2)],
      allowableBuilds: [inf(3, 4, 5), airborne(3, 3, 1), armor(5, 6, 4), fleet(9, 3), air(5, 4, 3), replacement(7)],
    }),

    britain: nationSetup({
      // The printed list leaves Egypt out, but Britain sets up units there, so it is British-controlled.
      controlledAtStart: ["britain", "egypt", "iraq", "lebanon-syria", "palestine", "transjordan"],
      controlledZones: ["libya-east-of-start-line"],
      setup: [
        { kind: "place", type: "infantry", strength: 1, count: 1, in: [{ kind: "country", id: "lebanon-syria" }] },
        { kind: "place", type: "infantry", strength: 1, count: 1, in: [{ kind: "hex", id: "GG19" }] }, // Malta
        { kind: "place", type: "infantry", strength: 1, count: 1, in: [{ kind: "hex", id: "AA7" }] }, // Gibraltar
        { kind: "place", type: "fleet", strength: 9, count: 2, in: [{ kind: "hex", id: "AA7" }] },
        // "in Egypt and/or in Libya east of the scenario start line"
        { kind: "place", type: "infantry", strength: 3, count: 2, in: [{ kind: "country", id: "egypt" }, { kind: "zone", id: "libya-east-of-start-line" }] },
        { kind: "place", type: "armor", strength: 4, count: 1, in: [{ kind: "country", id: "egypt" }, { kind: "zone", id: "libya-east-of-start-line" }] },
        { kind: "place", type: "fleet", strength: 9, count: 3, in: [{ kind: "country", id: "egypt" }, { kind: "zone", id: "libya-east-of-start-line" }] },
        { kind: "place", type: "air", strength: 5, count: 1, in: [{ kind: "country", id: "egypt" }, { kind: "zone", id: "libya-east-of-start-line" }] },
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
      // Free French units function as British in all respects (Ref 35.0), so they set up in
      // British-controlled territory, within the area the page names.
      mayAlsoSetUpIn: [{ areas: [{ kind: "controlled-by", owner: "britain" }] }],
      setup: [{ kind: "all-in", types: "all", in: [{ kind: "country", id: "lebanon-syria" }] }],
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
        { kind: "place", type: "infantry", strength: 1, count: 1, in: [{ kind: "country", id: "albania" }] },
        { kind: "place", type: "infantry", strength: 1, count: 2, in: [{ kind: "zone", id: "libya-west-of-start-line" }] },
        { kind: "all-in", types: ["fleet"], in: [{ kind: "ports", front: "mediterranean" }] },
      ],
      forcePool: [inf(3, 3, 2), inf(2, 3, 4), inf(1, 3, 6), airborne(2, 3, 1), armor(2, 5, 2), fleet(9, 6), air(5, 4, 2)],
      allowableBuilds: [replacement(6)],
    }),

    germany: nationSetup({
      controlledAtStart: ["germany", "baltic-states", "belgium", "denmark", "netherlands", "norway", "luxembourg", "poland", "yugoslavia", "greece"],
      controlledZones: ["occupied-france", "ussr-west-of-start-line"],
      setup: [
        { kind: "all-in", types: ["fleet"], in: [{ kind: "zone", id: "baltic-north-atlantic-ports" }, { kind: "box", box: "murmansk-box" }] },
        { kind: "place", type: "armor", count: 1, in: [{ kind: "zone", id: "libya-west-of-start-line" }] },
        { kind: "place", type: "infantry", count: 1, in: [{ kind: "zone", id: "libya-west-of-start-line" }] },
        // TODO(verify): the page names one armor and one infantry unit for Libya, so Germany is held
        // to their 7 factors there (4-6 armor plus 3-3 infantry), the literal reading. Whether the
        // original lets more German units start in Libya is not known (docs/RULES.md).
        { kind: "max-factors", area: { kind: "zone", id: "libya-west-of-start-line" }, max: 7 },
      ],
      mayAlsoSetUpIn: [
        { areas: [{ kind: "country", id: "bulgaria" }, { kind: "country", id: "finland" }, { kind: "country", id: "hungary" }, { kind: "country", id: "rumania" }] },
        { areas: [{ kind: "box", box: "murmansk-box" }], types: ["fleet", "air"] },
        // The page sets up a German armor and infantry unit in Libya west of the start line, which is
        // Italian; the max-factors requirement above limits how much may go there.
        { areas: [{ kind: "zone", id: "libya-west-of-start-line" }], types: ["armor", "infantry"] },
      ],
      forcePool: [inf(3, 3, 28), armor(4, 6, 8), fleet(9, 3), air(5, 4, 4)],
      allowableBuilds: [airborne(3, 3, 1), armor(4, 6, 4), air(5, 4, 2), replacement(8), from(armor(5, 6, 2), 1943)],
    }),

    ...axisMinorSetups("1942"),

    "vichy-france": nationSetup({
      controlledAtStart: ["morocco", "algeria", "tunisia"],
      controlledZones: ["vichy-france", "corsica"],
      setup: [
        { kind: "place", type: "infantry", strength: 2, count: 1, in: [{ kind: "country", id: "morocco" }, { kind: "country", id: "algeria" }, { kind: "country", id: "tunisia" }] },
        { kind: "rest-in", in: [{ kind: "zone", id: "vichy-france" }, { kind: "zone", id: "corsica" }] },
      ],
      forcePool: [inf(2, 3, 6), fleet(9, 1)],
      allowableBuilds: [], // "none (other than losses that occur while Vichy is active)"
    }),
  },

  notes: [
    "The Axis moves first. The 'scenario start line' divides the U.S.S.R. between Germany (west) and the Soviets (east), and Libya at Tobruk between Britain (east, inclusive) and Italy (west). The program draws it at setup; it is not on the printed map card. Its hexes come from the original game's 1942 control bitmaps.",
    "The printed 'Controlled at start' list for Britain leaves out Egypt, but Britain's setup places units there, so Egypt is encoded as British. The original game's BRIT42.CON marks all of Egypt as British too.",
    "Britain's Free French (2-3 infantry x2) are set up by the Allied player in Lebanon-Syria. Free French units function as British in all respects (Ref 35.0).",
    "Vichy France is an inactive German Minor-Ally. Its European hexes are chosen by the program (Ref 35.0) and are not on the printed map; they come from the original game's VICHY42.CON. Vichy may build only to replace losses that occur while it is active.",
    "At least six Soviet ground factors must set up in and/or adjacent to Leningrad and Moscow. The page does not say whether the six are counted across both cities together; this encodes them as a single total.",
    "Germany may place units in the Murmansk Convoy Box (fleets and air units only), and its fleets must start in Baltic Sea, North Sea or Atlantic ports (Ops 4.12).",
    "Germany's 290 BRPs include 45 for Finland, Rumania, Hungary and Bulgaria. Only SW Construction is allowed in the 1942 Year Start Sequence. Victory conditions are in Ref 2.0 and 2.2 and are not encoded yet.",
  ],
};

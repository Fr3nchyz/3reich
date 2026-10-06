import type { Scenario } from "../engine/types";
import { axisMinorSetups } from "./axis-minors";
import { air, airborne, armor, fleet, inf, nation, nationSetup, ofNation, replacement } from "./counters";
import { FRANCE_MAINLAND, ISLANDS, UNPLACED_REGIONS } from "./zones";

/**
 * 1944 scenario. Source: Ops 9.0 "1944 SCENARIO" (pp. 24-26), with Ref 17.3 for the Minor-Allies'
 * setup.
 *
 * Duration Spring '44 - Spring '46 (9 Game Turns maximum). The Allies move first. The USA,
 * Britain and the USSR are at war with Germany and with its active Minor-Allies Finland, Rumania,
 * Hungary and Bulgaria. Italy and Vichy France are out of the game. Victory: Ref 2.0 and 2.3.
 */
export const SCENARIO_1944: Scenario = {
  id: "1944",
  name: "1944 Scenario",
  start: { year: 1944, season: "spring" },
  end: { year: 1946, season: "spring" },
  firstSide: "allies",
  nations: {
    // "370 (325 Base, plus 45 for Finland, Rumania, Hungary and Bulgaria)".
    germany: nation("germany", "axis", 325, 50, 370),
    italy: nation("italy", "out", 0, 0),
    ussr: nation("ussr", "allied", 130, 30),
    britain: nation("britain", "allied", 220, 40),
    usa: nation("usa", "allied", 400, 60),
    france: nation("france", "out", 0, 0),
  },

  deploymentOrder: ["usa", "britain", "free-france", "ussr", "germany", "finland", "rumania", "bulgaria", "hungary"],

  warsAtStart: (["usa", "britain", "ussr"] as const).flatMap((a) =>
    (["germany", "finland", "rumania", "hungary", "bulgaria"] as const).map((b): [typeof a, typeof b] => [a, b]),
  ),
  minorAllies: [
    { owner: "finland", of: "germany", active: true },
    { owner: "rumania", of: "germany", active: true },
    { owner: "hungary", of: "germany", active: true },
    { owner: "bulgaria", of: "germany", active: true },
  ],

  zones: {
    corsica: ISLANDS.corsica,
    sicily: ISLANDS.sicily,
    sardinia: ISLANDS.sardinia,
    rhodes: ISLANDS.rhodes,
    "france-mainland": FRANCE_MAINLAND,
    "european-turkey": UNPLACED_REGIONS["european-turkey"],
    "eastern-europe": UNPLACED_REGIONS["eastern-europe"],
    "baltic-north-atlantic-ports": UNPLACED_REGIONS["baltic-north-atlantic-ports"],
    // The "scenario start line" for 1944. The program draws it at setup; it is not on the printed
    // map card and the manuals do not list its hexes.
    "ussr-east-of-start-line": { countries: ["ussr"], description: "The U.S.S.R. east of the 1944 scenario start line", hexes: null },
    "ussr-west-of-start-line": { countries: ["ussr"], description: "The U.S.S.R. west of the 1944 scenario start line", hexes: null },
    "italy-north-of-start-line": { countries: ["italy"], description: "Italy north of the 1944 scenario start line", hexes: null },
    "italy-south-of-start-line": { countries: ["italy"], description: "Italy south of the 1944 scenario start line", hexes: null },
  },

  // "Only SW Construction is allowed in the 1944 YSS. The U.S.A. begins with 2 ASW and 3 SAC factors,
  // and Britain begins with 2 ASW and 2 SAC factors, already built."
  startingYss: "sw-construction-only",
  startingStrategicWarfare: {
    usa: { submarines: 0, asw: 2, sac: 3 },
    britain: { submarines: 0, asw: 2, sac: 2 },
  },

  rules: [
    // "Neither side may declare war on any country that is neutral at the start of the scenario."
    { kind: "no-war-on-neutrals" },
  ],

  forces: {
    usa: nationSetup({
      controlledAtStart: ["usa"],
      // "U.S. 'at start' forces are set up in the U.S. Box and/or anywhere in British-controlled territory."
      setup: [{ kind: "all-in", types: "all", in: [{ box: "us-box" }, { controlledBy: "britain" }] }],
      forcePool: [inf(3, 4, 10), airborne(3, 3, 1), armor(5, 6, 4), fleet(9, 7), air(5, 4, 5)],
      allowableBuilds: [inf(3, 4, 5), armor(5, 6, 1), replacement(7)],
    }),

    britain: nationSetup({
      // The printed list leaves Egypt out, but it lies between Libya and Palestine and is British in
      // the earlier scenarios, so it is encoded as British. Cyprus, Gibraltar and Malta are part of
      // "britain" on the map.
      controlledAtStart: ["britain", "algeria", "egypt", "iraq", "lebanon-syria", "libya", "morocco", "palestine", "transjordan", "tunisia"],
      controlledZones: ["corsica", "sardinia", "sicily", "italy-south-of-start-line"],
      setup: [
        // "At least three 3-4 infantry, two 4-5 armor, four 9-factor fleets and one 5-4 air unit on the Mediterranean Front."
        { kind: "place", type: "infantry", strength: 3, count: 3, in: [{ front: "mediterranean" }] },
        { kind: "place", type: "armor", strength: 4, count: 2, in: [{ front: "mediterranean" }] },
        { kind: "place", type: "fleet", strength: 9, count: 4, in: [{ front: "mediterranean" }] },
        { kind: "place", type: "air", strength: 5, count: 1, in: [{ front: "mediterranean" }] },
      ],
      forcePool: [inf(3, 4, 7), inf(1, 3, 3), airborne(3, 3, 1), armor(4, 5, 4), fleet(9, 10), air(5, 4, 4), replacement(6)],
      allowableBuilds: [], // "none (other than losses)"
    }),

    "free-france": nationSetup({
      controlledAtStart: [],
      setup: [{ kind: "all-in", types: "all", in: [{ front: "mediterranean" }] }],
      forcePool: [inf(2, 3, 2)],
      allowableBuilds: [],
    }),

    ussr: nationSetup({
      controlledAtStart: [],
      controlledZones: ["ussr-east-of-start-line"],
      forcePool: [inf(3, 3, 20), inf(2, 3, 10), inf(1, 3, 6), airborne(2, 3, 2), armor(4, 5, 4), armor(3, 5, 6), fleet(9, 2), air(5, 4, 3)],
      allowableBuilds: [],
    }),

    germany: nationSetup({
      controlledAtStart: [
        "germany", "albania", "baltic-states", "belgium", "denmark", "netherlands", "norway", "luxembourg", "poland", "yugoslavia", "greece",
      ],
      controlledZones: ["france-mainland", "rhodes", "italy-north-of-start-line", "ussr-west-of-start-line"],
      setup: [
        // "All fleets must start in Baltic-Sea, North-Sea and/or Atlantic ports [Exception: the German-controlled
        // Italian fleet must start in a German-controlled Mediterranean port]."
        { kind: "all-in", types: ["fleet"], nationality: "own", in: [{ zone: "baltic-north-atlantic-ports" }, { box: "murmansk-box" }] },
        { kind: "all-in", types: ["fleet"], nationality: "italy", in: [{ ports: "mediterranean" }] },
      ],
      mayAlsoSetUpIn: [
        { areas: [{ country: "bulgaria" }, { country: "finland" }, { country: "hungary" }, { country: "rumania" }] },
        { areas: [{ box: "murmansk-box" }], types: ["fleet", "air"] },
      ],
      forcePool: [inf(3, 3, 31), airborne(3, 3, 1), armor(5, 6, 2), armor(4, 6, 6), fleet(9, 2), ofNation(fleet(6, 1), "italy"), air(5, 4, 6)],
      allowableBuilds: [inf(1, 3, 6), armor(4, 6, 5), replacement(8)],
    }),

    ...axisMinorSetups("1944"),
  },

  notes: [
    "The Allies move first. Neither side may declare war on a country that is neutral when the scenario starts.",
    "The 'scenario start line' divides the U.S.S.R. between Germany (west) and the Soviets (east), and Italy between Germany (north) and Britain (south). The program draws it at setup; it is not on the printed map card, so its hexes are not yet known.",
    "The printed 'Controlled at start' list for Britain leaves out Egypt; it is encoded as British (see the 1942 scenario).",
    "Britain's Free French (2-3 infantry x2) set up on the Mediterranean Front. Free French units function as British in all respects (Ref 35.0).",
    "The light-blue 6-factor fleet in Germany's pool is the Italian fleet, which must start in a German-controlled Mediterranean port.",
    "Germany's 370 BRPs include 45 for Finland, Rumania, Hungary and Bulgaria. Only SW Construction is allowed in the 1944 Year Start Sequence. Victory conditions are in Ref 2.0 and 2.3 and are not encoded yet.",
  ],
};

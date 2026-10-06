import type { Scenario } from "../engine/types";
import { air, airborne, armor, fleet, inf, nation, nationSetup, replacement } from "./counters";

/**
 * 1939 scenario. Source: Ops 9.0 "1939 SCENARIO" (pp. 20-21), the in-game status screen
 * for BRPs, and Ref 29.0 for Poland and Eastern Europe, with Peele's errata applied:
 * Germany's 20-factor limit for Finland, Hungary, Rumania and Bulgaria is gone, except
 * the 5-factor maximum in Finland.
 *
 * Duration Fall '39 - Summer '42 (12 Game Turns maximum). The Axis moves first. Italy,
 * the USSR and the USA start neutral.
 */
export const SCENARIO_1939: Scenario = {
  id: "1939",
  name: "1939 Scenario",
  start: { year: 1939, season: "fall" },
  end: { year: 1942, season: "summer" },
  firstSide: "axis",
  nations: {
    france: nation("france", "allied", 85, 30),
    britain: nation("britain", "allied", 125, 40),
    usa: nation("usa", "neutral", 270, 60),
    ussr: nation("ussr", "neutral", 90, 30),
    germany: nation("germany", "axis", 150, 50),
    italy: nation("italy", "neutral", 75, 20),
  },

  // "Order of deployment: Poland, Italy, France, Britain, U.S.S.R., Germany." The USA sets
  // up in Spring '42, so it is not part of the opening setup.
  deploymentOrder: ["poland", "italy", "france", "britain", "ussr", "germany"],

  // "Germany is at war with Poland, France and Britain" (Ops 9.0, Ref 29.0).
  warsAtStart: [
    ["germany", "poland"],
    ["germany", "france"],
    ["germany", "britain"],
  ],
  minorAllies: [],

  zones: {
    // Ref 29.0: a red line the program draws through Poland. It is not on the printed map card
    // and no manual lists its hexes, so they are unknown until we see the original's setup screen.
    "poland-east-of-partition-line": {
      countries: ["poland"],
      description: "Poland east of the Polish Partition Line (Ref 29.0)",
      hexes: null,
    },
  },

  // "Year Start Sequence: None in 1939."
  startingYss: "none",
  startingStrategicWarfare: {},

  rules: [
    // "The U.S.A. automatically spends 35 BRPs for a DoW vs. Germany in the Allied Spring '42 turn."
    { kind: "automatic-declaration", by: "usa", on: "germany", turn: { year: 1942, season: "spring" }, side: "allies", brpCost: 35 },
    // "No Allied Seaborne Invasion is allowed in the Summer '42 turn."
    { kind: "no-seaborne-invasion", side: "allies", turn: { year: 1942, season: "summer" } },
    // "No BRP Base growth in the 1940 YSS." (There is no Year Start Sequence in 1939.)
    { kind: "no-brp-growth", year: 1940 },
    // Ref 29.0: German units east of the Partition Line at the end of the Axis Fall '39 turn are eliminated.
    { kind: "eliminate-in-zone", zone: "poland-east-of-partition-line", side: "axis", turn: { year: 1939, season: "fall" } },
  ],

  forces: {
    poland: nationSetup({
      controlledAtStart: ["poland"],
      setup: [{ kind: "all-in", types: "all", in: [{ country: "poland" }] }],
      forcePool: [inf(2, 3, 3), inf(1, 3, 7), air(1, 4, 2)],
      allowableBuilds: [],
    }),

    italy: nationSetup({
      // Sicily, Sardinia and Rhodes are part of Italy on the map; Albania and Libya are their own countries.
      controlledAtStart: ["italy", "albania", "libya"],
      setup: [
        { kind: "place", type: "infantry", strength: 1, count: 1, in: [{ country: "albania" }] },
        { kind: "place", type: "infantry", strength: 1, count: 2, in: [{ country: "libya" }] },
        { kind: "all-in", types: ["fleet"], in: [{ ports: "mediterranean" }] },
      ],
      forcePool: [inf(3, 3, 2), inf(1, 3, 6), armor(2, 5, 1), fleet(9, 4), air(5, 4, 2)],
      allowableBuilds: [inf(2, 3, 4), armor(2, 5, 1), fleet(9, 1), replacement(6)],
    }),

    france: nationSetup({
      // Corsica is part of France on the map.
      controlledAtStart: ["france", "algeria", "morocco", "tunisia", "lebanon-syria"],
      setup: [
        {
          kind: "place", type: "infantry", strength: 2, count: 1,
          in: [{ country: "morocco" }, { country: "tunisia" }, { country: "algeria" }],
        },
        { kind: "place", type: "infantry", strength: 2, count: 1, in: [{ country: "lebanon-syria" }] },
      ],
      forcePool: [inf(2, 3, 12), armor(3, 5, 1), fleet(9, 3), air(5, 4, 2), replacement(2)],
      allowableBuilds: [inf(2, 3, 4), armor(3, 5, 2), replacement(2)],
    }),

    britain: nationSetup({
      // Cyprus, Gibraltar and Malta are part of Britain on the map.
      controlledAtStart: ["britain", "egypt", "iraq", "palestine", "transjordan"],
      setup: [
        { kind: "place", type: "infantry", strength: 1, count: 1, in: [{ country: "palestine" }] },
        // Malta (GG19).
        { kind: "place", type: "infantry", strength: 1, count: 1, in: [{ hex: "GG19" }] },
        { kind: "place", type: "air", strength: 1, count: 1, in: [{ hex: "GG19" }] },
        // Egypt.
        { kind: "place", type: "infantry", strength: 1, count: 1, in: [{ country: "egypt" }] },
        { kind: "place", type: "armor", strength: 2, count: 1, in: [{ country: "egypt" }] },
        { kind: "place", type: "fleet", strength: 9, count: 1, in: [{ country: "egypt" }] },
        { kind: "place", type: "air", strength: 1, count: 2, in: [{ country: "egypt" }] },
        // Gibraltar (AA7).
        { kind: "place", type: "air", strength: 1, count: 1, in: [{ hex: "AA7" }] },
        { kind: "place", type: "fleet", strength: 9, count: 2, in: [{ hex: "AA7" }] },
      ],
      forcePool: [inf(3, 4, 3), inf(1, 3, 3), armor(4, 5, 1), armor(2, 5, 1), fleet(9, 6), air(5, 4, 2), air(1, 4, 4)],
      allowableBuilds: [inf(3, 4, 3), armor(4, 5, 2), fleet(9, 3), air(5, 4, 1), air(1, 4, 1), replacement(6)],
    }),

    ussr: nationSetup({
      controlledAtStart: ["ussr"],
      setup: [
        { kind: "place", type: "infantry", strength: 2, count: 1, in: [{ hex: "D44" }] }, // Leningrad
        { kind: "place", type: "armor", strength: 3, count: 1, in: [{ hex: "H47" }] }, // Moscow
        { kind: "place", type: "infantry", strength: 1, count: 1, in: [{ hex: "T37" }] }, // Odessa
        { kind: "place", type: "infantry", strength: 1, count: 1, in: [{ hex: "O43" }] }, // Kharkov
        { kind: "place", type: "infantry", strength: 1, count: 1, in: [{ hex: "U48" }] }, // Grozny
      ],
      forcePool: [inf(1, 3, 12), inf(2, 3, 5), armor(3, 5, 3), fleet(9, 3), air(5, 4, 2)],
      allowableBuilds: [inf(1, 3, 3), inf(2, 3, 5), inf(3, 3, 5), armor(3, 5, 3), air(5, 4, 1)],
    }),

    germany: nationSetup({
      // East Prussia is part of Germany on the map.
      controlledAtStart: ["germany"],
      setup: [
        // Ref 29.0. Italian and Minor-Ally units, and units in Rumania or Turkey, do not count; for the
        // opening setup only, Western Front units adjacent to the Polish border also count.
        { kind: "min-factors", front: "eastern", min: 20, alsoCountsAdjacentTo: "poland", excludeCountries: ["rumania", "turkey"] },
        // Peele's errata: the 20-factor allowance for Finland, Hungary, Rumania and Bulgaria is
        // removed, but no more than 5 factors may set up in Finland.
        { kind: "max-factors", area: { country: "finland" }, max: 5 },
      ],
      // "May place ... in Finland (five maximum), Hungary, Rumania and/or Bulgaria."
      mayAlsoSetUpIn: [{ areas: [{ country: "finland" }, { country: "hungary" }, { country: "rumania" }, { country: "bulgaria" }] }],
      forcePool: [inf(3, 3, 8), armor(4, 6, 4), fleet(9, 2), air(5, 4, 4)],
      allowableBuilds: [inf(3, 3, 20), armor(4, 6, 8), airborne(3, 3, 1), fleet(9, 2), air(5, 4, 2), replacement(8)],
    }),

    usa: nationSetup({
      controlledAtStart: ["usa"],
      // All U.S. units set up in the U.S. Box in Spring '42 (the 1942 page spells out the turn;
      // the 1939 page's text is cut off in the scan).
      setup: [{ kind: "all-in", types: "all", in: [{ box: "us-box" }] }],
      forcePool: [inf(3, 4, 10), armor(5, 6, 1), fleet(9, 4), air(5, 4, 2)],
      allowableBuilds: [], // "none (other than losses)"
    }),
  },

  notes: [
    "Germany's opening Eastern Front Offensive Option is free, and Germany must make at least one ground attack on Polish ground units. It must keep attacking Poland every turn, by Offensive or Attrition Option, until Poland is conquered (Ref 29.0).",
    "Until Germany and the USSR are at war, Germany must have at least 20 ground/air factors in Eastern Front hexes at the end of each Axis Movement Phase and Axis Player Turn. Italian and Axis Minor-Ally units, and units in Rumania or Turkey, do not count. Failing this releases the USSR from the ban on declaring war before Fall 1941 (Ref 29.0). For the opening setup only, Western Front units adjacent to the Polish border count (Ref 29.0).",
    "The USSR may not declare war on Germany or Italy, or do anything that automatically causes it, before the Fall 1941 turn (Ops 9.0), unless Germany breaks the 20-factor rule above (Ref 13.1, 29.0).",
    "Germany may not set up in Bessarabia in Fall 1939 (Ref 29.0).",
    "The red Polish Partition Line runs north-south through Poland at the start of this scenario. German units east of it are eliminated if still there at the end of the Axis Fall 1939 turn. At that point Eastern Europe is created: the Baltic States, Poland east of the line, and Bessarabia, worth 25 BRPs. The line is drawn by the program and is not on the printed map card, so its hexes are not yet known (Ref 29.0).",
    "Before 1942, British and French units may not stack together, and British units may not stop in the Maginot Line, Paris, Marseilles or Vichy until France falls (Ref 26.0).",
    "There is no Year Start Sequence in 1939. Victory conditions are in Ref 2.0-2.1 and are not encoded yet.",
  ],
};

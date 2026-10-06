import { setupOf } from "../engine/game";
import type { ForceEntry, ForceOwner, NationSetup, Scenario } from "../engine/types";
import { air, airborne, armor, fleet, from, inf, replacement } from "./counters";
import { SCENARIO_1939 } from "./scenario-1939";

const base = (owner: ForceOwner): NationSetup => setupOf(SCENARIO_1939, owner);

/** The Campaign page prints the same builds as the 1939 page, then a second row that opens up later. */
const withLaterBuilds = (owner: ForceOwner, later: ForceEntry[]): NationSetup => {
  const b = base(owner);
  return { ...b, allowableBuilds: [...b.allowableBuilds, ...later] };
};

/**
 * Campaign scenario. Source: Ops 9.0 "CAMPAIGN SCENARIO" (pp. 26-27). It starts exactly as
 * the 1939 scenario does (same BRPs, pools, setup and wars) and runs on to Summer '45, so
 * each nation's allowable builds gain the starred counters that become available later.
 *
 * Duration Fall '39 - Summer '45 (24 Game Turns maximum). Victory: Ref 2.0 and 2.4.
 */
export const SCENARIO_CAMPAIGN: Scenario = {
  ...SCENARIO_1939,
  id: "campaign",
  name: "Campaign Scenario",
  end: { year: 1945, season: "summer" },

  forces: {
    ...SCENARIO_1939.forces,
    // "* in/after 1942"
    italy: withLaterBuilds("italy", [from(airborne(2, 3, 1), 1942), from(fleet(9, 1), 1942)]),
    // "* in/after Summer '42"
    britain: withLaterBuilds("britain", [
      from(inf(3, 4, 1), 1942, "summer"),
      from(airborne(3, 3, 1), 1942, "summer"),
      from(armor(4, 5, 1), 1942, "summer"),
      from(fleet(9, 1), 1942, "summer"),
    ]),
    // "* in/after 1942"
    ussr: withLaterBuilds("ussr", [from(inf(3, 3, 15), 1942), from(airborne(2, 3, 2), 1942), from(armor(4, 5, 4), 1942)]),
    // "* in/after 1943", "† in/after 1944"
    germany: withLaterBuilds("germany", [
      from(armor(5, 6, 2), 1943),
      from(inf(3, 3, 3), 1944),
      from(inf(1, 3, 6), 1944),
      from(armor(4, 6, 1), 1944),
    ]),
    // The Campaign page gives the U.S.A. builds that the 1939 page does not ("none (other than losses)").
    usa: {
      ...base("usa"),
      allowableBuilds: [
        inf(3, 4, 5),
        airborne(3, 3, 1),
        armor(5, 6, 4),
        fleet(9, 3),
        air(5, 4, 3),
        replacement(7),
      ],
    },
  },

  rules: [
    // "The U.S.A. automatically spends 35 BRPs for a DoW vs. Germany in the Allied Spring '42 turn."
    // The Campaign page does not repeat the 1939 page's Summer '42 Seaborne Invasion ban.
    { kind: "automatic-declaration", by: "usa", on: "germany", turn: { year: 1942, season: "spring" }, side: "allies", brpCost: 35 },
    { kind: "no-brp-growth", year: 1940 },
    { kind: "eliminate-in-zone", zone: "poland-east-of-partition-line", side: "axis", turn: { year: 1939, season: "fall" } },
  ],

  notes: [
    ...SCENARIO_1939.notes.filter((n) => !n.startsWith("There is no Year Start Sequence")),
    "There is no Year Start Sequence in 1939; there is one before each later year. Victory conditions are in Ref 2.0 and 2.4 and are not encoded yet.",
  ],
};

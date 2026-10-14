import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { minorForceEntries } from "../src/engine/minors";
import { MINOR_COUNTRY_FORCES } from "../src/engine/tables";
import type { ForceEntry, MinorCountry } from "../src/engine/types";

/** Spec 02: a minor country's forces as counters, from the Minor Country Forces chart (Ref 14.0). */

const sorted = (es: readonly ForceEntry[]) =>
  [...es].map((e) => `${e.type}:${e.strength}:${e.movement ?? ""}:${e.count}`).sort();

describe("the forces of a minor country", () => {
  it("equal Poland's force pool on the 1939 scenario page, counter for counter", () => {
    expect(sorted(minorForceEntries("poland"))).toEqual(sorted(SCENARIO_1939.forces.poland!.forcePool));
  });

  it("equal each Axis Minor-Ally's force pool on the 1942 scenario page", () => {
    for (const m of ["finland", "rumania", "hungary", "bulgaria"] as const) {
      expect(sorted(minorForceEntries(m)), m).toEqual(sorted(SCENARIO_1942.forces[m]!.forcePool));
    }
  });

  it("count every counter the chart lists, and nothing for a minor with no forces", () => {
    for (const minor of Object.keys(MINOR_COUNTRY_FORCES) as MinorCountry[]) {
      const f = MINOR_COUNTRY_FORCES[minor];
      const listed = f.inf1_3 + f.inf2_3 + f.arm2_5 + f.air1_4 + f.air2_4 + f.fleet2;
      expect(minorForceEntries(minor).reduce((n, e) => n + e.count, 0), minor).toBe(listed);
    }
    expect(minorForceEntries("ireland")).toEqual([]);
  });

  it("give Turkey its armor, air and fleet counters: 7 2-3 infantry, 2 2-5 armor, 2 2-4 air, 3 2-factor fleets", () => {
    expect(sorted(minorForceEntries("turkey"))).toEqual(
      sorted([
        { type: "infantry", strength: 2, movement: 3, count: 7 },
        { type: "armor", strength: 2, movement: 5, count: 2 },
        { type: "air", strength: 2, movement: 4, count: 2 },
        { type: "fleet", strength: 2, count: 3 },
      ]),
    );
  });
});

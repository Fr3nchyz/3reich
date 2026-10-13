import { describe, expect, it } from "vitest";
import {
  AIR_FACTOR_STACKING_LIMIT,
  airAdvantageDrm,
  airNationalityDrm,
  BRP_COSTS,
  BUILD_COST_PER_FACTOR,
  interceptionRolls,
  MINOR_COUNTRY_FORCES,
  type MinorCountry,
  navalAdvantageDrm,
  navalNationalityDrm,
  type NavalNation,
  STACKING_LIMIT,
  STACKING_LIMIT_BRIDGEHEAD,
  STACKING_LIMIT_LONDON_BRITISH,
} from "../src/engine/tables";
import { MAX_OCEAN_AIR_STAGE_HEXES, NO_ATTRITION_OCCUPATION } from "../src/engine/terrain";

// The charts below were checked against the original game's own chart screens (TABLE*.TAB) and,
// where the executable holds the rule, against 3R2.EXE, decoded with scripts/gamedata/tables.ts.
// See docs/GAME_DATA.md, "Rule tables".
describe("reference-map charts", () => {
  // TABLE7.TAB prints "25-30" and "30+". The game's interception routine (3R2.EXE) puts 30 in
  // the 25-30 band, which settles the old TODO(verify).
  it("interception, at every band edge", () => {
    expect(interceptionRolls(1)).toBe("automatic");
    expect(interceptionRolls(2)).toEqual([1, 2, 3, 4, 5]);
    expect(interceptionRolls(10)).toEqual([1, 2, 3, 4, 5]);
    expect(interceptionRolls(11)).toEqual([1, 2, 3, 4]);
    expect(interceptionRolls(18)).toEqual([1, 2, 3, 4]);
    expect(interceptionRolls(19)).toEqual([1, 2, 3]);
    expect(interceptionRolls(24)).toEqual([1, 2, 3]);
    expect(interceptionRolls(25)).toEqual([1, 2]);
    expect(interceptionRolls(30)).toEqual([1, 2]);
    expect(interceptionRolls(31)).toEqual([1]);
    expect(interceptionRolls(60)).toEqual([1]);
  });
  it("interception never gets easier with distance", () => {
    const chance = (d: number) => {
      const r = interceptionRolls(d);
      return r === "automatic" ? 6 : r.length;
    };
    for (let d = 2; d <= 60; d++) expect(chance(d)).toBeLessThanOrEqual(chance(d - 1));
  });

  // TABLE10.TAB prints 1.33:1 and 1.67:1, and the game's naval routine (3R2.EXE) compares the
  // single-precision ratio with exactly those decimals. So 5:3 (1.666...) is +1, not +2, and
  // exactly 1.67:1 is +1 too (1.67 in single precision is just below 1.67). This changed: the
  // engine used to read the chart as 4/3 and 5/3, which gave +2 at 5:3.
  it("naval advantage at the game's thresholds", () => {
    expect(navalAdvantageDrm(9, 9)).toBe(0);
    expect(navalAdvantageDrm(11, 9)).toBe(0);
    expect(navalAdvantageDrm(132, 100)).toBe(0);
    expect(navalAdvantageDrm(133, 100)).toBe(1);
    expect(navalAdvantageDrm(4, 3)).toBe(1);
    expect(navalAdvantageDrm(12, 9)).toBe(1);
    expect(navalAdvantageDrm(5, 3)).toBe(1);
    expect(navalAdvantageDrm(15, 9)).toBe(1);
    expect(navalAdvantageDrm(167, 100)).toBe(1);
    expect(navalAdvantageDrm(168, 100)).toBe(2);
    expect(navalAdvantageDrm(17, 10)).toBe(2);
    expect(navalAdvantageDrm(16, 9)).toBe(2);
    expect(navalAdvantageDrm(18, 9)).toBe(3);
    expect(navalAdvantageDrm(27, 9)).toBe(4);
    expect(navalAdvantageDrm(36, 9)).toBe(5);
    expect(navalAdvantageDrm(9, 0)).toBe(5);
    expect(navalAdvantageDrm(9, 18)).toBe(0);
  });
  // A model of the game's routine, independent of the integer form in the engine.
  it("naval advantage equals the game's single-precision comparison for totals up to 200", () => {
    const game = (f: number, e: number) => {
      const r = Math.fround(f / e);
      return r >= 4 ? 5 : r >= 3 ? 4 : r >= 2 ? 3 : r >= 1.67 ? 2 : r >= 1.33 ? 1 : 0;
    };
    for (let f = 1; f <= 200; f++) for (let e = 1; e <= 200; e++) expect(navalAdvantageDrm(f, e), `${f} vs ${e}`).toBe(game(f, e));
  });
  // TABLE10.TAB, and the game's naval routine for every nation but Vichy and Free France (see the
  // TODO(verify) on navalNationalityDrm). Row N is the boundary for Italy: "in or south of" is -1.
  it("naval nationality for every nation that can own a fleet", () => {
    const expected: Record<NavalNation, number> = {
      germany: 2, usa: 1, britain: 1, sweden: 1, france: 0, "vichy-france": 0, "free-france": 0,
      italy: -1, ussr: -2, turkey: -2, spain: -2,
    };
    for (const [nation, drm] of Object.entries(expected) as [NavalNation, number][]) {
      expect(navalNationalityDrm(nation), nation).toBe(drm);
      if (nation !== "italy") expect(navalNationalityDrm(nation, true), nation).toBe(drm);
    }
    expect(navalNationalityDrm("italy", true)).toBe(-2);
  });
  // TABLE1.TAB, and for nationality the game's air routine (3R2.EXE).
  it("air DRMs", () => {
    expect(airAdvantageDrm(10, 7)).toBe(3);
    expect(airAdvantageDrm(7, 10)).toBe(0);
    expect(airAdvantageDrm(7, 7)).toBe(0);
    for (const p of ["germany", "usa", "britain"] as const) expect(airNationalityDrm(p)).toBe(0);
    for (const p of ["ussr", "italy", "france"] as const) expect(airNationalityDrm(p)).toBe(-1);
    expect(airNationalityDrm("other")).toBe(-2);
  });
  // TABLE3.TAB.
  it("costs per factor", () => {
    expect(BUILD_COST_PER_FACTOR).toEqual({
      air: 3, airborne: 3, armor: 2, asw: 3, infantry: 1, interceptorFlak: 2, naval: 3, replacement: 1, sac: 3, submarine: 2,
    });
  });
  // Every row of the game's Minor Country Forces chart screen (TABLE9.TAB), in counters.
  // Columns: 1-3 inf, 2-3 inf, 2-5 armor, 1-4 air, 2-4 air, 2 fleet.
  it("minor country forces, every row", () => {
    const CHART = `
      arabia 0 0 0 0 0 0 | belgium 3 1 0 1 0 0 | bulgaria 4 0 0 1 0 0 | denmark 1 0 0 1 0 0
      finland 0 5 0 1 0 0 | greece 0 4 0 1 0 0 | hungary 6 1 0 1 0 0 | ireland 0 0 0 0 0 0
      luxembourg 0 0 0 0 0 0 | netherlands 0 1 0 1 0 0 | norway 2 0 0 0 0 0 | persia 0 0 0 0 0 0
      poland 7 3 0 2 0 0 | portugal 0 0 0 0 0 0 | rumania 6 2 0 1 0 0 | spain 0 7 1 0 3 4
      sweden 0 5 0 1 0 2 | turkey 0 7 2 0 2 3 | yugoslavia 0 5 0 2 0 0`;
    const rows = CHART.split(/[|\n]/).map((s) => s.trim()).filter(Boolean);
    expect(rows).toHaveLength(19);
    expect(Object.keys(MINOR_COUNTRY_FORCES)).toHaveLength(19);
    for (const row of rows) {
      const [name, ...n] = row.split(/\s+/);
      const [inf1_3, inf2_3, arm2_5, air1_4, air2_4, fleet2] = n.map(Number);
      expect(MINOR_COUNTRY_FORCES[name as MinorCountry], name).toEqual({ inf1_3, inf2_3, arm2_5, air1_4, air2_4, fleet2 });
    }
  });
  // Only Spain, Sweden and Turkey have fleets, and each has a naval nationality DRM on the chart.
  it("gives fleets only to minors listed on the naval chart", () => {
    const withFleets = Object.entries(MINOR_COUNTRY_FORCES).filter(([, f]) => f.fleet2 > 0).map(([m]) => m);
    expect(withFleets.sort()).toEqual(["spain", "sweden", "turkey"]);
  });
});

// Values copied from the reference map card and Reference Manual (docs/RULES.md). They are not used
// by a rule yet; pinning them stops a later edit from changing one without anyone noticing.
describe("printed constants waiting for their rules", () => {
  // Also on the game's own BRP costs chart screen (TABLE3.TAB).
  it("keeps the BRP costs of war and offensives", () => {
    expect(BRP_COSTS).toEqual({ declareWarOnMajorPower: 35, declareWarOnMinorCountry: 10, offensiveOption: 15 });
  });

  it("keeps the stacking limits (Ref 5.0)", () => {
    expect(STACKING_LIMIT).toBe(2);
    expect(STACKING_LIMIT_LONDON_BRITISH).toBe(3);
    expect(STACKING_LIMIT_BRIDGEHEAD).toBe(5);
    expect(AIR_FACTOR_STACKING_LIMIT).toBe(5);
  });

  it("keeps the hex features that cannot be chosen for occupation after attrition (Ref 12.4)", () => {
    expect([...NO_ATTRITION_OCCUPATION]).toEqual(["capital", "capital-port", "objective"]);
  });

  it("keeps the staging distance for air units over the ocean", () => {
    expect(MAX_OCEAN_AIR_STAGE_HEXES).toBe(8);
  });
});

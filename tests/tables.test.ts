import { describe, expect, it } from "vitest";
import {
  AIR_FACTOR_STACKING_LIMIT,
  airAdvantageDrm,
  airNationalityDrm,
  BRP_COSTS,
  BUILD_COST_PER_FACTOR,
  interceptionRolls,
  MINOR_COUNTRY_FORCES,
  navalAdvantageDrm,
  navalNationalityDrm,
  STACKING_LIMIT,
  STACKING_LIMIT_BRIDGEHEAD,
  STACKING_LIMIT_LONDON_BRITISH,
} from "../src/engine/tables";
import { MAX_OCEAN_AIR_STAGE_HEXES, NO_ATTRITION_OCCUPATION } from "../src/engine/terrain";

describe("reference-map charts", () => {
  it("interception", () => {
    expect(interceptionRolls(1)).toBe("automatic");
    expect(interceptionRolls(10)).toEqual([1, 2, 3, 4, 5]);
    expect(interceptionRolls(11)).toEqual([1, 2, 3, 4]);
    expect(interceptionRolls(31)).toEqual([1]);
  });
  it("naval DRMs", () => {
    expect(navalAdvantageDrm(9, 9)).toBe(0);
    expect(navalAdvantageDrm(11, 9)).toBe(0);
    expect(navalAdvantageDrm(12, 9)).toBe(1);
    expect(navalAdvantageDrm(15, 9)).toBe(2);
    expect(navalAdvantageDrm(18, 9)).toBe(3);
    expect(navalAdvantageDrm(36, 9)).toBe(5);
    expect(navalNationalityDrm("germany")).toBe(2);
    expect(navalNationalityDrm("italy")).toBe(-1);
    expect(navalNationalityDrm("italy", true)).toBe(-2);
    expect(navalNationalityDrm("ussr")).toBe(-2);
  });
  it("air DRMs", () => {
    expect(airAdvantageDrm(10, 7)).toBe(3);
    expect(airAdvantageDrm(7, 10)).toBe(0);
    expect(airNationalityDrm("germany")).toBe(0);
    expect(airNationalityDrm("france")).toBe(-1);
    expect(airNationalityDrm("other")).toBe(-2);
  });
  it("costs and minor forces", () => {
    expect(BUILD_COST_PER_FACTOR.armor).toBe(2);
    expect(MINOR_COUNTRY_FORCES.poland).toEqual({ inf1_3: 7, inf2_3: 3, arm2_5: 0, air1_4: 2, air2_4: 0, fleet2: 0 });
    expect(MINOR_COUNTRY_FORCES.spain.fleet2).toBe(4);
  });
});

// Values copied from the reference map card and Reference Manual (docs/RULES.md). They are not used
// by a rule yet; pinning them stops a later edit from changing one without anyone noticing.
describe("printed constants waiting for their rules", () => {
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

import { describe, expect, it } from "vitest";
import {
  airAdvantageDrm,
  airNationalityDrm,
  BUILD_COST_PER_FACTOR,
  interceptionRolls,
  MINOR_COUNTRY_FORCES,
  navalAdvantageDrm,
  navalNationalityDrm,
} from "../src/engine/tables";

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

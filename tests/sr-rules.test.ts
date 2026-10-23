import { describe, expect, it } from "vitest";
import { SR_ALLOWANCE, SR_BRPS_PER_REDEPLOYMENT, srAllowanceProblem, srGrantCost, srLeft, srNationOf, srUnitCost } from "../src/engine/sr-rules";
import type { MinorAlly } from "../src/engine/types";

const allies: MinorAlly[] = [{ owner: "rumania", of: "germany", active: true }, { owner: "finland", of: "germany", active: false }];
const state = { minorAllies: allies };

describe("Strategic Redeployment facts (Ref 11.72; spec 16 R18, R21)", () => {
  it("gives each Major Power its printed allowance, totalling 42 units", () => {
    expect(SR_ALLOWANCE).toEqual({ usa: 10, germany: 9, britain: 7, ussr: 6, italy: 5, france: 5 });
    expect(Object.values(SR_ALLOWANCE).reduce((sum, allowance) => sum + allowance, 0)).toBe(42);
  });

  it("counts each 20 BRPs or part of a grant as one redeployment (Ref 11.71)", () => {
    expect(SR_BRPS_PER_REDEPLOYMENT).toBe(20);
  });
});

describe("whose allowance a unit uses (spec 16 R18, AER26)", () => {
  it("a Major Power's counter uses its own allowance", () => {
    expect(srNationOf(state, { owner: "germany" })).toBe("germany");
    expect(srNationOf(state, { owner: "ussr" })).toBe("ussr");
  });

  it("the counter's nationality comes first: an Italian counter Germany holds counts for Italy (AER26)", () => {
    expect(srNationOf(state, { owner: "germany", nationality: "italy" })).toBe("italy");
  });

  it("Free French counters use Britain's allowance (AER26)", () => {
    expect(srNationOf(state, { owner: "free-france" })).toBe("britain");
  });

  it("a Minor-Ally's counter uses its Major Power's allowance (Ref 17.1)", () => {
    expect(srNationOf(state, { owner: "rumania" })).toBe("germany");
    expect(srNationOf(state, { owner: "hungary" })).toBeNull(); // not a Minor-Ally of anyone in this game
  });

  it("Polish and Vichy counters cannot be redeployed in Beta (AER26)", () => {
    expect(srNationOf(state, { owner: "poland" })).toBeNull();
    expect(srNationOf(state, { owner: "vichy-france" })).toBeNull();
  });
});

describe("the allowance and the cost (Ref 11.72, 11.71; spec 16 R18, R21)", () => {
  it("what is left is the allowance less what was used, never below 0", () => {
    expect(srLeft({}, "germany")).toBe(9);
    expect(srLeft({ germany: 4 }, "germany")).toBe(5);
    expect(srLeft({ germany: 12 }, "germany")).toBe(0);
  });

  it("one nation's use is not another's: Italy's five do not touch Germany's nine", () => {
    expect(srLeft({ italy: 5 }, "germany")).toBe(9);
    expect(srAllowanceProblem({ italy: 5 }, { germany: 9 })).toBeNull();
    expect(srAllowanceProblem({ italy: 5 }, { italy: 1 })).toMatch(/italy has 0 of 5/);
  });

  it("each unit costs one, whatever its size, charged to its own nation", () => {
    const cost = srUnitCost(state, [{ owner: "germany" }, { owner: "germany", nationality: "italy" }, { owner: "rumania" }, { owner: "poland" }]);
    expect(cost).toEqual({ germany: 2, italy: 1 });
  });

  it("the allowance is checked exactly: the ninth German unit fits, the tenth does not", () => {
    expect(srAllowanceProblem({ germany: 8 }, { germany: 1 })).toBeNull();
    expect(srAllowanceProblem({ germany: 9 }, { germany: 1 })).toMatch(/germany has 0 of 9/);
    expect(srAllowanceProblem({ germany: 7 }, { germany: 3 })).toMatch(/needs 3/);
  });

  it("a grant uses one redeployment per 20 BRPs or part (R21, AER30)", () => {
    expect([0, 1, 19, 20, 21, 40, 41].map(srGrantCost)).toEqual([0, 1, 1, 1, 2, 2, 3]);
    expect(srGrantCost(-5)).toBe(0);
    expect(srGrantCost(Number.NaN)).toBe(0);
  });
});

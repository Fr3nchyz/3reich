import { describe, expect, it } from "vitest";
import { SR_ALLOWANCE, SR_BRPS_PER_REDEPLOYMENT } from "../src/engine/sr-rules";

describe("Strategic Redeployment facts (Ref 11.72; spec 16 R18, R21)", () => {
  it("gives each Major Power its printed allowance, totalling 42 units", () => {
    expect(SR_ALLOWANCE).toEqual({ usa: 10, germany: 9, britain: 7, ussr: 6, italy: 5, france: 5 });
    expect(Object.values(SR_ALLOWANCE).reduce((sum, allowance) => sum + allowance, 0)).toBe(42);
  });

  it("counts each 20 BRPs or part of a grant as one redeployment (Ref 11.71)", () => {
    expect(SR_BRPS_PER_REDEPLOYMENT).toBe(20);
  });
});

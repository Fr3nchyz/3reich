import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction } from "../src/engine/actions";
import { BRP_COSTS } from "../src/engine/tables";
import { declarationTargets } from "../src/engine/war";
import { CTX, atStart } from "./helpers";

/** Spec 15 R11, TODO(verify) MC14: preserve the ordinary declaration assumption.
 * Q21 (Ref 24.0) specifies 25 for Lend-Lease, whose payment is not implemented. */
describe("Persia's ordinary declaration price (MC14)", () => {
  it("an ordinary declaration on Persia costs the minor-country price, 10 BRPs, for either side", () => {
    expect(BRP_COSTS.declareWarOnMinorCountry).toBe(10);
    for (const side of ["axis", "allies"] as const) {
      const s = { ...atStart(SCENARIO_1939, 1), activeSide: side };
      const by = side === "axis" ? "germany" : "britain";
      expect(declarationTargets(CTX, s, by)).toContain("persia");
      const r = applyAction(CTX, s, { type: "DECLARE_WAR", by, on: "persia" });
      if (!r.ok) throw new Error(r.error);
      expect(r.state.nations[by].spent - s.nations[by].spent).toBe(10);
      expect(r.events).toContainEqual(expect.objectContaining({ type: "WAR_DECLARED", on: "persia", cost: 10 }));
    }
  });
});

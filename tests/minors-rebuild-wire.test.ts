import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions } from "../src/engine/actions";
import { legalAllBuilds, legalMinorRebuilds } from "../src/engine/minors-rebuild-wire";
import { chooseBuild } from "../src/ai/build";
import type { GameState, MinorCountry, PowerId } from "../src/engine/types";
import { CTX, NO_AIRBASES_LEFT, atStart } from "./helpers";

/** Ticket 15-19b: the pure rebuild of 15-19a is offered and applied at step 8b (spec 15 R8/R9; Ref 17.1, 17.3). */
const ok = (r: ReturnType<typeof applyAction>) => { if (!r.ok) throw new Error(r.error); return r; };
const at8b = (): GameState => {
  const at3 = ok(applyAction(CTX, { ...atStart(SCENARIO_1939, 1), airbasesPlaced: NO_AIRBASES_LEFT }, { type: "END_STEP", side: "axis", step: "1" })).state;
  return ok(applyAction(CTX, at3, { type: "END_STEP", side: "axis", step: "3" })).state;
};
/** Step 8b with one returned counter in a minor's pool, controlled by `of`. */
function fixture(country: MinorCountry, of: PowerId, side: "axis" | "allies" = "axis", helpers: PowerId[] = [of]) {
  const base = at8b();
  const state: GameState = { ...base, activeSide: side, units: {},
    minorAllies: [{ owner: country, of, active: true }],
    countries: { [country]: { status: "allied", helpers } },
    pools: { ...base.pools, [country]: { forcePool: [], allowableBuilds: [{ type: "infantry", strength: 3, count: 1, returned: true, movement: 3 }] } } };
  return state;
}
const rebuilds = (s: GameState) => legalMinorRebuilds(CTX, s);

describe("15-19b: Minor-Ally rebuilds at step 8b", () => {
  it("offers a returned counter of an active German ally at its home hexes, paid by Germany", () => {
    const s = fixture("hungary", "germany");
    const list = rebuilds(s);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((a) => a.owner === "germany" && a.pool === "hungary" && a.unit.returned === true && CTX.map.hexes[a.at]?.country === "hungary")).toBe(true);
    expect(legalAllBuilds(CTX, s)).toEqual(expect.arrayContaining(list));
    expect(legalActions(CTX, s)).toEqual(expect.arrayContaining(list));
  });
  it("applies it: pays, places a Hungarian counter at home, uses the pool entry", () => {
    const s = fixture("hungary", "germany");
    const a = rebuilds(s)[0]!;
    const r = ok(applyAction(CTX, s, a));
    const u = r.state.units[`u${s.nextUnitId}`];
    expect(u).toMatchObject({ owner: "hungary", type: "infantry", strength: 3, at: a.at });
    expect(r.state.nations.germany.brpTotal).toBe(s.nations.germany.brpTotal - 3);
    expect(r.state.pools.hungary!.allowableBuilds).toEqual([]);
    expect(r.events.some((e) => e.type === "UNIT_BUILT" && e.owner === "germany" && e.pool === "hungary" && e.returned === true)).toBe(true);
    expect(rebuilds(r.state)).toEqual([]);
  });
  it("offers nothing for a sleeping ally, a conquered one, a non-returned entry or the other side", () => {
    const s = fixture("hungary", "germany");
    expect(rebuilds({ ...s, minorAllies: [{ owner: "hungary", of: "germany", active: false }] })).toEqual([]);
    expect(rebuilds({ ...s, conquests: [{ country: "hungary" } as never] })).toEqual([]);
    expect(rebuilds({ ...s, pools: { ...s.pools, hungary: { forcePool: [], allowableBuilds: [{ type: "infantry", strength: 3, count: 1 }] } } })).toEqual([]);
    expect(rebuilds({ ...s, activeSide: "allies" })).toEqual([]);
  });
  it("refuses when the controller cannot afford it or a hand-made action names the wrong payer", () => {
    const s = fixture("hungary", "germany");
    const a = rebuilds(s)[0]!;
    const broke = { ...s, nations: { ...s.nations, germany: { ...s.nations.germany, brpTotal: 0 } } };
    expect(rebuilds(broke)).toEqual([]);
    expect(applyAction(CTX, broke, a).ok).toBe(false);
    expect(applyAction(CTX, s, { ...a, owner: "italy" }).ok).toBe(false);
    const notReturned = { ...a, unit: { type: a.unit.type, strength: a.unit.strength } };
    expect(applyAction(CTX, s, notReturned).ok).toBe(false);
    expect(applyAction(CTX, s, { ...a, at: "0000" }).ok).toBe(false);
  });
  it("Spain and Turkey: only after Intervention, paid by the first helper, never fleets", () => {
    for (const country of ["spain", "turkey"] as const) {
      const s = fixture(country, "britain", "allies", ["britain", "france"]);
      const list = rebuilds(s);
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((a) => a.owner === "britain" && a.pool === country)).toBe(true);
      const r = ok(applyAction(CTX, s, list[0]!));
      expect(r.state.nations.britain.brpTotal).toBe(s.nations.britain.brpTotal - 3);
      expect(rebuilds({ ...s, countries: { [country]: { status: "allied", helpers: ["france", "britain"] } } })).toEqual([]);
      expect(rebuilds({ ...s, countries: { [country]: { status: "attacked" } } })).toEqual([]);
      const fleet = { ...s, pools: { ...s.pools, [country]: { forcePool: [], allowableBuilds: [{ type: "fleet" as const, strength: 3, count: 1, returned: true }] } } };
      expect(rebuilds(fleet)).toEqual([]);
    }
  });
  it("keeps step 8b open while only a rebuild is possible, and the computer does not pick it", () => {
    const s = fixture("hungary", "germany");
    const own = { ...s, pools: { ...s.pools, germany: { forcePool: [], allowableBuilds: [] } } };
    const legal = legalActions(CTX, own);
    expect(legal.some((a) => a.type === "BUILD" && a.pool === "hungary")).toBe(true);
    expect(chooseBuild(CTX, own, legal, { seed: 1 })).toBeUndefined();
    const mixed = chooseBuild(CTX, s, legalActions(CTX, s), { seed: 1 });
    expect(mixed === undefined || (mixed.action.type === "BUILD" && mixed.action.pool === undefined)).toBe(true);
  });
  it("does not skip step 8b when a rebuild is the only build", () => {
    const s = fixture("hungary", "germany");
    const own = { ...s, pools: { ...s.pools, germany: { forcePool: [], allowableBuilds: [] } } };
    const at8a = { ...own, position: { ...own.position!, step: "8a" } } as GameState;
    const r = ok(applyAction(CTX, at8a, { type: "END_STEP", side: "axis", step: "8a" }));
    expect(r.state.position).toMatchObject({ step: "8b" });
  });
  it("is deterministic and leaves the input state alone", () => {
    const s = fixture("rumania", "germany");
    const before = structuredClone(s);
    const a = rebuilds(s)[0]!;
    expect(applyAction(CTX, s, a)).toEqual(applyAction(CTX, s, a));
    expect(s).toEqual(before);
  });
});

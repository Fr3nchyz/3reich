import { describe, expect, it } from "vitest";
import { legalActions } from "../src/engine/actions";
import { eliminateUnits } from "../src/engine/losses";
import { siberianPool } from "../src/engine/siberian";
import { evaluateVictory, siberianInForce, victoryTarget } from "../src/engine/victory";
import type { ForceEntry, GameState } from "../src/engine/types";
import { counter } from "./board";
import { CTX } from "./helpers";
import { apply, at8a, MOSCOW, refusal, transfer, withPool } from "./helpers-siberian";

// Spec 17 ticket 17-5 (R6; TODO(verify) RB12): the Free Siberian Transfer takes a returned Russian infantry or armor entry like any other,
// and the first one taken switches the victory tables for good, as spec 14 R2 says.

const back = (type: "infantry" | "armor", strength: number, count = 1): ForceEntry => ({ type, strength, movement: 3, count, returned: true });
const only = (...entries: ForceEntry[]): GameState => withPool(at8a(), entries);
const takes = (s: GameState) => legalActions(CTX, s).filter((a) => a.type === "SIBERIAN_TRANSFER");

describe("RB12: a returned Russian entry is in the Transfer's pool", () => {
  it("a Russian unit destroyed in play comes back to the pool and is offered at step 8a", () => {
    const s0 = withPool(at8a([counter("r1", "ussr", "infantry", 4, "J40", 3)]), []);
    const lost = eliminateUnits(s0, ["r1"]).state;
    expect(siberianPool(lost)).toEqual([back("infantry", 4)]);
    expect(takes(lost).some((a) => a.type === "SIBERIAN_TRANSFER" && a.unit.type === "infantry" && a.unit.strength === 4 && a.at === MOSCOW)).toBe(true);
  });

  it("the returned entry has no date: it is offered although a scenario entry of its kind would wait for 1942", () => {
    const s = only(back("infantry", 5));
    expect(siberianPool(s)).toHaveLength(1);
    expect(refusal(s, transfer("infantry", 5, MOSCOW))).toBeUndefined();
  });

  it("an armor entry that came back is taken once as much infantry has been (the armor rule is unchanged)", () => {
    const s = only(back("infantry", 3), back("armor", 4));
    expect(refusal(s, transfer("armor", 4, MOSCOW))).toMatch(/take infantry first/);
    const t = apply(s, transfer("infantry", 3, MOSCOW)).state;
    expect(refusal(t, transfer("armor", 4, MOSCOW))).toBeUndefined();
    const u = apply(t, transfer("armor", 4, MOSCOW)).state;
    expect(siberianPool(u)).toEqual([]);
    expect(Object.values(u.units).filter((x) => x.owner === "ussr" && x.type === "armor")).toHaveLength(1);
  });

  it("a returned entry is used up like any other: one taken, the count goes down, and the last one leaves the list", () => {
    const s = only(back("infantry", 3, 2));
    const t = apply(s, transfer("infantry", 3, MOSCOW)).state;
    expect(t.pools.ussr!.allowableBuilds).toEqual([back("infantry", 3, 1)]);
    const u = apply(t, transfer("infantry", 3, "E54")).state;
    expect(u.pools.ussr!.allowableBuilds).toEqual([]);
  });

  it("with a scenario counter and a returned one of the same kind, the scenario's (first) entry is taken", () => {
    const fresh: ForceEntry = { type: "infantry", strength: 3, movement: 3, count: 1 };
    const t = apply(only(fresh, back("infantry", 3)), transfer("infantry", 3, MOSCOW)).state;
    expect(t.pools.ussr!.allowableBuilds).toEqual([back("infantry", 3)]);
  });
});

describe("the first returned unit taken switches the victory tables (spec 14 R2)", () => {
  it("no unit taken yet: the tables are not switched; taking one returned unit switches them, and the event says it is the first use", () => {
    const s = only(back("infantry", 3, 2));
    expect(siberianInForce(s)).toBe(false);
    const r = apply(s, transfer("infantry", 3, MOSCOW));
    expect(r.events).toEqual([expect.objectContaining({ type: "SIBERIAN_TRANSFER_USED", unitType: "infantry", strength: 3, at: MOSCOW, firstUse: true })]);
    expect(siberianInForce(r.state)).toBe(true);
    expect(r.state.siberian!.used).toBe(true);
    const r2 = apply(r.state, transfer("infantry", 3, "E54"));
    expect(r2.events).toEqual([expect.objectContaining({ firstUse: false })]);
  });

  it("the verdict is read from the Transfer tables once a returned unit was taken", () => {
    const s = only(back("infantry", 3));
    const t = apply(s, transfer("infantry", 3, MOSCOW)).state;
    expect(evaluateVictory(CTX, t, "end-of-play")).toMatchObject({ siberian: true });
    expect(evaluateVictory(CTX, s, "end-of-play")).toMatchObject({ siberian: false });
    expect(victoryTarget(CTX, t).table!.allies.marginal).toBe(victoryTarget(CTX, s).table!.allies.marginal + 1);
  });

  it("taking nothing leaves the tables as they were, even with returned units in the pool", () => {
    const s = only(back("infantry", 3));
    expect(siberianInForce(apply(s, { type: "END_STEP", side: "allies", step: "8a" }).state)).toBe(false);
  });
});

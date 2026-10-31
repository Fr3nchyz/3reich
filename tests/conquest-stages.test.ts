import { describe, expect, it } from "vitest";
import type { GameEvent } from "../src/engine/action-types";
import { conquer, type FallPlan, type FallStep } from "../src/engine/conquest-stages";
import { isConquered } from "../src/engine/conquest-record";
import { controllerOf } from "../src/engine/control";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Spec 14 C8: the stages every fall shares, in order: before, units and pools, land, record, events, loners, after.

const WARSAW = "M35";
const SECOND = { year: 1939, season: "fall" } as const;
const polish = (id: string, at: string) => counter(id, "poland", "infantry", 2, at, 3);
const german = (id: string, at: string) => counter(id, "germany", "infantry", 3, at, 3);
const plan = (over: Partial<FallPlan> = {}): FallPlan => ({
  country: "poland",
  who: "poland",
  owners: ["poland"],
  conqueror: "germany",
  side: "allies",
  how: "capital",
  isHome: (hex, owner) => owner === "poland" && hex.country === "poland",
  mark: (s) => s,
  ...over,
});
const start = () => board([german("g1", WARSAW), polish("p1", "M34"), counter("b1", "britain", "infantry", 3, "L32", 3)], undefined, { ...SECOND, control: { [WARSAW]: "germany" } });
const types = (events: GameEvent[]) => events.map((e) => e.type);

describe("conquer (C8)", () => {
  it("runs before first, then the stages, then after; the events concatenate in that order", () => {
    const order: string[] = [];
    const step = (name: string, event: GameEvent): FallStep => (_ctx, state) => {
      order.push(`${name}:${Object.keys(state.units).join(",")}:${isConquered(state, "poland")}`);
      return { state, events: [event] };
    };
    const before = step("before", { type: "REPORT", text: "before" } as unknown as GameEvent);
    const after = step("after", { type: "REPORT", text: "after" } as unknown as GameEvent);
    const r = conquer(CTX, start(), plan({ before, after }));
    // before sees the units still on the map and no record; after sees them gone and the record written
    expect(order).toEqual(["before:g1,p1,b1:false", "after:g1,b1:true"]);
    const t = types(r.events);
    expect(t[0]).toBe("REPORT");
    expect(t[1]).toBe("COUNTRY_CONQUERED");
    expect(t.at(-1)).toBe("REPORT");
    expect(t.indexOf("UNITS_REMOVED_BY_CONQUEST")).toBeGreaterThan(1);
    expect(t.indexOf("CONTROL_PASSED")).toBeGreaterThan(t.indexOf("UNITS_REMOVED_BY_CONQUEST"));
  });
  it("without steps: the country's units leave, others stay, its land passes, the record is written once", () => {
    const r = conquer(CTX, start(), plan({ startingBrps: 7 }));
    expect(Object.keys(r.state.units).sort()).toEqual(["b1", "g1"]);
    expect(controllerOf(CTX, r.state, "M34")).toBe("germany");
    expect(r.state.conquests).toEqual([{ country: "poland", by: "germany", side: "allies", how: "capital", at: SECOND, startingBrps: 7 }]);
    expect(types(r.events).filter((x) => x === "COUNTRY_CONQUERED")).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ type: "COUNTRY_CONQUERED", country: "poland", unitsRemoved: 1 });
  });
  it("stays: the land does not change hands, no CONTROL_PASSED", () => {
    const r = conquer(CTX, start(), plan({ stays: true }));
    expect(types(r.events)).not.toContain("CONTROL_PASSED");
    expect(controllerOf(CTX, r.state, "M34")).toBe("poland");
    expect(isConquered(r.state, "poland")).toBe(true);
  });
  it("a hex under a hostile ground unit is kept by the fall", () => {
    const s = board([german("g1", WARSAW), counter("b1", "britain", "infantry", 3, "M34", 3)], undefined, { ...SECOND, control: { [WARSAW]: "germany" } });
    const r = conquer(CTX, s, plan());
    expect(controllerOf(CTX, r.state, "M34")).not.toBe("germany");
  });
  it("a counter of the country's nationality held by another owner leaves with it", () => {
    const lent = { ...counter("l1", "britain", "infantry", 2, "L32", 3), nationality: "poland" } as never;
    const s = board([german("g1", WARSAW), lent], undefined, { ...SECOND, control: { [WARSAW]: "germany" } });
    expect(conquer(CTX, s, plan({ who: "poland" })).state.units.l1).toBeUndefined();
  });
  it("a lent counter of a Major Power still in the war goes back to it, as its own", () => {
    const lent = { ...counter("l1", "germany", "infantry", 2, "L32", 3), nationality: "britain" } as never;
    const s = board([german("g1", WARSAW), lent], undefined, { ...SECOND, control: { [WARSAW]: "germany" } });
    const r = conquer(CTX, s, plan({ who: "poland", owners: ["poland", "germany"] }));
    expect(r.state.units.l1).toMatchObject({ owner: "britain" });
    expect(r.state.units.l1).not.toHaveProperty("nationality");
  });
  it("pools of the owners go; the input state is not mutated and the result is a new object", () => {
    const pools = { poland: { pool: [], builds: [] }, britain: { pool: [], builds: [] } } as never;
    const s = { ...start(), pools };
    const before = structuredClone(s);
    const r = conquer(CTX, s, plan());
    expect(s).toEqual(before);
    expect(r.state).not.toBe(s);
    expect(Object.keys(r.state.pools)).toEqual(["britain"]);
  });
  it("a country already recorded falls again: pinned, a second record is added (the caller guards it)", () => {
    const once = conquer(CTX, start(), plan());
    const twice = conquer(CTX, once.state, plan());
    expect(twice.state.conquests).toHaveLength(2);
  });
});

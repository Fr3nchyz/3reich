import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { hostileGroundHexes, passControl, removePools, removeUnits, sweepPassed, TRAPPED_UNITS_KEEP_ONLY_THEIR_HEX, type PassRule } from "../src/engine/conquest-forces";
import { controllerOf } from "../src/engine/control";
import type { ForceOwner, GameState } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Spec 14 C8 steps 1, 2 and 6 (TODO(verify) V10, V11, V12): the units and pools that leave, the land that changes hands, the loners left behind.

const WARSAW = "M35";
const polish = (id: string, at: string) => counter(id, "poland", "infantry", 2, at, 3);
const german = (id: string, at: string) => counter(id, "germany", "infantry", 3, at, 3);
const rule = (over: Partial<PassRule> = {}): PassRule => ({ from: ["poland"], to: "germany", isHome: () => true, keep: new Set(), ...over });
const polishHexes = Object.values(MAP.hexes).filter((h) => h.land && h.country === "poland").map((h) => h.id);

describe("removeUnits (C8 step 1)", () => {
  const s = board([polish("p2", "M34"), polish("p1", WARSAW), german("g1", "M36")]);
  it("removes exactly the named ids and lists them in the order given", () => {
    const r = removeUnits(s, ["p1", "p2"]);
    expect(Object.keys(r.state.units)).toEqual(["g1"]);
    expect(r.removed).toEqual([
      { id: "p1", owner: "poland", type: "infantry", strength: 2 },
      { id: "p2", owner: "poland", type: "infantry", strength: 2 },
    ]);
  });
  it("ignores unknown ids and leaves everything else as it was", () => {
    const r = removeUnits(s, ["nope", "p2"]);
    expect(r.removed.map((u) => u.id)).toEqual(["p2"]);
    expect(r.state.units.p1).toEqual(s.units.p1);
    expect(r.state.units.g1).toEqual(s.units.g1);
    expect({ ...r.state, units: {} }).toEqual({ ...s, units: {} });
  });
  it("an empty list removes nothing", () => {
    const r = removeUnits(s, []);
    expect(r.removed).toEqual([]);
    expect(r.state.units).toEqual(s.units);
  });
  it("does not touch the input state", () => {
    const before = structuredClone(s);
    removeUnits(s, ["p1"]);
    expect(s).toEqual(before);
  });
});

describe("removePools (C8 step 1, V10)", () => {
  const pools = { poland: { pool: [], builds: [] }, germany: { pool: [], builds: [] }, italy: { pool: [], builds: [] } } as unknown as GameState["pools"];
  const s = { ...board([]), pools };
  it("empties only the named owners' pools", () => {
    const r = removePools(s, ["poland", "italy"]);
    expect(Object.keys(r.pools)).toEqual(["germany"]);
    expect(r.pools.germany).toBe(s.pools.germany);
  });
  it("names nobody, changes nothing; the input is untouched", () => {
    const before = structuredClone(s);
    expect(removePools(s, []).pools).toEqual(s.pools);
    removePools(s, ["poland"]);
    expect(s).toEqual(before);
  });
});

describe("hostileGroundHexes (V12)", () => {
  it("the switch is on", () => expect(TRAPPED_UNITS_KEEP_ONLY_THEIR_HEX).toBe(true));
  it("lists the hexes of ground units of the other side in the war, not air, ships or its own side", () => {
    const s = board([
      german("g1", "M36"),
      counter("g2", "germany", "air", 3, "M37", 3),
      counter("g3", "germany", "armor", 3, "M38", 3),
      polish("p1", "M34"),
      counter("b1", "britain", "air", 3, "M40", 3),
      counter("b2", "britain", "fleet", 3, "M41", 3),
    ]);
    expect([...hostileGroundHexes(s, "allies")].sort()).toEqual(["M36", "M38"]);
    expect([...hostileGroundHexes(s, "axis")]).toEqual(["M34"]);
  });
  it("a unit of an owner that takes no side does not count", () => {
    const s = board([counter("v1", "vichy-france", "infantry", 3, "M36", 3)]);
    expect(hostileGroundHexes(s, "axis").size).toBe(0);
  });
});

describe("passControl (C8 step 2, V11, V12)", () => {
  const start = board([]);
  it("the land held by the country passes to the conqueror, in hex-id order", () => {
    const r = passControl(CTX, start, rule());
    expect(r.passed.toNobody).toEqual([]);
    expect(r.passed.toConqueror).toEqual([...r.passed.toConqueror].sort());
    expect(r.passed.toConqueror).toContain(WARSAW);
    for (const h of r.passed.toConqueror) expect(controllerOf(CTX, r.state, h)).toBe("germany");
  });
  it("isHome false: the hexes become nobody's", () => {
    const r = passControl(CTX, start, rule({ isHome: () => false }));
    expect(r.passed.toConqueror).toEqual([]);
    expect(r.passed.toNobody).toContain(WARSAW);
    expect(r.state.control[WARSAW]).toBeNull();
  });
  it("a kept hex is left as it was and is not reported", () => {
    const r = passControl(CTX, start, rule({ keep: new Set([WARSAW]) }));
    expect(r.passed.toConqueror).not.toContain(WARSAW);
    expect(controllerOf(CTX, r.state, WARSAW)).toBe("poland");
  });
  it("hexes held by other owners are untouched", () => {
    const s = { ...start, control: { H47: "britain" as ForceOwner } };
    const r = passControl(CTX, s, rule());
    expect(r.state.control.H47).toBe("britain");
    expect(r.passed.toConqueror).not.toContain("H47");
  });
  it("an empty rule changes nothing", () => {
    const r = passControl(CTX, start, rule({ from: [] }));
    expect(r.state).toEqual(start);
    expect(r.passed).toEqual({ toConqueror: [], toNobody: [] });
  });
  it("land: hexes nobody holds pass to the conqueror; hexes already on the conqueror's side do not change", () => {
    const land = new Set(polishHexes.slice(0, 3));
    const [a, b, c] = [...land];
    const s = { ...start, control: { [a!]: null, [b!]: "germany" as ForceOwner } };
    const r = passControl(CTX, s, rule({ from: [], land }));
    expect(r.passed.toConqueror).toContain(a);
    expect(r.passed.toConqueror).toContain(c);
    expect(r.passed.toConqueror).not.toContain(b);
    expect(r.state.control[a!]).toBe("germany");
  });
  it("land: a kept hex nobody holds is recorded as nobody's, and not reported", () => {
    const hex = polishHexes.find((h) => controllerOf(CTX, start, h) === null);
    if (hex === undefined) return;
    const r = passControl(CTX, start, rule({ from: [], land: new Set([hex]), keep: new Set([hex]) }));
    expect(r.state.control[hex]).toBeNull();
    expect(r.passed.toConqueror).toEqual([]);
  });
  it("land: a hex that is not on the map land is ignored; the input is not mutated", () => {
    const before = structuredClone(start);
    const r = passControl(CTX, start, rule({ from: [], land: new Set(["ZZ99"]) }));
    expect(r.passed.toConqueror).toEqual([]);
    expect(start).toEqual(before);
  });
});

describe("sweepPassed (C8 step 6)", () => {
  it("nothing to sweep: no events and the same state", () => {
    const s = board([german("g1", WARSAW)]);
    expect(sweepPassed(CTX, s, [], "axis")).toEqual({ state: s, events: [] });
    expect(sweepPassed(CTX, s, [WARSAW], "axis")).toEqual({ state: s, events: [] });
  });
  it("an enemy counter that cannot be moved away is destroyed: UNITS_SWEPT lists it and it leaves the map", () => {
    const s = board([counter("b1", "britain", "replacement", 1, WARSAW)]);
    const r = sweepPassed(CTX, s, [WARSAW], "axis");
    const e = r.events.find((x) => x.type === "UNITS_SWEPT");
    expect(e).toMatchObject({ type: "UNITS_SWEPT", hex: WARSAW });
    if (e?.type === "UNITS_SWEPT") expect(e.units.map((u) => u.id)).toEqual(["b1"]);
    expect(r.state.units.b1).toBeUndefined();
  });
  it("an enemy air unit alone in a passed hex does not stay there", () => {
    const s = board([counter("b1", "britain", "air", 3, WARSAW, 3)]);
    const r = sweepPassed(CTX, s, [WARSAW], "axis");
    expect(r.state.units.b1?.at).not.toBe(WARSAW);
    expect(r.events.length).toBeGreaterThan(0);
  });
  it("a unit of the conqueror's own side is left alone", () => {
    const s = board([counter("g9", "germany", "replacement", 1, WARSAW)]);
    expect(sweepPassed(CTX, s, [WARSAW], "axis").state.units.g9).toBeDefined();
  });
});

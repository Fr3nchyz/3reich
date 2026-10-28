import { describe, expect, it } from "vitest";
import { neighborIds } from "../src/engine/attack-rules";
import { applyAction } from "../src/engine/actions";
import { navalOf, markGray, markUsed, type SeaSupplyDesignation } from "../src/engine/naval-record";
import { freeCapacity, supplyChainLink } from "../src/engine/naval-supply";
import { seaSupplyOptions, seaSupplyProblem } from "../src/engine/naval-supply-options";
import { supplyStatus } from "../src/engine/supply";
import type { GameState, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Ref 19.31, 21.1, 26.0, 27.0; spec 12 R3/R5/R7. Real-map ports; hostile land isolates the destination and transfer port.
const fleet = (id: string, at: string, strength = 9, owner: Unit["owner"] = "britain") => counter(id, owner, "fleet", strength, at);
const infantry = (id: string, at: string) => counter(id, "britain", "infantry", 2, at, 3);
const designation = (from: string, to: string, units = ["b1"]): SeaSupplyDesignation => ({ fleets: ["f1", "f2"], from, to, units });
function position(from = "K24", link = "AA7", to = "AA19", extra: Unit[] = [], strength = 9): GameState {
  const control: GameState["control"] = Object.fromEntries(Object.values(CTX.map.hexes).filter((h) => h.land).map((h) => [h.id, "germany" as const]));
  // The source fleet has an ordinary British land line. Its link and receiving port have no such line.
  for (const at of ["K23", from, link, to]) control[at] = "britain";
  return board([fleet("f1", from, strength), fleet("f2", link, strength), infantry("b1", to), ...extra], undefined,
    { activeSide: "allies", position: { part: "player-turn", turn: 2, step: "6e" }, control });
}
const problem = (s: GameState, d: SeaSupplyDesignation) => seaSupplyProblem(CTX, s, "allies", d);
const record = (s: GameState, d: SeaSupplyDesignation) => ({ ...s, naval: { ...navalOf(s), supply: [d] } });

describe("sea supply through two-Front ports (spec 12 R7; Ref 19.31)", () => {
  it("London's land-connected fleet and Gibraltar's fleet save Cagliari; either alone cannot", () => {
    const s = position(), d = designation("K24", "AA19");
    expect(supplyStatus(CTX, s, "allies").unsupplied).toEqual(["b1"]);
    expect(problem(s, { ...d, fleets: ["f1"] })).toMatch(/second fleet.*Gibraltar/);
    expect(problem(s, { ...d, fleets: ["f2"], from: "AA7" })).toMatch(/no land supply line/);
    expect(problem(s, d)).toBeNull();
    expect(supplyStatus(CTX, record(s, d), "allies").unsupplied).toEqual([]);
    expect(supplyChainLink(CTX, s, d)).toBe("AA7");
  });

  it.each([
    ["K24", "J30", "D44"], ["D44", "J30", "K24"],
    ["U22", "Z33", "V38"], ["V38", "Z33", "U22"], ["U22", "AA7", "K24"],
  ])("serves %s through %s to %s in either direction", (from, link, to) => {
    const s = position(from, link, to);
    // A British-controlled capital joined to this source makes its fleet supplied, independently of the remote link.
    const control = { ...s.control };
    for (const h of Object.values(CTX.map.hexes)) if (h.land) control[h.id] = "britain";
    for (const blocked of [link, to]) {
      for (const h of neighborIds(CTX, blocked)) if (h !== from) control[h] = "germany";
      control[blocked] = "britain";
    }
    const state = { ...s, control };
    expect(problem(state, designation(from, to))).toBeNull();
    expect(supplyChainLink(CTX, state, designation(from, to))).toBe(link);
    expect(supplyStatus(CTX, record(state, designation(from, to)), "allies").unsupplied).toEqual([]);
  });

  it("allows the second fleet on the outgoing Front away from the transfer port", () => {
    const s = position(), d = designation("K24", "AA19");
    const moved = { ...s, control: { ...s.control, GG19: "britain" as const }, units: { ...s.units, f2: fleet("f2", "GG19") } };
    expect(problem(moved, d)).toBeNull();
  });

  it("a supplied fleet in a two-Front port already serves both Fronts without a chain (R3)", () => {
    const s = position("J30", "AA7", "D44");
    const control = { ...s.control };
    for (const h of Object.values(CTX.map.hexes)) if (h.land && h.country === "germany") control[h.id] = "britain";
    const d = { ...designation("J30", "D44"), fleets: ["f1"] };
    expect(problem({ ...s, control }, d)).toBeNull();
  });

  it("requires a friendly named link, two fleets, and the outgoing Front", () => {
    const s = position(), d = designation("K24", "AA19");
    expect(problem({ ...s, control: { ...s.control, AA7: "germany" } }, d)).toMatch(/two-Front port/);
    expect(problem({ ...s, units: { ...s.units, f2: fleet("f2", "C33") } }, d)).toMatch(/two-Front port/);
    expect(problem({ ...s, units: { ...s.units, f3: fleet("f3", "GG19") } }, { ...d, fleets: ["f1", "f2", "f3"] })).toMatch(/two fleets/);
    expect(problem(s, { ...d, fleets: ["f2", "f1"] })).toMatch(/not at/);
  });

  it("does not treat Baltic and Black Sea ports as one water body (R3; N5)", () => {
    const s = position("D44", "J30", "V38");
    expect(problem(s, { ...designation("D44", "V38"), fleets: ["f1"] })).toMatch(/two fleets|second fleet/);
    expect(problem(s, designation("D44", "V38"))).toMatch(/two-Front port/);
    expect(problem(position("K32", "J30", "V38"), { ...designation("K32", "V38"), fleets: ["f1"] })).toMatch(/second fleet/);
    const wrong = position("K24", "J30", "V38");
    expect(problem(wrong, designation("K24", "V38"))).toMatch(/two-Front port/);
  });

  it("charges every supplied counter to BOTH legs, including earlier designations", () => {
    const s = position("K24", "AA7", "AA19", [infantry("b2", "AA19"), infantry("b3", "AA19")], 2);
    const d = designation("K24", "AA19", ["b1", "b2"]);
    expect(problem(s, d)).toBeNull();
    const room = freeCapacity(s, [d]);
    expect(room("f1")).toBe(0); expect(room("f2")).toBe(0);
    expect(problem(record(s, d), designation("K24", "AA19", ["b3"]))).toMatch(/only 0 more/);
    const unequal = { ...s, units: { ...s.units, f2: fleet("f2", "AA7", 1) } };
    expect(problem(unequal, d)).toMatch(/only 1 more/);
  });

  it("refuses used links and mixed Soviet/Western groups, allows British/French supply", () => {
    const s = position(), d = designation("K24", "AA19");
    expect(problem(markUsed(s, ["f2"], "mission"), d)).toMatch(/already been used/);
    expect(problem(markUsed(s, ["f2"], "new"), d)).toMatch(/built this Game Turn/);
    const allied = { ...s, nations: { ...s.nations, ussr: { ...s.nations.ussr, status: "allied" as const } } };
    expect(problem({ ...allied, units: { ...s.units, f2: fleet("f2", "AA7", 9, "ussr") } }, d)).toMatch(/same group/);
    expect(problem({ ...s, units: { ...s.units, f2: fleet("f2", "AA7", 9, "france") } }, d)).toBeNull();
  });

  it("rejects a gray fleet on either chain leg (spec 17 R5, RB7)", () => {
    const s = position(), d = designation("K24", "AA19");
    for (const id of ["f1", "f2"]) {
      const gray = markGray(s, id);
      expect(problem(gray, d)).toMatch(/gray/i);
      expect(seaSupplyOptions(CTX, gray, "allies").some((o) => o.fleets.includes(id))).toBe(false);
    }
  });

  it("the existing action records and marks both fleets used; no new action or record shape", () => {
    const s = position(), d = designation("K24", "AA19");
    const result = applyAction({ ...CTX, supplyEffects: true }, s, { type: "DESIGNATE_SEA_SUPPLY", side: "allies", fleets: d.fleets, to: d.to, units: d.units });
    expect(result.ok, !result.ok ? result.error : "").toBe(true);
    if (!result.ok) return;
    expect(navalOf(result.state).used).toMatchObject({ f1: "supply", f2: "supply" });
    expect(supplyStatus(CTX, result.state, "allies").unsupplied).toEqual([]);
  });

  it("orders multiple chains by origin and fleet ids, independently of insertion order", () => {
    const s = position("K24", "AA7", "AA19", [fleet("f0", "K21"), fleet("f3", "GG19")]);
    const state = { ...s, control: { ...s.control, K21: "britain" as const, K22: "britain" as const, GG19: "britain" as const } };
    const options = seaSupplyOptions(CTX, state, "allies");
    expect(options.map((o) => [o.from, o.fleets])).toEqual([
      ["K21", ["f0", "f2"]], ["K21", ["f0", "f3"]], ["K24", ["f1", "f2"]], ["K24", ["f1", "f3"]],
    ]);
    expect(seaSupplyOptions(CTX, { ...state, units: Object.fromEntries(Object.entries(state.units).reverse()) }, "allies")).toEqual(options);
  });

  it("proposes valid chains after all singles, deterministic under reversed unit insertion", () => {
    const s = position("K24", "AA7", "AA19", [infantry("b2", "C33")]);
    const control = { ...s.control, C33: "britain" as const };
    const state = { ...s, control };
    const options = seaSupplyOptions(CTX, state, "allies");
    expect(options.map((o) => [o.to, o.fleets])).toEqual([["C33", ["f1"]], ["AA19", ["f1", "f2"]]]);
    for (const o of options) expect(problem(state, o)).toBeNull();
    expect(seaSupplyOptions(CTX, { ...state, units: Object.fromEntries(Object.entries(state.units).reverse()) }, "allies")).toEqual(options);
    expect(seaSupplyOptions(CTX, markUsed(state, ["f2"], "intercept"), "allies").some((o) => o.to === "AA19")).toBe(false);
  });
});


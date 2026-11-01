import { describe, expect, it } from "vitest";
import { dutyFeasible, MINOR_PLANS, plannedReserve } from "../src/ai/minors";
import { newGame } from "../src/engine/game";
import { hex, hexsideId } from "../src/engine/hex";
import type { GameContext } from "../src/engine/context";
import type { GameState, Unit } from "../src/engine/types";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { CTX } from "./helpers";

const state = (): GameState => ({ ...newGame(SCENARIO_1939, 1), units: {} });
const unit = (overrides: Partial<Unit> = {}): Unit => ({ id: "u1", owner: "germany", type: "infantry", strength: 3, movement: 2, at: "A1", ...overrides });
function context(blocked = false): GameContext {
  const ids = ["A1", "A2", "A3", "A4"];
  return { ...CTX, map: { ...CTX.map,
    hexes: Object.fromEntries(ids.map((id, i) => [id, { id, land: "plain" as const, sea: false, features: [], front: "western" as const, country: i === 3 ? "denmark" : "germany" }])),
    hexsides: Object.fromEntries(ids.slice(1).map((id, i) => {
      const key = hexsideId(hex(ids[i]!), hex(id));
      return [key, { id: key, land: !blocked, sea: blocked }];
    })),
  } };
}
const withUnit = (overrides: Partial<Unit> = {}): GameState => ({ ...state(), units: { u1: unit(overrides) } });

describe("spec 15 Part E / R2, R4 minor policy (unwired)", () => {
  it("R4 / MC30 pins Germany's exact targets, priority and spring dates", () => {
    expect(MINOR_PLANS).toEqual(["denmark", "norway", "netherlands", "belgium", "luxembourg", "yugoslavia", "greece"].map((on, i) => ({ by: "germany", on, from: { year: i < 5 ? 1940 : 1941, season: "spring" } })));
  });
  it("R4 / MC31 reaches neutral land in one move without changing records", () => {
    const s = withUnit({ movement: 3 });
    const before = structuredClone(s);
    expect(dutyFeasible(context(), s, "germany", "denmark")).toBe(true);
    expect(s).toEqual(before);
    expect(dutyFeasible(context(), withUnit(), "germany", "denmark")).toBe(false);
  });
  it("R4 / MC31 accepts crossable adjacency even when an enemy blocks entry", () => {
    const s = withUnit({ at: "A3", movement: 1 });
    s.units.enemy = unit({ id: "enemy", owner: "denmark", at: "A4" });
    expect(dutyFeasible(context(), s, "germany", "denmark")).toBe(true);
    expect(dutyFeasible(context(true), s, "germany", "denmark")).toBe(false);
  });
  it.each(["italy", "finland"] as const)("R4 / MC3 rejects %s units", (owner) => {
    expect(dutyFeasible(context(), withUnit({ owner, at: "A3" }), "germany", "denmark")).toBe(false);
  });
  it.each(["air", "fleet", "replacement"] as const)("R4 / MC31 rejects %s counters", (type) => {
    expect(dutyFeasible(context(), withUnit({ type, at: "A3" }), "germany", "denmark")).toBe(false);
  });
  it("R4 / MC31 rejects off-map, immobile, absent and neutral declarers", () => {
    for (const overrides of [{ at: "us-box" }, { movement: 0 }] as Partial<Unit>[]) expect(dutyFeasible(context(), withUnit(overrides), "germany", "denmark")).toBe(false);
    expect(dutyFeasible(context(), state(), "germany", "denmark")).toBe(false);
    expect(dutyFeasible(context(), withUnit({ owner: "italy", at: "A3" }), "italy", "denmark")).toBe(false);
  });
  it("R2 / MC32 reserves every future minor plan without cash, date or reach gates", () => {
    const s = state();
    s.nations.germany.brpTotal = 0;
    s.nations.germany.spent = s.nations.germany.spendLimit;
    expect(plannedReserve(CTX, s, "germany")).toBe(70);
    expect(plannedReserve(CTX, s, "italy")).toBe(0);
    expect(plannedReserve(CTX, s, "france")).toBe(0);
  });
  it("R2 / MC32 excludes wars, fighting records and closed targets", () => {
    const s = state();
    s.wars = [...s.wars, ["germany", "denmark"]];
    s.countries = { norway: { status: "attacked", attacker: "italy" }, belgium: { status: "neutral", closedTo: ["germany"] } };
    expect(plannedReserve(CTX, s, "germany")).toBe(40);
  });
  it("R2 / MC32 honors scenario bans and individual full-limit affordability", () => {
    const s = state();
    s.nations.germany.spendLimit = 9;
    expect(plannedReserve(CTX, s, "germany")).toBe(0);
    s.nations.germany.spendLimit = 10;
    expect(plannedReserve(CTX, s, "germany")).toBe(70);
    const ctx = { ...CTX, scenario: { ...CTX.scenario, rules: [...CTX.scenario.rules, { kind: "no-war-on-neutrals" as const }] } };
    expect(plannedReserve(ctx, s, "germany")).toBe(0);
  });
});

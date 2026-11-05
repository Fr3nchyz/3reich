import { describe, expect, it } from "vitest";
import { chooseDeclaration, plannedReserve as declareReserve } from "../src/ai/declare";
import { dutyFeasible, MINOR_PLANS, plannedReserve } from "../src/ai/minors";
import type { Action } from "../src/engine/actions";
import { BRP_COSTS } from "../src/engine/tables";
import { newGame } from "../src/engine/game";
import { hex, hexsideId } from "../src/engine/hex";
import type { GameContext } from "../src/engine/context";
import type { GameState, Unit } from "../src/engine/types";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { CTX } from "./helpers";

const state = (): GameState => ({ ...newGame(SCENARIO_1939, 1), units: {} });
const unit = (overrides: Partial<Unit> = {}): Unit => ({ id: "u1", owner: "germany", type: "infantry", strength: 3, movement: 2, at: "A1", ...overrides });
function context(blocked = false, target = "denmark"): GameContext {
  const ids = ["A1", "A2", "A3", "A4"];
  return { ...CTX, map: { ...CTX.map,
    hexes: Object.fromEntries(ids.map((id, i) => [id, { id, land: "plain" as const, sea: false, features: [], front: "western" as const, country: i === 3 ? target : "germany" }])),
    hexsides: Object.fromEntries(ids.slice(1).map((id, i) => {
      const key = hexsideId(hex(ids[i]!), hex(id));
      return [key, { id: key, land: !blocked, sea: blocked }];
    })),
  } };
}
const withUnit = (overrides: Partial<Unit> = {}): GameState => ({ ...state(), units: { u1: unit(overrides) } });

describe("spec 15 Part E / R2, R4 minor policy (pure functions)", () => {
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

// Ticket 15-14-2 (wiring): the computer declares on a minor country only on the plan's date and only when the declarer's units can meet the duty.
const declare = (on: string, by = "germany"): Action => ({ type: "DECLARE_WAR", by, on } as Action);
const at = (year: number, season: GameState["season"], units: Record<string, Unit> = { u1: unit({ movement: 3 }) }): GameState => ({ ...state(), year, season, units });

describe("spec 15 Part E, ticket 15-14-2: chooseDeclaration on minor countries", () => {
  it("declares on Denmark in Spring 1940 when a German unit reaches it", () => {
    const d = chooseDeclaration(context(), at(1940, "spring"), [declare("denmark")]);
    expect(d?.action).toEqual(declare("denmark"));
    expect(d?.why).toContain("Denmark");
  });
  it("declares on nothing before the plan's date, however legal the declaration is", () => {
    expect(chooseDeclaration(context(), at(1939, "winter"), [declare("denmark")])).toBeUndefined();
    expect(chooseDeclaration(context(), at(1939, "fall"), [declare("denmark")])).toBeUndefined();
  });
  it("declares on nothing when the duty cannot be met: no unit in reach, or only a unit of another nation", () => {
    expect(chooseDeclaration(context(), at(1940, "spring", { u1: unit({ movement: 1 }) }), [declare("denmark")])).toBeUndefined();
    expect(chooseDeclaration(context(), at(1940, "spring", { u1: unit({ owner: "italy", movement: 3 }) }), [declare("denmark")])).toBeUndefined();
    expect(chooseDeclaration(context(), at(1940, "spring", {}), [declare("denmark")])).toBeUndefined();
  });
  it("declares on nothing that is not legal, and on nothing that is not a plan", () => {
    expect(chooseDeclaration(context(), at(1940, "spring"), [])).toBeUndefined();
    expect(chooseDeclaration(context(), at(1940, "spring"), [declare("sweden")])).toBeUndefined();
    expect(chooseDeclaration(context(), at(1940, "spring"), [declare("denmark", "italy")])).toBeUndefined();
  });
  it("takes the plans in the listed order: Denmark before Norway, a Balkan country only from Spring 1941", () => {
    expect(chooseDeclaration(context(), at(1940, "spring"), [declare("norway"), declare("denmark")])?.action).toEqual(declare("denmark"));
    expect(chooseDeclaration(context(false, "greece"), at(1940, "summer"), [declare("greece")])).toBeUndefined();
    expect(chooseDeclaration(context(false, "greece"), at(1941, "spring"), [declare("greece")])?.action).toEqual(declare("greece"));
  });
  it("a Major Power plan comes before a minor one", () => {
    expect(chooseDeclaration(context(), at(1941, "summer"), [declare("denmark"), declare("ussr")])?.action).toEqual(declare("ussr"));
  });
});

describe("spec 15 Part E, ticket 15-14-2: the reserve the builds and options keep back", () => {
  it("is the Major Power declarations still waiting plus the minor reserve", () => {
    const s = state();
    expect(declareReserve(CTX, s, "germany")).toBe(BRP_COSTS.declareWarOnMajorPower + plannedReserve(CTX, s, "germany"));
    expect(plannedReserve(CTX, s, "germany")).toBe(70);
  });
  it("shrinks by the price of a minor once it is at war, and is zero when the nation cannot pay the price", () => {
    const s = state();
    s.wars = [...s.wars, ["germany", "denmark"]];
    expect(declareReserve(CTX, s, "germany")).toBe(BRP_COSTS.declareWarOnMajorPower + 60);
    s.nations.germany.spendLimit = BRP_COSTS.declareWarOnMajorPower - 1;
    expect(declareReserve(CTX, s, "germany")).toBe(0);
  });
});

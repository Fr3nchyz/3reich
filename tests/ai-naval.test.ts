import { describe, expect, it, vi } from "vitest";
import { chooseAction } from "../src/ai/choose";
import { chooseSeaSupply } from "../src/ai/naval";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { navalOf } from "../src/engine/naval-record";
import { seaSupplyOptions } from "../src/engine/naval-supply-options";
import * as optionsModule from "../src/engine/naval-supply-options";
import { settle } from "../src/engine/turn";
import { supplyStatus } from "../src/engine/supply";
import type { GameState, Unit } from "../src/engine/types";
import { TurnTally } from "../scripts/selfplay/stats";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Spec 12 Part E, Release I; R6/R7; Ref 19.31. Policy only; the supply switch is enabled in this test's context, never in shipped rules.
const ON = { ...CTX, supplyEffects: true };
const infantry = (id: string, at: string) => counter(id, "italy", "infantry", 2, at, 3);
function position(units: Unit[] = [infantry("i1", "AA19")], capacity = 9, step = "6e"): GameState {
  const base = board([]);
  return board([...units, counter("fleet", "italy", "fleet", capacity, "U22")], undefined, {
    activeSide: "axis", nations: { ...base.nations, italy: { ...base.nations.italy, status: "axis" } },
    control: { AA19: "italy", Z19: "italy", X20: "italy" },
    position: { part: "player-turn", turn: 1, step },
  });
}
const decision = (s: GameState) => chooseAction(ON, s, { seed: 1 })!;
const apply = (s: GameState, action: Action) => {
  const result = applyAction(ON, s, action);
  if (!result.ok) throw new Error(result.error);
  return result;
};

describe("the computer saves cut-off units by sea (spec 12 Part E)", () => {
  it.each(["6e", "9f"])("at %s designates an engine-listed action and saves Cagliari", (step) => {
    const s = position(undefined, 9, step), legal = legalActions(ON, s);
    expect(supplyStatus(ON, s, "axis").unsupplied).toEqual(["i1"]);
    const pick = decision(s);
    expect(pick.action.type).toBe("DESIGNATE_SEA_SUPPLY");
    expect(legal).toContainEqual(pick.action);
    expect(supplyStatus(ON, apply(s, pick.action).state, "axis").unsupplied).toEqual([]);
  });

  it("takes the pocket with most units before another pocket", () => {
    const s = position([infantry("small", "AA19"), infantry("large1", "X20"), infantry("large2", "X20")], 2);
    expect(decision(s).action).toMatchObject({ type: "DESIGNATE_SEA_SUPPLY", to: "X20", units: ["large1", "large2"] });
  });

  it("a tie takes the lowest receiving hex id, before origin port order", () => {
    const s = position([infantry("z", "AA19"), infantry("a", "X20")], 1);
    expect(decision(s).action).toMatchObject({ type: "DESIGNATE_SEA_SUPPLY", to: "AA19", units: ["z"] });
  });

  it.each(["6e", "9f"])("at %s rereads after a designation, saving another pocket with remaining capacity", (step) => {
    const s = position([infantry("i1", "AA19"), infantry("i2", "X20")], 2, step);
    const first = decision(s);
    expect(first.action).toMatchObject({ type: "DESIGNATE_SEA_SUPPLY", to: "AA19" });
    const after = apply(s, first.action).state;
    expect(navalOf(after).used.fleet).toBe("supply");
    const second = decision(after);
    expect(second.action).toMatchObject({ type: "DESIGNATE_SEA_SUPPLY", to: "X20", units: ["i2"] });
    expect(supplyStatus(ON, apply(after, second.action).state, "axis").unsupplied).toEqual([]);
  });

  it("rechecks capacity: a full fleet cannot designate again", () => {
    const s = position([infantry("i1", "AA19"), infantry("i2", "X20")], 1);
    const after = apply(s, decision(s).action).state;
    expect(seaSupplyOptions(ON, after, "axis")).toEqual([]);
    expect(supplyStatus(ON, after, "axis").unsupplied).toEqual(["i2"]);
  });

  it.each(["6e", "9f"])("ends %s when no proposal saves a unit", (step) => {
    const s = position([infantry("i1", "U22")], 9, step);
    const end: Action = { type: "END_STEP", side: "axis", step };
    expect(chooseSeaSupply(ON, s, [end])).toBeUndefined();
    // A forced waiting step exposes the fallback even when the ordinary sequence would have skipped this empty step.
    const forced = { ...ON, implementedSteps: new Set([step]) };
    expect(chooseAction(forced, s, { seed: 1 })!.action).toEqual(end);
  });

  it("never constructs a designation absent from the supplied legal list", () => {
    const s = position(), legal = legalActions(ON, s);
    const picked = chooseSeaSupply(ON, s, legal)!;
    expect(legal.some((a) => a === picked.action)).toBe(true);
    expect(chooseSeaSupply(ON, s, legal.filter((a) => a.type !== "DESIGNATE_SEA_SUPPLY"))).toBeUndefined();
  });

  it("ignores zero-saving proposals, even if a future caller lists their designation", () => {
    const s = position(), legal = legalActions(ON, s), proposals = seaSupplyOptions(ON, s, "axis");
    const spy = vi.spyOn(optionsModule, "seaSupplyOptions").mockReturnValue(proposals.map((o) => ({ ...o, saves: 0 })));
    try { expect(chooseSeaSupply(ON, s, legal)).toBeUndefined(); } finally { spy.mockRestore(); }
  });

  it("the same state and different seeds give the same choice without changing state", () => {
    const s = position([infantry("i1", "AA19"), infantry("i2", "X20")], 1), before = JSON.stringify(s);
    expect(chooseAction(ON, s, { seed: 100 })).toEqual(decision(s));
    expect(decision(s)).toEqual(decision(s));
    expect(JSON.stringify(s)).toBe(before);
  });

  it("with the shipped switch off the sea-supply step offers no designation", () => {
    const s = position();
    const settled = settle(CTX, s).state;
    expect(settled.position).not.toMatchObject({ step: "6e" });
    expect(legalActions(CTX, settled).some((a) => a.type === "DESIGNATE_SEA_SUPPLY")).toBe(false);
  });

  it("counts actual newly saved counters for the self-play report (Part E)", () => {
    const s = position([infantry("cut", "AA19"), infantry("land", "U22")]);
    const result = apply(s, { type: "DESIGNATE_SEA_SUPPLY", side: "axis", fleets: ["fleet"], to: "AA19", units: ["cut"] });
    const tally = new TurnTally("Fall 1939"); tally.add(result.events, s, ON);
    expect(tally.close(ON, result.state, true).savedBySea).toBe(1);
    const waste = apply(s, { type: "DESIGNATE_SEA_SUPPLY", side: "axis", fleets: ["fleet"], to: "U22", units: ["land"] });
    const wasteTally = new TurnTally("Fall 1939"); wasteTally.add(waste.events, s, ON);
    expect(wasteTally.close(ON, waste.state, true).savedBySea).toBe(0);
  });
});

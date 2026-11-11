import { expect, it } from "vitest";
import { chooseAction } from "../src/ai/choose";
import { chooseManualCompletion } from "../src/ai/manual-completion";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { sideToAct } from "../src/engine/actor";
import { setManualDas } from "../src/engine/air-defense-wire";
import { newAirTurn } from "../src/engine/air-record";
import { setManualFleetMove } from "../src/engine/naval-actions";
import { navalOf } from "../src/engine/naval-record";
import type { GameState } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

function apply(s: GameState, a: Action): GameState {
  const result = applyAction(CTX, s, a);
  if (!result.ok) throw Error(result.error);
  return result.state;
}
function atSea() {
  const base = board([counter("b", "britain", "fleet", 9, "K21"), counter("g", "germany", "fleet", 9, "K28"),
    counter("p", "germany", "air", 1, "N19"), counter("base", "germany", "airbase", 0, "N19")], undefined,
  { activeSide: "allies", position: { part: "player-turn", turn: 1, step: "6b" },
    control: { N18: "britain", N19: "germany" }, frontOptions: { western: { option: "attrition" } } });
  const enabled = setManualFleetMove(base, true);
  const moved = apply({ ...enabled, naval: { ...navalOf(enabled), manualSeaAir: true } },
    { type: "MOVE_FLEET", side: "allies", fleet: "b", to: "N18", front: "western" });
  return apply(moved, { type: "END_STEP", side: "allies", step: "6b" });
}

it.each(["interceptions", "sea-air"])("AER116: computer resolves queued %s at 6d with mission policies off", kind => {
  let s = atSea();
  const declaration = legalActions(CTX, s).find(a => a.type === (kind === "interceptions" ? "DECLARE_INTERCEPT" : "DESIGNATE_SEA_AIR"));
  expect(declaration).toBeDefined();
  s = apply(s, declaration!);
  // Human declarations are followed by the computer's legal passes, then explicit resolution.
  for (let i = 0; i < 2; i++) {
    const choice = chooseAction(CTX, s, { seed: 1 });
    expect(choice?.action).toEqual({ type: "PASS_INTERCEPT", side: sideToAct(s) });
    s = apply(s, choice!.action);
  }
  expect(s.position).toMatchObject({ step: "6d" });
  const choice = chooseAction(CTX, s, { seed: 1 });
  expect(choice?.action.type).toBe(kind === "interceptions" ? "RESOLVE_INTERCEPTIONS" : "RESOLVE_SEA_AIR");
  expect(legalActions(CTX, s)).toContainEqual(choice!.action);
  const done = apply(s, choice!.action);
  expect(done).not.toEqual(s);
});

it("AER116: computer resolves 7c and passes defender DAS at 7d", () => {
  const base = board([counter("g", "germany", "infantry", 3, "M32", 3), counter("d", "poland", "infantry", 3, "M33", 3),
    counter("a", "germany", "air", 3, "J32", 4), counter("p", "britain", "air", 3, "M33", 4)], undefined,
  { position: { part: "player-turn", turn: 1, step: "7b" } });
  const enabled = setManualDas({ ...base, air: newAirTurn(base) }, true);
  let s = apply(enabled, { type: "DESIGNATE_AIR", side: "axis", mission: "counter-air", units: ["a"], target: "M33" });
  s = apply(s, { type: "END_STEP", side: "axis", step: "7b" });
  expect(s.position).toMatchObject({ step: "7c" });
  const resolve = chooseAction(CTX, s, { seed: 1 });
  expect(resolve?.action).toEqual({ type: "RESOLVE_COUNTER_AIR", side: "axis" });
  expect(applyAction(CTX, s, resolve!.action).ok).toBe(true);
  s = apply(enabled, { type: "END_STEP", side: "axis", step: "7b" });
  expect(s.position).toMatchObject({ step: "7d" });
  expect(sideToAct(s)).toBe("allies");
  const pass = chooseAction(CTX, s, { seed: 1 });
  expect(pass?.action).toEqual({ type: "END_STEP", side: "allies", step: "7d" });
  expect(applyAction(CTX, s, pass!.action).ok).toBe(true);
});

it("AER116: completion fallback stays inert without flags", () => {
  const actions: Action[] = [{ type: "PASS_INTERCEPT", side: "axis" }, { type: "RESOLVE_INTERCEPTIONS", side: "axis" },
    { type: "RESOLVE_SEA_AIR", side: "axis" }, { type: "RESOLVE_COUNTER_AIR", side: "axis" }, { type: "RESOLVE_PORT_ATTACKS", side: "axis" }];
  const s = board([]);
  expect(chooseManualCompletion(s, actions)).toBeUndefined();
  const enabled = setManualDas(s, true);
  expect(chooseManualCompletion(enabled, actions)?.action.type).toBe("RESOLVE_COUNTER_AIR");
});

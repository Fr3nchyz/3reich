import { applyAction, type Action } from "../src/engine/actions";
import { newAirTurn } from "../src/engine/air-record";
import { setManualFleetMove } from "../src/engine/naval-actions";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { newSession } from "../src/ui/session";
import { board, counter } from "./board";
import { CTX } from "./helpers";

export function position() {
  const s = board([
    counter("b1", "britain", "fleet", 9, "K21"), counter("b2", "britain", "fleet", 9, "K21"),
    counter("g1", "germany", "fleet", 9, "K28"), counter("g2", "germany", "fleet", 9, "K28"),
  ], undefined, { activeSide: "allies", position: { part: "player-turn", turn: 1, step: "6b" },
    frontOptions: { western: { option: "attrition" } }, control: { N18: "britain" } });
  return setManualFleetMove({ ...s, air: newAirTurn(s) }, true);
}
export const move: Action = { type: "MOVE_FLEET", side: "allies", fleet: "b1", to: "N18", front: "western" };
export const declaration: Action = { type: "DECLARE_INTERCEPT", side: "axis", target: "move:0", fleets: ["g1"], meetingPoint: "N18" };
export const passAxis: Action = { type: "PASS_INTERCEPT", side: "axis" };
export const passAllies: Action = { type: "PASS_INTERCEPT", side: "allies" };
export const resolution: Action = { type: "RESOLVE_INTERCEPTIONS", side: "allies" };
export function apply(s: ReturnType<typeof position>, a: Action) {
  const r = applyAction(CTX, s, a);
  if (!r.ok) throw new Error(r.error);
  return r;
}
export const at6c = () => apply(apply(position(), move).state, { type: "END_STEP", side: "allies", step: "6b" }).state;
export function at6d() {
  return apply(apply(apply(at6c(), declaration).state, passAxis).state, passAllies).state;
}
export function session(state = position()) {
  const s = newSession(SCENARIO_1939, "allies", 1);
  s.state = state;
  return s;
}

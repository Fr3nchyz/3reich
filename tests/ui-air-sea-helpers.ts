import type { Action } from "../src/engine/actions";
import { navalOf } from "../src/engine/naval-record";
import { counter } from "./board";
import { apply, at6c, session } from "./ui-fleet-helpers";
export { apply };
export function seaSession() {
  const base = at6c();
  const state = { ...base, rngState: 7, control: { ...base.control, N19: "germany" as const },
    units: { ...base.units, p: counter("p", "germany", "air", 1, "N19"), q: counter("q", "germany", "air", 1, "N19"),
      base: counter("base", "germany", "airbase", 0, "N19") },
    naval: { ...navalOf(base), manualSeaAir: true } };
  const s = session(state); s.humanSide = "axis";
  return s;
}
export const designation: Action = { type: "DESIGNATE_SEA_AIR", side: "axis", target: "move:0", point: "N18", units: ["p"] };
export const resolution: Action = { type: "RESOLVE_SEA_AIR", side: "allies" };
export function queued() {
  const s = seaSession();
  s.state = apply(s.state, designation).state;
  for (const side of ["axis", "allies"] as const) s.state = apply(s.state, { type: "PASS_INTERCEPT", side }).state;
  s.humanSide = "allies";
  return s;
}

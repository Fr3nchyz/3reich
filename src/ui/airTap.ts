import { legalActions, type Action } from "../engine/actions";
import { designateProblem, groundSupportTargets, airInRangeOf } from "../engine/air-missions";
import { turnKey } from "../engine/combat-record";
import type { MapHex } from "../engine/map";
import { atStep7b } from "./airView";
import { airPick } from "./airPick";
import { run, type Session } from "./session";

/**
 * The tap flow of ground support at step 7b (spec 09, part D2): tap a hex the player can attack (on the map, or its row in the list) and the
 * card opens with every plane that fits already chosen; tap a plane to add or remove it; the one button makes the engine's DESIGNATE_AIR action.
 * The draft lives in `Session.airDraft`, is dropped when the step or the turn changes and is never part of the game. No rule here: who may fly, the
 * range and the cap are the engine's `designateProblem`.
 */

export interface AirDraft {
  target: string;
  /** The ids of the planes chosen to fly there. */
  units: string[];
  /** The Player Turn the draft was made in (`turnKey`): a draft never outlives it. */
  turn: string;
  /** Just opened: the card's heading takes the keyboard focus on the next draw, once. */
  fresh: boolean;
  /** Opened from the list, where the hex may be off the visible map: the map moves to show it, once. */
  focus: boolean;
}

type Designate = Extract<Action, { type: "DESIGNATE_AIR" }>;

/** The hexes planes can be committed to now: the targets of the DESIGNATE_AIR actions the engine lists, once each, in order. */
export const airTargets = (actions: readonly Action[]): string[] => [...new Set(actions.filter((a): a is Designate => a.type === "DESIGNATE_AIR").map((a) => a.target))];

/** The legal actions for the air flow: none unless the player may commit air now. */
export const airActions = (s: Session): Action[] => (atStep7b(s) ? legalActions(s.ctx, s.state) : []);

/** The planes that can fly to `target` one by one: free, in range, and fitting under the cap alone. */
function singles(s: Session, target: string): string[] {
  const targets = groundSupportTargets(s.ctx, s.state);
  return airInRangeOf(s.ctx, s.state, target).filter((u) => designateProblem(s.ctx, s.state, [u], target, targets) === null).map((u) => u.id);
}

/** The draft as it stands now: dropped when it is not the player's step 7b, the Player Turn has changed or no plane can fly there; planes that can no longer fly are taken out. */
export function normaliseAir(s: Session): void {
  const d = s.airDraft;
  if (!d) return;
  if (!atStep7b(s) || d.turn !== turnKey(s.state)) {
    s.airDraft = null;
    return;
  }
  const can = singles(s, d.target);
  if (can.length === 0) s.airDraft = null;
  else if (!d.units.every((u) => can.includes(u))) s.airDraft = { ...d, units: d.units.filter((u) => can.includes(u)) };
}

/** Opens the card on `target` with every plane that fits chosen (the engine's own first choice). Does nothing for a hex planes cannot go to. */
export function openAir(s: Session, target: string, fromList = false): boolean {
  const all = airActions(s).find((a): a is Designate => a.type === "DESIGNATE_AIR" && a.target === target);
  if (!all) return false;
  s.toast = "";
  s.airDraft = { target, units: [...all.units], turn: turnKey(s.state), fresh: true, focus: fromList };
  return true;
}

/** A plane chip: add the plane, or take it out. A plane that cannot be added is left as it is. */
export function toggleAir(s: Session, id: string): void {
  const d = s.airDraft;
  if (!d) return;
  const chip = airPick(s.ctx, s.state, d.target, d.units)?.chips.find((c) => c.id === id);
  if (!chip || chip.state === "greyed" || chip.state === "committed") return;
  s.airDraft = { ...d, fresh: false, units: d.units.includes(id) ? d.units.filter((u) => u !== id) : [...d.units, id] };
}

/** "Cancel", Escape, or a tap on the same hex again: the draft is thrown away and nothing has changed in the game. */
export function cancelAir(s: Session): void {
  s.airDraft = null;
}

/** The one button: the chosen planes are committed through the engine's DESIGNATE_AIR. Refused, it says why and keeps the draft. */
export function confirmAir(s: Session): void {
  const d = s.airDraft;
  if (!d) return;
  const pick = airPick(s.ctx, s.state, d.target, d.units);
  if (!pick || pick.button.disabled) {
    s.toast = pick?.button.text ?? "";
    return;
  }
  const units = pick.chips.filter((c) => c.state === "chosen").map((c) => c.id);
  s.toast = "";
  if (run(s, { type: "DESIGNATE_AIR", side: s.state.activeSide, mission: "ground-support", units, target: d.target })) s.airDraft = null;
}

/** A tap on a map hex at step 7b: a hex planes can go to opens the card (or moves it there), the hex of the open card closes it. False when the player may not commit air now. */
export function tapToAir(s: Session, h: MapHex): boolean {
  if (!atStep7b(s)) return false;
  const targets = airTargets(airActions(s));
  if (targets.length === 0) return false;
  if (!targets.includes(h.id)) return true;
  if (s.airDraft?.target === h.id) cancelAir(s);
  else openAir(s, h.id);
  return true;
}

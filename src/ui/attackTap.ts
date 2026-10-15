import { legalActions, type Action } from "../engine/actions";
import { turnKey } from "../engine/combat-record";
import type { MapHex } from "../engine/map";
import { attackPreview, defaultAttackers } from "./attackPreview";
import { attackTargets, newDraft, reconciled, toggled } from "./attackDraft";
import { computerToMove } from "./computerPlay";
import { run, type Session } from "./session";

/**
 * The tap flow of the attack at step 7h (spec 07, part B): tap a red hex on the map, or its row in the list, and the attack card opens with every
 * unit that can attack already chosen; tap a chip to add or remove a unit; the one button makes the real ATTACK action through `applyAction`.
 * The draft lives in `Session.attack`, is dropped when the step or the turn changes, and is never part of the game. No rule here: the units
 * that can attack and the numbers all come from `legalActions` and the preview model.
 */

/** Whether the player may make an attack now: step 7h of a Player Turn that is theirs, and not a watched game. */
export function attacking(s: Session): boolean {
  const p = s.state.position;
  return s.state.phase === "player-turn" && p?.part === "player-turn" && p.step === "7h" && !s.watch && !computerToMove(s);
}

/** The legal actions for the attack flow: none unless the player may attack now. */
export const attackActions = (s: Session): Action[] => (attacking(s) ? legalActions(s.ctx, s.state) : []);

/** The hexes that can be attacked now. */
export const targetsNow = (s: Session): string[] => attackTargets(attackActions(s));

/**
 * Keeps the draft and the result card honest after any change: a draft goes when it is not the player's step 7h, the turn has changed or
 * the hex can no longer be attacked, and loses units that can no longer attack; the result card goes with its Player Turn or step.
 */
export function normaliseAttack(s: Session, actions?: readonly Action[]): void {
  if (!attacking(s)) {
    s.attack = null;
    if (s.battle && (s.battle.turn !== turnKey(s.state) || !(s.state.position?.part === "player-turn" && s.state.position.step === "7h"))) s.battle = null;
    return;
  }
  if (s.battle && s.battle.turn !== turnKey(s.state)) s.battle = null;
  if (s.attack) s.attack = reconciled(s.attack, s.state, actions ?? legalActions(s.ctx, s.state));
}

/** Opens the attack card on `target` with every unit that can attack chosen. `fromList`: the map moves to show the hex. Does nothing for a hex that cannot be attacked. */
export function openAttack(s: Session, target: string, fromList = false): boolean {
  if (!targetsNow(s).includes(target)) return false;
  s.toast = "";
  s.battle = null;
  s.attack = newDraft(s.state, target, defaultAttackers(s.ctx, s.state, target), fromList);
  return true;
}

/** A unit chip: add the unit to the attack, or take it out. A unit that cannot attack is left as it is. */
export function toggleAttacker(s: Session, id: string): void {
  const d = s.attack;
  if (!d) return;
  const chip = attackPreview(s.ctx, s.state, d.target, d.units).attackers.find((c) => c.id === id);
  if (chip && chip.state !== "greyed") s.attack = toggled(d, id);
}

/** "Cancel", Escape, or a tap on the same hex again: the draft is thrown away and nothing has changed in the game. */
export function cancelAttack(s: Session): void {
  s.attack = null;
}

/** The result card's Close button. */
export function closeResult(s: Session): void {
  s.battle = null;
}

/**
 * The one button: the chosen units attack the hex, through the engine's ATTACK action. Refused (no unit chosen, or the rules say no) it says why
 * and keeps the draft; made, the draft goes and the result card takes its place.
 */
export function confirmAttack(s: Session): void {
  const d = s.attack;
  if (!d) return;
  const p = attackPreview(s.ctx, s.state, d.target, d.units);
  if (p.button.disabled) {
    s.toast = p.button.text;
    return;
  }
  const units = p.attackers.filter((c) => c.state === "chosen").map((c) => c.id);
  s.toast = "";
  s.build = null;
  s.moveFrom = null;
  if (run(s, { type: "ATTACK", side: s.state.activeSide, units, target: d.target })) s.attack = null;
}

/**
 * A tap on a map hex at step 7h: a red hex opens the card (or moves it there from another red hex), the hex of the open card closes it, and any
 * other hex does nothing here (the hex card shows it, with the reason it cannot be attacked). Returns false when the player may not attack now.
 */
export function tapToAttack(s: Session, h: MapHex): boolean {
  if (!attacking(s)) return false;
  if (!targetsNow(s).includes(h.id)) return true;
  if (s.attack?.target === h.id) cancelAttack(s);
  else openAttack(s, h.id);
  return true;
}

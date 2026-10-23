import { turnKey } from "../engine/combat-record";
import type { MapHex } from "../engine/map";
import { confirmFor, defaultTicks, moverStacks, selectionFor, whyNot, type SrSelection } from "./redeployModel";
import { noteRedeploy } from "./redeployUndo";
import * as T from "./redeployText";
import { run, type Session } from "./session";
import { atStep9e } from "./step9e";

/**
 * The tap flow of Strategic Redeployment at step 9e (spec 16 D4, ticket 16-19): tap a stack of yours (or its row in the list) and it is chosen with the
 * units that can go ticked; tick or untick lines; tap a yellow hex (or its row) and a confirm card names the redeployment; "Redeploy" sends exactly the
 * ticked units through the engine's SR_UNITS action. The choice lives in `Session.redeploy`, is dropped when the step or the turn changes and is never
 * shown to the computer or in watch mode. Nothing here lists the engine's actions: the model asks one unit at a time (redeployModel.ts). No rule here.
 */

/** The stack chosen to redeploy: its hex, the units ticked, and the hex chosen to go to (the confirm card), if any. Screen state, never saved. */
export interface SrChoice {
  hex: string;
  ticked: string[];
  /** The hex tapped to go to: the confirm card shows while it is set. */
  to: string | null;
  /** The Player Turn the choice was made in (`turnKey`): a choice never outlives it. */
  turn: string;
  /** Just chosen: the card's heading takes the keyboard focus on the next draw, once. */
  fresh: boolean;
  /** Chosen from the list, where the hex may be off the visible map: the map moves to show it, once. */
  focus: boolean;
  /** The fold-out "Where they can go" is open. */
  whereOpen?: boolean;
}

export { atStep9e };

let cached: { state: unknown; ctx: unknown; hex: string; key: string; sel: SrSelection } | null = null;

/** The card of the chosen stack, or null when nothing is chosen or it is not the player's step 9e. Computed once per state and set of ticks. */
export function selectionNow(s: Session): SrSelection | null {
  const c = s.redeploy;
  if (!c || !atStep9e(s)) return null;
  const key = c.ticked.join(",");
  if (cached && cached.state === s.state && cached.ctx === s.ctx && cached.hex === c.hex && cached.key === key) return cached.sel;
  const sel = selectionFor(s.ctx, s.state, c.hex, c.ticked);
  cached = { state: s.state, ctx: s.ctx, hex: c.hex, key, sel };
  return sel;
}

/** The yellow hexes: where the ticked units can all go. */
export const redeployTargets = (s: Session): string[] => selectionNow(s)?.destinations ?? [];

/** Keeps the choice honest after any change: gone when it is not the player's step 9e, the Player Turn changed or nobody in the hex can go any more. */
export function normaliseRedeploy(s: Session): void {
  const c = s.redeploy;
  if (!c) return;
  if (!atStep9e(s) || c.turn !== turnKey(s.state)) {
    s.redeploy = null;
    return;
  }
  const sel = selectionNow(s)!;
  if (sel.tickable === 0) s.redeploy = null;
  else if (sel.ticked.length !== c.ticked.length || (c.to && !sel.destinations.includes(c.to))) s.redeploy = { ...c, ticked: sel.ticked, to: c.to && sel.destinations.includes(c.to) ? c.to : null };
}

/** Chooses the stack in `hex` with its movers ticked. False, and no change, when nobody there can be redeployed. */
export function chooseStack(s: Session, hex: string, fromList = false): boolean {
  if (!atStep9e(s)) return false;
  const ticked = defaultTicks(s.ctx, s.state, hex);
  if (ticked.length === 0) return false;
  s.toast = "";
  s.redeploy = { hex, ticked, to: null, turn: turnKey(s.state), fresh: true, focus: fromList };
  return true;
}

const withTicks = (c: SrChoice, ticked: string[]): SrChoice => ({ ...c, ticked, to: null, fresh: false, focus: false });

/** A unit line: ticked if free, free if ticked. A unit that cannot go is left as it is. */
export function toggleTick(s: Session, id: string): void {
  const sel = selectionNow(s);
  const line = sel?.lines.find((l) => l.id === id);
  if (!sel || !line || !line.can) return;
  s.toast = "";
  s.redeploy = withTicks(s.redeploy!, line.ticked ? sel.ticked.filter((t) => t !== id) : [...sel.ticked, id]);
}

export function tickAll(s: Session): void {
  s.toast = "";
  if (s.redeploy) s.redeploy = withTicks(s.redeploy, defaultTicks(s.ctx, s.state, s.redeploy.hex));
}

export function tickNone(s: Session): void {
  s.toast = "";
  if (s.redeploy) s.redeploy = withTicks(s.redeploy, []);
}

/** "Cancel", Escape, or a tap on the chosen hex again: the choice is thrown away and nothing has changed in the game. */
export function cancelRedeploy(s: Session): void {
  s.toast = "";
  s.redeploy = null;
}

export function setWhereOpen(s: Session, open: boolean): void {
  if (s.redeploy) s.redeploy = { ...s.redeploy, whereOpen: open };
}

/** A yellow hex (map or row): the confirm card names the redeployment. A hex that is not yellow says why. */
export function pickDestination(s: Session, to: string): void {
  const sel = selectionNow(s);
  if (!sel) return;
  if (sel.ticked.length === 0) s.toast = T.NOTHING_TICKED;
  else if (!sel.destinations.includes(to)) s.toast = sel.why ?? whyNot(s.ctx, s.state, sel.ticked, to);
  else {
    s.toast = "";
    s.redeploy = { ...s.redeploy!, to, fresh: false, focus: false };
  }
}

/** "Choose another hex": the confirm card goes, the yellow hexes stay. */
export function changeDestination(s: Session): void {
  s.toast = "";
  if (s.redeploy) s.redeploy = { ...s.redeploy, to: null };
}

/** "Redeploy": the ticked units go to the chosen hex through SR_UNITS; the hex stays chosen while someone there can still go. */
export function confirmRedeploy(s: Session): void {
  const sel = selectionNow(s);
  const to = s.redeploy?.to;
  if (!sel || !to || sel.ticked.length === 0 || !sel.destinations.includes(to)) return;
  const said = confirmFor(s.ctx, s.state, sel.ticked, to);
  const line = `${T.redeployedLine(said.units, said.from, said.to)} ${said.left}`.trim();
  const action = { type: "SR_UNITS" as const, side: s.state.activeSide, units: sel.ticked, to };
  const [before, logLen] = [s.state, s.log.length];
  if (!run(s, action)) return;
  noteRedeploy(s, before, logLen, action, line);
  const rest = defaultTicks(s.ctx, s.state, sel.hex);
  s.redeploy = rest.length > 0 && atStep9e(s) ? { ...s.redeploy!, ticked: rest, to: null, fresh: false, focus: false } : null;
  s.toast = line;
}

/**
 * A tap at step 9e. A stack of yours that can be redeployed is chosen with its movers ticked (also when it stands on a yellow hex: choosing wins; the
 * list "Where they can go" reaches such a hex); tapping the chosen hex again lets it go; a yellow hex opens the confirm card.
 * Returns false when it is not step 9e or no unit can be redeployed.
 */
export function tapToRedeploy(s: Session, h: MapHex): boolean {
  if (!atStep9e(s)) return false;
  const stacks = moverStacks(s.ctx, s.state);
  if (stacks.length === 0) return false;
  if (s.redeploy?.hex === h.id) {
    cancelRedeploy(s);
    return true;
  }
  if (stacks.some((k) => k.hex === h.id)) {
    chooseStack(s, h.id);
    return true;
  }
  if (selectionNow(s)) pickDestination(s, h.id);
  else s.toast = T.CHOOSE_FIRST;
  return true;
}

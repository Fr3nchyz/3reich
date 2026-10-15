import { legalActions, type Action } from "../engine/actions";
import { turnKey } from "../engine/combat-record";
import type { MapHex } from "../engine/map";
import { computerToMove } from "./computerPlay";
import { newChoice, withTicks } from "./moveDraft";
import { defaultTicks, movedLine, selectionFor, toggled, type MoveSelection } from "./moveSelection";
import * as T from "./moveText";
import { placeName, stackSummary, unitsWithIds } from "./names";
import { run, type Session } from "./session";

/**
 * The tap flow of ground movement at step 6f (spec 10, ticket 10-3): tap a stack of yours (or its row in the list) and it is chosen with every
 * unit that can move ticked; tick or untick lines, All, None; tap a yellow hex and exactly the ticked units move, through the engine's MOVE
 * action. The hex stays chosen while someone there can still move. The choice lives in `Session.moveChosen`, is dropped when the step or the turn
 * changes and is never shown to the computer or in watch mode. The numbers and the words come from moveSelection.ts and moveText.ts; no rule here.
 */

type Move = Extract<Action, { type: "MOVE" }>;

/** Whether it is step 6f of a Player Turn the player plays (not watched, not the computer's). */
export function atStep6f(s: Session): boolean {
  const p = s.state.position;
  return s.state.phase === "player-turn" && p?.part === "player-turn" && p.step === "6f" && !s.watch && !computerToMove(s);
}

/** The moves on offer now, or none outside step 6f. */
export function movesNow(s: Session): Move[] {
  const p = s.state.position;
  if (s.state.phase !== "player-turn" || p?.part !== "player-turn" || p.step !== "6f") return [];
  return legalActions(s.ctx, s.state).filter((a): a is Move => a.type === "MOVE");
}

const startOf = (s: Session, m: Move): string | undefined => s.state.units[m.units[0]!]?.at;

/** The hexes holding units that can move now, in the engine's order, each with how many. */
export function movableStacks(s: Session): { hex: string; units: number }[] {
  const by = new Map<string, Set<string>>();
  for (const m of movesNow(s)) {
    const at = startOf(s, m);
    if (at) by.set(at, new Set([...(by.get(at) ?? []), ...m.units]));
  }
  return [...by].map(([hex, ids]) => ({ hex, units: ids.size }));
}

let cached: { state: unknown; ctx: unknown; hex: string; key: string; sel: MoveSelection } | null = null;

/** The card of the chosen stack, or null when nothing is chosen or it is not the player's step 6f. Computed once per state and set of ticks. */
export function selectionNow(s: Session): MoveSelection | null {
  const c = s.moveChosen;
  if (!c || !atStep6f(s)) return null;
  const key = c.ticked.join(",");
  if (cached && cached.state === s.state && cached.ctx === s.ctx && cached.hex === c.hex && cached.key === key) return cached.sel;
  const sel = selectionFor(s.ctx, s.state, c.hex, c.ticked);
  cached = { state: s.state, ctx: s.ctx, hex: c.hex, key, sel };
  return sel;
}

/** The yellow hexes: where all ticked units can end up together. */
export const moveTargets = (s: Session): string[] => selectionNow(s)?.destinations.map((d) => d.to) ?? [];

/** The second shade: where a faster ticked unit could go further alone. */
export const moveFurther = (s: Session): string[] => selectionNow(s)?.alone ?? [];

/**
 * Keeps the choice honest after any change: it goes when it is not the player's step 6f, the Player Turn has changed or nobody in the hex can
 * move any more, and loses ticks on units that can no longer be ticked.
 */
export function normaliseMove(s: Session): void {
  const c = s.moveChosen;
  if (!c) return;
  if (!atStep6f(s) || c.turn !== turnKey(s.state)) {
    s.moveChosen = null;
    return;
  }
  const sel = selectionNow(s)!;
  if (sel.status === "nobody") s.moveChosen = null;
  else if (sel.ticked.length !== c.ticked.length) s.moveChosen = { ...c, ticked: sel.ticked };
}

/** Chooses the stack in `hex` with every unit that can move ticked (decision 1). False, and no change, when no unit there can move. */
export function chooseStack(s: Session, hex: string, fromList = false): boolean {
  if (!atStep6f(s)) return false;
  const ticked = defaultTicks(s.ctx, s.state, hex);
  if (ticked.length === 0) return false;
  s.toast = "";
  s.moveChosen = newChoice(s.state, hex, ticked, fromList);
  return true;
}

/** A unit line: ticked if free, free if ticked. A unit that cannot move is left as it is. */
export function toggleTick(s: Session, id: string): void {
  const sel = selectionNow(s);
  const line = sel?.lines.find((l) => l.key === id);
  if (!sel || !line || line.state === "greyed") return;
  s.toast = "";
  s.moveChosen = withTicks(s.moveChosen!, toggled(sel.ticked, id));
}

/** "All": every unit that can move is ticked. */
export function tickAll(s: Session): void {
  s.toast = "";
  if (s.moveChosen) s.moveChosen = withTicks(s.moveChosen, defaultTicks(s.ctx, s.state, s.moveChosen.hex));
}

/** "None". */
export function tickNone(s: Session): void {
  s.toast = "";
  if (s.moveChosen) s.moveChosen = withTicks(s.moveChosen, []);
}

/** "Cancel", Escape, or a tap on the chosen hex again: the choice is thrown away and nothing has changed in the game. */
export function cancelMove(s: Session): void {
  s.toast = "";
  s.moveChosen = null;
}

/** The ticked units go to `to` if it is a yellow hex; the hex stays chosen while someone there can still move. */
function moveTicked(s: Session, sel: MoveSelection, to: string): void {
  const dest = sel.destinations.find((d) => d.to === to);
  if (sel.ticked.length === 0) s.toast = T.NOTHING_TICKED;
  else if (!dest) s.toast = sel.alone.includes(to) && sel.further ? sel.further : T.CANNOT_GET_THERE;
  else {
    const line = movedLine(s.ctx, s.state, sel.ticked, to);
    if (!run(s, { type: "MOVE", side: s.state.activeSide, units: sel.ticked, path: dest.path })) return;
    const rest = defaultTicks(s.ctx, s.state, sel.hex);
    s.moveChosen = rest.length > 0 ? withTicks(s.moveChosen!, rest) : null;
    s.toast = rest.length > 0 ? `${line} ${T.stayingSentence(placeName(s.ctx.map, sel.hex), stackSummary(unitsWithIds(s.state, rest), true))}` : line;
  }
}

/**
 * A tap at step 6f. A stack of yours that can move is chosen with all its movers ticked (also when it stands on a yellow hex: choosing wins, and
 * a stack joins another by choosing the other one instead); tapping the chosen hex again lets it go; a yellow hex moves exactly the ticked units.
 * Returns false when the game is not at step 6f (or no unit can move).
 */
export function tapToMove(s: Session, h: MapHex): boolean {
  const moves = movesNow(s);
  if (moves.length === 0) return false;
  if (s.moveChosen?.hex === h.id) {
    cancelMove(s);
    return true;
  }
  if (moves.some((m) => startOf(s, m) === h.id)) {
    chooseStack(s, h.id);
    return true;
  }
  const sel = selectionNow(s);
  if (sel) moveTicked(s, sel, h.id);
  else s.toast = T.CHOOSE_FIRST;
  return true;
}

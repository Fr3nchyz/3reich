import { legalActions, type Action } from "../engine/actions";
import type { MapHex } from "../engine/map";
import { run, type Session } from "./session";

/**
 * The tap flow of ground movement at step 6f: tap a stack of yours (its destinations are outlined), then
 * tap one of them. Every move is one of the engine's legal MOVE actions; nothing here knows a rule.
 */

type Move = Extract<Action, { type: "MOVE" }>;

/** The moves on offer now, or none outside step 6f. */
export function movesNow(s: Session): Move[] {
  const p = s.state.position;
  if (s.state.phase !== "player-turn" || p?.part !== "player-turn" || p.step !== "6f") return [];
  return legalActions(s.ctx, s.state).filter((a): a is Move => a.type === "MOVE");
}

const startOf = (s: Session, m: Move): string | undefined => s.state.units[m.units[0]!]?.at;

/** The hexes the chosen stack can reach (the ones to outline), or none. */
export function moveTargets(s: Session): string[] {
  if (!s.moveFrom) return [];
  return [...new Set(movesNow(s).filter((m) => startOf(s, m) === s.moveFrom).map((m) => m.path[m.path.length - 1]!))];
}

/** A tap at step 6f: choose the stack in the hex, or move the chosen stack there. Returns false when the game is not at step 6f. */
export function tapToMove(s: Session, h: MapHex): boolean {
  const moves = movesNow(s);
  if (moves.length === 0) return false;
  if (s.moveFrom && s.moveFrom !== h.id) {
    // The whole stack goes if it can; otherwise the biggest group of it that can.
    const here = moves.filter((m) => startOf(s, m) === s.moveFrom && m.path[m.path.length - 1] === h.id).sort((a, b) => b.units.length - a.units.length);
    if (here[0]) {
      s.moveFrom = null;
      run(s, here[0]);
      return true;
    }
  }
  if (s.moveFrom === h.id || !moves.some((m) => startOf(s, m) === h.id)) {
    s.moveFrom = null;
    s.toast = "Tap one of your stacks that can move, then a yellow hex.";
    return true;
  }
  s.moveFrom = h.id;
  return true;
}

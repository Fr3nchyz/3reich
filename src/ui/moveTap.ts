import { legalActions, type Action } from "../engine/actions";
import type { MapHex } from "../engine/map";
import { run, type Session } from "./session";

/**
 * The tap flow of ground movement at step 6f: tap a stack of yours (its destinations are outlined), then
 * tap one of them. Every move is one of the engine's legal MOVE actions; nothing here knows a rule.
 * The engine lists the moves once per game state (move-action.ts), so selecting and moving cost one listing between them.
 */

type Move = Extract<Action, { type: "MOVE" }>;

/** The moves on offer now, or none outside step 6f. */
export function movesNow(s: Session): Move[] {
  const p = s.state.position;
  if (s.state.phase !== "player-turn" || p?.part !== "player-turn" || p.step !== "6f") return [];
  return legalActions(s.ctx, s.state).filter((a): a is Move => a.type === "MOVE");
}

const startOf = (s: Session, m: Move): string | undefined => s.state.units[m.units[0]!]?.at;
const endOf = (m: Move): string => m.path[m.path.length - 1]!;

/** The hexes the chosen stack can reach (the ones to outline), or none. */
export function moveTargets(s: Session): string[] {
  if (!s.moveFrom) return [];
  return [...new Set(movesNow(s).filter((m) => startOf(s, m) === s.moveFrom).map(endOf))];
}

const SELECT_HELP = "Tap one of your stacks that can move, then a yellow hex.";

/**
 * A tap at step 6f. A stack of yours that can move is chosen (also when it stands on a yellow hex: choosing wins, and
 * a stack joins another by choosing the other one instead); tapping the chosen stack again lets it go; a yellow hex moves
 * the chosen stack there, the whole stack if it can, otherwise the biggest part of it that can (and the toast says so).
 * Returns false when the game is not at step 6f.
 */
export function tapToMove(s: Session, h: MapHex): boolean {
  const moves = movesNow(s);
  if (moves.length === 0) return false;
  if (s.moveFrom === h.id) {
    s.moveFrom = null;
    return true;
  }
  if (moves.some((m) => startOf(s, m) === h.id)) {
    s.moveFrom = h.id;
    return true;
  }
  if (!s.moveFrom) {
    s.toast = SELECT_HELP;
    return true;
  }
  const here = moves.filter((m) => startOf(s, m) === s.moveFrom && endOf(m) === h.id).sort((a, b) => b.units.length - a.units.length);
  if (!here[0]) {
    s.toast = "That stack cannot get there. The yellow hexes are the places it can.";
    return true;
  }
  const stack = new Set(moves.filter((m) => startOf(s, m) === s.moveFrom).flatMap((m) => m.units)).size;
  s.moveFrom = null;
  if (run(s, here[0]) && here[0].units.length < stack) s.toast = `Only ${here[0].units.join(", ")} could get there; the rest of the stack stays.`;
  return true;
}

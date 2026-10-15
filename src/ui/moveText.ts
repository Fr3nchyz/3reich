import { TERRAIN_MOVE_COST } from "../engine/movement";
import type { UnitType } from "../engine/types";
import { cap } from "./format";

/**
 * Every sentence the Move card says, in one place (spec 10, part E: a later French pass is a translation). Plain English, built from counter
 * names and place names the caller passes in, never from an id. Pure string functions; nothing here decides a rule.
 */

/**
 * Whether one movement point is one hex, so that "can go 3 hexes" is true. TODO(verify, Ref 4.5): every terrain costs 1 today
 * (`TERRAIN_MOVE_COST`); if a real cost differs, the card counts movement points instead of hexes.
 */
export const POINTS_ARE_HEXES = Object.values(TERRAIN_MOVE_COST).every((c) => c === 1);

/** "1 hex", "3 hexes" (or "1 movement point", "3 movement points" when a point is not one hex). */
export const reach = (n: number, hexes = POINTS_ARE_HEXES): string => (hexes ? `${n} ${n === 1 ? "hex" : "hexes"}` : `${n} movement point${n === 1 ? "" : "s"}`);

/** "A", "A and B", "A, B and C". */
export const listOf = (xs: readonly string[]): string => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The pronoun for one or several counters: "it" / "them", "It" / "They". */
export const they = (n: number, cap = false): string => (n === 1 ? (cap ? "It" : "it") : cap ? "They" : "them");

/**
 * Why a counter cannot be ticked, by what it is. Air units, fleets, airbases and bridgeheads do not move on the ground (`GROUND_MOVERS` is
 * infantry, armor and airborne). TODO(verify, engine fact 7): replacements print no movement factor and are said not to move.
 */
export function cannotMoveReason(type: UnitType): string | null {
  if (type === "replacement") return "replacements do not move";
  return type === "infantry" || type === "armor" || type === "airborne" ? null : "does not move on the ground";
}

/** A unit of this side that has used its move. TODO(verify, Ref 5.45f): one move per Player Turn (`ONE_MOVE_PER_TURN`). */
export const ALREADY_MOVED = "already moved this turn";
export const NOT_YOURS = "not yours to move now";
export const NO_HEX_TO_GO_TO = "no hex to go to";
/** A counter that is free to move but not ticked. */
export const STAYS_HERE = "stays here";
/** A counter that cannot move now for a reason the card has no words for (the engine said so). */
export const CANNOT_NOW = "cannot move now";

export const NOTHING_TICKED = "Tick at least one unit.";
export const NOWHERE_TOGETHER = "These units cannot all go anywhere together.";
export const NOTHING_CAN_MOVE = "No unit here can move now.";

export const tickedCount = (ticked: number, tickable: number): string => `${ticked} of ${tickable} ticked.`;
export const tapToMove = (n: number): string => `Tap a yellow hex to move ${they(n)} there.`;

/** Counters told by name, identical ones counted: "the 2-3 German infantry", "2 x 2-3 German infantry", "the 3-4 German armor and 2 x 2-3 German infantry". */
export function these(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return listOf([...counts].map(([name, k]) => (k === 1 ? `the ${name}` : `${k} x ${name}`)));
}

/** "The 3-4 German armor can go up to 4 hexes." for one counter; "Together they can go up to 3 hexes (set by the 2-3 German infantry)." for several. */
export function togetherSentence(names: readonly string[], points: number, slowest: readonly string[]): string {
  if (names.length === 1) return `The ${names[0]} can go up to ${reach(points)}.`;
  const set = slowest.length < names.length ? ` (set by ${these(slowest)})` : "";
  return `Together they can go up to ${reach(points)}${set}.`;
}

/** "The 3-4 German armor alone could go up to 4 hexes." Identical counters: "2 x 3-4 German armor could each go up to 4 hexes alone." Several kinds: one clause each, joined by "; ". */
export function furtherSentence(alone: readonly { name: string; points: number }[]): string {
  const by = new Map<string, { name: string; points: number; n: number }>();
  for (const a of alone) by.set(`${a.name}|${a.points}`, { ...a, n: (by.get(`${a.name}|${a.points}`)?.n ?? 0) + 1 });
  const clause = ({ name, points, n }: { name: string; points: number; n: number }) =>
    n === 1 ? `the ${name} alone could go up to ${reach(points)}` : `${n} x ${name} could each go up to ${reach(points)} alone`;
  return `${[...by.values()].map((c) => cap(clause(c))).join("; ")}.`;
}

/** "Untick the 2-3 German infantry to let it go further." (`faster` is how many counters would gain, for "it" or "them"). */
export const untickAdvice = (limiting: readonly string[], faster: number): string => `Untick ${these(limiting)} to let ${they(faster)} go further.`;

/** "2 hexes within reach cannot take both of them." The count is of hexes some ticked counter could end in alone. */
export const roomSentence = (hexes: number, ticked: number): string => `${reach(hexes, true)} within reach cannot take ${ticked === 2 ? "both" : "all"} of them.`;

/** The line a screen reader hears after each change: "2 of 2 ticked. They can go up to 3 hexes." */
export const announceReady = (ticked: number, tickable: number, points: number): string => `${tickedCount(ticked, tickable)} ${they(ticked, true)} can go up to ${reach(points)}.`;

/** "Staying in Lodz (N33): 2-3 German infantry." (a list of counters left behind, told by `stackSummary`). */
export const stayingSentence = (place: string, units: string): string => `Staying in ${place}: ${units}.`;

/** "Moved 3-4 German armor from Lodz (N33) to Radom (N34)." (`what` is the counters with their origin, from `unitsWhere`). */
export const movedSentence = (what: string, to: string): string => `Moved ${what} to ${to}.`;

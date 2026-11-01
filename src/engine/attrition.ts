import { attackerPool, crossable, defendersAt, isEnemy, isGroundCombatUnit, neighborIds } from "./attack-rules";
import { angloFrenchStopProblem } from "./anglo-french";
import { attritionColumn } from "./combat";
import { combatOf } from "./combat-record";
import type { GameContext } from "./context";
import { controllingSide } from "./control";
import { FRONTS, frontOptionOf } from "./frontoptions";
import { occupiedOptionProblem } from "./france-occupied";
import { otherSide } from "./game";
import { hex, hexsideId, type HexId } from "./hex";
import type { Front } from "./map";
import { sideOfOwner } from "./setup";
import { wasCutOff } from "./supply-effects";
import { MINOR_COUNTRY_FORCES } from "./tables";
import { NO_ATTRITION_OCCUPATION } from "./terrain";
import type { GameState, Unit } from "./types";

/** Existing table lookup, without a second table (Ref 12.4; spec 16 R3). */
export const attritionColumnOf = attritionColumn;
const ordered = (units: Unit[]): Unit[] => units.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const arrow = (ctx: GameContext, from: HexId, to: HexId): boolean => ctx.map.hexsides[hexsideId(hex(from), hex(to))]?.crossingArrow === true;
const contact = (ctx: GameContext, state: GameState, u: Unit, front: Front): boolean =>
  neighborIds(ctx, u.at).some((to) => ctx.map.hexes[to]?.front === front && crossable(ctx, u.at, to) && defendersAt(state, [u], to).length > 0);

/** A screen's reason for excluding one unit (Ref 12.4, 22.0; spec 16 R2; AER2/AER3/AER8). */
export function attritionParticipantProblem(ctx: GameContext, state: GameState, unit: Unit, front: Front, used: readonly string[] = []): string | null {
  if (unit.type === "replacement") return "Replacements do not take part in Attrition.";
  const banned = unit.owner === "france" ? occupiedOptionProblem(state, "france", front, "attrition", ctx) : null; // spec 14 R5 (Ref 18.3)
  if (banned) return banned;
  if (used.includes(unit.id) || combatOf(state).attacked.includes(unit.id)) return "This unit has already been used in combat this Player Turn.";
  if (!attackerPool(ctx, state, state.activeSide, []).some((u) => u.id === unit.id)) return "Only ground units of the Phasing side in play may take part.";
  return contact(ctx, state, unit, front) ? null : "This unit has no land contact with an enemy ground unit on this Front.";
}

/** Printed factors, once per eligible unit, on the enemy hex's Front (Ref 12.4, 19.4, 22.0; spec 16 R2). TODO(verify): AER1/AER2/AER3/AER8. */
export function attritionParticipants(ctx: GameContext, state: GameState, front: Front, used: readonly string[] = []): { units: Unit[]; factors: number } {
  const unavailable = [...combatOf(state).attacked, ...used];
  const units = ordered(attackerPool(ctx, state, state.activeSide, unavailable).filter((u) => u.type !== "replacement"
    && !(u.owner === "france" && occupiedOptionProblem(state, "france", front, "attrition", ctx) !== null)
    && contact(ctx, state, u, front)));
  return { units, factors: units.reduce((sum, u) => sum + u.strength, 0) };
}

/** Unresolved Fronts with an Attrition Option and a participant (Ref 11.52, 12.4; spec 16 R1/R2; AER9). The future run record supplies `done`. */
export function attritionFronts(ctx: GameContext, state: GameState, done: readonly Front[] = []): Front[] {
  return FRONTS.filter((front) => !done.includes(front) && frontOptionOf(state, front) === "attrition" && attritionParticipants(ctx, state, front).units.length > 0);
}

/** Enemy ground units anywhere on the Front, including Replacements (Ref 12.4, 22.0; spec 16 R4). TODO(verify): AER4, not just contact units. */
export function lossCandidates(ctx: GameContext, state: GameState, front: Front, participants: readonly Unit[]): Unit[] {
  return ordered(Object.values(state.units).filter((u) => isGroundCombatUnit(u) && sideOfOwner(u.owner) === otherSide(state.activeSide)
    && ctx.map.hexes[u.at]?.front === front && participants.some((p) => isEnemy(state, p.owner, u.owner))));
}

/** Validate a loss choice without eliminating anything (Ref 12.4; spec 16 R4; TODO(verify) AER5, fewer candidates means all). */
export function attritionLossProblem(ctx: GameContext, state: GameState, front: Front, participants: readonly Unit[], mustLose: number, chosen: readonly string[]): string | null {
  if (!Number.isInteger(mustLose) || mustLose < 0) return "Attrition losses must be a non-negative whole number.";
  const candidates = lossCandidates(ctx, state, front, participants);
  if (chosen.some((id) => !candidates.some((u) => u.id === id))) return "Only eligible enemy ground units on this Front may be taken as Attrition losses.";
  const count = Math.min(mustLose, candidates.length);
  return chosen.length !== count || new Set(chosen).size !== count ? `Choose exactly ${count} distinct Attrition loss units.` : null;
}

/** Why a participant cannot occupy the emptied hex (Ref 12.4, 19.4, 22.0; spec 16 R7). Stacking is the caller's job. */
export function occupationProblem(ctx: GameContext, state: GameState, unit: Unit, to: HexId): string | null {
  const u = state.units[unit.id];
  if (!u || !isGroundCombatUnit(u) || u.type === "replacement") return "Only surviving participating infantry, armor or airborne may occupy.";
  if (!ctx.map.hexes[u.at] || !ctx.map.hexes[to] || !crossable(ctx, u.at, to)) return "An occupier must be next to the hex across a land hexside.";
  if (arrow(ctx, u.at, to)) return "Attrition occupation cannot cross a Crossing Arrow.";
  if (wasCutOff(state, u.id)) return `${u.id} was cut off at the start of the Player Turn and cannot occupy.`;
  const stop = angloFrenchStopProblem(ctx, state, u.owner, to);
  if (stop) return stop;
  const minor = Object.hasOwn(MINOR_COUNTRY_FORCES, u.owner) && !state.minorAllies.some((m) => m.owner === u.owner && m.active);
  if (minor && ctx.map.hexes[to]?.country !== u.owner) return "An attacked minor country's unit cannot occupy outside its own country.";
  return null;
}

/** Eligible participants at their CURRENT positions; no stacking check or state change (Ref 12.4; spec 16 R7). */
export function occupiersOf(ctx: GameContext, state: GameState, to: HexId, participants: readonly Unit[]): Unit[] {
  return ordered(participants.filter((u, i) => participants.findIndex((p) => p.id === u.id) === i && occupationProblem(ctx, state, u, to) === null).map((u) => state.units[u.id]!));
}

/** Eligibility is re-read after every loss/retreat/occupation; no run state is kept here (Ref 12.4, 4.7, 4.8; spec 16 R5; AER3/AER7/AER11). */
export function attritionHexProblem(ctx: GameContext, state: GameState, front: Front, to: HexId, participants: readonly Unit[]): string | null {
  const h = ctx.map.hexes[to];
  if (!h) return "That is not a hex on the map.";
  if (defendersAt(state, participants, to).length === 0) return "The hex holds no enemy ground unit now.";
  if (h.front !== front) return "The hex is not on the Attritioned Front.";
  if (to !== "O25" && h.features.some((f) => NO_ATTRITION_OCCUPATION.includes(f))) return "A capital or Objective cannot be taken by Attrition.";
  if (state.fortresses[to] === true) return "A fortress cannot be taken by Attrition.";
  if (Object.values(state.units).some((u) => u.at === to && u.type === "bridgehead")) return "A bridgehead cannot be taken by Attrition.";
  if (!participants.some((p) => state.units[p.id] && crossable(ctx, state.units[p.id]!.at, to) && !arrow(ctx, state.units[p.id]!.at, to))) return "The hex can only be reached across a Crossing Arrow or has no land contact.";
  if (occupiersOf(ctx, state, to, participants).length === 0) return "No eligible participant can occupy the hex.";
  return null;
}

/** Every neighbouring enemy-controlled/occupied hex and its refusal, or null when selectable (Ref 12.4; spec 16 R5). */
export function selectableHexes(ctx: GameContext, state: GameState, front: Front, participants: readonly Unit[]): Map<HexId, string | null> {
  const current = participants.flatMap((u) => state.units[u.id] ? [state.units[u.id]!] : []);
  const near = new Set(current.flatMap((u) => neighborIds(ctx, u.at)));
  return new Map([...near].sort().filter((to) => controllingSide(ctx, state, to) === otherSide(state.activeSide)
    || Object.values(state.units).some((u) => u.at === to && current.some((p) => isEnemy(state, p.owner, u.owner))))
    .map((to) => [to, attritionHexProblem(ctx, state, front, to, current)]));
}

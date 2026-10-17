import type { Action } from "../engine/actions";
import { airbasePlacements } from "../engine/air-actions";
import { powersWithReserve } from "../engine/air-work";
import { turnKey } from "../engine/combat-record";
import type { MapHex } from "../engine/map";
import { POWER_NAMES } from "../engine/nations";
import type { GameState, PowerId } from "../engine/types";
import { airMoveCard, airMoveTargets, baseHexes, defaultPlaneTicks, planesAt, type AirMoveCard } from "./airMove";
import * as T from "./airMoveText";
import { movesNow } from "./moveTap";
import { noteMove } from "./moveUndo";
import { placeName, stackSummary, unitsWithIds } from "./names";
import { run, type Session } from "./session";
import { atStep6f } from "./step6f";

/**
 * The tap flow of planes and airbases at step 6f (spec 09, part D1): tap a base with planes (on the map, or its row in the list) and the planes card
 * opens with the planes that can still change base ticked; the yellow hexes are the bases they can go to together; a tap on one (or its row) changes
 * their base through the engine's STAGE_AIR, Split and Join through SPLIT_AIR and COMBINE_AIR. "Airbases" places one of the three movable airbases
 * through PLACE_AIRBASE. The choice lives in `Session.airMove` / `Session.airbase`, is dropped when the step or the turn changes and is never part of the
 * game. No rule here: every list and every refusal comes from the engine (`air-stage.ts`, `air-actions.ts`, `air-units.ts`).
 */

/** The planes chosen at a base. */
export interface AirMoveChoice {
  hex: string;
  /** The ids of the planes ticked. */
  ticked: string[];
  /** The Player Turn the choice was made in (`turnKey`): a choice never outlives it. */
  turn: string;
  /** Just chosen: the card's heading takes the keyboard focus on the next draw, once. */
  fresh: boolean;
  /** Chosen from the list, where the hex may be off the visible map: the map moves to show it, once. */
  focus: boolean;
  /** The pale ring of the 4-hex mission range is shown. */
  range: boolean;
}

/** An airbase being placed: the Major Power whose airbase it is. The hexes it may go to are asked of the engine for the position (`placementsOf`). */
export interface AirbasePick {
  owner: PowerId;
  turn: string;
  fresh: boolean;
}

export { atStep6f };

/** The card of the open choice, or null. Computed once per state and set of ticks. */
let cached: { state: GameState; hex: string; key: string; card: AirMoveCard } | null = null;
export function airMoveNow(s: Session): AirMoveCard | null {
  const c = s.airMove;
  if (!c || !atStep6f(s)) return null;
  const key = c.ticked.join(",");
  if (cached && cached.state === s.state && cached.hex === c.hex && cached.key === key) return cached.card;
  const card = airMoveCard(s.ctx, s.state, c.hex, c.ticked);
  cached = { state: s.state, hex: c.hex, key, card };
  return card;
}

/** The hexes an airbase of `owner` may be placed in, worked out once for a position. */
let placed: { state: GameState; owner: PowerId; hexes: string[] } | null = null;
export function placementsOf(s: Session, owner: PowerId): string[] {
  if (placed && placed.state === s.state && placed.owner === owner) return placed.hexes;
  const hexes = airbasePlacements(s.ctx, s.state, owner).filter((h) => s.ctx.map.hexes[h]);
  placed = { state: s.state, owner, hexes };
  return hexes;
}

/** The Major Powers of the side to move that have an airbase left and a place to put it. */
export const airbaseOwners = (s: Session): PowerId[] => powersWithReserve(s.state).filter((p) => placementsOf(s, p).length > 0);

/** The yellow hexes of the open choice: the bases the planes can go to, or the places an airbase can go. */
export function airYellow(s: Session): string[] {
  if (s.airbase && atStep6f(s)) return placementsOf(s, s.airbase.owner);
  const card = airMoveNow(s);
  return card ? airMoveTargets(card) : [];
}

/** Keeps the choices honest after any change: they go when it is not the player's step 6f, the Player Turn changed or nothing is left to choose. */
export function normaliseAirMove(s: Session): void {
  const turn = turnKey(s.state);
  if (s.airMove && (!atStep6f(s) || s.airMove.turn !== turn || planesAt(s.state, s.airMove.hex).length === 0)) s.airMove = null;
  if (s.airMove) {
    const ids = planesAt(s.state, s.airMove.hex).map((u) => u.id);
    if (!s.airMove.ticked.every((id) => ids.includes(id))) s.airMove = { ...s.airMove, ticked: s.airMove.ticked.filter((id) => ids.includes(id)) };
  }
  if (s.airbase && (!atStep6f(s) || s.airbase.turn !== turn || placementsOf(s, s.airbase.owner).length === 0)) s.airbase = null;
}

/** Chooses the planes of `hex`, the ones that can still change base ticked. False, and no change, when the side has no plane there or it is not step 6f. */
export function chooseBase(s: Session, hex: string, fromList = false): boolean {
  if (!atStep6f(s) || planesAt(s.state, hex).length === 0) return false;
  s.toast = "";
  s.moveChosen = null;
  s.airbase = null;
  s.airMove = { hex, ticked: defaultPlaneTicks(s.state, hex), turn: turnKey(s.state), fresh: true, focus: fromList, range: s.airMove?.hex === hex ? s.airMove.range : false };
  return true;
}

/** A plane line: ticked if free, free if ticked. */
export function togglePlane(s: Session, id: string): void {
  const c = s.airMove;
  if (!c || !planesAt(s.state, c.hex).some((u) => u.id === id)) return;
  s.toast = "";
  s.airMove = { ...c, fresh: false, focus: false, ticked: c.ticked.includes(id) ? c.ticked.filter((t) => t !== id) : [...c.ticked, id] };
}

export function tickAllPlanes(s: Session): void {
  if (s.airMove) s.airMove = { ...s.airMove, fresh: false, focus: false, ticked: planesAt(s.state, s.airMove.hex).map((u) => u.id) };
}

export function tickNoPlanes(s: Session): void {
  if (s.airMove) s.airMove = { ...s.airMove, fresh: false, focus: false, ticked: [] };
}

export function toggleRange(s: Session): void {
  if (s.airMove) s.airMove = { ...s.airMove, fresh: false, focus: false, range: !s.airMove.range };
}

/** "Cancel", Escape, or a tap on the chosen base again: the choice is thrown away and nothing has changed in the game. */
export function cancelAirMove(s: Session): void {
  s.toast = "";
  s.airMove = null;
  s.airbase = null;
}

/** Runs one air action of the player's step 6f and notes it for "Take back last move". False when the engine refused. */
function runNoted(s: Session, action: Extract<Action, { type: "STAGE_AIR" | "SPLIT_AIR" | "COMBINE_AIR" | "PLACE_AIRBASE" }>, line: string): boolean {
  const [before, logLen] = [s.state, s.log.length];
  if (!run(s, action)) return false;
  noteMove(s, before, logLen, action, line);
  return true;
}

/** The ticked planes change base to `to`, if it is one of the yellow hexes; the engine has the last word. */
export function stageTo(s: Session, to: string): void {
  const c = s.airMove;
  const card = airMoveNow(s);
  if (!c || !card) return;
  if (card.ticked.length === 0) s.toast = T.NOTHING_TICKED;
  else if (!airMoveTargets(card).includes(to)) s.toast = card.blocked.find((b) => b.hex === to)?.reason ?? (baseHexes(s.ctx, s.state).includes(to) ? T.CHOOSE_BASE : T.notABase(placeName(s.ctx.map, to)));
  else {
    const line = T.stagedLine(stackSummary(unitsWithIds(s.state, card.ticked)), placeName(s.ctx.map, c.hex), placeName(s.ctx.map, to));
    if (!runNoted(s, { type: "STAGE_AIR", side: s.state.activeSide, units: card.ticked, to }, line)) return;
    s.airMove = null;
    s.toast = line;
  }
}

/** Splits the one ticked plane into the parts; the card stays open on the same base with the parts ticked. */
export function splitPlane(s: Session, parts: readonly number[]): void {
  const c = s.airMove;
  if (!c || c.ticked.length !== 1) return;
  const unit = s.state.units[c.ticked[0]!]!;
  const line = `${stackSummary([unit])} at ${placeName(s.ctx.map, c.hex)} split into ${parts.join(" + ")} air factors.`;
  if (!runNoted(s, { type: "SPLIT_AIR", side: s.state.activeSide, unit: unit.id, parts: [...parts] }, line)) return;
  s.airMove = { ...c, fresh: false, focus: false, ticked: defaultPlaneTicks(s.state, c.hex) };
  s.toast = line;
}

/** Joins the ticked planes into one counter; the card stays open on the same base with the new plane ticked. */
export function joinPlanes(s: Session): void {
  const c = s.airMove;
  const card = airMoveNow(s);
  if (!c || !card?.join) return;
  const line = `${stackSummary(unitsWithIds(s.state, card.ticked))} at ${placeName(s.ctx.map, c.hex)} joined into one ${card.join.total}.`;
  if (!runNoted(s, { type: "COMBINE_AIR", side: s.state.activeSide, units: card.ticked }, line)) return;
  s.airMove = { ...c, fresh: false, focus: false, ticked: defaultPlaneTicks(s.state, c.hex) };
  s.toast = line;
}

/** Starts placing an airbase of `owner`: its places are outlined on the map. False, and a toast, when it has none to place or nowhere to put it. */
export function openPlacement(s: Session, owner: PowerId): boolean {
  if (!atStep6f(s) || !powersWithReserve(s.state).includes(owner)) return false;
  s.toast = "";
  if (placementsOf(s, owner).length === 0) {
    s.toast = T.NO_PLACE;
    return false;
  }
  s.moveChosen = null;
  s.airMove = null;
  s.airbase = { owner, turn: turnKey(s.state), fresh: true };
  return true;
}

/** The airbase goes to `at`, through PLACE_AIRBASE. */
export function placeAt(s: Session, at: string): void {
  const pick = s.airbase;
  if (!pick) return;
  if (!placementsOf(s, pick.owner).includes(at)) {
    s.toast = T.NOT_A_PLACE;
    return;
  }
  const line = T.placedLine(POWER_NAMES[pick.owner], placeName(s.ctx.map, at));
  if (!runNoted(s, { type: "PLACE_AIRBASE", owner: pick.owner, at }, line)) return;
  s.airbase = null;
  s.toast = line;
}

/** Whether the hex holds a stack of ground units that can move now (the ground flow keeps a tap on it). */
const groundStackAt = (s: Session, hex: string): boolean => movesNow(s).some((m) => s.state.units[m.units[0]!]?.at === hex);

/**
 * A tap at step 6f that belongs to the air flow. While an airbase is being placed a tap places it; while planes are chosen a yellow hex changes
 * their base (a base they cannot use says why), the same base lets them go, another base with planes chooses those. With nothing chosen, a base with
 * planes and no movable ground stack chooses its planes. Returns false when the tap is the ground flow's (or not step 6f).
 */
export function tapToAirMove(s: Session, h: MapHex): boolean {
  if (!atStep6f(s)) return false;
  if (s.airbase) {
    placeAt(s, h.id);
    return true;
  }
  if (s.airMove) {
    if (s.airMove.hex === h.id) cancelAirMove(s);
    else if (groundStackAt(s, h.id) && !airYellow(s).includes(h.id)) return false;
    else if (!airYellow(s).includes(h.id) && planesAt(s.state, h.id).length > 0) chooseBase(s, h.id);
    else stageTo(s, h.id);
    return true;
  }
  if (s.moveChosen || groundStackAt(s, h.id) || planesAt(s.state, h.id).length === 0) return false;
  return chooseBase(s, h.id);
}

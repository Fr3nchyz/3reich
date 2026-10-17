import { commitCap, designateProblem, groundSupportTargets } from "../engine/air-missions";
import { flownOf } from "../engine/air-record";
import { committedAt } from "../engine/air-support";
import { MISSION_RANGE } from "../engine/air-rules";
import { flightDistances, missionHexes } from "../engine/air-range";
import type { GameContext } from "../engine/context";
import { sideInWar } from "../engine/control";
import type { GameState, Unit } from "../engine/types";
import * as T from "./airText";
import { placeName, unitName } from "./names";

/**
 * The air-support card of step 7b (spec 09, part D2) as plain data: the planes that can reach a hex, which of them are chosen, what the cap leaves
 * room for and what the button says. A pure function of the context, the state, the hex and the ids chosen: no DOM, no dice and no rule of its own.
 * Who may fly, the range and the cap all come from the engine's `designateProblem`; the sentences here only say it in words.
 */

export interface AirChip {
  id: string;
  /** "3-4 German air". */
  name: string;
  /** "Poznan (M33)". */
  from: string;
  /** "3 hexes away". */
  distance: string;
  strength: number;
  /** "committed": already flying to this hex (shown, cannot be taken out). */
  state: "chosen" | "free" | "greyed" | "committed";
  /** Why a greyed plane cannot be added; null otherwise. */
  reason: string | null;
}

export interface AirPick {
  target: string;
  targetName: string;
  chips: AirChip[];
  /** Air factors already committed to the hex. */
  committed: number;
  /** Air factors chosen now (not yet committed). */
  chosen: number;
  /** The most air factors the hex can take in all. */
  cap: number;
  /** The planes in range that have not flown and are not committed here (whatever the cap leaves room for). */
  available: { planes: number; factors: number };
  button: { text: string; disabled: boolean };
}

/** Air units of the side to move on the map that can reach the hex in a mission, in id order (flown or not). */
function planesInRange(ctx: GameContext, state: GameState, target: string): Unit[] {
  return Object.values(state.units)
    .filter((u) => u.type === "air" && sideInWar(state, u.owner) === state.activeSide && Object.hasOwn(ctx.map.hexes, u.at) && missionHexes(ctx, state, u.owner, u.at).includes(target))
    .sort((a, b) => Number(a.id.replace(/\D/g, "")) - Number(b.id.replace(/\D/g, "")));
}

/** The picture of the card for `target`, or null when the hex is not one ground support can go to now. */
export function airPick(ctx: GameContext, state: GameState, target: string, chosenIds: readonly string[]): AirPick | null {
  const targets = groundSupportTargets(ctx, state);
  const ground = targets.get(target);
  if (!ground) return null;
  const cap = commitCap(ground);
  const committed = committedAt(state, target);
  const flown = flownOf(state).units;
  const chosen = planesInRange(ctx, state, target).filter((u) => chosenIds.includes(u.id) && !committed.includes(u) && designateProblem(ctx, state, [u], target, targets) === null);
  const chip = (u: Unit, st: AirChip["state"], reason: string | null): AirChip => ({
    id: u.id,
    name: unitName(u),
    from: placeName(ctx.map, u.at),
    distance: T.hexesAway(flightDistances(ctx, state, u.owner, u.at, MISSION_RANGE).get(target) ?? 0),
    strength: u.strength,
    state: st,
    reason,
  });
  const have = committed.reduce((n, u) => n + u.strength, 0);
  const add = chosen.reduce((n, u) => n + u.strength, 0);
  const chips: AirChip[] = committed.map((u) => chip(u, "committed", null));
  for (const u of planesInRange(ctx, state, target)) {
    if (committed.includes(u)) continue;
    if (chosen.includes(u)) chips.push(chip(u, "chosen", null));
    else if (Object.hasOwn(flown, u.id)) chips.push(chip(u, "greyed", flown[u.id] === "new" ? T.REASON_NEW : T.REASON_FLOWN));
    else if (designateProblem(ctx, state, [...chosen, u], target, targets) !== null) chips.push(chip(u, "greyed", have + add + u.strength > cap ? T.reasonOverCap(cap) : T.REASON_OTHER));
    else chips.push(chip(u, "free", null));
  }
  const place = placeName(ctx.map, target);
  const bad = chosen.length > 0 && designateProblem(ctx, state, chosen, target, targets) !== null;
  const button = chosen.length === 0 || bad ? { text: T.NOTHING_CHOSEN, disabled: true } : { text: T.commitButton(chosen.length, add, place), disabled: false };
  const open = planesInRange(ctx, state, target).filter((u) => !committed.includes(u) && !Object.hasOwn(flown, u.id));
  return { target, targetName: place, chips, committed: have, chosen: add, cap, available: { planes: open.length, factors: open.reduce((n, u) => n + u.strength, 0) }, button };
}

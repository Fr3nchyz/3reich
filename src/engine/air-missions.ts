import { attackables } from "./attack";
import { airOf, hasFlown, markFlown } from "./air-record";
import { clearGroundSupport, committedAt } from "./air-support";
import { GS_CAP_MULTIPLE, AIR_MISSIONS_ENABLED } from "./air-rules";
import { missionHexes } from "./air-range";
import type { Action, ActionResult, GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { sideInWar } from "./control";
import type { HexId } from "./hex";
import type { GameState, Unit } from "./types";

/**
 * Ground Support (spec 09 R8; Ref 20.41, Ops 5.46b): at step 7b the side to move commits air units within 4 hexes of a hex it will attack; their factors are
 * added to the attackers' (`attackNumbers` reads the record), at most three times the ground factors. The hex must then be attacked, or the committed air is
 * eliminated when step 7h ends (`loseUnusedGroundSupport`). A unit flies one mission a Game Turn and a unit built this Game Turn flies none (`air-record.ts`).
 */

type Designate = Extract<Action, { type: "DESIGNATE_AIR" }>;

/** No list of units is longer than this: a bound before any loop runs over it. */
const MAX_UNITS = 100;

/** The enemy hexes the side to move could attack now, each with the ground units that could attack it (what `attackables` lists at step 7h). */
export function groundSupportTargets(ctx: GameContext, state: GameState): Map<HexId, Unit[]> {
  return attackables(ctx, state);
}

/** The side's air units that have not flown this Game Turn, on the map, in id order. */
export function freeAir(ctx: GameContext, state: GameState): Unit[] {
  return Object.values(state.units)
    .filter((u) => u.type === "air" && sideInWar(state, u.owner) === state.activeSide && Object.hasOwn(ctx.map.hexes, u.at) && !hasFlown(state, u.id))
    .sort((a, b) => Number(a.id.replace(/\D/g, "")) - Number(b.id.replace(/\D/g, "")));
}

/** The free air units that can reach the hex in a mission (within 4 hexes, a route that avoids neutral land). */
export const airInRangeOf = (ctx: GameContext, state: GameState, target: HexId): Unit[] =>
  freeAir(ctx, state).filter((u) => missionHexes(ctx, state, u.owner, u.at).includes(target));

/** The most air factors that may be committed at the hex: three times every ground factor that could attack it (the exact cap is applied at step 7h, R8 option a). */
const commitCap = (ground: readonly Unit[]): number => GS_CAP_MULTIPLE * ground.reduce((n, u) => n + u.strength, 0);

/** Whether step 7b has anything to wait for: some designation is possible (a free air unit within reach of a hex that can be attacked, and room under the cap). */
export const hasAirWork = (ctx: GameContext, state: GameState): boolean => designations(ctx, state).length > 0;

/** The first reason these air units may not all be committed to ground support at `target`, or null. */
export function designateProblem(ctx: GameContext, state: GameState, units: readonly Unit[], target: HexId, targets: ReadonlyMap<HexId, Unit[]> = groundSupportTargets(ctx, state)): string | null {
  const ground = targets.get(target);
  if (!ground) return `${target} is not a hex the ${state.activeSide} side can attack now.`;
  for (const u of units) {
    if (u.type !== "air") return `${u.id} is not an air unit.`;
    if (sideInWar(state, u.owner) !== state.activeSide) return `${u.id} does not belong to the ${state.activeSide} side now.`;
    if (hasFlown(state, u.id)) return `${u.id} has already flown a mission this Game Turn, or was built in it.`;
    if (!Object.hasOwn(ctx.map.hexes, u.at) || !missionHexes(ctx, state, u.owner, u.at).includes(target)) return `${u.id} at ${u.at} cannot reach ${target}: a mission flies at most 4 hexes and not over neutral land.`;
  }
  const have = committedAt(state, target).reduce((n, u) => n + u.strength, 0);
  const add = units.reduce((n, u) => n + u.strength, 0);
  const cap = commitCap(ground);
  if (have + add > cap) return `${target} can take at most ${cap} air factors of ground support (three times the ground factors that could attack it); ${have} are committed and these add ${add}.`;
  return null;
}

/** True for a real array of strings (a hole in a sparse array is refused). */
function allStrings(x: unknown): x is string[] {
  if (!Array.isArray(x) || x.length > MAX_UNITS) return false;
  for (let i = 0; i < x.length; i++) if (typeof x[i] !== "string") return false;
  return true;
}

/** Commits the air units to ground support at the target: they have flown their mission, and the hex must now be attacked. */
export function applyDesignate(ctx: GameContext, state: GameState, action: Designate): ActionResult {
  if (action.side !== state.activeSide) return { ok: false, error: `It is the ${state.activeSide} player turn, not ${String(action.side)}.` };
  if (action.mission !== "ground-support") return { ok: false, error: "Only the ground-support mission is built." };
  if (typeof action.target !== "string" || !Object.hasOwn(ctx.map.hexes, action.target)) return { ok: false, error: "A mission names a hex on the map to support." };
  const ids = action.units;
  if (!allStrings(ids) || ids.length === 0 || new Set(ids).size !== ids.length) return { ok: false, error: "A mission names one or more distinct air units." };
  if (ids.some((id) => !Object.hasOwn(state.units, id))) return { ok: false, error: "An air unit to commit is not on the map." };
  const units = ids.map((id) => state.units[id]!);
  const problem = designateProblem(ctx, state, units, action.target);
  if (problem) return { ok: false, error: problem };
  const rec = airOf(state);
  const flown = markFlown(state, ids, "ground-support");
  return {
    ok: true,
    state: { ...flown, air: { ...rec, groundSupport: { ...rec.groundSupport, [action.target]: [...committedAt(state, action.target).map((u) => u.id), ...ids] } } },
    events: [{ type: "AIR_MISSION_DESIGNATED", mission: "ground-support", units: [...ids], target: action.target }],
  };
}

/** The designations that could be made now: for each hex that can be attacked, every free air unit in range that fits under the cap, together (the first useful choice, as ATTACK lists the whole force). */
function designations(ctx: GameContext, state: GameState): Action[] {
  const targets = groundSupportTargets(ctx, state);
  if (targets.size === 0) return [];
  const out: Action[] = [];
  for (const target of [...targets.keys()].sort()) {
    const chosen: string[] = [];
    for (const u of airInRangeOf(ctx, state, target)) if (designateProblem(ctx, state, [...chosen, u.id].map((id) => state.units[id]!), target, targets) === null) chosen.push(u.id);
    if (chosen.length > 0) out.push({ type: "DESIGNATE_AIR", side: state.activeSide, mission: "ground-support", units: chosen, target });
  }
  return out;
}

/** The designations listed to the player at step 7b; nothing while the missions are switched off (`enabled` is for a test to ask as if they were on). */
export const legalDesignations = (ctx: GameContext, state: GameState, enabled: boolean = AIR_MISSIONS_ENABLED): Action[] => (enabled ? designations(ctx, state) : []);

/**
 * Step 7h is over: ground support committed to a hex that was not attacked is eliminated (Ref 20.41, R8: the committed units cannot be withdrawn;
 * "legal odds" is any attack the engine lists, `TODO(verify)`).
 */
export function loseUnusedGroundSupport(state: GameState): { state: GameState; events: GameEvent[] } {
  let next = state;
  const events: GameEvent[] = [];
  for (const hex of Object.keys(airOf(state).groundSupport).sort()) {
    const lost = committedAt(next, hex);
    if (lost.length > 0) {
      const units = { ...next.units };
      for (const u of lost) delete units[u.id];
      next = { ...next, units };
      events.push({ type: "GROUND_SUPPORT_LOST", hex, units: lost.map((u) => ({ id: u.id, owner: u.owner, strength: u.strength })) });
      for (const u of lost) events.push({ type: "UNIT_ELIMINATED", unitId: u.id, owner: u.owner, at: u.at });
    }
    next = clearGroundSupport(next, hex);
  }
  return { state: next, events };
}

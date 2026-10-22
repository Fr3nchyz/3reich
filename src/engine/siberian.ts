import { availableBuilds } from "./construction";
import { controllerOf } from "./control";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import { isGone } from "./nations";
import { stackingProblem, type UnitSpec } from "./placement";
import { supplyNetwork } from "./supply";
import { specialNets } from "./supply-sources";
import { AIR_BASE_FEATURES } from "./terrain";
import type { ForceEntry, GameState } from "./types";
import { turnKey } from "./victory";
import { RUSSIA_COUNTRY } from "./winter-record";

/**
 * The Free Siberian Transfer (spec 14 R11, ticket 14-18; Ref 11.63, Ops 5.47a), step 8a of the Allied Player Turn. In four Game Turns the Allies may take ground units from the
 * Russian Force Pool at no BRP cost and place them in Russian cities: four in Winter 1941, then three, two and one. Units not taken in a Game Turn are lost. Only infantry and
 * armor (airborne never), and the armor taken in a Game Turn may not outnumber the infantry taken in it. The first unit taken switches the victory tables for good
 * (`GameState.siberian.used`, read by `evaluateVictory`). One unit per action, like a build. The queries are here; the action (`SIBERIAN_TRANSFER`) is in victory-actions.ts.
 */

/** The units the Allies may take, by Game Turn (Ref 11.63, R11). A Game Turn that is not listed has no Transfer; the 1944 scenario starts after the last, so it is exempt without a rule of its own. */
export const SIBERIAN_QUOTAS: Readonly<Record<string, number>> = { "1941-winter": 4, "1942-spring": 3, "1942-summer": 2, "1942-fall": 1 };

/** The kinds of counter that may be taken: ground units that are not airborne (R11). TODO(verify) V58: a replacement is not taken. */
export const TAKEN_TYPES: readonly ForceEntry["type"][] = ["infantry", "armor"];

const byHex = (a: HexId, b: HexId): number => (a < b ? -1 : a > b ? 1 : 0);

/** The units taken so far in the Game Turn now being played, by kind. */
export function siberianTakenNow(state: GameState): { infantry: number; armor: number } {
  const key = turnKey(state);
  const all = state.siberian?.taken[key] ?? 0;
  const armor = state.siberian?.armor?.[key] ?? 0;
  return { infantry: all - armor, armor };
}

/** The units the Allies may still take in the Game Turn now being played: its quota less what was taken. 0 when this Game Turn has no Transfer. */
export function siberianLeft(state: GameState): number {
  return Math.max(0, (SIBERIAN_QUOTAS[turnKey(state)] ?? 0) - (state.siberian?.taken[turnKey(state)] ?? 0));
}

/**
 * TODO(verify) V58: the Russian Force Pool is read as the U.S.S.R.'s Allowable Builds (the counters it may still construct: everything else of its Force Pool is on the map after
 * the opening setup), only infantry and armor, only those whose "in or after" date has come. Taking a unit uses up one of that entry, as building it would.
 */
export function siberianPool(state: GameState): ForceEntry[] {
  return availableBuilds(state, "ussr").filter((e) => TAKEN_TYPES.includes(e.type));
}

/** Whether the Transfer is open to the side to move now: the Allied Player Turn, the U.S.S.R. still in the game, and units left in this Game Turn's quota. */
const open = (state: GameState): boolean => !!state.nations.ussr && state.phase === "player-turn" && state.activeSide === "allies" && !isGone(state.nations.ussr) && siberianLeft(state) > 0;

/**
 * Which pool entries may be taken now: those of the pool (V58) that the armor rule allows. R11: the armor taken may not outnumber the infantry taken, tested after every unit
 * (TODO(verify) V60), so an armor counter can be taken only once at least as many infantry have been.
 */
export function siberianOptions(state: GameState): { left: number; entries: ForceEntry[] } {
  if (!open(state)) return { left: 0, entries: [] };
  const { infantry, armor } = siberianTakenNow(state);
  return { left: siberianLeft(state), entries: siberianPool(state).filter((e) => e.type === "infantry" || armor + 1 <= infantry) };
}

/** Whether a hex is a city (every kind the rules call a base: Ref 4.7, so cities, ports, capitals and Objectives) of the map country "ussr". */
const isRussianCity = (ctx: GameContext, h: HexId): boolean => {
  const hx = ctx.map.hexes[h];
  return !!hx && !!hx.land && hx.country === RUSSIA_COUNTRY && hx.features.some((f) => AIR_BASE_FEATURES.includes(f));
};

/**
 * The Russian cities where a unit may appear now, in hex order: held by the U.S.S.R. and joined to the east edge of the map by a supply line (the east-edge source of
 * supply-sources.ts: land the Allies control with no enemy ground unit, Ref 19.2, 19.3). TODO(verify) V59: no test of an enemy Zone of Control on the city itself, no
 * separate test that Russia is at war (a neutral Russia holds no supply line, so nothing qualifies); stacking is checked per counter (`siberianPlaces`).
 */
export function siberianCities(ctx: GameContext, state: GameState): HexId[] {
  const edge = specialNets(ctx, state, "allies").find((n) => n.id === "soviet-edge");
  if (!edge) return [];
  const reached = supplyNetwork(ctx, state, "allies").reachFrom(edge.sources);
  return [...reached.keys()].filter((h) => isRussianCity(ctx, h) && controllerOf(ctx, state, h) === "ussr").sort(byHex);
}

/** The cities this counter fits in (the stacking limit of Ref 5.0 is the engine's own, `stackingProblem`). */
export const siberianPlaces = (ctx: GameContext, state: GameState, cities: readonly HexId[], spec: UnitSpec): HexId[] => cities.filter((h) => stackingProblem(ctx, state, "ussr", spec, h) === null);

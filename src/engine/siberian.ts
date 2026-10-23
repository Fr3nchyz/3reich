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
export const SIBERIAN_QUOTAS: Readonly<Record<string, number>> = { "1941-winter": 4, "1942-spring": 3, "1942-summer": 2, "1942-fall": 1 }; // TODO(verify) V26: the quotas (the manual: four, then three, two and one) apply in the Allied Player Turn of those Game Turns, once each, with no carry-over

/** The kinds of counter that may be taken: ground units that are not airborne (R11). */
export const TAKEN_TYPES: readonly ForceEntry["type"][] = ["infantry", "armor"]; // TODO(verify) V58: "non-airborne ground units" is read as infantry and armor; a replacement counter is not taken

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
 * The Russian Force Pool (Ref 11.63; Ops 5.47b builds from the same pool): the U.S.S.R.'s Allowable Builds that are infantry or armor and whose
 * "in or after" date has come. Taking a unit uses up one of that entry, as building it would. The rest of the Force Pool is on the map after the opening setup;
 * a Russian unit eliminated comes back to the Allowable Builds as a `returned` entry (losses.ts, spec 17 R1) and may be taken like any other (TODO(verify) RB12).
 * When a returned and a new counter of one kind are both there, the first entry of the list is taken: the scenario's, since returned entries come last.
 */
export function siberianPool(state: GameState): ForceEntry[] {
  return availableBuilds(state, "ussr").filter((e) => TAKEN_TYPES.includes(e.type)); // TODO(verify) V58, RB12: the Russian Force Pool is read as the U.S.S.R.'s Allowable Builds, which take back eliminated units since spec 17
}

/** Whether the Transfer is open to the side to move now: the Allied Player Turn, the U.S.S.R. still in the game, and units left in this Game Turn's quota. */
const open = (state: GameState): boolean => !!state.nations.ussr && state.phase === "player-turn" && state.activeSide === "allies" && !isGone(state.nations.ussr) && siberianLeft(state) > 0;

/**
 * Which pool entries may be taken now: those of the pool that the armor rule allows. R11: the armor taken may not outnumber the infantry taken, tested after every unit,
 * so an armor counter can be taken only once at least as many infantry have been.
 */
export function siberianOptions(state: GameState): { left: number; entries: ForceEntry[] } {
  if (!open(state)) return { left: 0, entries: [] };
  const { infantry, armor } = siberianTakenNow(state);
  return { left: siberianLeft(state), entries: siberianPool(state).filter((e) => e.type !== "armor" || armor + 1 <= infantry) }; // TODO(verify) V60: the armor rule is tested after every unit taken, so the infantry come first (the manual states it for the Game Turn as a whole)
}

/** Whether a hex is a city (every kind the rules call a base: Ref 4.7, so cities, ports, capitals and Objectives) of the map country "ussr". */
const isRussianCity = (ctx: GameContext, h: HexId): boolean => {
  const hx = ctx.map.hexes[h];
  return !!hx && !!hx.land && hx.country === RUSSIA_COUNTRY && hx.features.some((f) => AIR_BASE_FEATURES.includes(f));
};

/**
 * The Russian cities where a unit may appear now, in hex order: held by the U.S.S.R. and joined to the east edge of the map by a supply line (the east-edge source of
 * supply-sources.ts: land the Allies control with no enemy ground unit, Ref 19.2, 19.3); stacking is checked per counter (`siberianPlaces`).
 */
export function siberianCities(ctx: GameContext, state: GameState): HexId[] {
  const edge = specialNets(ctx, state, "allies").find((n) => n.id === "soviet-edge"); // TODO(verify) V59: "supply line to the east edge" is the existing east-edge source; an enemy Zone of Control on the city is not tested, and no separate test that Russia is at war (a neutral Russia holds no supply line, so nothing qualifies)
  if (!edge) return [];
  const reached = supplyNetwork(ctx, state, "allies").reachFrom(edge.sources);
  return [...reached.keys()].filter((h) => isRussianCity(ctx, h) && controllerOf(ctx, state, h) === "ussr").sort(byHex);
}

/** The cities this counter fits in (the stacking limit of Ref 5.0 is the engine's own, `stackingProblem`). */
export const siberianPlaces = (ctx: GameContext, state: GameState, cities: readonly HexId[], spec: UnitSpec): HexId[] => cities.filter((h) => stackingProblem(ctx, state, "ussr", spec, h) === null);

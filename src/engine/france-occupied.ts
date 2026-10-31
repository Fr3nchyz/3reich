import { territoryOf } from "./areas";
import { capitalOf } from "./capital";
import { isConquered } from "./conquest-record";
import type { GameContext } from "./context";
import { controllingSide } from "./control";
import { adjacent, hex, type HexId } from "./hex";
import type { Front } from "./map";
import type { ForceOwner, FrontOption, GameState, PowerId } from "./types";

// spec 14 R5 (Ref 18.3). TODO(verify) V63: the task's settled defaults.
export const V63_ADJACENT_INCLUDES_PARIS = true;
export const V63_FRANCE_LAND_ONLY = true;
export const V63_ODDS_ONE_TO_TWO = true;
export const V63_ONLY_FRANCE_LIMITED = true;

// spec 14 R5 (Ref 18.3): shared refusal texts for the future callers.
export const OCCUPIED_ATTACK_TARGET_TEXT = "France may attack only Paris and its adjacent hexes while Paris is Axis-held.";
export const OCCUPIED_ATTACK_ODDS_TEXT = "French attacks require odds of 1:2 or better while Paris is Axis-held.";
export const OCCUPIED_ATTACK_SUPPLY_TEXT = "French attackers must all be supplied while Paris is Axis-held.";
export const OCCUPIED_ATTRITION_TEXT = "France may not use the Attrition Option while Paris is Axis-held.";
export const OCCUPIED_OFFENSIVE_TEXT = "France may use the Offensive Option only on the Western Front while Paris is Axis-held.";
export const OCCUPIED_DECLARE_TEXT = "France may not declare war while Paris is Axis-held.";
export const OCCUPIED_MOVE_OUT_TEXT = "French units may not move out of France while Paris is Axis-held.";

/** spec 14 R5 (Ref 18.3): the interval before France's conquest, while the Axis holds Paris. */
export function franceOccupied(ctx: GameContext, state: GameState): boolean {
  const paris = capitalOf(ctx, "france");
  return paris !== null && !isConquered(state, "france") && controllingSide(ctx, state, paris) === "axis";
}

/** spec 14 R5 (Ref 18.3): only French attackers, near Paris, supplied and at least 1:2. */
export function occupiedAttackProblem(ctx: GameContext, state: GameState, owner: ForceOwner, target: HexId, odds: { attack: number; defense: number }, supplied: boolean): string | null {
  if ((V63_ONLY_FRANCE_LIMITED && owner !== "france") || !franceOccupied(ctx, state)) return null;
  const paris = capitalOf(ctx, "france")!;
  if (!(V63_ADJACENT_INCLUDES_PARIS && target === paris) && !adjacent(hex(paris), hex(target))) return OCCUPIED_ATTACK_TARGET_TEXT;
  if (odds.attack * (V63_ODDS_ONE_TO_TWO ? 2 : 1) < odds.defense) return OCCUPIED_ATTACK_ODDS_TEXT;
  if (!supplied) return OCCUPIED_ATTACK_SUPPLY_TEXT;
  return null;
}

/** spec 14 R5 (Ref 18.3): no French Attrition; Offensive only in the west. */
export function occupiedOptionProblem(state: GameState, owner: PowerId, front: Front, option: FrontOption, ctx: GameContext): string | null {
  if (owner !== "france" || !franceOccupied(ctx, state)) return null;
  if (option === "attrition") return OCCUPIED_ATTRITION_TEXT;
  if (option === "offensive" && front !== "western") return OCCUPIED_OFFENSIVE_TEXT;
  return null;
}

/** spec 14 R5 (Ref 18.3): France cannot declare war in this interval. */
export function occupiedDeclareProblem(ctx: GameContext, state: GameState, declarer: PowerId): string | null {
  return declarer === "france" && franceOccupied(ctx, state) ? OCCUPIED_DECLARE_TEXT : null;
}

/** spec 14 R5 (Ref 18.3): French moves must end inside France (V63: colonies excluded). */
export function occupiedMoveOutProblem(ctx: GameContext, state: GameState, owner: ForceOwner, to: HexId): string | null {
  if (owner !== "france" || !franceOccupied(ctx, state)) return null;
  const allowed = V63_FRANCE_LAND_ONLY ? ctx.map.hexes[to]?.country === "france" : territoryOf(ctx, "france").places.has(to);
  return allowed ? null : OCCUPIED_MOVE_OUT_TEXT;
}

/** spec 14 R5 (Ref 18.3): London is the sole French supply source during the interval. */
export function occupiedSupplySources(ctx: GameContext, state: GameState): HexId[] | null {
  return franceOccupied(ctx, state) ? [capitalOf(ctx, "britain")!] : null;
}

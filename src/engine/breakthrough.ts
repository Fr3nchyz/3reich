import type { Action, ActionResult, GameEvent } from "./action-types";
import { angloFrenchStopProblem } from "./anglo-french";
import { attackerPool } from "./attack-rules";
import { combatOf, turnKey, type AdvanceChance } from "./combat-record";
import type { GameContext } from "./context";
import { enterHexes } from "./control";
import { exploitOf, exploiterIds, type BreakthroughGroup } from "./exploit-record";
import { adjacent, hex, type HexId } from "./hex";
import { movesOf } from "./move-record";
import { sideOfOwner } from "./setup";
import { supplyStatus } from "./supply";
import { supplyEffectsOn } from "./supply-effects";
import type { GameState, Unit } from "./types";

/**
 * Breakthrough and the armor that moves in (Ref 12.31; Ops 5.46h; spec 16 R10, R11). A won attack whose attackers included an armor unit, followed by an
 * advance into the hex the defenders left, makes that hex a Breakthrough hex (`openBreakthrough`, called by the advance). Until step 7h is left, the
 * Phasing side may then place into it, free, any of its armor units that are in supply, have made no attack in this Combat Phase, and stood in or next to a
 * hex the attackers attacked from (PLACE_EXPLOITERS). The placed units are the exploiting units: they ignore the stacking limit in that hex, take no part
 * in ordinary combat and count as having moved (AER13). Leaving 7h lapses whatever was not placed (`lapseBreakthroughs`).
 *
 * TODO(verify) AER12: "includes at least one armor unit" is read as armor among the attackers, alive or not; "adjacent to or stacked with an attacker" is
 * measured from where the attackers stood when they attacked, by hex adjacency. TODO(verify) AER13: a placed unit counts as having moved.
 * Not here: Exploitation movement (16-10), Exploitation combat and its advance (16-11), the vacant-hex attack (16-14), the supply exemption (R14, 16-10).
 */

type PlaceAction = Extract<Action, { type: "PLACE_EXPLOITERS" }>;

/** Whether an advance into the chance's hex makes it a Breakthrough hex: the battle's attackers included armor (R10). An old chance has no mark and makes none. */
export const breakthroughAfter = (chance: AdvanceChance): boolean => chance.armor === true;

/** Whether `at` is one of the attackers' hexes or next to one (R11, AER12). */
const nearAttackers = (from: readonly HexId[], at: HexId): boolean => from.includes(at) || from.some((f) => adjacent(hex(f), hex(at)));

/** The units of the side that have attacked this Combat Phase or already exploit: neither may be placed (R11). */
const usedUp = (state: GameState): string[] => [...combatOf(state).attacked, ...exploiterIds(state)];

/** The ids of the side's ground units in supply now, or null when the supply effects are off and nothing is checked (R14, AER15; as for movement and advance). */
function suppliedNow(ctx: GameContext, state: GameState): ReadonlySet<string> | null {
  return supplyEffectsOn(ctx) ? new Set(supplyStatus(ctx, state, state.activeSide).supplied.map((l) => l.unitId)) : null;
}

/** Why this unit may not be placed into the group's hex now, or null (R11). `supplied` is `suppliedNow`. */
function placeProblem(ctx: GameContext, state: GameState, group: BreakthroughGroup, id: string, supplied: ReadonlySet<string> | null): string | null {
  const u: Unit | undefined = Object.hasOwn(state.units, id) ? state.units[id] : undefined;
  if (!u || !ctx.map.hexes[u.at]) return `${id} is not on the map.`;
  if (u.type !== "armor" || sideOfOwner(u.owner) !== state.activeSide) return `${id} is not an armor unit of the ${state.activeSide} side: only armor moves into a Breakthrough hex (Ref 12.31).`;
  if (exploiterIds(state).includes(id)) return `${id} has already moved into a Breakthrough hex.`;
  if (combatOf(state).attacked.includes(id)) return `${id} has attacked in this Combat Phase and cannot move into a Breakthrough hex (Ref 12.31).`;
  if (!attackerPool(ctx, state, state.activeSide, []).includes(u)) return `${id} cannot take part in combat now.`;
  if (!nearAttackers(group.from, u.at)) return `${id} was not in or next to a hex the attack on ${group.hex} was made from (Ref 12.31).`;
  if (supplied && !supplied.has(id)) return `${id} is out of supply and cannot move into a Breakthrough hex (Ref 12.31, 19.4).`;
  return angloFrenchStopProblem(ctx, state, u.owner, group.hex); // a placed unit stops in the hex (Ref 26.0; spec 16 R32)
}

/** The armor units that may be placed into the group's hex now, in the order the Breakthrough listed them (R11). */
export function placeableArmor(ctx: GameContext, state: GameState, group: BreakthroughGroup, supplied: ReadonlySet<string> | null = suppliedNow(ctx, state)): string[] {
  return group.placeable.filter((id) => placeProblem(ctx, state, group, id, supplied) === null);
}

/**
 * The advance into `chance.to` was made and the battle had armor in it: the hex becomes a Breakthrough hex (R10). The armor that could move in is listed
 * now, from the attackers' hexes as they stood (AER12): the side's armor that has not attacked and does not exploit, in or next to one of them.
 */
export function openBreakthrough(ctx: GameContext, state: GameState, chance: AdvanceChance): { state: GameState; events: GameEvent[] } {
  const from = [...(chance.from ?? [])];
  const used = usedUp(state);
  const candidates = attackerPool(ctx, state, state.activeSide, used).filter((u) => u.type === "armor" && u.at !== chance.to && nearAttackers(from, u.at)).map((u) => u.id);
  const group: BreakthroughGroup = { hex: chance.to, from, placeable: candidates, placed: [], moved: {}, attacked: [] };
  const rec = exploitOf(state);
  const next: GameState = { ...state, exploit: { ...rec, groups: [...rec.groups, group] } };
  return { state: next, events: [{ type: "BREAKTHROUGH", side: state.activeSide, hex: chance.to, placeable: placeableArmor(ctx, next, group) }] };
}

/** The placements listed at step 7h: for each Breakthrough with armor to place, all of it, and each unit alone when there are several. Any subset is accepted. */
export function legalPlacements(ctx: GameContext, state: GameState): Action[] {
  const groups = exploitOf(state).groups.filter((g) => g.placeable.length > 0);
  if (groups.length === 0) return [];
  const supplied = suppliedNow(ctx, state);
  const out: Action[] = [];
  for (const g of groups) {
    const ids = placeableArmor(ctx, state, g, supplied);
    if (ids.length === 0) continue;
    out.push({ type: "PLACE_EXPLOITERS", side: state.activeSide, hex: g.hex, units: ids });
    if (ids.length > 1) for (const id of ids) out.push({ type: "PLACE_EXPLOITERS", side: state.activeSide, hex: g.hex, units: [id] });
  }
  return out;
}

/** Whether a Breakthrough has armor that may still be placed (step 7h waits for it, spec 16 C5). */
export const hasPlaceWork = (ctx: GameContext, state: GameState): boolean => legalPlacements(ctx, state).length > 0;

/** PLACE_EXPLOITERS: the armor units move into the Breakthrough hex free, with no stacking limit there (R11), and become its exploiting units. */
export function applyPlaceExploiters(ctx: GameContext, state: GameState, action: PlaceAction): ActionResult {
  if (combatOf(state).pending) return { ok: false, error: "An Exchange is waiting for its losses to be chosen first." };
  if (action.side !== state.activeSide) return { ok: false, error: `It is the ${state.activeSide} player turn, not ${action.side}.` };
  const rec = exploitOf(state);
  const index = rec.groups.findIndex((g) => g.hex === action.hex);
  const group = rec.groups[index];
  if (!group) return { ok: false, error: `${String(action.hex)} is not a Breakthrough hex this turn: no won attack with armor in it advanced there.` };
  const ids = action.units;
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string") || new Set(ids).size !== ids.length) return { ok: false, error: "A placement names one or more distinct armor units." };
  const supplied = suppliedNow(ctx, state);
  for (const id of ids) {
    const problem = placeProblem(ctx, state, group, id, supplied);
    if (problem) return { ok: false, error: problem };
  }
  const from = [...new Set(ids.map((id) => state.units[id]!.at))];
  const units = { ...state.units };
  for (const id of ids) units[id] = { ...units[id]!, at: group.hex };
  const groups = rec.groups.map((g, i) => (i === index ? { ...g, placed: [...g.placed, ...ids] } : g));
  const moves = movesOf(state);
  let next: GameState = { ...state, units, exploit: { ...rec, groups }, moves: { ...moves, moved: [...moves.moved, ...ids] } }; // AER13: a placed unit counts as having moved
  const events: GameEvent[] = [{ type: "EXPLOITERS_PLACED", side: action.side, units: [...ids], from, hex: group.hex }];
  for (const id of ids) {
    const entered = enterHexes(ctx, next, next.units[id]!, [group.hex]); // the hex is already the side's after the advance; Ref 6.0 gives it to the last nation to enter
    next = entered.state;
    events.push(...entered.events);
  }
  return { ok: true, state: next, events };
}

/**
 * Leaving step 7h: an unused Breakthrough lapses (spec 16 R11, C5). Armor not placed can no longer be; a Breakthrough with no exploiter is dropped, and
 * the record goes with the last one, so a turn with no exploiter leaves the state as it was before this rule.
 */
export function lapseBreakthroughs(state: GameState): GameState {
  const rec = state.exploit;
  if (!rec || rec.turn !== turnKey(state)) return state;
  const groups = rec.groups.filter((g) => g.placed.length > 0).map((g) => ({ ...g, placeable: [] }));
  if (groups.length > 0) return { ...state, exploit: { ...rec, groups } };
  const { exploit: _gone, ...rest } = state;
  return rest;
}

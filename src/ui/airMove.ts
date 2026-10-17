import { applyAction, type Action } from "../engine/actions";
import { AIR_COMBAT_RULES } from "../engine/air-combat";
import { airBasesOf, airCapacity, airFactorsAt, airRoom } from "../engine/air-bases";
import { flightDistances, missionHexes, stagingChoices } from "../engine/air-range";
import { airOf } from "../engine/air-record";
import { STAGING_RANGE } from "../engine/air-rules";
import { stagingTargets } from "../engine/air-stage";
import { combineProblem, splitChoices } from "../engine/air-units";
import type { GameContext } from "../engine/context";
import { sideInWar } from "../engine/control";
import type { HexId } from "../engine/hex";
import type { GameState, Unit } from "../engine/types";
import * as T from "./airMoveText";
import type { MoveMarks } from "./moveMarks";
import { placeName, unitName } from "./names";

/**
 * The planes card of step 6f (spec 09, part D1) as plain data: for one base and the planes ticked there, every plane as a line, the bases the ticked
 * planes can change to together (the yellow hexes), the bases they cannot use with the reason, the ways to split one plane, whether the ticked planes
 * can be joined, and the 4-hex range. Pure: it asks the engine's read-only queries and a dry run of `applyAction`, decides no rule, and never puts
 * a unit id in a sentence (the `key` of a line is for the list only).
 */

export interface PlaneLine {
  /** The unit id, a stable key for the list; never shown. */
  key: string;
  /** "3-4 German air". */
  name: string;
  state: "ticked" | "free";
  /** "ready" or "changed base this turn". */
  note: string;
  strength: number;
}

export interface BaseRow {
  hex: HexId;
  name: string;
  distance: number;
  room: number;
  /** "3 hexes, room for 4 air factors". */
  text: string;
}

export interface AirMoveCard {
  hex: HexId;
  title: string;
  lines: PlaneLine[];
  ticked: string[];
  /** "This base holds 6 of 10 air factors." */
  baseLine: string;
  /** The yellow hexes, nearest first. */
  bases: BaseRow[];
  /** Why there are no bases (nothing ticked, already changed base, none in reach), or null. */
  why: string | null;
  /** The bases in a straight line within 8 hexes that the first ticked plane may not use, each with the engine's reason. */
  blocked: { hex: HexId; name: string; reason: string }[];
  /** Ways to split the one ticked plane that the engine accepts, as lists of sizes; empty unless exactly one plane is ticked. */
  splits: { name: string; parts: number[] }[];
  /** Set when two or more planes are ticked: the join action when the engine accepts it, else null (with `joinWhy`). */
  join: { action: Action; total: number } | null;
  joinWhy: string | null;
  /** The hexes the first ticked plane could fly a mission to (4 hexes), the base itself included. */
  range: HexId[];
  announce: string;
}

const idOrder = (u: Unit): number => Number(u.id.replace(/\D/g, ""));

/** The side's air units standing in the hex, in id order. */
export const planesAt = (state: GameState, hex: HexId): Unit[] =>
  Object.values(state.units).filter((u) => u.type === "air" && u.at === hex && sideInWar(state, u.owner) === state.activeSide).sort((a, b) => idOrder(a) - idOrder(b));

/** The bases with planes of the side to move, in hex-id order, each with how many planes and how many have not changed base. */
export function planeBases(ctx: GameContext, state: GameState): { hex: HexId; planes: number; free: number }[] {
  const staged = new Set(airOf(state).staged);
  const by = new Map<HexId, Unit[]>();
  for (const u of Object.values(state.units)) {
    if (u.type !== "air" || sideInWar(state, u.owner) !== state.activeSide || !Object.hasOwn(ctx.map.hexes, u.at)) continue;
    by.set(u.at, [...(by.get(u.at) ?? []), u]);
  }
  return [...by].sort(([a], [b]) => (a < b ? -1 : 1)).map(([hex, us]) => ({ hex, planes: us.length, free: us.filter((u) => !staged.has(u.id)).length }));
}

/** The ticks a base starts with: every plane that has not changed base (all of them when none can). */
export function defaultPlaneTicks(state: GameState, hex: HexId): string[] {
  const staged = new Set(airOf(state).staged);
  const all = planesAt(state, hex);
  const free = all.filter((u) => !staged.has(u.id));
  return (free.length > 0 ? free : all).map((u) => u.id);
}

/** The most bases the card lists (the nearest first); the map shows the rest. */
export const BASES_LIMIT = 40;

const dry = (ctx: GameContext, state: GameState, action: Action): boolean => applyAction(ctx, state, action).ok;

/** The card for `hex` with these planes ticked (ids that are not planes of the side at the hex are ignored). */
export function airMoveCard(ctx: GameContext, state: GameState, hex: HexId, tickedIds: readonly string[]): AirMoveCard {
  const planes = planesAt(state, hex);
  const staged = new Set(airOf(state).staged);
  const ticked = planes.map((u) => u.id).filter((id) => tickedIds.includes(id));
  const lines = planes.map((u): PlaneLine => ({ key: u.id, name: unitName(u), state: ticked.includes(u.id) ? "ticked" : "free", note: staged.has(u.id) ? T.STAGED : T.READY, strength: u.strength }));
  const first = planes.find((u) => u.id === ticked[0]);
  const targets = stagingTargets(ctx, state, ticked); // nothing ticked: the engine lists nothing
  const reach = first ? flightDistances(ctx, state, first.owner, hex, STAGING_RANGE) : new Map<HexId, number>();
  const rows = targets
    .map((to): BaseRow => ({ hex: to, name: placeName(ctx.map, to), distance: reach.get(to) ?? 0, room: airRoom(ctx, state, to), text: T.baseRow(reach.get(to) ?? 0, airRoom(ctx, state, to)) }))
    .sort((a, b) => a.distance - b.distance || (a.name < b.name ? -1 : 1));
  const why = ticked.length === 0 ? T.NOTHING_TICKED : rows.length > 0 ? null : ticked.some((id) => staged.has(id)) ? T.ALREADY_STAGED : T.NO_BASE;
  const blocked = first ? stagingChoices(ctx, state, first).filter((c) => c.problem !== null && !targets.includes(c.hex)).map((c) => ({ hex: c.hex, name: placeName(ctx.map, c.hex), reason: c.problem! })) : [];
  const side = state.activeSide;
  const splits = ticked.length === 1 && first ? splitChoices(first.strength).filter((parts) => dry(ctx, state, { type: "SPLIT_AIR", side, unit: first.id, parts })).map((parts) => ({ name: unitName(first), parts })) : [];
  const joinAction: Action = { type: "COMBINE_AIR", side, units: ticked };
  const total = ticked.reduce((n, id) => n + state.units[id]!.strength, 0);
  const canJoin = ticked.length >= 2 && combineProblem(state, ticked.map((id) => state.units[id]!)) === null && dry(ctx, state, joinAction);
  return {
    hex,
    title: placeName(ctx.map, hex),
    lines,
    ticked,
    baseLine: T.baseLine(airFactorsAt(state, hex), airCapacity(ctx, state, hex)),
    bases: rows,
    why,
    blocked,
    splits,
    join: canJoin ? { action: joinAction, total } : null,
    joinWhy: ticked.length >= 2 && !canJoin ? T.joinWhy(AIR_COMBAT_RULES.counterSizes) : null,
    range: first ? [hex, ...missionHexes(ctx, state, first.owner, hex)] : [],
    announce: `${placeName(ctx.map, hex)}. ${T.tickedCount(ticked.length, planes.length)} ${why ?? T.basesTitle(rows.length)}.`,
  };
}

/** The bases the card's ticked planes can go to, as bare hex ids (the yellow hexes). */
export const airMoveTargets = (card: AirMoveCard): HexId[] => card.bases.map((b) => b.hex);

/** Every base of the side, for the tap that names a base the planes cannot use (the reason is in `blocked`). */
export const baseHexes = (ctx: GameContext, state: GameState): HexId[] => airBasesOf(ctx, state, state.activeSide);

/** What the map shows of the card: the chosen base outlined, a gold ring on each ticked plane and a pale dash on the planes left out (the badges of spec 10, ticket 10-5). */
export const airMarks = (card: AirMoveCard): MoveMarks => ({
  from: card.hex,
  units: { ticked: new Set(card.ticked), left: new Set(card.lines.filter((l) => l.state === "free").map((l) => l.key)) },
});

import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import { controllerOf } from "./control";
import { hostileGroundHexes, passControl, sweepPassed, type PassRule } from "./conquest-forces";
import { conquestOf, type KeptHex } from "./conquest-record";
import type { HexId } from "./hex";
import { sideOfOwner } from "./setup";
import type { ForceOwner, GameState, Side } from "./types";

/**
 * The hexes a fall kept under hostile ground units (V12, simplified: `TRAPPED_UNITS_KEEP_ONLY_THEIR_HEX`, conquest-forces.ts) pass on once no such unit stands
 * there (spec 14, ticket 14-25). The rules do not say what becomes of such a hex; the owner decided on 2026-10-23 ("After a country falls, what happens to a
 * hex its last unit leaves?": "Hex passes on when the unit leaves") that it passes on by the rule that would have applied to it at the fall: to the conqueror, or
 * to nobody (V11, V37).
 *
 * TODO(verify) V62: when that is looked at. Here, after every action (`applyAction`) and, within one action, at the end of each Game Turn before the Campaign
 * checkpoint and the end-of-play result are read (`endGameTurn`, turn.ts). So a unit that leaves by moving, is eliminated in combat or for being out of supply,
 * or leaves the game with its own country's fall frees the hex in the same action. Not once the game is over: the result has been read, and the
 * final state stays as it was read. A hex that someone has taken since the fall (its controller is no longer the
 * one the fall left it with) is no longer the fallen country's to pass on: its record is dropped and control stays as it is. If the owner it was to go to has
 * fallen since, it goes where that owner's own fall would have sent it (`keptDestination`), so no conquered Power ends up holding a hex (R4). Off, kept hexes
 * stay as they are.
 */
export const KEPT_HEX_PASSES_WHEN_FREED = true;

const byId = (a: HexId, b: HexId): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Records, at a fall, the hexes `rule.keep` saved from passing on, with what passing on would have done to each: the same `passControl` with nothing kept,
 * read for those hexes only. `before` is the state the land was passed from, `after` the state it was passed into; returns `after` with the records added
 * (a later fall that keeps the same hex replaces its record).
 */
export function keptAtFall(ctx: GameContext, before: GameState, after: GameState, rule: PassRule, side: Side, country: KeptHex["country"]): GameState {
  if (rule.keep.size === 0) return after;
  const would = passControl(ctx, before, { ...rule, keep: new Set() }).passed;
  const entries: Record<HexId, KeptHex> = {};
  const add = (hexes: HexId[], to: ForceOwner | null) => {
    for (const hex of hexes) if (rule.keep.has(hex)) entries[hex] = { country, side, to, was: controllerOf(ctx, after, hex) };
  };
  add(would.toConqueror, rule.to);
  add(would.toNobody, null);
  if (Object.keys(entries).length === 0) return after;
  return { ...after, keptHexes: { ...(after.keptHexes ?? {}), ...entries } };
}

/**
 * Where a kept hex goes now: the record's `to`, unless that owner has itself fallen since (TODO(verify) V62). Then the hex goes where that owner's own fall
 * would have sent it, had it held the hex: a hex outside its home country becomes nobody's (V11), one inside it passes to its conqueror (a minor country's
 * land: V37). France is the exception: everything it held passed to its conqueror (V15, V41). After a Russian surrender Russian holdings stay Russian
 * (R7c). Followed down the chain of conquerors, at most once per conquest. "Nobody's" alone would be wrong for a hex in that owner's home country (a
 * German hex France held, kept at France's fall and to go to Germany, then Germany falls): Germany's own fall would have given it to Germany's conqueror.
 */
export function keptDestination(ctx: GameContext, state: GameState, to: ForceOwner | null, hex: HexId): ForceOwner | null {
  let dest = to;
  const country = ctx.map.hexes[hex]?.country;
  for (let n = 0; dest !== null && n <= (state.conquests?.length ?? 0); n++) {
    const fell = conquestOf(state, dest);
    if (!fell || fell.how === "surrender") return dest;
    dest = dest === "france" || country === dest ? fell.by : null;
  }
  return dest;
}

/**
 * Passes on every kept hex with no hostile ground unit on it any more (see `KEPT_HEX_PASSES_WHEN_FREED`): its control becomes the record's `to` (or, if
 * that owner has fallen since, `keptDestination`), a
 * CONTROL_PASSED event names the fallen country, and the conqueror's enemies left alone in a hex that passed to the conqueror are dealt with as at the fall
 * (`sweepPassed`). Pure; returns the same state object when nothing changes.
 */
export function releaseKept(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  const kept = state.keptHexes;
  if (!kept || !KEPT_HEX_PASSES_WHEN_FREED) return { state, events: [] };
  const hostile = new Map<Side, Set<HexId>>();
  const rest: Record<HexId, KeptHex> = {};
  const control = { ...state.control };
  const groups = new Map<string, { record: KeptHex; to: ForceOwner | null; hexes: HexId[] }>();
  let changed = false;
  for (const hex of Object.keys(kept).sort(byId)) {
    const record = kept[hex]!;
    if (controllerOf(ctx, state, hex) !== record.was) {
      changed = true; // taken since the fall: not the fallen country's any more
      continue;
    }
    let held = hostile.get(record.side);
    if (!held) hostile.set(record.side, (held = hostileGroundHexes(state, record.side)));
    if (held.has(hex)) {
      rest[hex] = record;
      continue;
    }
    changed = true;
    const to = keptDestination(ctx, state, record.to, hex);
    control[hex] = to;
    const key = `${record.country}|${to ?? ""}`;
    const group = groups.get(key) ?? { record, to, hexes: [] };
    group.hexes.push(hex);
    groups.set(key, group);
  }
  if (!changed) return { state, events: [] };
  const { keptHexes: _old, ...without } = state;
  let next: GameState = Object.keys(rest).length > 0 ? { ...without, control, keptHexes: rest } : { ...without, control };
  const events: GameEvent[] = [];
  for (const { record, to, hexes } of groups.values()) {
    events.push({ type: "CONTROL_PASSED", country: record.country, to, hexes });
    if (to === null) continue;
    const swept = sweepPassed(ctx, next, hexes, to === record.to ? record.side : sideOfOwner(to));
    next = swept.state;
    events.push(...swept.events);
  }
  return { state: next, events };
}

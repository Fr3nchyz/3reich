import type { GameContext } from "../engine/context";
import { sideInWar } from "../engine/control";
import { parseHexId, distance, type HexId } from "../engine/hex";
import { endProblem } from "../engine/movement";
import { POWER_NAMES } from "../engine/nations";
import { srOf } from "../engine/sr-record";
import { srDestinations, srHexProblem, srProblem, srRegion, srUnitProblem, srView, type SrSoFar, type SrView } from "../engine/sr-region";
import { SR_ALLOWANCE, srLeft, srNationOf, srUnitCost, SR_UNIT_TYPES } from "../engine/sr-rules";
import type { GameState, PowerId, Unit } from "../engine/types";
import { placeName, stackSummary, unitName, unitsWithIds } from "./names";
import * as T from "./redeployText";

/**
 * The Redeploy panel of step 9e as plain data (spec 16 D4, ticket 16-19): the allowance of each nation, the stacks that can be redeployed and the
 * units that cannot with the reason, and, for a chosen stack and the units ticked in it, where they can go together. Pure: it asks the engine's read-only
 * queries (sr-region.ts) one unit or one stack at a time and NEVER the list of legal actions, which at 9e holds up to 19,000 stack-level actions and costs
 * 70 to 120 ms (spec 16, "As built" of 16-17). It decides no rule and never puts a unit id in a sentence (the `id` of a line is a key for the buttons).
 */

export interface SrLine {
  /** The unit id, a stable key for the buttons; never shown. */
  id: string;
  /** "3-4 German armor" (", held by Germany" for a counter of another owner). */
  name: string;
  nation: PowerId;
  can: boolean;
  /** Why it cannot be redeployed, or the note that Replacements move only this way, or null. */
  note: string | null;
}

export interface SrStack {
  hex: HexId;
  /** "Berlin (K30)". */
  title: string;
  lines: SrLine[];
  /** How many of the lines can be redeployed. */
  movers: number;
}

export interface SrAllowance {
  power: PowerId;
  left: number;
  of: number;
}

export interface SrPanel {
  allowances: SrAllowance[];
  /** Every hex holding a unit of the side that is redeployed in Beta, in hex-id order. */
  stacks: SrStack[];
}

interface Env {
  view: SrView;
  so: SrSoFar;
  panel: SrPanel;
}

const cache = new WeakMap<GameState, WeakMap<GameContext, Env>>();

/** The unit's `srUnitProblem` text, in the words of the screen (the engine's text names a unit id). */
function unitReason(problem: string): string {
  if (problem.includes("already been redeployed")) return T.REASON_DONE;
  if (problem.includes("next to an enemy")) return T.REASON_ENEMY;
  if (problem.includes("cut off from supply")) return T.REASON_SUPPLY;
  if (problem.includes("not land its side controls")) return T.REASON_LAND;
  return T.REASON_OTHER;
}

/** Whether some hex of the unit's region other than its own takes it alone: a cheap `srDestinations(...).length > 0`. */
function hasPlace(ctx: GameContext, state: GameState, unit: Unit, view: SrView): boolean {
  for (const h of srRegion(ctx, state, unit, view)) if (h !== unit.at && endProblem(ctx, state, [unit], h) === null) return true;
  return false;
}

function build(ctx: GameContext, state: GameState): Env {
  const view = srView(ctx, state);
  const rec = srOf(state);
  const so: SrSoFar = { used: rec.used, redeployed: rec.moved };
  const by = new Map<HexId, SrLine[]>();
  const powers = new Set<PowerId>();
  const units = Object.values(state.units)
    .filter((u) => SR_UNIT_TYPES.includes(u.type) && ctx.map.hexes[u.at] && sideInWar(state, u.owner) === state.activeSide && srNationOf(state, u) !== null)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const u of units) {
    const nation = srNationOf(state, u)!;
    powers.add(nation);
    const problem = srUnitProblem(ctx, state, u, rec.moved, view);
    let note: string | null = problem ? unitReason(problem) : null;
    if (!note && srLeft(rec.used, nation) === 0) note = T.reasonNone(nation);
    if (!note && !hasPlace(ctx, state, u, view)) note = T.REASON_NOWHERE;
    const line: SrLine = { id: u.id, name: unitName(u, true), nation, can: note === null, note: note ?? (u.type === "replacement" ? T.REPLACEMENTS_NOTE : null) };
    by.set(u.at, [...(by.get(u.at) ?? []), line]);
  }
  const stacks = [...by].sort(([a], [b]) => (a < b ? -1 : 1)).map(([hex, lines]) => ({ hex, title: placeName(ctx.map, hex), lines, movers: lines.filter((l) => l.can).length }));
  const allowances = [...powers].sort((a, b) => (POWER_NAMES[a] < POWER_NAMES[b] ? -1 : 1)).map((power) => ({ power, left: srLeft(rec.used, power), of: SR_ALLOWANCE[power] }));
  return { view, so, panel: { allowances, stacks } };
}

function envOf(ctx: GameContext, state: GameState): Env {
  const byCtx = cache.get(state) ?? new WeakMap<GameContext, Env>();
  cache.set(state, byCtx);
  let env = byCtx.get(ctx);
  if (!env) byCtx.set(ctx, (env = build(ctx, state)));
  return env;
}

/** The panel for the position: allowances and stacks. Computed once per state and context. */
export const panelOf = (ctx: GameContext, state: GameState): SrPanel => envOf(ctx, state).panel;

/** The stacks that have at least one unit that can be redeployed. */
export const moverStacks = (ctx: GameContext, state: GameState): SrStack[] => panelOf(ctx, state).stacks.filter((k) => k.movers > 0);

/** The units of a stack ticked when it is chosen: all that can go (nations mix freely in a group, `MIXED_NATIONS_MOVE_TOGETHER`; each pays its own allowance). */
export const defaultTicks = (ctx: GameContext, state: GameState, hex: HexId): string[] => panelOf(ctx, state).stacks.find((k) => k.hex === hex)?.lines.filter((l) => l.can).map((l) => l.id) ?? [];

export interface SrSelection {
  hex: HexId;
  title: string;
  lines: (SrLine & { ticked: boolean })[];
  ticked: string[];
  tickable: number;
  /** Where the ticked units can all go, in the order the list shows them (nearest first). */
  destinations: HexId[];
  /** Why there is nowhere to go, when units are ticked and there is none; else null. */
  why: string | null;
  summary: string;
}

/** The units of the ticked set as a cost against what each nation has left: the first nation that is over, as the sentence says. */
function overAllowance(state: GameState, units: readonly Unit[], so: SrSoFar): string | null {
  const cost = srUnitCost(state, units);
  for (const [power, n] of Object.entries(cost) as [PowerId, number][]) if (n > srLeft(so.used ?? {}, power)) return T.overAllowance(power, srLeft(so.used ?? {}, power));
  return null;
}

/** The chosen stack and its ticks as data; empty (`lines` empty) when the hex holds nobody the side redeploys. */
export function selectionFor(ctx: GameContext, state: GameState, hex: HexId, tickedIds: readonly string[]): SrSelection {
  const { view, so, panel } = envOf(ctx, state);
  const stack = panel.stacks.find((k) => k.hex === hex);
  const lines = (stack?.lines ?? []).map((l) => ({ ...l, ticked: l.can && tickedIds.includes(l.id) }));
  const ticked = lines.filter((l) => l.ticked).map((l) => l.id);
  const units = ticked.map((id) => state.units[id]!);
  let destinations: HexId[] = [];
  let why: string | null = null;
  if (units.length > 0) {
    why = overAllowance(state, units, so);
    if (!why) {
      const from = parseHexId(hex);
      const first = srDestinations(ctx, state, units[0]!, so, view);
      destinations = (units.length === 1 ? first : first.filter((to) => srProblem(ctx, state, ticked, to, so, view) === null)).sort((a, b) => {
        const [pa, pb] = [parseHexId(a), parseHexId(b)];
        const [da, db] = from && pa && pb ? [distance(from, pa), distance(from, pb)] : [0, 0];
        return da - db || (placeName(ctx.map, a) < placeName(ctx.map, b) ? -1 : 1);
      });
      if (destinations.length === 0) why = T.noRoom;
    }
  }
  const tickable = lines.filter((l) => l.can).length;
  return { hex, title: stack?.title ?? placeName(ctx.map, hex), lines, ticked, tickable, destinations, why, summary: T.tickedCount(ticked.length, tickable) };
}

/** Why the ticked units cannot go to `to`, in words (D6: a tap that cannot be chosen says why). */
export function whyNot(ctx: GameContext, state: GameState, ids: readonly string[], to: HexId): string {
  const { view } = envOf(ctx, state);
  const units = ids.flatMap((id) => state.units[id] ?? []);
  if (units.length === 0) return T.NOTHING_TICKED;
  const out = units.find((u) => !srRegion(ctx, state, u, view).has(to));
  if (!out) return T.WHY_NOT_FIT;
  const fault = srHexProblem(ctx, state, view, out, to) ?? "";
  if (fault.includes("not a land hex")) return T.WHY_NOT_LAND;
  if (fault.includes("not controlled")) return T.WHY_NOT_CONTROL;
  if (fault.includes("enemy")) return T.WHY_NOT_ENEMY;
  if (fault.includes("cut off")) return T.WHY_NOT_SUPPLY;
  return T.whyNotReached(placeName(ctx.map, out.at));
}

export interface SrConfirm {
  question: string;
  /** "Germany will have 4 left." for each nation the units cost. */
  left: string;
  from: string;
  to: string;
  units: string;
}

/** The confirm card's sentences for these units going to `to`. */
export function confirmFor(ctx: GameContext, state: GameState, ids: readonly string[], to: HexId): SrConfirm {
  const { so } = envOf(ctx, state);
  const units = unitsWithIds(state, ids);
  const cost = srUnitCost(state, units);
  const left = (Object.entries(cost) as [PowerId, number][]).map(([power, n]) => T.willHave(power, srLeft(so.used ?? {}, power) - n)).join(" ");
  const from = [...new Set(units.map((u) => placeName(ctx.map, u.at)))].join(" and ");
  const units_ = stackSummary(units, true);
  return { question: T.confirmQuestion(units_, from, placeName(ctx.map, to)), left, from, to: placeName(ctx.map, to), units: units_ };
}

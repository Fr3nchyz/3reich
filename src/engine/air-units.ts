import { AIR_COMBAT_RULES } from "./air-combat";
import { airOf } from "./air-record";
import type { Action, ActionResult } from "./action-types";
import { sideInWar } from "./control";
import type { Unit } from "./types";
import type { GameState } from "./types";
import { isMajorPower } from "./war";

/**
 * Partial air units (spec 09 R6; Ref 20.6, Ops 4.11): an air unit may be split into smaller counters and counters of one nationality combined,
 * in the owner's Player Turn, with the factors conserved. Pure rules on the counters; no screen, and not in `legalActions` (the computer does not
 * reshape its air yet). The counter sizes are `AIR_COMBAT_RULES.counterSizes` (`TODO(verify)`, spec 09 part J item 4).
 */

type Split = Extract<Action, { type: "SPLIT_AIR" }>;
type Combine = Extract<Action, { type: "COMBINE_AIR" }>;

/** The steps of the Player Turn at which air counters may be reshaped: movement, and the combat step of ground support (not yet a waiting step). */
const RESHAPE_STEPS: readonly string[] = ["6f", "7b"];

const sizes = (): readonly number[] => AIR_COMBAT_RULES.counterSizes;

/** True for a real array of whole numbers (a hole in a sparse array is refused). */
function allWhole(x: unknown): x is number[] {
  if (!Array.isArray(x)) return false;
  for (let i = 0; i < x.length; i++) if (!Number.isInteger(x[i])) return false;
  return true;
}

/** True for a real array of strings (a hole in a sparse array is refused). */
function allStrings(x: unknown): x is string[] {
  if (!Array.isArray(x)) return false;
  for (let i = 0; i < x.length; i++) if (typeof x[i] !== "string") return false;
  return true;
}

/** Every way to split `strength` into two or more counter sizes, largest part first, parts in falling order, e.g. 5 into [3, 2], [3, 1, 1], [2, 2, 1], [2, 1, 1, 1], [1, 1, 1, 1, 1]. */
export function splitChoices(strength: number): number[][] {
  const out: number[][] = [];
  const fill = (left: number, max: number, parts: number[]): void => {
    if (left === 0) {
      if (parts.length >= 2) out.push(parts);
      return;
    }
    for (const size of [...sizes()].sort((a, b) => b - a)) if (size <= left && size <= max) fill(left - size, size, [...parts, size]);
  };
  fill(strength, Math.max(0, ...sizes()), []);
  return out;
}

/** Why the Player Turn is not at a moment to reshape air, or null. */
function momentProblem(state: GameState): string | null {
  const p = state.position;
  if (state.phase !== "player-turn" || p?.part !== "player-turn" || !RESHAPE_STEPS.includes(p.step)) return "Air counters are split and combined at step 6f or 7b.";
  return null;
}

/** Why this counter may not be reshaped (not an air counter, not the mover's, not a Major Power's), or null. Minor-country air is not partial (R6). */
function reshapeProblem(state: GameState, u: Unit): string | null {
  if (u.type !== "air") return `${u.id} is not an air unit.`;
  if (sideInWar(state, u.owner) !== state.activeSide) return `${u.id} does not belong to the ${state.activeSide} side now.`;
  if (!isMajorPower(u.owner)) return `${u.id} is minor-country air: it is not split or combined.`;
  return null;
}

/** A counter, with the same fields as its parent and a new id; `staged` parts are staged (a unit cannot stage twice by being split). */
const copyOf = (u: Unit, id: string, strength: number): Unit => ({ ...u, id, strength });

/** Splits one air unit into smaller counters of the same owner, nationality, movement and place. */
export function applySplitAir(state: GameState, action: Split): ActionResult {
  if (action.side !== state.activeSide) return { ok: false, error: `It is the ${state.activeSide} player turn, not ${String(action.side)}.` };
  const moment = momentProblem(state);
  if (moment) return { ok: false, error: moment };
  if (typeof action.unit !== "string" || !Object.hasOwn(state.units, action.unit)) return { ok: false, error: "The unit to split is not on the map." };
  const u = state.units[action.unit]!;
  const bad = reshapeProblem(state, u);
  if (bad) return { ok: false, error: bad };
  if (!allWhole(action.parts) || action.parts.length < 2) return { ok: false, error: "A split names two or more parts, each a whole number of air factors." };
  if (action.parts.some((n) => !sizes().includes(n))) return { ok: false, error: `Air counters come in sizes ${sizes().join(", ")} only.` };
  const total = action.parts.reduce((n, x) => n + x, 0);
  if (total !== u.strength) return { ok: false, error: `The parts add up to ${total}, but ${u.id} has ${u.strength} air factors.` };
  const rest = Object.fromEntries(Object.entries(state.units).filter(([id]) => id !== u.id));
  const made = [...action.parts].sort((a, b) => b - a).map((n, i) => copyOf(u, `u${state.nextUnitId + i}`, n));
  const rec = airOf(state);
  return {
    ok: true,
    state: {
      ...state,
      nextUnitId: state.nextUnitId + made.length,
      units: { ...rest, ...Object.fromEntries(made.map((m) => [m.id, m])) },
      air: rec.staged.includes(u.id) ? { ...rec, staged: [...rec.staged, ...made.map((m) => m.id)] } : rec,
    },
    events: [{ type: "AIR_RESHAPED", at: u.at, before: [{ id: u.id, strength: u.strength }], after: made.map((m) => ({ id: m.id, strength: m.strength })) }],
  };
}

/** The first reason these counters may not be combined, or null. */
export function combineProblem(state: GameState, units: readonly Unit[]): string | null {
  for (const u of units) {
    const bad = reshapeProblem(state, u);
    if (bad) return bad;
  }
  const first = units[0]!;
  const other = units.find((u) => u.at !== first.at || u.owner !== first.owner || (u.nationality ?? null) !== (first.nationality ?? null) || u.movement !== first.movement);
  if (other) return `${other.id} and ${first.id} are not the same nationality and movement in one hex: only like air counters combine.`;
  const total = units.reduce((n, u) => n + u.strength, 0);
  if (!sizes().includes(total)) return `${total} air factors is not a counter size (${sizes().join(", ")}).`;
  return null;
}

/** Combines air counters of one owner and nationality in one hex into a single counter. */
export function applyCombineAir(state: GameState, action: Combine): ActionResult {
  if (action.side !== state.activeSide) return { ok: false, error: `It is the ${state.activeSide} player turn, not ${String(action.side)}.` };
  const moment = momentProblem(state);
  if (moment) return { ok: false, error: moment };
  const ids = action.units;
  if (!allStrings(ids) || ids.length < 2 || new Set(ids).size !== ids.length) return { ok: false, error: "A combine names two or more distinct air units." };
  if (ids.some((id) => !Object.hasOwn(state.units, id))) return { ok: false, error: "A unit to combine is not on the map." };
  const units = ids.map((id) => state.units[id]!);
  const problem = combineProblem(state, units);
  if (problem) return { ok: false, error: problem };
  const total = units.reduce((n, u) => n + u.strength, 0);
  const id = `u${state.nextUnitId}`;
  const rest = Object.fromEntries(Object.entries(state.units).filter(([k]) => !ids.includes(k)));
  const rec = airOf(state);
  return {
    ok: true,
    state: {
      ...state,
      nextUnitId: state.nextUnitId + 1,
      units: { ...rest, [id]: copyOf(units[0]!, id, total) },
      air: units.some((u) => rec.staged.includes(u.id)) ? { ...rec, staged: [...rec.staged, id] } : rec,
    },
    events: [{ type: "AIR_RESHAPED", at: units[0]!.at, before: units.map((u) => ({ id: u.id, strength: u.strength })), after: [{ id, strength: total }] }],
  };
}

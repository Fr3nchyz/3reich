import type { GameContext } from "./context";
import { distance, parseHexId, type HexId } from "./hex";
import { MINOR_COUNTRIES } from "./minors-ids";
import { minorForceEntries } from "./minors";
import { baseSuits, stackingProblem } from "./placement";
import type { GameState, MinorCountry, UnitType } from "./types";

// TODO(verify) MC1, spec 15 R3: any home hex, subject to normal stacking and bases.
export const MC1_NORMAL_PLACEMENT_LIMITS = true;

/** Spec 15 R3: one chart counter and its destination; movement comes from the chart. */
export interface MinorPlacement { type: UnitType; strength: number; at: HexId }
export interface MinorPlacementChoices {
  type: UnitType;
  strength: number;
  count: number;
  hexes: HexId[];
}
type Result = { ok: true; state: GameState } | { ok: false; error: string };
const ground = (type: UnitType) => type === "infantry" || type === "armor";
const capital = (ctx: GameContext, at: HexId) =>
  ctx.map.hexes[at]?.features.some((f) => f === "capital" || f === "capital-port") ?? false;
const objective = (ctx: GameContext, at: HexId) => ctx.map.hexes[at]?.features.includes("objective") ?? false;
export const pending = (state: GameState, country: MinorCountry) =>
  MINOR_COUNTRIES.includes(country) && !!state.countries?.[country]?.toPlace &&
  (state.countries?.[country]?.status !== "neutral" || state.minorAllies.some((m) => m.owner === country && m.active)) && // R9: a woken ally's record stays neutral while its army waits
  !state.conquests?.some((c) => c.country === country);

/** Spec 15 R3/MC1: current destinations per chart kind, not a Cartesian set of complete armies.
 * Complete placements must also satisfy the capital requirement and combined stacking in apply.
 */
export function legalMinorPlacements(ctx: GameContext, state: GameState, country: MinorCountry): MinorPlacementChoices[] {
  if (!pending(state, country)) return [];
  return minorForceEntries(country).map((entry) => ({
    type: entry.type, strength: entry.strength, count: entry.count,
    hexes: Object.values(ctx.map.hexes).filter((h) => h.country === country &&
      baseSuits(ctx, entry.type, h.id) && (!MC1_NORMAL_PLACEMENT_LIMITS ||
        stackingProblem(ctx, state, country, entry, h.id) === null))
      .map((h) => h.id).sort(),
  }));
}

/** Spec 15 R3: creates fresh counters without touching pools, records, or the input state. */
function put(state: GameState, country: MinorCountry, p: MinorPlacement): GameState {
  const entry = minorForceEntries(country).find((e) => e.type === p.type && e.strength === p.strength)!;
  const id = `u${state.nextUnitId}`;
  return { ...state, nextUnitId: state.nextUnitId + 1, units: { ...state.units,
    [id]: { id, owner: country, type: p.type, strength: p.strength, at: p.at,
      ...(entry.movement === undefined ? {} : { movement: entry.movement }) } } };
}

/** Spec 15 R3: exact chart, borders, combined stacking/bases, and a ground counter in the capital. */
export function applyMinorPlacement(ctx: GameContext, state: GameState, country: MinorCountry,
  placement: readonly MinorPlacement[]): Result {
  if (!pending(state, country)) return { ok: false, error: "No minor army is awaiting placement." };
  const entries = minorForceEntries(country);
  if (!entries.length || placement.length !== entries.reduce((n, e) => n + e.count, 0) ||
    entries.some((e) => placement.filter((p) => p.type === e.type && p.strength === e.strength).length !== e.count)) {
    return { ok: false, error: "Placement must contain exactly the chart's counters." };
  }
  let next = state;
  for (const p of placement) {
    const choices = legalMinorPlacements(ctx, next, country).find((e) => e.type === p.type && e.strength === p.strength);
    if (!choices?.hexes.includes(p.at)) return { ok: false, error: "Illegal destination, base, or stacking." };
    next = put(next, country, p);
  }
  if (!placement.some((p) => ground(p.type) && capital(ctx, p.at))) {
    return { ok: false, error: "A ground unit must occupy the capital." };
  }
  // Spec 15 C1/R3: absence of toPlace means placed; preserve attacker, duty and helpers.
  const { toPlace: _placed, ...record } = state.countries![country]!;
  return { ok: true, state: { ...next, countries: { ...state.countries, [country]: record } } };
}

/** Spec 15 R3 and R16, slice 15-3a: capital, Objectives, nearest the attacker, then ascending hex id. Null if no legal army fits.
 * Backtracking keeps an early choice from stranding a later counter; no randomness or hidden state.
 */
export function suggestMinorPlacement(ctx: GameContext, state: GameState, country: MinorCountry): MinorPlacement[] | null {
  if (!pending(state, country)) return null;
  // Spec 15 R3: no complete army can fit without a legal ground destination in the capital.
  const choices = legalMinorPlacements(ctx, state, country);
  if (!choices.some((e) => ground(e.type) && e.hexes.some((at) => capital(ctx, at)))) return null;
  // Spec 15 R16: capital, then Objectives, then hexes nearest the attacker's units, then the lowest hex id.
  const attacker = state.countries?.[country]?.attacker;
  const theirs = Object.values(state.units).filter((u) => u.owner === attacker && u.at !== null)
    .map((u) => parseHexId(u.at)).filter((h) => h !== null);
  const nearest = (id: HexId) => {
    const h = parseHexId(id);
    return h === null || theirs.length === 0 ? 0 : Math.min(...theirs.map((t) => distance(h, t)));
  };
  const counters = minorForceEntries(country).flatMap((e) => Array.from({ length: e.count }, () => e));
  const search = (next: GameState, placed: MinorPlacement[]): MinorPlacement[] | null => {
    if (placed.length === counters.length) return applyMinorPlacement(ctx, state, country, placed).ok ? placed : null;
    const entry = counters[placed.length]!;
    const choices = legalMinorPlacements(ctx, next, country).find((e) => e.type === entry.type && e.strength === entry.strength)!;
    const hexes = [...choices.hexes].sort((a, b) => Number(capital(ctx, b)) - Number(capital(ctx, a)) ||
      Number(objective(ctx, b)) - Number(objective(ctx, a)) || nearest(a) - nearest(b) || (a < b ? -1 : a > b ? 1 : 0));
    for (const at of hexes) {
      // Spec 15 R3: reserve the first ground counter for the compulsory capital garrison.
      if (ground(entry.type) && !placed.some((p) => ground(p.type)) && !capital(ctx, at)) continue;
      const p = { type: entry.type, strength: entry.strength, at };
      const result = search(put(next, country, p), [...placed, p]);
      if (result) return result;
    }
    return null;
  };
  return search(state, []);
}

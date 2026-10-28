import type { GameEvent } from "./action-types";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import { routeLosses } from "./losses";
import { baseSuits, GROUND_FOR_STACKING, stackingProblem } from "./placement";
import { sideOfOwner } from "./setup";
import type { GameState, Side, Unit } from "./types";

/**
 * Stacking in play (Ref 5.0; Ops 5.45g and 5.48j). The limits are the setup limits of placement.ts
 * (two ground units per hex, three in London if all British, 5 air factors per base, 36 naval factors
 * per port; airborne free) and apply at all times. Movement may leave a hex over the limit; at step 6g
 * and again at 9j the owner chooses which units are eliminated.
 *
 * TODO(verify, Ref 26.0): the Anglo-French ban on sharing a hex before 1942 is a movement restriction,
 * not a limit to eliminate down to, so it is reported by `angloFrenchHexes` and left out of the
 * overstack here. TODO(verify): the manual's wording on whether the owner may eliminate more than needed;
 * this reading allows only what brings the hex within its limit. Eliminated units go back to their pool, or out of the game for good (losses.ts, spec 17 R1).
 */

export type StackKind = "ground" | "air" | "naval";

export interface Overstack {
  hex: HexId;
  kind: StackKind;
  /** The side whose units these are: each side's units are counted apart (an enemy never shares a hex). */
  side: Side;
  /** The units of that kind and side in the hex, in id order: the ones the owner may choose from. */
  unitIds: string[];
}

const kindOf = (u: Unit): StackKind | null =>
  GROUND_FOR_STACKING.includes(u.type) ? "ground" : u.type === "air" ? "air" : u.type === "fleet" ? "naval" : null;

/** Unit ids are "u1", "u2", ...: oldest first. */
const idOrder = (a: Unit, b: Unit) => Number(a.id.replace(/\D/g, "")) - Number(b.id.replace(/\D/g, ""));

const unitsByHex = (ctx: GameContext, state: GameState): Map<HexId, Unit[]> => {
  const out = new Map<HexId, Unit[]>();
  for (const u of Object.values(state.units).sort(idOrder)) {
    if (!ctx.map.hexes[u.at]) continue;
    out.set(u.at, [...(out.get(u.at) ?? []), u]);
  }
  return out;
};

/**
 * Whether `kind` is over its limit in the hex, given just one side's units there. Reuses placement's per-counter test.
 * Ref 5.0 and RULES.md: the air limit is per BASE and the naval limit per PORT, so air units off a base (a city, port,
 * capital or an airbase counter) and fleets outside a port are not counted.
 * TODO(verify): whether air units in flight or fleets at sea have a stacking limit of their own.
 */
function overLimit(ctx: GameContext, state: GameState, hex: HexId, here: readonly Unit[], kind: StackKind): boolean {
  if (kind === "air" && !baseSuits(ctx, "air", hex) && !here.some((u) => u.type === "airbase")) return false;
  if (kind === "naval" && !baseSuits(ctx, "fleet", hex)) return false;
  // A counter is "in the way" if re-adding it to the hex without it breaks a limit. The year is set past 1941 so Ref 26.0 is not counted.
  return here.some((u) => {
    if (kindOf(u) !== kind) return false;
    const others = Object.fromEntries(here.filter((o) => o.id !== u.id).map((o) => [o.id, o]));
    const spec = { type: u.type, strength: u.strength, ...(u.nationality ? { nationality: u.nationality } : {}) };
    return stackingProblem(ctx, { ...state, year: 1942, units: others }, u.owner, spec, hex) !== null;
  });
}

/** Every hex, side and kind of counter that is over its limit now, in hex order. */
export function overstacks(ctx: GameContext, state: GameState): Overstack[] {
  const out: Overstack[] = [];
  for (const [hex, here] of [...unitsByHex(ctx, state)].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const side of ["axis", "allies"] as const) {
      const mine = here.filter((u) => sideOfOwner(u.owner) === side);
      for (const kind of ["ground", "air", "naval"] as const) {
        if (overLimit(ctx, state, hex, mine, kind)) out.push({ hex, kind, side, unitIds: mine.filter((u) => kindOf(u) === kind).map((u) => u.id) });
      }
    }
  }
  return out;
}

/** The overstacks that hold units of this side: the ones its player must resolve. */
export const overstacksOf = (ctx: GameContext, state: GameState, side: Side): Overstack[] =>
  overstacks(ctx, state).filter((o) => o.side === side);

/** Hexes where British and French units share a hex before 1942 (Ref 26.0). */
export function angloFrenchHexes(ctx: GameContext, state: GameState): HexId[] {
  if (state.year >= 1942) return [];
  return [...unitsByHex(ctx, state)].filter(([, here]) => here.some((u) => u.owner === "britain") && here.some((u) => u.owner === "france")).map(([hex]) => hex).sort();
}

const without = (state: GameState, ids: readonly string[]): GameState => ({
  ...state,
  units: Object.fromEntries(Object.entries(state.units).filter(([id]) => !ids.includes(id))),
});

const stillOver = (ctx: GameContext, state: GameState, o: Overstack, removed: readonly string[]): boolean =>
  overstacks(ctx, without(state, removed)).some((x) => x.hex === o.hex && x.kind === o.kind && x.side === o.side);

/** Why the owner's choice of units to eliminate does not settle this overstack, or null if it does and takes no more than needed. */
export function eliminationProblem(ctx: GameContext, state: GameState, o: Overstack, chosen: readonly string[]): string | null {
  if (new Set(chosen).size !== chosen.length) return `A unit is named twice at ${o.hex}.`;
  const bad = chosen.find((id) => !o.unitIds.includes(id));
  if (bad) return `${bad} is not one of the ${o.kind} units at ${o.hex}.`;
  if (stillOver(ctx, state, o, chosen)) return `${o.hex} would still hold too many ${o.kind} units.`;
  const spare = chosen.find((id) => !stillOver(ctx, state, o, chosen.filter((c) => c !== id)));
  return spare ? `${spare} need not be eliminated at ${o.hex}.` : null;
}

/**
 * A legal choice for every overstack of a side that a computer player can use: the weakest units go
 * first until the hex fits, then any that turn out not to be needed are kept.
 */
export function defaultElimination(ctx: GameContext, state: GameState, side: Side): Record<HexId, string[]> {
  const out: Record<HexId, string[]> = {};
  for (const o of overstacksOf(ctx, state, side)) {
    const order = o.unitIds.map((id) => state.units[id]!).filter((u) => sideOfOwner(u.owner) === side).sort((a, b) => a.strength - b.strength || idOrder(a, b));
    const chosen: string[] = [];
    for (const u of order) {
      if (!stillOver(ctx, state, o, chosen)) break;
      chosen.push(u.id);
    }
    for (const id of [...chosen].reverse()) {
      const rest = chosen.filter((c) => c !== id);
      if (!stillOver(ctx, state, o, rest)) chosen.splice(chosen.indexOf(id), 1);
    }
    out[o.hex] = [...(out[o.hex] ?? []), ...chosen];
  }
  return out;
}

/**
 * Steps 6g and 9j: the side's player has chosen, hex by hex, the units to eliminate. Every overstack of
 * that side must be settled, with units of that side only; otherwise nothing is done.
 */
export function eliminateOverstack(
  ctx: GameContext,
  state: GameState,
  side: Side,
  choices: Readonly<Record<HexId, readonly string[]>>,
): { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string } {
  const todo = overstacksOf(ctx, state, side);
  for (const hex of Object.keys(choices)) {
    if (!todo.some((o) => o.hex === hex)) return { ok: false, error: `${hex} is not overstacked.` };
  }
  const removed: string[] = [];
  for (const o of todo) {
    const mine = (choices[o.hex] ?? []).filter((id) => o.unitIds.includes(id));
    // Several kinds can be over at once in one hex: judge each kind by the units named for it.
    const problem = eliminationProblem(ctx, state, o, mine);
    if (problem) return { ok: false, error: problem };
    removed.push(...mine);
  }
  const unknown = Object.values(choices).flat().find((id) => !removed.includes(id));
  if (unknown) return { ok: false, error: `${unknown} is not part of an overstack.` };
  // Each unit goes back to its pool or is lost for good (losses.ts, spec 17 R1), its routing event right after its own.
  let next = without(state, removed);
  const events: GameEvent[] = [];
  for (const id of removed) {
    const u = state.units[id]!;
    const routed = routeLosses(next, [u]);
    next = routed.state;
    events.push({ type: "OVERSTACK_ELIMINATED", unitId: id, owner: u.owner, at: u.at }, ...routed.events);
  }
  return { ok: true, state: next, events };
}

import type { GameEvent } from "./action-types";
import { isBox, territoryOf } from "./areas";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import { MINOR_COUNTRY_FORCES } from "./tables";
import type { ForceOwner, GameState, MinorCountry, PowerId, Side, Unit, UnitType } from "./types";
import { atWar, sideOfPower } from "./war";

/**
 * Control of hexes (Ref 7.0, 16.0, spec 03). Every land hex starts under the owner whose
 * "controlled at start" territory it is (whole countries plus zones, see areas.ts); hexes in nobody's
 * territory (neutral minor countries) have no controller. Only the differences from that start are
 * kept in GameState.control, so a new game needs no map to set it up.
 *
 * What the written rules in docs/RULES.md settle is only the start; the rest is the reading below.
 * TODO(verify, Ref 7.0): control changes when a ground unit ENTERS an enemy-controlled hex (here, also
 * when it passes through, because the caller lists every hex entered); whether a unit that only passes
 * through, or that is later overrun, keeps the hex is not settled.
 * TODO(verify, Ref 16.0): whether conquering a minor country hands over the whole country at once
 * (capital, all objectives) rather than hex by hex, and whether other uncontrolled land (the Baltic
 * States, which no scenario hands to anyone in 1939) changes hands the same way.
 */

/** Counters whose entry into a hex can change its control. TODO(verify): replacements cannot move; air and fleets never take hexes. */
export const CONTROL_CHANGING_TYPES: readonly UnitType[] = ["infantry", "armor", "airborne"];

const starts = new WeakMap<GameContext, ReadonlyMap<HexId, ForceOwner>>();

/** Who controls each hex when the scenario begins: the owner whose territory it is. */
export function startingControl(ctx: GameContext): ReadonlyMap<HexId, ForceOwner> {
  const hit = starts.get(ctx);
  if (hit) return hit;
  const out = new Map<HexId, ForceOwner>();
  for (const owner of Object.keys(ctx.scenario.forces) as ForceOwner[]) {
    for (const place of territoryOf(ctx, owner).places) {
      if (!isBox(place) && ctx.map.hexes[place]?.land && !out.has(place)) out.set(place, owner);
    }
  }
  starts.set(ctx, out);
  return out;
}

/** Who controls a hex now, or null for land nobody controls (and for sea). */
export function controllerOf(ctx: GameContext, state: GameState, hex: HexId): ForceOwner | null {
  return state.control[hex] ?? startingControl(ctx).get(hex) ?? null;
}

/** Every controlled hex and its controller. */
export function controlMap(ctx: GameContext, state: GameState): Map<HexId, ForceOwner> {
  return new Map([...startingControl(ctx), ...Object.entries(state.control)]);
}

const ALLIED_FOR_GOOD: readonly ForceOwner[] = ["poland", "free-france"];
const MINOR_ALLIES: readonly ForceOwner[] = ["finland", "rumania", "hungary", "bulgaria"];

/**
 * The side an owner fights on right now, or null while it takes no part: a Major Power that is
 * neutral, out of the scenario or Vichy; an inactive Minor-Ally; Vichy France (TODO(verify): the
 * Vichy forces are neutral until they are attacked).
 */
export function sideInWar(state: GameState, owner: ForceOwner): Side | null {
  if (owner in state.nations) return sideOfPower(state.nations[owner as PowerId]);
  if (ALLIED_FOR_GOOD.includes(owner)) return "allies";
  if (MINOR_ALLIES.includes(owner)) return state.minorAllies.some((m) => m.owner === owner && m.active) ? "axis" : null;
  return null;
}

/** Whether two owners are enemies: on opposite sides, or (when one takes no side) at war by the record. */
export function areEnemies(state: GameState, a: ForceOwner, b: ForceOwner): boolean {
  const sa = sideInWar(state, a);
  const sb = sideInWar(state, b);
  return sa !== null && sb !== null ? sa !== sb : atWar(state, a, b);
}

/** The side that controls a hex, or null if nobody does or its controller takes no side. */
export function controllingSide(ctx: GameContext, state: GameState, hex: HexId): Side | null {
  const c = controllerOf(ctx, state, hex);
  return c === null ? null : sideInWar(state, c);
}

const isMinorCountry = (c: string | undefined): c is MinorCountry => c !== undefined && c in MINOR_COUNTRY_FORCES;

/**
 * Who would control `hex` after `unit` enters it, or null if control does not change: a ground
 * unit takes a hex held by an enemy, and a hex of a minor country that is at war with the unit's owner.
 */
export function controlAfterEntry(ctx: GameContext, state: GameState, unit: Pick<Unit, "owner" | "type">, hex: HexId): ForceOwner | null {
  const h = ctx.map.hexes[hex];
  if (!h?.land || !CONTROL_CHANGING_TYPES.includes(unit.type)) return null;
  const now = controllerOf(ctx, state, hex);
  if (now === unit.owner) return null;
  if (now !== null) return areEnemies(state, unit.owner, now) ? unit.owner : null;
  return isMinorCountry(h.country) && atWar(state, unit.owner, h.country) ? unit.owner : null;
}

/** Records the control changes of a unit entering these hexes in order (nothing moves the unit here). Logs each change. */
export function enterHexes(ctx: GameContext, state: GameState, unit: Unit, hexes: readonly HexId[]): { state: GameState; events: GameEvent[] } {
  let control = state.control;
  const events: GameEvent[] = [];
  for (const hex of hexes) {
    const now = control[hex] ?? startingControl(ctx).get(hex) ?? null;
    const to = controlAfterEntry(ctx, { ...state, control }, unit, hex);
    if (to === null) continue;
    control = { ...control, [hex]: to };
    events.push({ type: "HEX_CONTROL_CHANGED", hex, from: now, to, unitId: unit.id });
  }
  return { state: events.length ? { ...state, control } : state, events };
}

import type { GameEvent } from "./action-types";
import { isBox, territoryOf } from "./areas";
import { powerOfCapital } from "./capital";
import type { GameContext } from "./context";
import type { HexId } from "./hex";
import { derivedMinorControl } from "./minors-record";
import { sovietCityTaken } from "./soviet";
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
 * Conquering a minor country (Ref 16.0, answered 2026-10-17 and built by spec 14 ticket 14-6, conquest-minor.ts): when a hostile unit holds its capital, every hex
 * of the country passes to the conqueror at once, at the end of the attacker's Combat Phase. The Baltic States are part of Eastern Europe (Ref 29.0), conquered like a
 * colony by holding all its cities (spec 15 calls `fallCountry`).
 *
 * Nobody's land (spec 14 R4, TODO(verify) V11): when a Major Power is conquered, the land it held outside its own country is recorded as
 * `control[hex] = null`. That differs from having no entry (the start territory decides): the hex stays nobody's until a ground unit
 * enters it, and the first one to do so takes it, at war or not (`controlAfterEntry`). TODO(verify) V34: such a hex is open to every
 * ground unit, even inside a minor country (movement.ts reads `isNobodys`).
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
  const held = state.control[hex]; // null is an entry too: nobody controls the hex, whatever the start territory says
  if (held !== undefined) return held;
  const start = startingControl(ctx).get(hex);
  if (start !== undefined) return start;
  // Spec 15 C1: last fallback, a fighting minor controls its own land unless spec 14 records its conquest (derived, never stored).
  return ctx.map.hexes[hex]?.land ? derivedMinorControl(state, ctx.map.hexes[hex]?.country) : null;
}

/** Whether the record says nobody controls this hex (a conquered Power's land outside its own country, spec 14 R4). */
export const isNobodys = (state: GameState, hex: HexId): boolean => state.control[hex] === null;

/** Every controlled hex and its controller (a hex nobody controls is left out). */
export function controlMap(ctx: GameContext, state: GameState): Map<HexId, ForceOwner> {
  const out = new Map(startingControl(ctx));
  for (const [hex, owner] of Object.entries(state.control)) {
    if (owner === null) out.delete(hex);
    else out.set(hex, owner);
  }
  return out;
}

const ALLIED_FOR_GOOD: readonly ForceOwner[] = ["poland", "free-france"];
const MINOR_ALLIES: readonly ForceOwner[] = ["finland", "rumania", "hungary", "bulgaria"];

/**
 * Spec 15 C4.1: the side a minor country with a record fights on. Attacked: opposite the declarer. Allied (helped): the first helper's side.
 * Neutral, unrecorded or an older saved game: no side. TODO(verify) MC19 (two helpers, one value) is not read here: the first helper decides.
 */
function sideOfMinor(state: GameState, owner: ForceOwner): Side | null {
  const record = state.countries?.[owner as MinorCountry];
  if (record?.status === "attacked" && record.attacker) {
    const declarer = sideOfPower(state.nations[record.attacker]);
    return declarer === null ? null : declarer === "axis" ? "allies" : "axis";
  }
  const helper = record?.status === "allied" ? record.helpers?.[0] : undefined;
  return helper ? sideOfPower(state.nations[helper]) : null;
}

/**
 * The side an owner fights on right now, or null while it takes no part: a Major Power that is
 * neutral, out of the scenario or Vichy; an inactive Minor-Ally; Vichy France (TODO(verify): the
 * Vichy forces are neutral until they are attacked).
 */
export function sideInWar(state: GameState, owner: ForceOwner): Side | null {
  if (owner in state.nations) return sideOfPower(state.nations[owner as PowerId]);
  if (ALLIED_FOR_GOOD.includes(owner)) return "allies";
  if (MINOR_ALLIES.includes(owner)) return state.minorAllies.some((m) => m.owner === owner && m.active) ? "axis" : null;
  return sideOfMinor(state, owner);
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
  if (now !== null) return areEnemies(state, unit.owner, now) ? unit.owner : null;
  if (isNobodys(state, hex)) return unit.owner; // spec 14 R4: nobody controls it, so the first ground unit to enter takes it
  return isMinorCountry(h.country) && atWar(state, unit.owner, h.country) ? unit.owner : null;
}

/** Records the control changes of a unit entering these hexes in order (nothing moves the unit here). Logs each change. */
export function enterHexes(ctx: GameContext, state: GameState, unit: Unit, hexes: readonly HexId[]): { state: GameState; events: GameEvent[] } {
  let control = state.control;
  let fortresses = state.fortresses;
  let rest: Pick<GameState, "nations" | "soviet"> = { nations: state.nations, soviet: state.soviet }; // what the first capture of Moscow or Leningrad changes (spec 14 R7a)
  const events: GameEvent[] = [];
  for (const hex of hexes) {
    const now = controllerOf(ctx, { ...state, control }, hex);
    const to = controlAfterEntry(ctx, { ...state, control }, unit, hex);
    if (to === null) continue;
    control = { ...control, [hex]: to };
    events.push({ type: "HEX_CONTROL_CHANGED", hex, from: now, to, unitId: unit.id }, ...capitalEvents(ctx, state, hex, now, to));
    // Spec 14 R7a: the Axis taking Moscow or Leningrad from the Allies moves 15 BRPs from the U.S.S.R. to Germany, at once and once for each city (soviet.ts).
    // TODO(verify) V47: a unit entering the city is the capture, in the Movement Phase as well as after a battle.
    if (now !== null && sideInWar(state, to) === "axis" && sideInWar(state, now) === "allies") {
      const moved = sovietCityTaken(ctx, { ...state, ...rest }, hex);
      if (moved) {
        rest = { nations: moved.state.nations, soviet: moved.state.soviet };
        events.push(...moved.events);
      }
    }
    // Ref 4.8: a Fortress (other than Malta, Gibraltar and Sevastopol, which fortress.ts decides) loses the status for good when an enemy occupies it.
    const kind = ctx.map.hexes[hex]?.fortress;
    const owner = startingControl(ctx).get(hex);
    if (fortresses[hex] === true && (kind === "standard" || kind === "maginot" || kind === "west-wall") && owner !== undefined && areEnemies(state, to, owner)) {
      fortresses = { ...fortresses, [hex]: false };
      events.push({ type: "FORTRESS_CHANGED", hex, status: false, why: "enemy-entered" }); // spec 16 R31
    }
  }
  return { state: events.length ? { ...state, control, fortresses, ...rest } : state, events };
}

/**
 * The warning that goes with a capital changing hands (spec 14 R4, D3): a Major Power's capital taken by the other side (CAPITAL_LOST: the Power falls at
 * the end of its own Combat Phase unless it takes the capital back) or taken back (CAPITAL_RETAKEN). Sides are read with `sideInWar`, so a hex that
 * passes between two owners of one side, or to or from nobody, says nothing.
 */
function capitalEvents(ctx: GameContext, state: GameState, hex: HexId, from: ForceOwner | null, to: ForceOwner): GameEvent[] {
  const power = powerOfCapital(ctx, hex);
  const nation = power ? state.nations[power] : undefined;
  const side = nation ? sideOfPower(nation) : null;
  if (!power || side === null) return [];
  const before = from === null ? null : sideInWar(state, from);
  const after = sideInWar(state, to);
  if (after !== null && after !== side && before !== after) return [{ type: "CAPITAL_LOST", power, capital: hex, by: to }];
  if (after === side && before !== null && before !== side) return [{ type: "CAPITAL_RETAKEN", power, capital: hex }];
  return [];
}

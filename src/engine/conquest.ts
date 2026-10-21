import type { GameEvent } from "./action-types";
import { afterHexTaken } from "./capture";
import { capitalOf, CONQUERED_BY_CAPITAL } from "./capital";
import type { GameContext } from "./context";
import { controllerOf, controllingSide, sideInWar } from "./control";
import { hostileGroundHexes, passControl, removePools, removeUnits, type RemovedUnit } from "./conquest-forces";
import type { Conquest } from "./conquest-record";
import { ALIGNMENT, sideOfPower } from "./war";
import { sideOfOwner } from "./setup";
import { evaluateVictory } from "./victory";
import type { ForceOwner, GameState, PowerId, Side } from "./types";

/**
 * A Major Power is conquered by its capital (spec 14 R4, C8; Ref 2.0, 18.1). When an enemy ground unit takes the capital the owner is warned
 * (CAPITAL_LOST, control.ts); if the capital is still lost when the owner's own Combat Phase ends (the end of step 7p of its Player Turn) the Power
 * falls: `fall()`. Minor countries, colonies and Eastern Europe (ticket 14-6, spec 15) reuse the pieces in conquest-forces.ts; France's Vichy
 * and the colony dice (ticket 14-7) and Italy's surrender (ticket 14-8) add their own steps to `fall()`.
 */

export type CapitalState = "free" | "capital-lost" | "conquered";

/** Where a Major Power stands: free, its capital lost (the other side holds it), or conquered. A Power outside `CONQUERED_BY_CAPITAL` (France until ticket 14-7), or not in the war, is free. */
export function capitalState(ctx: GameContext, state: GameState, power: PowerId): CapitalState {
  const nation = state.nations[power];
  if (!nation) return "free";
  if (nation.status === "conquered") return "conquered";
  const capital = capitalOf(ctx, power);
  const side = sideOfPower(nation);
  if (capital === null || side === null || !CONQUERED_BY_CAPITAL.includes(power)) return "free";
  const holder = controllingSide(ctx, state, capital);
  return holder !== null && holder !== side ? "capital-lost" : "free";
}

/** The Major Powers of `side` whose capital is lost now, in the order of `CONQUERED_BY_CAPITAL`: they fall if this is the end of their Combat Phase. */
export function fallingNow(ctx: GameContext, state: GameState, side: Side): PowerId[] {
  return CONQUERED_BY_CAPITAL.filter((p) => state.nations[p] && sideOfPower(state.nations[p]) === side && capitalState(ctx, state, p) === "capital-lost");
}

/** What the Power's units and land are, for a fall: the Power and its active Minor-Allies leave together. */
const withAllies = (state: GameState, who: PowerId): ForceOwner[] => [who, ...state.minorAllies.filter((m) => m.of === who && m.active).map((m) => m.owner)];

/**
 * The units that leave the game when `who` falls, and the lent counters that go back (TODO(verify) V32). The Power's own counters and its active
 * Minor-Allies' go; so do counters of its nationality that another owner holds (Italian ships in German hands go with Italy). A counter of another
 * Major Power that `who` holds (the Italian fleet Germany has in 1944) goes back to that Power if it is still in the war, and is removed otherwise.
 */
function leaving(state: GameState, who: PowerId, owners: readonly ForceOwner[]): { ids: string[]; returned: [string, PowerId][] } {
  const ids: string[] = [];
  const returned: [string, PowerId][] = [];
  for (const u of Object.values(state.units)) {
    const lent = u.nationality !== undefined && u.nationality !== u.owner;
    const home = u.nationality;
    if (!owners.includes(u.owner)) {
      if (lent && home === who) ids.push(u.id);
    } else if (lent && home !== who && home !== undefined && home in state.nations && sideOfPower(state.nations[home as PowerId]) !== null) {
      returned.push([u.id, home as PowerId]);
    } else {
      ids.push(u.id);
    }
  }
  return { ids, returned };
}

/**
 * Major Power `who` falls to `conqueror` (the owner of the unit that holds its capital). C8 steps 1 to 7:
 *  1. its units, and those of its active Minor-Allies, and their pools leave the game for good (TODO(verify) V10);
 *  2. the land it holds in its own map country passes to the conqueror, the rest it or its Minor-Allies held becomes nobody's (V11), except the hexes
 *     under hostile ground units (V12);
 *  3. its status becomes "conquered" and its BRPs 0; its Minor-Allies become inactive (V33);
 *  4. the Conquest is recorded, with the Game Turn and the BRPs it began the scenario with (V4, V9);
 *  5. the events are written;
 *  6. counters of the conqueror's enemies left alone in a hex that passed are dealt with as in any capture (`afterHexTaken`);
 *  7. the game ends at once if this conquest decides it (`evaluateVictory(..., "after-conquest")`, V3).
 * The Wars list is not touched: it keeps its history.
 */
export function fall(ctx: GameContext, state: GameState, who: PowerId, conqueror: ForceOwner, how: Conquest["how"] = "capital"): { state: GameState; events: GameEvent[] } {
  const nation = state.nations[who];
  const side = sideOfPower(nation) ?? ALIGNMENT[who];
  const owners = withAllies(state, who);
  const { ids, returned } = leaving(state, who, owners);
  // 1. units and pools
  const gone = removeUnits(state, ids);
  const units = { ...gone.state.units };
  for (const [id, home] of returned) {
    const { nationality: _lent, ...unit } = units[id]!;
    units[id] = { ...unit, owner: home };
  }
  let next: GameState = removePools({ ...gone.state, units }, owners);
  // 2. land
  const keep = hostileGroundHexes(next, sideOfOwner(conqueror));
  const passed = passControl(ctx, next, { from: owners, to: conqueror, keep, isHome: (hex, owner) => owner === who && hex.country === who });
  next = passed.state;
  // 3. and 4. status and record
  const record: Conquest = { country: who, by: conqueror, side, how, at: { year: state.year, season: state.season }, startingBrps: ctx.scenario.nations[who].brpTotal };
  next = {
    ...next,
    nations: { ...next.nations, [who]: { ...nation, status: "conquered", brpTotal: 0, spendLimit: 0, spent: 0 } },
    minorAllies: next.minorAllies.map((m) => (m.of === who && m.active ? { ...m, active: false } : m)),
    conquests: [...(state.conquests ?? []), record],
  };
  // 5. events
  const events: GameEvent[] = [{ type: "COUNTRY_CONQUERED", country: who, by: conqueror, how, unitsRemoved: gone.removed.length, hexesPassed: passed.passed.toConqueror.length }];
  if (gone.removed.length > 0) events.push({ type: "UNITS_REMOVED_BY_CONQUEST", country: who, units: gone.removed });
  if (passed.passed.toConqueror.length > 0) events.push({ type: "CONTROL_PASSED", country: who, to: conqueror, hexes: passed.passed.toConqueror });
  if (passed.passed.toNobody.length > 0) events.push({ type: "CONTROL_PASSED", country: who, to: null, hexes: passed.passed.toNobody });
  // 6. counters left alone in the land that passed
  const swept = sweepPassed(ctx, next, passed.passed.toConqueror, sideOfOwner(conqueror));
  next = swept.state;
  events.push(...swept.events);
  // 7. is the game decided?
  const result = evaluateVictory(ctx, next, "after-conquest");
  if (result) {
    next = { ...next, phase: "game-over", result };
    events.push({ type: "GAME_OVER", year: next.year, season: next.season, result });
  }
  return { state: next, events };
}

/** Enemy counters of the conqueror still standing alone (no ground unit can be there, or the hex would not have passed) in the hexes that passed: fleets move away, the rest is destroyed (capture.ts). */
function sweepPassed(ctx: GameContext, state: GameState, hexes: readonly string[], conquerorSide: Side): { state: GameState; events: GameEvent[] } {
  let next = state;
  const events: GameEvent[] = [];
  for (const hex of hexes) {
    const loners = Object.values(next.units).filter((u) => u.at === hex && sideInWar(next, u.owner) !== null && sideInWar(next, u.owner) !== conquerorSide);
    if (loners.length === 0) continue;
    const taken = afterHexTaken(ctx, next, hex, loners);
    const out = removeUnits(taken.state, taken.destroy.map((u) => u.id));
    next = out.state;
    const swept: RemovedUnit[] = out.removed;
    if (swept.length > 0) events.push({ type: "UNITS_SWEPT", hex, units: swept }, ...swept.map((u): GameEvent => ({ type: "UNIT_ELIMINATED", unitId: u.id, owner: u.owner, at: hex })));
    events.push(...taken.events);
  }
  return { state: next, events };
}

/**
 * Leaving step 7p of the active side's Player Turn (B7: `advance` calls this whatever the turn held): each of its Major Powers whose capital is still lost
 * falls, one after the other, to the owner of the unit that holds the capital. Stops as soon as one of the falls ends the game.
 */
export function settleConquests(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  let next = state;
  const events: GameEvent[] = [];
  for (let n = 0; n < CONQUERED_BY_CAPITAL.length && next.phase === "player-turn"; n++) { // each fall takes a Power out of `fallingNow`, so there are at most as many as there are Powers
    const power = fallingNow(ctx, next, next.activeSide)[0];
    const conqueror = power === undefined ? null : controllerOf(ctx, next, capitalOf(ctx, power)!);
    if (power === undefined || conqueror === null) break;
    const done = fall(ctx, next, power, conqueror, "capital");
    next = done.state;
    events.push(...done.events);
  }
  return { state: next, events };
}

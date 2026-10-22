import type { GameEvent } from "./action-types";
import { afterHexTaken } from "./capture";
import type { GameContext } from "./context";
import { sideInWar } from "./control";
import { hostileGroundHexes, passControl, removePools, removeUnits, type PassRule, type RemovedUnit } from "./conquest-forces";
import type { Conquest } from "./conquest-record";
import type { HexId } from "./hex";
import { sideOfOwner } from "./setup";
import { evaluateVictory } from "./victory";
import { sideOfPower } from "./war";
import type { ForceOwner, GameState, PowerId, Side } from "./types";

/**
 * The stages of a fall, the same for every country (spec 14 C8). `conquer` runs them for a plan that says what is particular to the country that falls:
 * `fall()` (conquest.ts) builds the plan of a Major Power, `fallCountry` (conquest-minor.ts) that of a minor country, a colony or Eastern Europe, and spec 15
 * calls the second one. The order, and every event, is the same for all of them.
 *
 * Two extension points, `before` and `after`, are for the countries that need more than the stages. France uses both on every fall (ticket 14-7,
 * conquest-france.ts): `before` rolls the colony dice, halves its units into Vichy France and hands the colonies and the Vichy hexes over, so that the stages
 * remove only the rest; `after` writes the report. Italy's surrender (ticket 14-8) will keep part of its fleet for Germany. Every other fall leaves them out and
 * runs the plain stages.
 */

/** A step a particular fall adds: a pure function of the state, with the events to log. */
export type FallStep = (ctx: GameContext, state: GameState) => { state: GameState; events: GameEvent[] };

export interface FallPlan {
  /** The country that falls, as the Conquest record names it. */
  country: Conquest["country"];
  /** Whose nationality leaves with it: counters of that nationality held by another owner go too, and counters of another Major Power it holds go back (TODO(verify) V32). */
  who: string;
  /** The owners whose units and pools leave the game: the country itself and, for a Major Power, its active Minor-Allies. */
  owners: readonly ForceOwner[];
  conqueror: ForceOwner;
  /** The side the country fought on. */
  side: Side;
  how: Conquest["how"];
  /** For a Major Power: the BRPs it began the scenario with. */
  startingBrps?: number;
  /** Which hexes held by one of `owners` pass to the conqueror (true) and which become nobody's (false). */
  isHome: PassRule["isHome"];
  /** The country's own land when it is more than what `owners` hold (a minor country, a colony, Eastern Europe); see `PassRule.land`. */
  land?: ReadonlySet<HexId>;
  /** What the fall does to the records of the nations (status, BRPs, Minor-Allies). */
  mark: (state: GameState) => GameState;
  before?: FallStep;
  after?: FallStep;
}

/**
 * The units that leave the game when `who` falls, and the lent counters that go back (TODO(verify) V32). The owners' own counters go; so do counters of
 * the nationality that another owner holds (Italian ships in German hands go with Italy). A counter of another Major Power that the owners hold (the
 * Italian fleet Germany has in 1944) goes back to that Power if it is still in the war, and is removed otherwise.
 */
function leaving(state: GameState, who: string, owners: readonly ForceOwner[]): { ids: string[]; returned: [string, PowerId][] } {
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
 * A country falls to its conqueror (the owner of the unit that holds its capital). C8 steps 1 to 7:
 *  1. its units, and those of its active Minor-Allies, and their pools leave the game for good (TODO(verify) V10);
 *  2. the land it holds in its own country passes to the conqueror, the rest it held becomes nobody's (V11), except the hexes under hostile ground units (V12);
 *  3. the nation's records are marked (`plan.mark`: "conquered" and 0 BRPs for a Major Power);
 *  4. the Conquest is recorded, with the Game Turn (V4) and, for a Major Power, the BRPs it began the scenario with (V9);
 *  5. the events are written;
 *  6. counters of the conqueror's enemies left alone in a hex that passed are dealt with as in any capture (`afterHexTaken`);
 *  7. the game ends at once if this conquest decides it (`evaluateVictory(..., "after-conquest")`, V3).
 */
export function conquer(ctx: GameContext, state: GameState, plan: FallPlan): { state: GameState; events: GameEvent[] } {
  const first = plan.before ? plan.before(ctx, state) : { state, events: [] as GameEvent[] };
  const { ids, returned } = leaving(first.state, plan.who, plan.owners);
  // 1. units and pools
  const gone = removeUnits(first.state, ids);
  const units = { ...gone.state.units };
  for (const [id, home] of returned) {
    const { nationality: _lent, ...unit } = units[id]!;
    units[id] = { ...unit, owner: home };
  }
  let next: GameState = removePools({ ...gone.state, units }, plan.owners);
  // 2. land
  const conquerorSide = sideOfOwner(plan.conqueror);
  const passed = passControl(ctx, next, { from: plan.owners, to: plan.conqueror, keep: hostileGroundHexes(next, conquerorSide), isHome: plan.isHome, ...(plan.land ? { land: plan.land } : {}) });
  next = passed.state;
  // 3. and 4. status and record
  const record: Conquest = { country: plan.country, by: plan.conqueror, side: plan.side, how: plan.how, at: { year: state.year, season: state.season }, ...(plan.startingBrps !== undefined ? { startingBrps: plan.startingBrps } : {}) };
  next = { ...plan.mark(next), conquests: [...(state.conquests ?? []), record] };
  // 5. events
  const events: GameEvent[] = [...first.events, { type: "COUNTRY_CONQUERED", country: plan.country, by: plan.conqueror, how: plan.how, unitsRemoved: gone.removed.length, hexesPassed: passed.passed.toConqueror.length }];
  if (gone.removed.length > 0) events.push({ type: "UNITS_REMOVED_BY_CONQUEST", country: plan.country, units: gone.removed });
  if (passed.passed.toConqueror.length > 0) events.push({ type: "CONTROL_PASSED", country: plan.country, to: plan.conqueror, hexes: passed.passed.toConqueror });
  if (passed.passed.toNobody.length > 0) events.push({ type: "CONTROL_PASSED", country: plan.country, to: null, hexes: passed.passed.toNobody });
  // 6. counters left alone in the land that passed
  const swept = sweepPassed(ctx, next, passed.passed.toConqueror, conquerorSide);
  next = swept.state;
  events.push(...swept.events);
  const last = plan.after ? plan.after(ctx, next) : { state: next, events: [] as GameEvent[] };
  next = last.state;
  events.push(...last.events);
  // 7. is the game decided?
  const result = evaluateVictory(ctx, next, "after-conquest");
  if (result) {
    next = { ...next, phase: "game-over", result };
    events.push({ type: "GAME_OVER", year: next.year, season: next.season, result });
  }
  return { state: next, events };
}

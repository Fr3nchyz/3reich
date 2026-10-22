import type { GameEvent } from "./action-types";
import { fall } from "./conquest";
import { conquer, type FallPlan } from "./conquest-stages";
import type { GameContext } from "./context";
import { controllerOf, sideInWar } from "./control";
import { isGroundCombatUnit } from "./attack-rules";
import type { HexId } from "./hex";
import { isGone } from "./nations";
import { objectiveHexes, objectiveSide } from "./objectives";
import { IMPLEMENTED_STEPS } from "./sequence";
import { surrenderOffer } from "./soviet-record";
import type { GameState, Unit } from "./types";
import { germanRussianWar, RUSSIA_COUNTRY } from "./winter";

/**
 * The Russian surrender (spec 14 R7b to R7d; Ref 11.8, 18.41, Ops 5.49a). At step 10a of an Allied Player Turn, if Russia is at war with Germany, has fewer
 * than 50 ground and air factors on the map and the Axis has at least three halves of that many inside Russia's original borders, Russia offers to
 * surrender, once. The Axis answers (`SURRENDER_ANSWER`, victory-actions.ts). Accepted, the U.S.S.R. is conquered by Germany without its land changing hands: its
 * units and pool go, the Objectives it holds and those in Russia the Axis does not hold count for the Allies for good, Germany gets half of Russia's starting
 * BRPs in each Year Start Sequence, the 15s of Moscow and Leningrad stop and Russian land is closed to the Axis. Refused, Russia stays until its last factor
 * inside its borders is gone (`settleSoviet`), then it falls like any Power (`fall`, "last-unit"). The Occupation Force (ticket 14-17) and the screens (14-16) are not here.
 */

/** Ref 11.8: Russia offers to surrender with fewer than this many ground and air factors on the map. */
export const SURRENDER_FACTOR_LIMIT = 50;

/** Ref 11.8: the Axis factors inside Russia must be at least 3 to 2 of the Russian ones (`axis * 2 >= russian * 3`, so exactly 3 to 2 is enough). */
export const SURRENDER_RATIO = { axis: 3, russian: 2 } as const;

/** A counter whose strength is a ground or air factor. TODO(verify) V17: replacements and airborne count as ground; airbases, fleets and bridgeheads do not. */
const isFactor = (u: Unit): boolean => isGroundCombatUnit(u) || u.type === "air";

const sum = (units: Iterable<Unit>): number => [...units].reduce((n, u) => n + u.strength, 0);

/** The ground and air factors of the U.S.S.R. standing on map hexes (units in boxes off the map do not count, TODO(verify) V17). */
export function russianFactors(ctx: GameContext, state: GameState): number {
  return sum(Object.values(state.units).filter((u) => u.owner === "ussr" && isFactor(u) && ctx.map.hexes[u.at] !== undefined));
}

/** The Russian factors inside Russia's original borders (the map country "ussr"): the ones whose last loss conquers Russia after a refusal (R7d, TODO(verify) V20). */
export function russianFactorsInRussia(ctx: GameContext, state: GameState): number {
  return sum(Object.values(state.units).filter((u) => u.owner === "ussr" && isFactor(u) && ctx.map.hexes[u.at]?.country === RUSSIA_COUNTRY));
}

/** The Axis ground and air factors (Italians and active Minor-Allies included, TODO(verify) V17) standing inside Russia's original borders. */
export function axisFactorsInRussia(ctx: GameContext, state: GameState): number {
  return sum(Object.values(state.units).filter((u) => isFactor(u) && sideInWar(state, u.owner) === "axis" && ctx.map.hexes[u.at]?.country === RUSSIA_COUNTRY));
}

/** The two sums of the test and whether they pass it. `offered` is true when Russia would offer to surrender now, ignoring whether it already did and whose turn it is. */
export interface SovietOffer {
  russian: number;
  axis: number;
  offered: boolean;
}

/**
 * The test of R7b: Russia at war with Germany, fewer than 50 Russian factors on the map, and the Axis inside Russia at least 3 to 2 of the Russian total.
 * TODO(verify) V17: what counts as factors; V18: "at war with the Axis" is read as at war with Germany (the war the winter rule also looks for, V43).
 */
export function sovietOffer(ctx: GameContext, state: GameState): SovietOffer {
  const russian = russianFactors(ctx, state);
  const axis = axisFactorsInRussia(ctx, state);
  return { russian, axis, offered: germanRussianWar(state) && russian < SURRENDER_FACTOR_LIMIT && axis * SURRENDER_RATIO.russian >= russian * SURRENDER_RATIO.axis };
}

/**
 * The game arrives at step 10a. At the end of an Allied Player Turn in which the test of R7b is met, and the offer has not been made, Russia offers: the
 * record says "asking" and the game waits at 10a for the Axis (`surrenderAsking`). The offer is made once, whatever the answer (TODO(verify) V18). Nothing
 * is offered where the step is not built (a context that lists its own implemented steps without 10a), so a record never asks a question nobody can be asked.
 */
export function offerSurrender(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  const none = { state, events: [] as GameEvent[] };
  if (state.activeSide !== "allies" || surrenderOffer(state) !== "none" || !(ctx.implementedSteps ?? IMPLEMENTED_STEPS).has("10a")) return none;
  const test = sovietOffer(ctx, state);
  if (!test.offered) return none;
  return {
    state: { ...state, soviet: { citiesTaken: {}, ...state.soviet, offer: "asking" } },
    events: [{ type: "RUSSIA_OFFERS_SURRENDER", russian: test.russian, axis: test.axis }],
  };
}

/**
 * The Objectives the Allies hold for good once the surrender is accepted (R7c, R1, TODO(verify) V19): every Objective the U.S.S.R. holds, and every Objective
 * inside Russia's original borders that the Axis does not hold (a Russian marker is placed on it), in hex order.
 */
export function creditedObjectives(ctx: GameContext, state: GameState): HexId[] {
  return objectiveHexes(ctx)
    .filter((hex) => {
      const owner = controllerOf(ctx, state, hex);
      return owner === "ussr" || (ctx.map.hexes[hex]?.country === RUSSIA_COUNTRY && (owner === null || objectiveSide(state, owner) !== "axis"));
    })
    .sort();
}

/** The Axis accepts. Germany conquers the U.S.S.R. "by surrender"; see the header and `acceptPlan`. */
export function acceptSurrender(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  const credited = creditedObjectives(ctx, state);
  const plan: FallPlan = {
    country: "ussr",
    who: "ussr",
    owners: ["ussr"],
    conqueror: "germany",
    side: "allies",
    how: "surrender",
    startingBrps: ctx.scenario.nations.ussr.brpTotal,
    isHome: () => false,
    stays: true, // R7c: Russian land stays Russian-controlled, and closed to the Axis (TODO(verify) V19)
    mark: (s) => ({
      ...s,
      nations: { ...s.nations, ussr: { ...s.nations.ussr, status: "conquered", brpTotal: 0, spendLimit: 0, spent: 0 } },
      // Russia leaves the war (the card of D5): with the war on record, the Axis could still walk into the land the neutral rule closes to units not at war with its holder (movement.ts).
      wars: s.wars.filter(([a, b]) => a !== "ussr" && b !== "ussr"),
      soviet: { citiesTaken: {}, ...s.soviet, offer: "accepted", credited },
    }),
    before: (_ctx, s) => ({ state: s, events: [{ type: "RUSSIA_SURRENDERED" }] }),
    after: (_ctx, s) => ({ state: s, events: credited.length > 0 ? [{ type: "OBJECTIVES_CREDITED", hexes: credited }] : [] }),
  };
  return conquer(ctx, state, plan);
}

/** The Axis refuses: the offer is not made again, and nothing else changes now (R7d; the Occupation Force is ticket 14-17). */
export function refuseSurrender(state: GameState): { state: GameState; events: GameEvent[] } {
  return { state: { ...state, soviet: { citiesTaken: {}, ...state.soviet, offer: "refused" } }, events: [{ type: "SURRENDER_REFUSED" }] };
}

/**
 * After a refusal, Russia is conquered when its last ground or air factor inside its original borders is gone (R7d). Checked after every Combat Phase and
 * after the unsupplied-unit eliminations (`turn.ts`; the engine has no "instant", TODO(verify) V20). Germany conquers it as it would conquer any Power
 * (`fall`: the Russian units and pool go, Russian land passes to Germany, TODO(verify) V20), and the game ends at once if that decides it. Nothing happens
 * when the offer was not refused, when Russia has left already, or when Germany has (nobody to conquer it).
 */
export function settleSoviet(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.phase !== "player-turn" || surrenderOffer(state) !== "refused" || isGone(state.nations.ussr) || isGone(state.nations.germany)) return { state, events: [] };
  if (russianFactorsInRussia(ctx, state) > 0) return { state, events: [] };
  return fall(ctx, state, "ussr", "germany", "last-unit");
}

import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, type Action, type GameEvent } from "../src/engine/actions";
import type { GameContext } from "../src/engine/context";
import type { GameState, GameTurn, Scenario, Unit } from "../src/engine/types";
import { board } from "./board";
import { CTX } from "./helpers";

/** Positions of the Free Siberian Transfer (spec 14 ticket 14-18, R11): the Allied Player Turn at step 8a, Germany and the U.S.S.R. at war. */

export const WINTER_41: GameTurn = { year: 1941, season: "winter" };
export const SPRING_42: GameTurn = { year: 1942, season: "spring" };
export const SUMMER_42: GameTurn = { year: 1942, season: "summer" };
export const FALL_42: GameTurn = { year: 1942, season: "fall" };

/** Russian cities on the map: Moscow, Kazan, Tula, Kiev, Gorki, Kalinin. */
export const MOSCOW = "H47";
export const KAZAN = "E54";
export const TULA = "J46";
export const KIEV = "O39";
export const GORKI = "F50";
export const KALININ = "G46";
/** Not a city: a plain hex of Russia. Warsaw is a city, and not Russian. */
export const PLAIN = "A49";
export const WARSAW = "M35";

/** The Allied Player Turn at step 8a of `turn` (the Axis moved first), Russia an Allied Power at war with Germany, the pools as the scenario starts them; the 1939 scenario by default. */
export function at8a(units: Unit[] = [], tweak: Partial<GameState> = {}, scenario: Scenario = SCENARIO_1939, turn: GameTurn = WINTER_41): GameState {
  const base = board(units, scenario, {});
  return {
    ...base,
    year: turn.year,
    season: turn.season,
    firstSide: "axis",
    activeSide: "allies",
    position: { part: "player-turn", turn: 2, step: "8a" },
    wars: [...base.wars, ["germany", "ussr"]],
    nations: { ...base.nations, ussr: { ...base.nations.ussr, status: "allied", brpTotal: 60, spendLimit: 30 } },
    winter: { stage: "over", inForce: "1941-winter", asking: false },
    ...tweak,
  };
}

type Transfer = Extract<Action, { type: "SIBERIAN_TRANSFER" }>;
export const transfer = (type: "infantry" | "armor", strength: number, at: string): Transfer => ({ type: "SIBERIAN_TRANSFER", side: "allies", unit: { type, strength }, at });

/** Applies one action and returns the new state, throwing the refusal's reason. */
export function apply(s: GameState, a: Action, ctx: GameContext = CTX): { state: GameState; events: GameEvent[] } {
  const r = applyAction(ctx, s, a);
  if (!r.ok) throw new Error(r.error);
  return { state: r.state, events: r.events };
}

/** Takes the units in order (each `[type, strength, at]`), returning the state after the last. */
export function takeAll(s: GameState, takes: readonly (readonly ["infantry" | "armor", number, string])[], ctx: GameContext = CTX): GameState {
  return takes.reduce((st, [type, strength, at]) => apply(st, transfer(type, strength, at), ctx).state, s);
}

/** The reason an action is refused, or undefined when it is accepted. */
export const refusal = (s: GameState, a: Action, ctx: GameContext = CTX): string | undefined => {
  const r = applyAction(ctx, s, a);
  return r.ok ? undefined : r.error;
};

/** The pool of the U.S.S.R. changed: this is its Allowable Builds. */
export const withPool = (s: GameState, allowableBuilds: NonNullable<GameState["pools"]["ussr"]>["allowableBuilds"]): GameState => ({ ...s, pools: { ...s.pools, ussr: { ...s.pools.ussr!, allowableBuilds } } });

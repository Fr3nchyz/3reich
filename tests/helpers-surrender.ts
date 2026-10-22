import { SCENARIO_1939 } from "../src/data/scenario-1939";
import type { GameContext } from "../src/engine/context";
import { applyAction } from "../src/engine/actions";
import type { GameEvent } from "../src/engine/action-types";
import { objectiveHexes } from "../src/engine/objectives";
import { settle } from "../src/engine/turn";
import type { ForceOwner, GameState, Scenario, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

/** Positions of Russia's offer to surrender (spec 14 ticket 14-15, R7b to R7d): Winter 1941, Germany and the U.S.S.R. at war, the Allied Player Turn about to leave step 9k. */

/** Hexes inside the original Russian border (the map country "ussr") and two outside it. */
export const IN = ["A49", "A50", "B49", "B50", "C49", "C50", "D49", "D50", "E49", "E50"] as const;
export const OUT = "M33";
export const MOSCOW = "H47";
export const LENINGRAD = "D44";
export const STALINGRAD = "N49";

export const ger = (id: string, at: string, strength = 3, owner: ForceOwner = "germany"): Unit => counter(id, owner, "infantry", strength, at, 3);
export const rus = (id: string, at: string, strength = 4): Unit => counter(id, "ussr", "infantry", strength, at, 3);
export const air = (id: string, owner: ForceOwner, at: string, strength = 4): Unit => counter(id, owner, "air", strength, at, 5);

/** `n` units of strength 4 of `owner` in Russia, one to a hex of `IN` first, then stacked: ids `${prefix}1`... */
export function many(prefix: string, owner: ForceOwner, n: number, strength = 4, at: readonly string[] = IN): Unit[] {
  return Array.from({ length: n }, (_, i) => counter(`${prefix}${i + 1}`, owner, "infantry", strength, at[i % at.length]!, 3));
}

/**
 * The Allied Player Turn of Winter 1941 (the second one, the Axis moved first) with the game about to leave step 9k, so `settle` arrives at 10a and Russia may offer.
 * Germany and the U.S.S.R. are at war; the U.S.S.R. is an Allied Power with 60 BRPs; the Winter record says the winter has been (no roll).
 */
export function at9k(units: Unit[], tweak: Partial<GameState> = {}, scenario: Scenario = SCENARIO_1939): GameState {
  const base = board(units, scenario, {});
  return {
    ...base,
    year: 1941,
    season: "winter",
    firstSide: "axis",
    activeSide: "allies",
    position: { part: "player-turn", turn: 2, step: "9k" },
    wars: [...base.wars, ["germany", "ussr"]],
    nations: { ...base.nations, ussr: { ...base.nations.ussr, status: "allied", brpTotal: 60, spendLimit: 30 } },
    winter: { stage: "over", inForce: "1941-winter", asking: false },
    ...tweak,
  };
}

/** Russia with `r` strength-4 factors (r a multiple of 4) and the Axis with `a` strength-4 factors inside Russia. 40 against 60 is exactly 3 to 2. */
export const sides = (r: number, a: number, tweak: Partial<GameState> = {}, scenario: Scenario = SCENARIO_1939): GameState => at9k([...many("r", "ussr", r / 4, 4, IN.slice(0, 5)), ...many("g", "germany", a / 4, 4, IN.slice(5))], tweak, scenario);

/** The game after the Allied Player Turn arrives at 10a: where Russia may offer. */
export const arrive = (s: GameState, ctx: GameContext = CTX) => settle(ctx, s);

/** The state waiting at 10a with the offer made (40 against 60 factors). */
export function asked(tweak: Partial<GameState> = {}, scenario: Scenario = SCENARIO_1939): GameState {
  const r = arrive(sides(40, 60, tweak, scenario), ctxFor(scenario));
  if (r.state.soviet?.offer !== "asking") throw new Error("the offer was not made");
  return r.state;
}

/** The offer made and waiting, in a position of the caller's own (it must meet the test). */
export function askedWith(units: Unit[], tweak: Partial<GameState> = {}, scenario: Scenario = SCENARIO_1939): GameState {
  const r = arrive(at9k(units, tweak, scenario), ctxFor(scenario));
  if (r.state.soviet?.offer !== "asking") throw new Error("the offer was not made");
  return r.state;
}

export const answer = (s: GameState, accept: boolean, ctx: GameContext = CTX) => {
  const r = applyAction(ctx, s, { type: "SURRENDER_ANSWER", side: "axis", accept });
  if (!r.ok) throw new Error(r.error);
  return r;
};

export const eventsOf = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T): Extract<GameEvent, { type: T }>[] => events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

/** An Objective hex outside Russia, to give to someone. */
export const objectiveOutside = (): string => objectiveHexes(CTX).find((h) => CTX.map.hexes[h]!.country !== "ussr")!;

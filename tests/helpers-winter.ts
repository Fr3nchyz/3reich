import { SCENARIO_1939 } from "../src/data/scenario-1939";
import type { ForceOwner, GameState, Scenario, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { ALL_OFFENSIVE } from "./helpers";

/** Positions of the Russian winter (spec 14 tickets 14-12 and 14-13): Winter 1941, Germany and the U.S.S.R. at war, the winter in force. */

/** Hexes of the original Russian border's inside (the map country "ussr"), chosen on the map: a plain hex with a plain hex beside it, a mountain, a swamp, a river between two. */
export const PLAIN = { at: "A49", from: "A50" } as const;
export const MOUNTAIN = { at: "A64", from: "A65" } as const;
export const SWAMP = { at: "M38", from: "M39" } as const;
export const RIVER = { at: "A47", from: "B47", other: "B46" } as const; // B47 is across a river from A47; B46 is not
/** Two plain hexes of Germany and Poland, outside Russia. */
export const OUTSIDE = { at: "M33", from: "M32" } as const;

export const KEY = "1941-winter";
export const WINTER: NonNullable<GameState["winter"]> = { stage: "over", inForce: KEY, asking: false };

/** The Allies' turn at step 7h of Winter 1941 (the second Player Turn), Germany and the U.S.S.R. at war; `winter` is the record (the winter in force by default). */
export function allied7h(units: Unit[], tweak: Partial<GameState> = {}, winter: GameState["winter"] | null = WINTER, scenario: Scenario = SCENARIO_1939): GameState {
  const base = board(units, scenario, {});
  return {
    ...base,
    year: 1941,
    season: "winter",
    firstSide: "axis",
    activeSide: "allies",
    position: { part: "player-turn", turn: 2, step: "7h" },
    frontOptions: ALL_OFFENSIVE, // attacks need the Offensive Option (spec 16 Q1)
    wars: [...base.wars, ["germany", "ussr"]],
    nations: { ...base.nations, ussr: { ...base.nations.ussr, status: "allied" } },
    ...(winter ? { winter } : {}),
    ...tweak,
  };
}

export const ger = (id: string, at: string, owner: ForceOwner = "germany", strength = 3): Unit => counter(id, owner, "infantry", strength, at, 3);
export const rus = (id: string, at: string, strength = 4): Unit => counter(id, "ussr", "infantry", strength, at, 3);


/** The Axis turn of Winter 1941 at step 3, the war with Russia on, Germany with BRPs to pay for an Option. */
export function axis3(winter: GameState["winter"] | null = WINTER, tweak: Partial<GameState> = {}): GameState {
  const s = allied7h([], { activeSide: "axis", frontOptions: {}, position: { part: "player-turn", turn: 1, step: "3" }, ...tweak }, winter);
  return { ...s, nations: { ...s.nations, germany: { ...s.nations.germany, brpTotal: 100, spent: 0 } } };
}

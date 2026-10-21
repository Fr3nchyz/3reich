import { newGame } from "../src/engine/game";
import { objectiveHexes, objectiveStandings } from "../src/engine/objectives";
import type { GameState, Scenario } from "../src/engine/types";
import { ctxFor } from "./helpers";

/** A game where the Allies hold `allies` of the Objectives somebody holds at the start and the Axis the rest; the neutral ones stay with nobody, as in the scenario. */
export function withSplit(scenario: Scenario, allies: number, siberian = false): GameState {
  const base = newGame(scenario, 1);
  const s = objectiveStandings(ctxFor(scenario), base);
  const held = [...s.axis, ...s.allies].sort();
  const control = Object.fromEntries(held.map((h, i) => [h, i < allies ? "britain" : "germany"] as const));
  return { ...base, control, ...(siberian ? { siberian: { used: true, taken: { "1941-winter": 1 } } } : {}) };
}

/** Every one of the 42 Objectives held by someone: the Allies hold `allies`, the Axis the rest (so both sides can reach a level at once). */
export function allHeld(scenario: Scenario, allies: number): GameState {
  const hexes = objectiveHexes(ctxFor(scenario));
  return { ...newGame(scenario, 1), control: Object.fromEntries(hexes.map((h, i) => [h, i < allies ? "britain" : "germany"] as const)) };
}

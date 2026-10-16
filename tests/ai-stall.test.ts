import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/ai";
import { ATTACK_MAX_EXCHANGE_FACTORS, ATTACK_STALL_MAX_EXCHANGE_FACTORS, ATTACK_STALL_TURNS } from "../src/ai/assault";
import { createMemory, type AiMemory } from "../src/ai/memory";
import { turnIndex } from "../src/engine/game";
import type { ForceOwner, GameState, Unit, UnitType } from "../src/engine/types";
import { CTX, atStart } from "./helpers";
import { SCENARIO_1939 } from "../src/data/scenario-1939";

// The stall rule is computer POLICY (spec 05, "What staging does not fix"), not a rule of the game: a side that has made no real
// ground attack for ATTACK_STALL_TURNS Game Turns accepts a riskier Exchange for the rest of that Game Turn.
// M32 is German plain next to M33 (Poznan, Polish city on plain, defence x2): 25 against 5x2 is 2-1 but could cost 10 factors.

const u = (id: string, owner: ForceOwner, strength: number, at: string, type: UnitType = "infantry"): Unit => ({ id, owner, type, strength, at });
const position = (year: number): GameState => ({
  ...atStart(SCENARIO_1939, 1), year, activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7h" },
  units: Object.fromEntries([u("g1", "germany", 25, "M32"), u("p1", "poland", 5, "M33")].map((x) => [x.id, x])),
});
/** The same position `n` Game Turns later. */
const later = (s: GameState, n: number): GameState => {
  for (let year = s.year; year <= s.year + 2; year++) for (const season of ["spring", "summer", "fall", "winter"] as const) if (turnIndex({ year, season }) - turnIndex(s) === n) return { ...s, year, season };
  throw new Error("no such turn");
};
const END = { type: "END_STEP", side: "axis", step: "7h" };
const decide = (s: GameState, memory?: AiMemory) => chooseAction(CTX, s, { seed: 1, memory })!;

describe("the stall rule (computer policy)", () => {
  it("its numbers are the ones the tests assume", () => {
    expect(ATTACK_MAX_EXCHANGE_FACTORS).toBeLessThan(10);
    expect(ATTACK_STALL_MAX_EXCHANGE_FACTORS).toBeGreaterThanOrEqual(10);
    expect(ATTACK_STALL_TURNS).toBe(2);
  });

  it("without a memory the Exchange limit never lifts", () => {
    expect(decide(position(1939)).action).toEqual(END);
    expect(decide(position(1941)).action).toEqual(END);
  });

  it("with a memory it waits at first, then attacks after two quiet Game Turns, in that Game Turn only", () => {
    const memory = createMemory();
    const first = position(1939);
    expect(decide(first, memory).action).toEqual(END); // the first call starts the count
    expect(memory.quietSince.axis).toBe(turnIndex(first));
    const one = later(first, 1);
    expect(decide(one, memory).action).toEqual(END);
    const two = later(first, 2);
    expect(turnIndex(two) - turnIndex(first)).toBe(ATTACK_STALL_TURNS);
    const d = decide(two, memory);
    expect(d.action).toMatchObject({ type: "ATTACK", target: "M33" });
    expect(d.why).toMatch(/odds 2-1/);
    expect(memory.quietSince.axis).toBe(turnIndex(two)); // a real attack ends the quiet spell
    expect(memory.stallTurn.axis).toBe(turnIndex(two));
  });

  it("stays lifted for the rest of that Game Turn after the attack, then the next Game Turn is back to the normal limit", () => {
    const memory = createMemory();
    const first = position(1939);
    decide(first, memory);
    const two = later(first, 2);
    decide(two, memory); // lifted, attacks
    expect(decide(two, memory).action.type).toBe("ATTACK"); // the same turn, asked again
    const next = later(first, 3);
    expect(decide(next, memory).action).toEqual(END);
  });

  it("each side counts its own quiet spell", () => {
    const memory = createMemory();
    const s = position(1939);
    decide(s, memory);
    expect(memory.quietSince.allies).toBeUndefined();
  });

  it("does not lift the odds floor: 12 against 5x2 is 6-5, under 2-1 and is still refused after a long quiet spell", () => {
    const memory = createMemory();
    const base = position(1939);
    const weak = { ...base, units: { g1: u("g1", "germany", 12, "M32"), p1: u("p1", "poland", 5, "M33") } };
    decide(weak, memory);
    expect(decide(later(weak, 6), memory).action).toEqual(END);
  });
});

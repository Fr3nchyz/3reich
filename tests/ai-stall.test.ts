import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/ai";
import { ATTACK_DEEP_STALL_MAX_EXCHANGE_FACTORS, ATTACK_DEEP_STALL_TURNS, ATTACK_MAX_EXCHANGE_FACTORS, ATTACK_STALL_MAX_EXCHANGE_FACTORS, ATTACK_STALL_TURNS } from "../src/ai/assault";
import { createMemory, type AiMemory } from "../src/ai/memory";
import { legalActions } from "../src/engine/actions";
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

// spec 05 Stall breaker, TODO(verify) AER70: policy thresholds and the existing quietSince ledger.
describe("the deep stall tier (computer policy)", () => {
  const costly = (defense = 10, attack = defense * 4): GameState => ({
    ...position(1939), units: { g1: u("g1", "germany", attack, "M32"), p1: u("p1", "poland", defense, "M33") },
  });
  const quiet = (s: GameState) => {
    const memory = createMemory();
    expect(decide(s, memory).action).toEqual(END);
    return memory;
  };

  it("exports the four-turn / 24-factor policy constants", () => {
    expect(ATTACK_DEEP_STALL_TURNS).toBe(4);
    expect(ATTACK_DEEP_STALL_MAX_EXCHANGE_FACTORS).toBe(24);
  });

  it("refuses a legal 20-factor Exchange at 2-1 after three quiet turns, accepts it after four", () => {
    const s = costly();
    const memory = quiet(s);
    expect(decide(later(s, 3), memory).action).toEqual(END);
    const four = later(s, 4);
    const d = decide(four, memory);
    expect(legalActions(CTX, four)).toContainEqual(d.action);
    expect(d.action).toMatchObject({ type: "ATTACK", target: "M33" });
    expect(d.why).toMatch(/10 \(x2\), odds 2-1/);
    expect(memory.quietSince.axis).toBe(turnIndex(four));
    expect(decide(later(s, 5), memory).action).toEqual(END);
    expect(decide(later(s, 7), memory).action).toEqual(END);
    expect(decide(later(s, 8), memory).action.type).toBe("ATTACK");
  });

  it("accepts exactly 24, refuses 26 even after a longer quiet spell", () => {
    const edge = costly(12);
    expect(decide(later(edge, 4), quiet(edge)).action.type).toBe("ATTACK");
    const over = costly(13);
    expect(decide(later(over, 6), quiet(over)).action).toEqual(END);
  });

  it("uses multiplied defence at x3 as well as plain x2", () => {
    // Ref 4.5 / spec 05: mountain defence x3, the same multiplier as a full fortress.
    const s = { ...position(1939), units: { g1: u("g1", "germany", 48, "Q33"), p1: u("p1", "poland", 8, "Q34") } };
    const memory = quiet(s);
    expect(decide(later(s, 3), memory).action).toEqual(END);
    const d = decide(later(s, 4), memory);
    expect(d.action.type).toBe("ATTACK");
    expect(d.why).toMatch(/8 \(x3\), odds 2-1/);
  });

  it("keeps the two-turn / 16 tier and the normal 8 cap", () => {
    const edge = costly(8);
    const memory = quiet(edge);
    expect(decide(later(edge, 1), memory).action).toEqual(END);
    expect(decide(later(edge, 2), memory).action.type).toBe("ATTACK");
    const over = costly(9);
    expect(decide(later(over, 2), quiet(over)).action).toEqual(END);
  });

  it("a cheaper real attack restarts the four-turn wait", () => {
    const s = costly();
    const memory = quiet(s);
    expect(decide(later(position(1939), 3), memory).action.type).toBe("ATTACK");
    expect(decide(later(s, 4), memory).action).toEqual(END);
    expect(decide(later(s, 6), memory).action).toEqual(END);
    expect(decide(later(s, 7), memory).action.type).toBe("ATTACK");
  });

  it("sweeps do not restart the quiet spell", () => {
    const s = costly();
    const memory = quiet(s);
    const sweep = later({ ...s, units: { ...s.units, p1: u("p1", "poland", 10, "M33", "air") } }, 3);
    expect(decide(sweep, memory).action.type).toBe("ATTACK");
    expect(memory.quietSince.axis).toBe(turnIndex(s));
    expect(decide(later(s, 4), memory).action.type).toBe("ATTACK");
  });

  it("requires memory and keeps each side's quiet spell separate", () => {
    const s = costly();
    expect(decide(later(s, 6)).action).toEqual(END);
    const memory = createMemory();
    memory.quietSince.allies = turnIndex(s);
    expect(decide(later(s, 4), memory).action).toEqual(END);
    expect(memory.quietSince.allies).toBe(turnIndex(s));
  });

  it("keeps both odds floors after four quiet turns", () => {
    // No printed-factor superiority: 29 against 10x2 is 1-1, still below 2-1.
    const weak = costly(10, 29);
    expect(decide(later(weak, 4), quiet(weak)).action).toEqual(END);
    // Threefold printed superiority keeps the existing 1-1 exception.
    const superior = costly(10, 30);
    const d = decide(later(superior, 4), quiet(superior));
    expect(d.action.type).toBe("ATTACK");
    expect(d.why).toMatch(/odds 1-1/);
  });
});

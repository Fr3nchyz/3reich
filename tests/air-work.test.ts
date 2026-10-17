import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { airBasesOf } from "../src/engine/air-bases";
import { airOf } from "../src/engine/air-record";
import { hasAirMoveWork, powersWithReserve } from "../src/engine/air-work";
import { settle } from "../src/engine/turn";
import type { GameState, Unit } from "../src/engine/types";
import { CTX } from "./helpers";
import { at6f, inf } from "./helpers-move";

// Spec 09, ticket 09-13 (C5): step 6f waits for air work too. German bases on the real 1939 map: J30, J32, K28, K29, K32, K33, L31 (docs: air-stage.test.ts).
// Ground work is absent in these positions (no ground unit), so the step waits only if a plane could change base or an airbase could be placed.

const air = (id: string, at: string, owner: Unit["owner"] = "germany"): Unit => inf(id, owner, at, 3, 4, "air");
const SPENT = { airbasesPlaced: { germany: 3, italy: 3, ussr: 3, britain: 3, france: 3, usa: 3 } };
const board = (units: Unit[], tweak: Partial<GameState> = {}): GameState => at6f(units, "axis", SCENARIO_1939, { nextUnitId: 100, ...tweak });
const stepAfter = (s: GameState): string | undefined => {
  const p = settle(CTX, s).state.position;
  return p?.part === "player-turn" ? p.step : undefined;
};

describe("step 6f waits for air work (spec 09 C5)", () => {
  it("a plane that could change base keeps the step open although no ground unit can move", () => {
    const s = board([air("a1", "J32")], SPENT);
    expect(hasAirMoveWork(CTX, s)).toBe(true);
    expect(stepAfter(s)).toBe("6f");
  });

  it("an airbase left to place keeps the step open with no plane and no ground unit", () => {
    const s = board([]);
    expect(powersWithReserve(s)).toContain("germany");
    expect(hasAirMoveWork(CTX, s)).toBe(true);
    expect(stepAfter(s)).toBe("6f");
  });

  it("nothing to do: the only plane has changed base this turn and every airbase is placed, so the step is passed as before", () => {
    const s = board([air("a1", "J32")], SPENT);
    const done: GameState = { ...s, air: { ...airOf(s), staged: ["a1"] } };
    expect(hasAirMoveWork(CTX, done)).toBe(false);
    expect(stepAfter(done)).not.toBe("6f");
  });

  it("planes and airbases of the other side do not count", () => {
    const s = board([air("b1", "J32", "britain")], SPENT);
    expect(hasAirMoveWork(CTX, s)).toBe(false);
    expect(stepAfter(s)).not.toBe("6f");
    expect(powersWithReserve(board([], { airbasesPlaced: { germany: 3, italy: 3 } }))).toEqual([]);
  });

  it("a plane whose every base in reach is full does not count", () => {
    const alone = board([air("a1", "J32")], SPENT);
    const others = airBasesOf(CTX, alone, "axis").filter((h) => h !== "J32");
    expect(others.length).toBeGreaterThan(3);
    const full = board([air("a1", "J32"), ...others.map((h, i) => inf(`f${i}`, "germany", h, 5, 4, "air"))], SPENT);
    expect(hasAirMoveWork(CTX, alone)).toBe(true);
    expect(hasAirMoveWork(CTX, full)).toBe(false);
  });

  it("the room of a base is the plane's factors exactly: room for 3 counts, room for 2 does not", () => {
    const alone = board([air("a1", "J32")], SPENT); // a 3-factor plane
    const others = airBasesOf(CTX, alone, "axis").filter((h) => h !== "J32");
    const fill = (spare: number) => board([air("a1", "J32"), ...others.map((h, i) => inf(`f${i}`, "germany", h, i === 0 ? 5 - spare : 5, 4, "air"))], SPENT);
    expect(hasAirMoveWork(CTX, fill(3))).toBe(true);
    expect(hasAirMoveWork(CTX, fill(2))).toBe(false);
  });

  it("a plane of the other side that could change base does not count for the side to move", () => {
    const probe = board([], SPENT);
    const mine = (h: string) => board([air("b1", h, "britain")], SPENT);
    const base = airBasesOf(CTX, probe, "allies").find((h) => hasAirMoveWork(CTX, { ...mine(h), activeSide: "allies" }));
    expect(base, "a base from which a British plane can change base").toBeDefined();
    const brit = mine(base!);
    expect(hasAirMoveWork(CTX, { ...brit, activeSide: "allies" })).toBe(true); // the plane itself can change base
    expect(hasAirMoveWork(CTX, brit)).toBe(false); // but it is not the Axis side's work
  });

  it("a plane of the other side that the engine would refuse to stage does not make the step wait (a British airbase counter held by the Axis at the start of its turn)", () => {
    // The airbase is British and now held by Britain, but Germany held the hex when the Axis turn began, so `stageProblem` alone would let the Axis "stage" a British plane to it.
    const s0 = board([air("b1", "L32", "britain"), { id: "x1", owner: "britain", type: "airbase", strength: 0, at: "L33" }], SPENT);
    const s: GameState = { ...s0, control: { ...s0.control, L33: "britain" }, air: { ...airOf(s0), controlAtStart: { ...s0.control, L33: "germany" } } };
    expect(hasAirMoveWork(CTX, s)).toBe(false);
  });

  it("a base the side did not hold when its turn began does not count (the engine's own stage test decides)", () => {
    const s = board([air("a1", "J32")], SPENT);
    const others = airBasesOf(CTX, s, "axis").filter((h) => h !== "J32");
    const lost = { ...s, air: { ...airOf(s), controlAtStart: Object.fromEntries(others.map((h) => [h, "poland"])) } } as GameState;
    expect(hasAirMoveWork(CTX, s)).toBe(true);
    expect(hasAirMoveWork(CTX, lost)).toBe(false);
  });
});

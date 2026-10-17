import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/ai";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { autoSetup } from "../src/engine/autosetup";
import type { GameContext } from "../src/engine/context";
import { newGame } from "../src/engine/game";
import { hasMoveWork } from "../src/engine/move-action";
import { movesOf } from "../src/engine/move-record";
import { settle } from "../src/engine/turn";
import type { GameState } from "../src/engine/types";
import { CTX, NO_AIRBASES_LEFT } from "./helpers";
import { at6f, errorOf, inf, move, movesIn, okOf } from "./helpers-move";

// Step 6f as a step of the Sequence of Play (Ops 5.45f): when it waits, what it lists, how it refuses bad input.

const waitingAt = (s: GameState) => (s.position?.part === "player-turn" ? s.position.step : undefined);
const fromStart = (units: Parameters<typeof at6f>[0], step = "5") => settle(CTX, at6f(units, "axis", SCENARIO_1939, { position: { part: "player-turn", turn: 1, step } })).state;

describe("the step waits only while some unit can move", () => {
  it("waits at 6f when a unit can move, and lists MOVE actions besides ending the step", () => {
    const s = fromStart([inf("u1", "germany", "L32")]);
    expect(waitingAt(s)).toBe("6f");
    const moves = movesIn(legalActions(CTX, s));
    expect(moves.length).toBeGreaterThan(0);
    expect(legalActions(CTX, s).some((a) => a.type === "END_STEP" && a.step === "6f")).toBe(true);
  });

  it("is passed, and recorded as passed, when no unit can move", () => {
    const s = settle(CTX, at6f([inf("u1", "germany", "L32", 2, 0, "replacement")], "axis", SCENARIO_1939, { airbasesPlaced: NO_AIRBASES_LEFT, position: { part: "player-turn", turn: 1, step: "5" } }));
    expect(hasMoveWork(CTX, at6f([inf("u1", "germany", "L32", 2, 0, "replacement")]))).toBe(false);
    expect(waitingAt(s.state)).not.toBe("6f");
    expect(s.events.flatMap((e) => (e.type === "STEPS_PASSED" ? e.steps : []))).toContain("6f");
  });

  it("is passed when every unit that could move has moved", () => {
    const after = okOf(move(at6f([inf("u1", "germany", "L32")]), ["u1"], ["L33"])).state;
    expect(hasMoveWork(CTX, after)).toBe(false);
  });

  it("ending the step moves on to 6g/7h and the moves are kept", () => {
    const s1 = okOf(move(fromStart([inf("u1", "germany", "L32")]), ["u1"], ["L33"])).state;
    const r = okOf(applyAction(CTX, s1, { type: "END_STEP", side: "axis", step: "6f" }));
    expect(waitingAt(r.state)).not.toBe("6f");
    expect(r.state.units.u1!.at).toBe("L33");
    expect(movesOf(r.state).moved).toEqual(["u1"]);
  });

  it("refuses MOVE at any other step, naming the step", () => {
    const s = { ...at6f([inf("u1", "germany", "L32")]), position: { part: "player-turn" as const, turn: 1 as const, step: "7h" } };
    expect(errorOf(move(s, ["u1"], ["L33"]))).toMatch(/Ground units are moved in step 6f.*7h/);
  });
});

describe("legalActions lists every reachable destination with its path", () => {
  const s = at6f([inf("u1", "germany", "L32", 3, 3), inf("u2", "germany", "L32", 4, 6, "armor"), inf("u3", "germany", "N31", 2, 3)]);
  const moves = movesIn(legalActions(CTX, s));

  it("each unit alone, and the two-unit stack in L32 at the slowest factor", () => {
    expect(new Set(moves.map((m) => m.units.join("+")))).toEqual(new Set(["u1", "u2", "u1+u2", "u3"]));
    for (const m of moves.filter((m) => m.units.length === 2)) expect(m.path.length).toBeLessThanOrEqual(3);
    expect(Math.max(...moves.filter((m) => m.units.join() === "u2").map((m) => m.path.length))).toBe(6);
  });

  it("every listed action is accepted by applyAction, and a move never listed is refused", () => {
    for (const m of moves) expect(applyAction(CTX, s, m).ok, JSON.stringify(m)).toBe(true);
    const dests = new Set(moves.filter((m) => m.units.join() === "u1").map((m) => m.path.at(-1)));
    expect(dests.has("L35")).toBe(true);
    expect(dests.has("L36")).toBe(false);
    expect(errorOf(move(s, ["u1"], ["L33", "L34", "L35", "L36"]))).not.toBe("");
  });

  it("only the last hex of each path is a place to end: no listed move ends on a full hex", () => {
    const full = at6f([inf("u1", "germany", "L32"), inf("u2", "germany", "L33"), inf("u3", "germany", "L33")]);
    for (const m of movesIn(legalActions(CTX, full)).filter((m) => m.units.join() === "u1")) expect(m.path.at(-1)).not.toBe("L33");
  });

  it("is deterministic: the same state lists the same actions", () => {
    expect(movesIn(legalActions(CTX, s))).toEqual(moves);
  });
});

/** An array of length 2 whose first entry is a hole: `some` and `map` skip it. */
const withHole = (last: string): string[] => {
  const a = new Array<string>(2);
  a[1] = last;
  return a;
};

describe("malformed MOVE actions are refused without throwing", () => {
  const s = at6f([inf("u1", "germany", "L32")]);
  const bad: [string, unknown][] = [
    ["null", null],
    ["a string", "MOVE"],
    ["no units", { type: "MOVE", side: "axis", path: ["L33"] }],
    ["units not an array", { type: "MOVE", side: "axis", units: "u1", path: ["L33"] }],
    ["empty units", { type: "MOVE", side: "axis", units: [], path: ["L33"] }],
    ["a sparse units array", { type: "MOVE", side: "axis", units: withHole("u1"), path: ["L33"] }],
    ["a sparse path array", { type: "MOVE", side: "axis", units: ["u1"], path: withHole("L33") }],
    ["unit ids that are not strings", { type: "MOVE", side: "axis", units: [1], path: ["L33"] }],
    ["a duplicate unit", { type: "MOVE", side: "axis", units: ["u1", "u1"], path: ["L33"] }],
    ["an inherited property as unit id", { type: "MOVE", side: "axis", units: ["__proto__"], path: ["L33"] }],
    ["constructor as unit id", { type: "MOVE", side: "axis", units: ["constructor"], path: ["L33"] }],
    ["an unknown unit", { type: "MOVE", side: "axis", units: ["u9"], path: ["L33"] }],
    ["no path", { type: "MOVE", side: "axis", units: ["u1"] }],
    ["path not an array", { type: "MOVE", side: "axis", units: ["u1"], path: "L33" }],
    ["an empty path", { type: "MOVE", side: "axis", units: ["u1"], path: [] }],
    ["a path of numbers", { type: "MOVE", side: "axis", units: ["u1"], path: [33] }],
    ["an inherited property as hex", { type: "MOVE", side: "axis", units: ["u1"], path: ["__proto__"] }],
    ["toString as hex", { type: "MOVE", side: "axis", units: ["u1"], path: ["toString"] }],
    ["a hex off the map", { type: "MOVE", side: "axis", units: ["u1"], path: ["ZZ99"] }],
    ["the wrong side", { type: "MOVE", side: "allies", units: ["u1"], path: ["L33"] }],
    ["no side", { type: "MOVE", units: ["u1"], path: ["L33"] }],
    ["an unknown type", { type: "TELEPORT", units: ["u1"], path: ["L33"] }],
  ];
  for (const [name, action] of bad) {
    it(`refuses ${name}`, () => {
      const r = applyAction(CTX, s, action as Action);
      expect(r.ok).toBe(false);
      expect(JSON.stringify(s)).toBe(JSON.stringify(at6f([inf("u1", "germany", "L32")])));
    });
  }

  it("does not throw when the move record in the state is damaged", () => {
    const broken = { ...s, moves: { turn: "x", moved: "u1" } } as unknown as GameState;
    expect(applyAction(CTX, broken, { type: "MOVE", side: "axis", units: ["u1"], path: ["L33"] }).ok).toBe(true);
  });
});

describe("replay determinism", () => {
  it("the same moves from the same state give the same state and events, by replay too", () => {
    const start = at6f([inf("u1", "germany", "L32", 3, 4), inf("u2", "germany", "M31", 3, 3), inf("p1", "poland", "M34", 2, 3)]);
    const actions: Action[] = [
      { type: "MOVE", side: "axis", units: ["u1"], path: ["L33", "L34"] },
      { type: "MOVE", side: "axis", units: ["u2"], path: ["M32", "M33"] },
      { type: "END_STEP", side: "axis", step: "6f" },
    ];
    const a = replay(CTX, start, actions);
    const b = replay(CTX, start, actions);
    expect(b).toEqual(a);
    expect(a.state.units.u1!.at).toBe("L34");
    expect(a.state.control).toMatchObject({ L34: "germany", M33: "germany" });
  });

  it("a real game: the actions listed at 6f in each scenario apply, and replay from the setup", () => {
    for (const scenario of [SCENARIO_1939, SCENARIO_1942, SCENARIO_1944]) {
      const ctx = { map: MAP, scenario };
      let state = newGame(scenario, 5);
      for (const a of autoSetup(ctx, state)) state = okOf(applyAction(ctx, state, a)).state;
      const played: Action[] = [];
      for (let guard = 0; guard < 80 && waitingAt(state) !== "6f"; guard++) {
        const d = chooseAction(ctx, state, { seed: 5 })!;
        state = okOf(applyAction(ctx, state, d.action)).state;
        played.push(d.action);
      }
      expect(waitingAt(state), scenario.name).toBe("6f");
      const moves = movesIn(legalActions(ctx, state));
      expect(moves.length, scenario.name).toBeGreaterThan(50);
      for (let i = 0; i < moves.length; i += 29) expect(applyAction(ctx, state, moves[i]!).ok, JSON.stringify(moves[i])).toBe(true);
      const mine = moves[Math.floor(moves.length / 2)]!;
      const after = okOf(applyAction(ctx, state, mine)).state;
      expect(replay(ctx, newGameSetUp(ctx, 5), [...played, mine]).state).toEqual(after);
    }
  });
});

function newGameSetUp(ctx: GameContext, seed: number): GameState {
  let state = newGame(ctx.scenario, seed);
  for (const a of autoSetup(ctx, state)) state = okOf(applyAction(ctx, state, a)).state;
  return state;
}

import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/ai";
import { distanceToEnemyObjective, groundDistances } from "../src/ai/geo";
import { createMemory } from "../src/ai/memory";
import { chooseRedeploy, sendTowardFront, SR_KEEP_CAPITAL_GARRISON, SR_MIN_GAIN, SR_NATION_ORDER } from "../src/ai/redeploy";
import { applyAction, type Action } from "../src/engine/actions";
import { srDestinations } from "../src/engine/sr-region";
import type { GameState, Unit } from "../src/engine/types";
import { auditRedeployed } from "../scripts/selfplay/audit";
import { runGame } from "../scripts/selfplay/runner";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Spec 16 part E, ticket 16-20 (Ref 11.72): the computer's Strategic Redeployment at step 9e is POLICY. 1939 map: Berlin L31, Munich Q27,
// Warsaw M35 (Polish, an objective), Rome Y22. The engine decides what is legal; these tests pin which legal answer the computer picks.
type Sr = Extract<Action, { type: "SR_UNITS" }>;
const inf = (id: string, owner: Unit["owner"], at: string): Unit => counter(id, owner, "infantry", 2, at, 3);
const rep = (id: string, owner: Unit["owner"], at: string): Unit => counter(id, owner, "replacement", 1, at);
const at9e = (units: Unit[], tweak: Partial<GameState> = {}): GameState =>
  board(units, undefined, { activeSide: "axis", position: { part: "player-turn", turn: 1, step: "9e" }, ...tweak });
const withItaly = (units: Unit[]): GameState => {
  const s = board([]);
  return at9e(units, { nations: { ...s.nations, italy: { ...s.nations.italy, status: "axis" } } });
};
const gain = (s: GameState, owner: "germany" | "italy", from: string, to: string): number => {
  const d = distanceToEnemyObjective(CTX, s, owner, "axis");
  return d.get(from)! - d.get(to)!;
};
// The shipped SR_MIN_GAIN (10) reaches only far rear areas; the tests that need a move use the smaller gain the position offers.
const MIN = 3;
const pick = (s: GameState, cfg = { seed: 1 }) => chooseRedeploy(CTX, s, cfg, MIN) ?? chooseAction(CTX, s, cfg)!;
const isSr = (a: Action): a is Sr => a.type === "SR_UNITS";
const used = (n: number): Partial<GameState> => ({ sr: { turn: "1939-fall-axis", used: { germany: n }, moved: [], escorted: {} } });

describe("what the computer redeploys (SR_MIN_GAIN)", () => {
  it("sends a Replacement from the rear to a hex at least SR_MIN_GAIN hexes closer to its target, and the engine accepts it", () => {
    const s = at9e([rep("r1", "germany", "Q27")]);
    const d = pick(s);
    expect(isSr(d.action)).toBe(true);
    const a = d.action as Sr;
    expect(a.units).toEqual(["r1"]);
    expect(gain(s, "germany", "Q27", a.to)).toBeGreaterThanOrEqual(MIN);
    expect(applyAction(CTX, s, a).ok).toBe(true);
    expect(d.why).toMatch(/Replacement/);
  });

  it("picks the reachable hex closest to the target, not just any hex that gains enough", () => {
    const s = at9e([rep("r1", "germany", "Q27")]);
    const a = pick(s).action as Sr;
    const d = distanceToEnemyObjective(CTX, s, "germany", "axis");
    // No other hex the Replacement may be sent to is closer.
    for (const alt of ["L31", "L32", "L33", "L34", "M34"]) {
      if (applyAction(CTX, s, { type: "SR_UNITS", side: "axis", units: ["r1"], to: alt }).ok) expect(d.get(a.to)!).toBeLessThanOrEqual(d.get(alt)!);
    }
  });

  it("sends the unit to the closest hex it can reach, and a unit of the biggest gain before a smaller one", () => {
    const s = at9e([rep("r1", "germany", "R28"), rep("r2", "germany", "K28")]);
    const a = pick(s).action as Sr;
    expect(a.units).toEqual(["r2"]);
    const from = new Map<string, string>();
    distanceToEnemyObjective(CTX, s, "germany", "axis", from);
    const d = groundDistances(CTX, s, "germany", [from.get("K28")!]); // the distances to the unit's own target
    const reach = srDestinations(CTX, s, s.units.r2!).map((h) => d.get(h) ?? Infinity);
    expect(d.get(a.to)).toBe(Math.min(...reach));
  });

  it("the gain needed is exact: a hex SR_MIN_GAIN closer is enough, one more is not", () => {
    const s = at9e([rep("r1", "germany", "Q27")]);
    const g = gain(s, "germany", "Q27", (pick(s).action as Sr).to);
    expect(chooseRedeploy(CTX, s, { seed: 1 }, g)).toBeDefined();
    expect(chooseRedeploy(CTX, s, { seed: 1 }, g + 1)).toBeUndefined();
  });

  it("a lone Replacement on a capital is no garrison and goes", () => {
    const s = withItaly([rep("r1", "italy", "Y22")]);
    expect((pick(s).action as Sr).units).toEqual(["r1"]);
  });

  it("does not move a unit that is already near its target: no hex gains SR_MIN_GAIN, so the step is ended", () => {
    const s = at9e([inf("g1", "germany", "M34")]);
    const d = pick(s);
    expect(d.action).toEqual({ type: "END_STEP", side: "axis", step: "9e" });
    expect(sendTowardFront(CTX, s, ["g1"], { seed: 1 }, MIN)).toBeNull();
  });

  it("Replacements go first, then the other units", () => {
    const s = at9e([inf("a1", "germany", "Q27"), rep("r1", "germany", "Q27")]);
    expect((pick(s).action as Sr).units).toEqual(["r1"]);
    const after = applyAction(CTX, s, pick(s).action);
    if (!after.ok) throw new Error(after.error);
    expect((pick(after.state).action as Sr).units).toEqual(["a1"]);
  });

  it("goes nation by nation in SR_NATION_ORDER", () => {
    expect(SR_NATION_ORDER[0]).toBe("germany");
    const s = withItaly([rep("i1", "italy", "Y22"), inf("g1", "germany", "Q27")]);
    const a = pick(s).action as Sr;
    expect(a.units).toEqual(["g1"]);
  });

  it("keeps the last ground unit on a capital its side holds; a Replacement there is no garrison and goes", () => {
    expect(SR_KEEP_CAPITAL_GARRISON).toBe(true);
    const alone = withItaly([inf("i1", "italy", "Y22")]);
    expect(pick(alone).action.type).toBe("END_STEP");
    expect(sendTowardFront(CTX, alone, ["i1"], { seed: 1 }, MIN)).toBeNull();
    const two = withItaly([inf("i1", "italy", "Y22"), inf("i2", "italy", "Y22")]);
    expect(pick(two).action.type).toBe("SR_UNITS");
    const newly = withItaly([inf("i1", "italy", "Y22"), rep("r1", "italy", "Y22")]);
    expect((pick(newly).action as Sr).units).toEqual(["r1"]);
  });

  it("never moves the whole stack off the capital in one go (sendTowardFront on both units)", () => {
    const two = withItaly([inf("i1", "italy", "Y22"), inf("i2", "italy", "Y22")]);
    expect(sendTowardFront(CTX, two, ["i1", "i2"], { seed: 1 }, MIN)).toBeNull();
    expect(sendTowardFront(CTX, two, ["i1"], { seed: 1 }, MIN)).not.toBeNull();
  });

  it("uses no more than the nation's allowance: with 8 of 9 used, one unit goes and then the step ends", () => {
    const s = at9e([rep("r1", "germany", "Q27"), rep("r2", "germany", "Q27")], used(8));
    const first = pick(s);
    expect(first.action.type).toBe("SR_UNITS");
    const r = applyAction(CTX, s, first.action);
    if (!r.ok) throw new Error(r.error);
    expect(chooseRedeploy(CTX, r.state, { seed: 1 }, MIN)).toBeUndefined();
  });

  it("a unit next to an enemy ground unit is not redeployed (the engine refuses it, the computer never asks)", () => {
    const s = at9e([rep("r1", "germany", "L34"), counter("p1", "poland", "infantry", 2, "M34", 3)]);
    expect(chooseRedeploy(CTX, s, { seed: 1 }, MIN)).toBeUndefined();
    expect(sendTowardFront(CTX, s, ["r1"], { seed: 1 }, MIN)).toBeNull();
  });

  it("is the same choice for the same seed, and sendTowardFront names the same hex as the step does", () => {
    const s = at9e([rep("r1", "germany", "Q27")]);
    expect(pick(s, { seed: 4 })).toEqual(pick(s, { seed: 4 }));
    expect(sendTowardFront(CTX, s, ["r1"], { seed: 4 }, MIN)).toBe((pick(s, { seed: 4 }).action as Sr).to);
  });

  it("sendTowardFront answers null for unknown ids, an empty list and units in different hexes, and changes nothing", () => {
    const s = at9e([rep("r1", "germany", "Q27"), rep("r2", "germany", "L31")]);
    const before = JSON.stringify(s);
    expect(sendTowardFront(CTX, s, ["nobody"], { seed: 1 }, MIN)).toBeNull();
    expect(sendTowardFront(CTX, s, [], { seed: 1 }, MIN)).toBeNull();
    expect(sendTowardFront(CTX, s, ["r1", "r2"], { seed: 1 }, MIN)).toBeNull();
    expect(JSON.stringify(s)).toBe(before);
  });

  it("remembers the target it sent a unit toward, so the mover keeps it (AiMemory)", () => {
    const s = at9e([rep("r1", "germany", "Q27")]);
    const memory = createMemory();
    pick(s, { seed: 1, memory } as { seed: number });
    expect(memory.targets.has("r1")).toBe(true);
    const keep = createMemory();
    sendTowardFront(CTX, s, ["r1"], { seed: 1, memory: keep }, MIN);
    expect(keep.targets.size).toBe(0);
  });
});

describe("the shipped gain", () => {
  it("SR_MIN_GAIN is 10: a Replacement 6 hexes from the front is not sent, a gain below it never is (AER50)", () => {
    expect(SR_MIN_GAIN).toBe(10);
    const s = at9e([rep("r1", "germany", "Q27")]);
    expect(sendTowardFront(CTX, s, ["r1"])).toBeNull();
    expect(chooseRedeploy(CTX, s, { seed: 1 })).toBeUndefined();
    expect(chooseAction(CTX, s, { seed: 1 })!.action.type).toBe("END_STEP");
  });
});

describe("self-play checks (ticket 16-20)", () => {
  it("a computer game redeploys, ends normally and has no anomaly; the report counts the redeployments per nation", () => {
    const r = runGame({ scenario: "1939", seed: 1, turns: 6 });
    expect(r.anomalies).toEqual([]);
    const n = r.turns.reduce((t, x) => t + x.redeployed.germany, 0);
    expect(n).toBeGreaterThan(0);
  });

  it("flags a redeployment that ends next to an enemy unit, and none that does not", () => {
    const s = at9e([inf("g1", "germany", "M34"), counter("p1", "poland", "infantry", 2, "M35", 3)]);
    const ev = (to: string) => [{ type: "UNITS_REDEPLOYED" as const, units: ["g1"], from: "L31", to, nation: "germany" as const, left: 8 }];
    expect(auditRedeployed(CTX, ev("M34"), s, "axis").map((f) => f.kind)).toEqual(["redeploy-near-enemy"]);
    expect(auditRedeployed(CTX, ev("L31"), s, "axis")).toEqual([]);
    expect(auditRedeployed(CTX, [], s, "axis")).toEqual([]);
  });
});

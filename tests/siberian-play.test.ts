import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { chooseWithoutRedeploying } from "./helpers-redeploy";
import { SIBERIAN_TAKE_ALL } from "../src/ai/siberian";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import type { GameEvent } from "../src/engine/action-types";
import { sideToAct } from "../src/engine/actor";
import { availableBuilds } from "../src/engine/construction";
import { newGame } from "../src/engine/game";
import { SIBERIAN_QUOTAS, siberianCities } from "../src/engine/siberian";
import type { GameState, Scenario } from "../src/engine/types";
import { turnKey } from "../src/engine/victory";
import { MAP } from "../src/data/map";
import { runGame, type Hooks } from "../scripts/selfplay/runner";
import type { ScenarioKey } from "../scripts/selfplay/scenarios";
import { SCENARIOS } from "../scripts/selfplay/scenarios";
import { computerTick, computerToMove } from "../src/ui/computerPlay";
import { newWatchSession } from "../src/ui/watchPlay";
import { statusHtml } from "../src/ui/statusView";

// Spec 14 ticket 14-18 (hazards 1 and 3 of the brief): whole computer games through the Free Siberian Transfer. At every state the legal list is not empty and the right side acts;
// the computer takes the units the rules allow and never more; the flag reaches the result; the recorded actions replay to the same state.

type Choose = NonNullable<Hooks["choose"]>;
type Transfer = Extract<Action, { type: "SIBERIAN_TRANSFER" }>;

interface Seen {
  states: number;
  at8a: number;
  sides: Set<string>;
}

/** Looks at every state before the computer chooses (the runner calls the chooser once for every action it takes), then lets the computer choose. */
function probing(seen: Seen): Choose {
  return (ctx, state, cfg) => {
    seen.states++;
    const legal = legalActions(ctx, state);
    expect(legal.length, "legalActions is never empty in play").toBeGreaterThan(0);
    seen.sides.add(sideToAct(state));
    if (state.position?.part === "player-turn" && state.position.step === "8a") {
      seen.at8a++;
      expect(sideToAct(state)).toBe("allies");
      expect(state.activeSide).toBe("allies");
      expect(legal[legal.length - 1]).toEqual({ type: "END_STEP", side: "allies", step: "8a" });
      expect(legal.filter((a) => a.type !== "SIBERIAN_TRANSFER").length, "the way on is the only other action").toBe(1);
    }
    const decision = chooseWithoutRedeploying(ctx, state, cfg);
    expect(decision, "the computer always has an action").not.toBeNull();
    return decision;
  };
}

interface Audit {
  taken: { turn: string; action: Transfer; before: GameState; after: GameState }[];
  perTurn: Record<string, { infantry: number; armor: number }>;
}

/** Replays the game's actions, collecting every unit taken with the states around it. */
function audit(scenario: Scenario, seed: number, actions: readonly Action[]): Audit {
  const ctx = { map: MAP, scenario };
  let state = newGame(scenario, seed);
  const out: Audit = { taken: [], perTurn: {} };
  for (const a of actions) {
    const r = applyAction(ctx, state, a);
    if (!r.ok) throw new Error(r.error);
    if (a.type === "SIBERIAN_TRANSFER") {
      const turn = turnKey(state);
      out.taken.push({ turn, action: a, before: state, after: r.state });
      const t = (out.perTurn[turn] ??= { infantry: 0, armor: 0 });
      t[a.unit.type === "armor" ? "armor" : "infantry"]++;
    }
    state = r.state;
  }
  return out;
}

/** The pool entry a unit taken came from: the first of its kind the Transfer could take (victory-actions.ts takes the first). */
const takenEntry = (t: Audit["taken"][number]) => availableBuilds(t.before, "ussr").find((e) => e.type === t.action.unit.type && e.strength === t.action.unit.strength);

/** Every rule of R11 over the units a game took. */
function expectRules(scenario: Scenario, a: Audit): void {
  const ctx = { map: MAP, scenario };
  for (const t of a.taken) {
    expect(SIBERIAN_QUOTAS[t.turn], `${t.turn} has a Transfer`).toBeGreaterThan(0);
    expect(t.before.position).toMatchObject({ part: "player-turn", step: "8a" });
    expect(t.before.activeSide).toBe("allies");
    expect(siberianCities(ctx, t.before), `${t.action.at} is a Russian city on a supply line`).toContain(t.action.at);
    expect(ctx.map.hexes[t.action.at]!.country).toBe("ussr");
    expect(t.after.nations.ussr.brpTotal, "free of charge").toBe(t.before.nations.ussr.brpTotal);
    expect(Object.keys(t.after.units).length).toBe(Object.keys(t.before.units).length + 1);
  }
  for (const [turn, n] of Object.entries(a.perTurn)) {
    expect(n.infantry + n.armor, `${turn}: no more than the quota`).toBeLessThanOrEqual(SIBERIAN_QUOTAS[turn]!);
    expect(n.armor, `${turn}: armor does not outnumber infantry`).toBeLessThanOrEqual(n.infantry);
  }
}

const played = new Map<string, ReturnType<typeof playOnce>>();
/** One game of the computer, played once per file (a scenario given by the test is its own game). */
function play(key: ScenarioKey, seed: number, scenario?: Scenario) {
  const id = `${key}:${seed}:${scenario ? "variant" : "plain"}`;
  return played.get(id) ?? played.set(id, playOnce(key, seed, scenario)).get(id)!;
}

function playOnce(key: ScenarioKey, seed: number, scenario?: Scenario) {
  const seen: Seen = { states: 0, at8a: 0, sides: new Set() };
  const result = runGame({ scenario: key, seed, turns: "end" }, { choose: probing(seen), ...(scenario ? { scenario } : {}) });
  return { seen, result };
}

describe("whole computer games", () => {
  // Spec 17 (ticket 17-1): a Russian infantry lost before Summer 1942 is back in the pool, so the computer takes two infantry in Summer 1942 where it took an infantry
  // and an armor before (the armor rule lets armor in only behind infantry, V60).
  it("1942 seed 1: three units in Spring 1942, two in Summer, none in Fall, and every rule holds", () => {
    expect(SIBERIAN_TAKE_ALL).toBe(true);
    const { seen, result } = play("1942", 1);
    expect(result.anomalies).toEqual([]);
    expect(result.final.phase).toBe("game-over");
    const a = audit(SCENARIOS["1942"], 1, result.actions);
    expectRules(SCENARIOS["1942"], a);
    expect(a.perTurn).toEqual({ "1942-spring": { infantry: 3, armor: 0 }, "1942-summer": { infantry: 2, armor: 0 } });
    expect(seen.at8a, "the game waited at 8a in Spring and Summer, and after the quota").toBeGreaterThanOrEqual(2);
    expect(result.final.siberian).toMatchObject({ used: true, taken: { "1942-spring": 3, "1942-summer": 2 } });
    expect(result.final.result!.siberian).toBe(true);
    expect(seen.sides.has("allies") && seen.sides.has("axis")).toBe(true);
  }, 240_000);

  // Spec 17 (ticket 17-1): the scenario's Russian builds are all built by Winter 1941, as before, but lost Russian units are back in the pool, so Winter 1941 now has
  // four to take (TODO(verify) RB12; it answers V58).
  it("the Campaign: in Winter 1941 the units taken are Russian losses back in the pool (the scenario's builds are all built), and Spring 1942 takes three more", () => {
    const { result } = play("campaign", 1);
    expect(result.anomalies).toEqual([]);
    const a = audit(SCENARIOS.campaign, 1, result.actions);
    expectRules(SCENARIOS.campaign, a);
    expect(a.perTurn["1941-winter"]).toEqual({ infantry: 3, armor: 1 });
    for (const t of a.taken.filter((x) => x.turn === "1941-winter")) expect(takenEntry(t)?.returned, `${t.turn}: a counter that came back`).toBe(true);
    expect(a.perTurn["1942-spring"]).toEqual({ infantry: 3, armor: 0 });
    expect(result.final.siberian?.used).toBe(true);
    expect(result.final.result!.siberian).toBe(true);
  }, 240_000);

  // Spec 17 (ticket 17-1) answers V58: before it, this game had nothing to take (the Russian Allowable Builds are all built by Winter 1941, and a lost unit did not come
  // back), so the Transfer was never used in a 1939 game of the computer. Now the Russian losses are back in the pool and are taken (TODO(verify) RB12).
  it("1939 seed 1: the Russian Allowable Builds are all built by Winter 1941, so every unit taken is a Russian loss back in the pool; every rule holds and the flag is set", () => {
    const { seen, result } = play("1939", 1);
    expect(result.anomalies).toEqual([]);
    const a = audit(SCENARIOS["1939"], 1, result.actions);
    expectRules(SCENARIOS["1939"], a);
    expect(a.perTurn).toEqual({ "1941-winter": { infantry: 3, armor: 1 }, "1942-spring": { infantry: 3, armor: 0 } }); // Ticket 15-8 (merged with 15-8a: the allies also inherit the wars; Winter 1941 takes 3 infantry and 1 armor)
    // Ticket 15-8 (the Axis allies wake in Summer 1941): the game changed and Spring 1942 takes the whole quota of three. // Ticket 16-13 (the computer exploits): the game changed and Spring 1942 has two Russian losses back in the pool to take (it took 3 before). // Ticket 15-5 (conquered income): the game changed and Summer 1942 has no Russian loss left to take (it took 2 before). // Summer 1942 takes 2 since Attrition is live (ticket 16-4 wiring; the game differs after the first Attrition runs); Spring 1942 took 1 before ticket 16-1; with the Front Options paid for the computer has the units to take the whole quota of three (no seed of 1 to 12 gives 1 now)
    for (const t of a.taken) {
      expect(availableBuilds(t.before, "ussr").filter((e) => !e.returned && (e.type === "infantry" || e.type === "armor")), "the scenario's builds are used up").toEqual([]);
      expect(takenEntry(t)?.returned).toBe(true);
    }
    expect(seen.at8a).toBeGreaterThanOrEqual(2);
    expect(result.final.siberian).toMatchObject({ used: true });
    expect(result.final.result!.siberian).toBe(true);
  }, 240_000);

  it("the 1944 scenario is exempt: no unit, no stop", () => {
    const { seen, result } = play("1944", 1);
    expect(result.anomalies).toEqual([]);
    expect(seen.at8a).toBe(0);
    expect(result.final.siberian).toBeUndefined();
  }, 240_000);

  it("a 1939 game with a Russian pool that is not used up takes the nine units of its three Game Turns, and the result is read with the Transfer tables", () => {
    const base = SCENARIO_1939.forces.ussr!;
    const nine: Scenario = {
      ...SCENARIO_1939,
      forces: { ...SCENARIO_1939.forces, ussr: { ...base, allowableBuilds: [...base.allowableBuilds, { type: "infantry", strength: 2, movement: 3, count: 300, from: { year: 1941, season: "winter" } }] } },
    };
    const { seen, result } = play("1939", 1, nine);
    expect(result.anomalies).toEqual([]);
    const a = audit(nine, 1, result.actions);
    expectRules(nine, a);
    const total = (t: string) => (a.perTurn[t]?.infantry ?? 0) + (a.perTurn[t]?.armor ?? 0);
    expect([total("1941-winter"), total("1942-spring"), total("1942-summer"), total("1942-fall")]).toEqual([4, 3, 2, 0]);
    expect(a.taken).toHaveLength(9);
    expect(seen.at8a).toBeGreaterThanOrEqual(3);
    expect(result.final.siberian).toMatchObject({ used: true, taken: { "1941-winter": 4, "1942-spring": 3, "1942-summer": 2 } });
    expect(result.final.result!.siberian).toBe(true);
    // The recorded game replays to the same final state.
    const ctx = { map: MAP, scenario: nine };
    expect(replay(ctx, newGame(nine, 1), result.actions).state).toEqual(result.final);
  }, 240_000);
});

describe("in the browser's session", () => {
  it("a watched game: the computer takes the units and ends the step by itself, and no card is drawn for a watcher", () => {
    const s = newWatchSession(SCENARIOS["1942"], 1, "turbo", null);
    let at8a = 0;
    for (let guard = 0; guard < 4000 && s.state.phase === "player-turn" && !(s.state.year === 1942 && s.state.season === "summer"); guard++) {
      if (s.state.position?.part === "player-turn" && s.state.position.step === "8a") {
        at8a++;
        expect(computerToMove(s)).toBe(true);
        expect(statusHtml(s, null, []), "no card for a watcher").not.toContain("siberian-card");
      }
      if (computerTick(s) === "stuck") break;
    }
    expect(at8a).toBeGreaterThan(0);
    expect(s.state.siberian?.taken["1942-spring"]).toBe(3);
    expect(s.log.filter((l) => l.startsWith("Free Siberian Transfer: a 3-factor infantry appears in")).length).toBe(3);
    expect(s.log.some((l) => l.includes("The Allied targets are now one objective higher."))).toBe(true);
  }, 240_000);

  it("the events of the game are one SIBERIAN_TRANSFER_USED for each unit, `left` counting down", () => {
    const { result } = play("1942", 1);
    const events: GameEvent[] = replay({ map: MAP, scenario: SCENARIOS["1942"] }, newGame(SCENARIOS["1942"], 1), result.actions).events;
    const used = events.filter((e): e is Extract<GameEvent, { type: "SIBERIAN_TRANSFER_USED" }> => e.type === "SIBERIAN_TRANSFER_USED");
    expect(used.map((e) => e.left)).toEqual([2, 1, 0, 1, 0]);
    expect(used.map((e) => e.firstUse)).toEqual([true, false, false, false, false]);
  }, 240_000);
});

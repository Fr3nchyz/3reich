import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { applyAction, type GameEvent } from "../src/engine/actions";
import type { GameContext } from "../src/engine/context";
import { newGame } from "../src/engine/game";
import { sideInWar } from "../src/engine/control";
import { citiesNamedHeldByAxis } from "../src/engine/soviet-income";
import { SUPPLY_EFFECTS_ENABLED } from "../src/engine/supply-effects";
import type { GameState } from "../src/engine/types";
import { runGame } from "../scripts/selfplay/runner";
import { chooseWithoutRedeploying } from "./helpers-redeploy";
import { SCENARIOS, type ScenarioKey } from "../scripts/selfplay/scenarios";

// Spec 14 ticket 14-14 (R7a), whole computer games that take Moscow and Leningrad: the 15 BRPs move once for each city even though control swings back and forth,
// the Year Start Sequence moves another 15 for each city the Axis holds when it runs, and replaying the recorded actions gives the same state.

interface Step { index: number; before: GameState; after: GameState; events: GameEvent[] }

/** Replays a recorded game, keeping the state before and after each action that wrote one of the events we look at. */
function replay(scenario: ScenarioKey, seed: number): { steps: Step[]; final: GameState; ended: string } {
  const run = runGame({ scenario, seed, turns: "end", verify: false }, { choose: chooseWithoutRedeploying });
  expect(run.anomalies).toEqual([]);
  const ctx: GameContext = { map: MAP, scenario: SCENARIOS[scenario], supplyEffects: SUPPLY_EFFECTS_ENABLED };
  let state = newGame(SCENARIOS[scenario], seed);
  const steps: Step[] = [];
  run.actions.forEach((action, index) => {
    const res = applyAction(ctx, state, action);
    if (!res.ok) throw new Error(`action ${index} refused: ${res.error}`);
    if (res.events.some((e) => e.type === "RUSSIA_BRPS_MOVED" || e.type === "HEX_CONTROL_CHANGED" || (e.type === "BRPS_CHANGED" && e.reason.startsWith("Year Start Sequence")))) steps.push({ index, before: state, after: res.state, events: res.events });
    state = res.state;
  });
  expect(state).toEqual(run.final);
  return { steps, final: state, ended: run.ended };
}

const CITIES = ["H47", "D44"];


describe.each([["1939", 8], ["1942", 1]] as const)("a whole computer game, %s seed %i, takes Moscow and Leningrad", (scenario, seed) => {
  const g = replay(scenario, seed);
  const CTX: GameContext = { map: MAP, scenario: SCENARIOS[scenario], supplyEffects: SUPPLY_EFFECTS_ENABLED };
  const moved = g.steps.flatMap((s) => s.events.filter((e) => e.type === "RUSSIA_BRPS_MOVED").map((e) => ({ s, e })));

  it("ends normally and both cities were paid for exactly once each", () => {
    expect(g.ended).toBe("game-over");
    expect(moved.map((m) => (m.e.type === "RUSSIA_BRPS_MOVED" ? m.e.city : "")).sort()).toEqual(["leningrad", "moscow"]);
    expect(g.final.soviet).toEqual({ citiesTaken: { moscow: true, leningrad: true } });
  });
  it("control of at least one city swung back and forth, and the payment was still made once (a city retaken and lost again)", () => {
    const axisTakes = (hex: string) => g.steps.flatMap((s) => s.events).filter((e) => e.type === "HEX_CONTROL_CHANGED" && e.hex === hex && sideInWar(g.final, e.to) === "axis").length;
    expect(Math.max(...CITIES.map(axisTakes))).toBeGreaterThanOrEqual(2);
  });
  it("each payment moves exactly 15 from the Soviet total to Germany's in that one action, and the sum of the two does not change", () => {
    for (const { s, e } of moved) {
      if (e.type !== "RUSSIA_BRPS_MOVED") continue;
      expect(s.after.nations.germany.brpTotal - s.before.nations.germany.brpTotal, `action ${s.index}`).toBe(e.amount);
      expect(s.before.nations.ussr.brpTotal - s.after.nations.ussr.brpTotal, `action ${s.index}`).toBe(e.lost);
      expect(e.amount).toBe(15);
    }
  });
  it("the Year Start Sequence log names exactly the cities the Axis holds (one or both), and none otherwise", () => {
    const yss = g.steps.filter((s) => s.events.some((e) => e.type === "BRPS_CHANGED" && e.reason.startsWith("Year Start Sequence")));
    expect(yss.length).toBeGreaterThan(0);
    let withCities = 0;
    for (const s of yss) {
      const named = citiesNamedHeldByAxis(CTX, s.before).map((c) => (c === "moscow" ? "Moscow" : "Leningrad")).join(" and ");
      const held = named === "" ? 0 : 1;
      const lines = s.events.filter((e): e is Extract<GameEvent, { type: "BRPS_CHANGED" }> => e.type === "BRPS_CHANGED" && e.reason.startsWith("Year Start Sequence"));
      const germany = lines.find((l) => l.nation === "germany");
      expect(germany === undefined || germany.reason.includes(`for ${named} held by the Axis`), `action ${s.index}`).toBe(held > 0);
      if (held > 0) withCities++;
    }
    expect(withCities).toBeGreaterThan(0);
  });
});

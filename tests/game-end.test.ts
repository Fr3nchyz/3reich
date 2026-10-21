import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import type { GameEvent } from "../src/engine/action-types";
import type { GameState, Scenario } from "../src/engine/types";
import { verdictName } from "../src/engine/victory-record";
import { ctxFor, started } from "./helpers";

// Spec 14 R3 (ticket 14-3): the game ends with a result. Ref 2.0: the result is read at the end of play.

/** Plays by always taking the last legal action (move on), as state.test.ts does; returns the final state, every event and the actions. */
function playOut(scenario: Scenario, stop?: (s: GameState) => boolean) {
  const ctx = ctxFor(scenario);
  const initial = started(scenario, 1);
  let state = initial;
  const events: GameEvent[] = [];
  const actions: Action[] = [];
  for (let guard = 0; guard < 2000; guard++) {
    if (stop?.(state)) break;
    const legal = legalActions(ctx, state);
    if (legal.length === 0) break;
    const next = legal.at(-1)!;
    const r = applyAction(ctx, state, next);
    if (!r.ok) throw new Error(r.error);
    actions.push(next);
    events.push(...r.events);
    state = r.state;
  }
  return { ctx, initial, state, events, actions };
}

describe("the last turn ends the game with a result", () => {
  it("1939: nothing is held differently at the end, so the Allies' 23 Objectives are an Allied Decisive Victory; GameState.result and GAME_OVER carry it", () => {
    const { state, events } = playOut(SCENARIO_1939);
    expect(state.phase).toBe("game-over");
    expect(state.result).toEqual({
      winner: "allies", level: "decisive", basis: "objectives", objectives: { axis: 9, allies: 23, nobody: 10 },
      at: { year: 1942, season: "summer" }, early: false, siberian: false,
    });
    const over = events.filter((e) => e.type === "GAME_OVER");
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ type: "GAME_OVER", year: 1942, season: "summer", result: state.result });
    expect(verdictName(state.result!)).toBe("Allied Decisive Victory");
  });

  it("1942: the Axis' 25 Objectives are an Axis Decisive Victory", () => {
    const { state } = playOut(SCENARIO_1942);
    expect(state.phase).toBe("game-over");
    expect(verdictName(state.result!)).toBe("Axis Decisive Victory");
    expect(state.result!.at).toEqual(SCENARIO_1942.end);
  });

  it("1944: Germany stands at the end, an Axis Decisive Victory by the turn limit (TODO(verify) V5)", () => {
    const { state } = playOut(SCENARIO_1944);
    expect([state.result!.winner, state.result!.level, state.result!.basis]).toEqual(["axis", "decisive", "turn-limit"]);
  });

  it("the Campaign: the Winter 1943 count is remembered on the way, and nothing is conquered, so a Stalemate", () => {
    const { state } = playOut(SCENARIO_CAMPAIGN);
    expect(state.victory).toEqual({ checkpoints: { "1943-winter": 9 } });
    expect(state.result).toMatchObject({ winner: null, level: null, basis: "turn-limit", early: false });
    expect(verdictName(state.result!)).toBe("Stalemate");
  });

  it("the result is not there before the end, and is set once, with the phase", () => {
    const { state } = playOut(SCENARIO_1939, (s) => s.year === 1942 && s.season === "summer" && s.activeSide !== s.firstSide);
    expect(state.phase).toBe("player-turn");
    expect(state.result).toBeUndefined();
  });

  it("nothing is legal after the end and the result stays", () => {
    const { ctx, state } = playOut(SCENARIO_1939);
    expect(legalActions(ctx, state)).toEqual([]);
    expect(applyAction(ctx, state, { type: "END_PLAYER_TURN", side: state.activeSide }).ok).toBe(false);
    expect(state.result).toBeDefined();
  });

  it("replaying the actions gives the same result, also from JSON (Ref 2.0, determinism)", () => {
    const { ctx, initial, state, actions } = playOut(SCENARIO_1939);
    expect(replay(ctx, initial, actions).state.result).toEqual(state.result);
    expect(replay(ctx, initial, JSON.parse(JSON.stringify(actions)) as Action[]).state.result).toEqual(state.result);
  });
});

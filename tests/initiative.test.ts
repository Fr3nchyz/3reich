import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { initiativeTotals } from "../src/engine/game";
import { CTX, endTurn, started } from "./helpers";
import type { GameState, PowerId } from "../src/engine/types";

function withBrps(state: GameState, brps: Partial<Record<PowerId, number>>): GameState {
  const nations = { ...state.nations };
  for (const [id, total] of Object.entries(brps) as [PowerId, number][]) nations[id] = { ...nations[id], brpTotal: total };
  return { ...state, nations };
}

/** State at the start of the second (Allied) player turn of Fall 1939. */
function alliedTurnFall1939(): GameState {
  const r = endTurn(CTX, started(SCENARIO_1939, 1));
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function endGameTurn(state: GameState): GameState {
  const r = endTurn(CTX, state);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe("initiative (Ref 11.1)", () => {
  it("goes to the side with the higher BRP total at the start of each Game Turn", () => {
    const next = endGameTurn(withBrps(alliedTurnFall1939(), { britain: 200 }));
    expect([next.season, next.firstSide, next.activeSide]).toEqual(["winter", "allies", "allies"]);
  });

  it("keeps the previous order on a tie", () => {
    const next = endGameTurn(withBrps(alliedTurnFall1939(), { germany: 135 })); // 135 + 75 = 210
    expect(next.firstSide).toBe("axis");
  });

  it("reports the comparison as an event", () => {
    const r = endTurn(CTX, alliedTurnFall1939());
    expect(r.ok && r.events.find((e) => e.type === "INITIATIVE_DETERMINED")).toEqual({
      type: "INITIATIVE_DETERMINED", year: 1939, season: "winter", firstSide: "axis", axis: 225, allies: 210,
    });
  });

  it("counts US BRPs from the Summer 1942 turn", () => {
    const base = started(SCENARIO_1939, 1);
    expect(initiativeTotals({ ...base, year: 1942, season: "spring" }).allies).toBe(210);
    expect(initiativeTotals({ ...base, year: 1942, season: "summer" }).allies).toBe(480);
  });

  it("counts Soviet BRPs only once the USSR is at war with Germany", () => {
    const base = started(SCENARIO_1939, 1);
    const allied = { ...base, nations: { ...base.nations, ussr: { ...base.nations.ussr, status: "allied" as const } } };
    expect(initiativeTotals(allied).allies).toBe(210);
    expect(initiativeTotals({ ...allied, wars: [...allied.wars, ["ussr", "germany"]] }).allies).toBe(300);
  });

  it("always adds Italy to the Axis total, even while neutral", () => {
    expect(initiativeTotals(started(SCENARIO_1939, 1)).axis).toBe(225);
  });
});

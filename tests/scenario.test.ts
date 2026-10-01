import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { initiativeTotals, newGame } from "../src/engine/game";
import { spendingLimit } from "../src/engine/nations";

describe("1939 scenario (Ops 9.0, in-game status screen)", () => {
  const state = newGame(SCENARIO_1939, 1);

  it("starts in Fall 1939 with the Axis moving first", () => {
    expect([state.year, state.season, state.firstSide, state.activeSide]).toEqual([1939, "fall", "axis", "axis"]);
    expect(state.lastTurn).toEqual({ year: 1942, season: "summer" });
  });

  it("matches the status screen statuses, totals and spending limits", () => {
    const statuses = Object.fromEntries(Object.values(state.nations).map((n) => [n.id, n.status]));
    expect(statuses).toEqual({
      france: "allied", britain: "allied", usa: "neutral", ussr: "neutral", germany: "axis", italy: "neutral",
    });
    // "Total Axis BRPs: 225 / Total Allied BRPs: 210", with Italy neutral.
    expect(initiativeTotals(state)).toEqual({ axis: 225, allies: 210 });
    const limits = Object.fromEntries(Object.values(state.nations).map((n) => [n.id, spendingLimit(n)]));
    expect(limits).toEqual({ france: 42, britain: 62, usa: 135, ussr: 45, germany: 75, italy: 37 });
  });
});

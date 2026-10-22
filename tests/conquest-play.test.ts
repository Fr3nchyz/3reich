import { describe, expect, it } from "vitest";
import { controlMap } from "../src/engine/control";
import type { GameState } from "../src/engine/types";
import { runGame } from "../scripts/selfplay/runner";

// Spec 14 ticket 14-5: the computer plays on after a Major Power has fallen, without a stall or an anomaly, and the game that a conquest decides ends.

/**
 * Berlin is British from the start and Germany has no unit left to take it back (the computer would attack at once), so the Power falls at the end of its
 * first Combat Phase. The Minor-Allies' units stand too far away to reach Berlin.
 */
const berlinBritish = (s: GameState): GameState => ({
  ...s,
  units: { ...Object.fromEntries(Object.entries(s.units).filter(([, u]) => u.owner !== "germany" && u.at !== "L31")), uBerlin: { id: "uBerlin", owner: "britain", type: "infantry", strength: 3, movement: 3, at: "L31" } },
  control: { ...s.control, L31: "britain" },
});

describe("play after a Major Power falls", () => {
  it("1939: Germany, with no unit to take Berlin back, falls at the end of its first Combat Phase; the computer plays four more Game Turns without an anomaly, the same game again ends in the same state, and nothing of Germany is left", () => {
    const r = runGame({ scenario: "1939", seed: 1, turns: 4, verify: true }, { prepare: berlinBritish });
    expect(r.anomalies).toEqual([]);
    expect(r.ended).toBe("turn-limit");
    const g = r.final.nations.germany;
    expect([g.status, g.brpTotal, g.spendLimit]).toEqual(["conquered", 0, 0]);
    expect(r.final.conquests).toHaveLength(1);
    expect(r.final.conquests![0]).toMatchObject({ country: "germany", by: "britain", how: "capital", startingBrps: 150 });
    expect(Object.values(r.final.units).filter((u) => u.owner === "germany")).toEqual([]);
    expect(r.final.pools.germany).toBeUndefined();
    expect([...controlMap(r.ctx, r.final).values()].filter((o) => o === "germany")).toEqual([]);
    // the same game again gives the same state: the conquest has no hidden input (determinism)
    expect(runGame({ scenario: "1939", seed: 1, turns: 4, verify: true }, { prepare: berlinBritish }).final).toEqual(r.final);
  });
  it("1944: Germany falls and the game ends at once with an early result; the computer stops", () => {
    const r = runGame({ scenario: "1944", seed: 1, turns: "end", verify: true }, { prepare: berlinBritish });
    expect(r.anomalies).toEqual([]);
    expect(r.ended).toBe("game-over");
    expect(r.final.result).toMatchObject({ basis: "conquest", early: true, winner: "allies" });
    expect(r.final.nations.germany.status).toBe("conquered");
  });
});

describe("play after a minor country falls (spec 14 ticket 14-6)", () => {
  it("1939, seed 1: Poland falls with Warsaw in Winter 1939, nothing of it is left on the map, in the pools or in the control record, and the computer plays on to the end without an anomaly", () => {
    const r = runGame({ scenario: "1939", seed: 1, turns: "end", verify: true });
    expect(r.anomalies).toEqual([]);
    expect(r.ended).toBe("game-over");
    const poland = r.final.conquests!.find((c) => c.country === "poland");
    expect(poland).toMatchObject({ by: "germany", side: "allies", how: "capital", at: { year: 1939, season: "winter" } });
    expect(Object.values(r.final.units).filter((u) => u.owner === "poland")).toEqual([]);
    expect(r.final.pools.poland).toBeUndefined();
    expect([...controlMap(r.ctx, r.final).values()]).not.toContain("poland");
    expect(runGame({ scenario: "1939", seed: 1, turns: "end", verify: false }).final).toEqual(r.final); // determinism
  });
  it("1942, seed 1: Finland, an Axis Minor-Ally, falls when the Soviets take Helsinki; the game goes on", () => {
    const r = runGame({ scenario: "1942", seed: 1, turns: "end", verify: false });
    expect(r.anomalies).toEqual([]);
    expect(r.final.conquests!.find((c) => c.country === "finland")).toMatchObject({ by: "ussr", side: "axis" });
    expect(r.final.minorAllies.find((m) => m.owner === "finland")?.active).toBe(false);
    expect(Object.values(r.final.units).filter((u) => u.owner === "finland")).toEqual([]);
  });
});

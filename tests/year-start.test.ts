import { describe, expect, it } from "vitest";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { applyAction } from "../src/engine/actions";
import type { GameState, PowerId, Scenario } from "../src/engine/types";
import { growthOf, KEEP_UNUSED_BRPS, minorAllyBrps, runYearStartSequence } from "../src/engine/yearstart";
import { ctxFor, started } from "./helpers";

/** Spec 02: the Year Start Sequence's BRP arithmetic (Ref 9.2, 10.0; Ops 6.0 part B). */

const withNation = (s: GameState, id: PowerId, patch: Partial<GameState["nations"][PowerId]>): GameState => ({
  ...s,
  nations: { ...s.nations, [id]: { ...s.nations[id], ...patch } },
});

/** The Year Start Sequence for `year`, with `unused` BRPs left in each listed nation. */
function yss(scenario: Scenario, year: number, unused: Partial<Record<PowerId, number>>) {
  const base = { ...started(scenario, 1), year, season: "spring" as const };
  const s = (Object.entries(unused) as [PowerId, number][]).reduce<GameState>((acc, [id, n]) => withNation(acc, id, { brpTotal: n }), base);
  return { before: s, ...runYearStartSequence(ctxFor(scenario), s) };
}

describe("BRP growth (Ref 9.2)", () => {
  it("adds the unused BRPs times the Growth Rate to the Base, and the new total is the new Base", () => {
    const r = yss(SCENARIO_1939, 1941, { germany: 100 }); // Germany: Base 150, 50%
    expect(r.state.nations.germany).toMatchObject({ brpBase: 200, brpTotal: 200 });
  });

  it("rounds fractions down", () => {
    expect(growthOf(101, 50)).toBe(50);
    expect(growthOf(99, 30)).toBe(29);
    const r = yss(SCENARIO_1939, 1941, { britain: 33 }); // Britain grows 40%: 40% of 33 = 13.2
    expect(r.state.nations.britain.brpBase - r.before.nations.britain.brpBase).toBe(13);
  });

  it("is nothing for a nation that kept nothing", () => {
    const r = yss(SCENARIO_1939, 1941, { germany: 0 });
    expect(r.state.nations.germany).toMatchObject({ brpBase: 150, brpTotal: 150 });
  });

  it("does not happen in the 1940 Year Start Sequence of the 1939 scenario and the Campaign: the 1940 Base is the 1939 Base", () => {
    for (const scenario of [SCENARIO_1939, SCENARIO_CAMPAIGN]) {
      const r = yss(scenario, 1940, { germany: 100 });
      expect(r.state.nations.germany).toMatchObject({ brpBase: 150, brpTotal: 150 });
    }
  });

  it("happens in 1941, and in a scenario with no such rule", () => {
    expect(yss(SCENARIO_CAMPAIGN, 1941, { germany: 100 }).state.nations.germany.brpBase).toBe(200);
    expect(yss(SCENARIO_1942, 1943, { germany: 100 }).state.nations.germany.brpBase).toBe(295);
  });

  it("drops the BRPs a nation did not spend: they only feed the growth (TODO(verify) in KEEP_UNUSED_BRPS)", () => {
    expect(KEEP_UNUSED_BRPS).toBe(false);
    const r = yss(SCENARIO_1939, 1941, { germany: 100 });
    expect(r.state.nations.germany.brpTotal).toBe(r.state.nations.germany.brpBase);
  });

  it("leaves a nation that is out of the scenario alone (Italy in 1944)", () => {
    const r = yss(SCENARIO_1944, 1945, { italy: 50 });
    expect(r.state.nations.italy).toEqual(r.before.nations.italy);
  });
});

describe("Minor-Allies in the initial total (Ref 9.2)", () => {
  it("add the scenario's figure to Germany's new Base: 1942 has 245 + 45", () => {
    expect(minorAllyBrps(ctxFor(SCENARIO_1942), started(SCENARIO_1942, 1), "germany")).toBe(45);
    const r = yss(SCENARIO_1942, 1943, { germany: 0 });
    expect(r.state.nations.germany).toMatchObject({ brpBase: 245, brpTotal: 290 });
  });

  it("add nothing in a scenario where none are active, or for a nation without any", () => {
    expect(minorAllyBrps(ctxFor(SCENARIO_1939), started(SCENARIO_1939, 1), "germany")).toBe(0);
    expect(minorAllyBrps(ctxFor(SCENARIO_1942), started(SCENARIO_1942, 1), "britain")).toBe(0);
  });

  it("are not counted once one of them is no longer active (TODO(verify): each one's own value)", () => {
    const s = started(SCENARIO_1942, 1);
    const off = { ...s, minorAllies: s.minorAllies.map((m) => (m.owner === "finland" ? { ...m, active: false } : m)) };
    expect(minorAllyBrps(ctxFor(SCENARIO_1942), off, "germany")).toBe(0);
  });
});

describe("the spending limit after the Year Start Sequence (Ref 10.0)", () => {
  it("is half the new total, fractions rounded down, and nothing is spent", () => {
    const r = yss(SCENARIO_1939, 1941, { germany: 101, ussr: 25 });
    for (const n of Object.values(r.state.nations)) {
      expect(n.spendLimit).toBe(Math.floor(n.brpTotal / 2));
      expect(n.spent).toBe(0);
    }
    expect(r.state.nations.germany.spendLimit).toBe(100); // Base 150 + 50 = 200
  });
});

describe("the log of the Year Start Sequence", () => {
  it("gives each change in a total as one BRPS_CHANGED event that says why, and the deltas add up", () => {
    const r = yss(SCENARIO_1939, 1941, { germany: 100, britain: 40 });
    const changed = r.events.flatMap((e) => (e.type === "BRPS_CHANGED" ? [e] : []));
    expect(changed.length).toBeGreaterThan(0);
    for (const e of changed) {
      expect(e.total).toBe(r.state.nations[e.nation].brpTotal);
      expect(e.total - e.delta).toBe(r.before.nations[e.nation].brpTotal);
      expect(e.reason).toMatch(/^Year Start Sequence 1941/);
    }
    const sum = (s: GameState) => Object.values(s.nations).reduce((n, x) => n + x.brpTotal, 0);
    expect(sum(r.state) - sum(r.before)).toBe(changed.reduce((n, e) => n + e.delta, 0));
  });
});

describe("the Year Start Sequence in the Sequence of Play (Ops 5.1, 6.0)", () => {
  const lastOfWinter = (year: number): GameState => ({
    ...withNation(started(SCENARIO_1939, 1), "germany", { brpTotal: 100 }),
    year,
    season: "winter",
    activeSide: "allies",
    position: { part: "player-turn", turn: 2, step: "10b" },
  });
  const endTurn = (s: GameState) => {
    const r = applyAction(ctxFor(SCENARIO_1939), s, { type: "END_PLAYER_TURN", side: "allies" });
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it("runs between Winter and Spring and decides the Initiative on the new totals", () => {
    const r = endTurn(lastOfWinter(1940));
    expect([r.state.year, r.state.season]).toEqual([1941, "spring"]);
    expect(r.state.nations.germany).toMatchObject({ brpBase: 200, brpTotal: 200 });
    const initiative = r.events.find((e) => e.type === "INITIATIVE_DETERMINED");
    expect(initiative).toMatchObject({ axis: r.state.nations.germany.brpTotal + r.state.nations.italy.brpTotal });
  });

  it("does not run at any other change of season", () => {
    const r = endTurn({ ...lastOfWinter(1940), season: "fall" });
    expect(r.state.nations.germany.brpTotal).toBe(100);
    expect(r.events.some((e) => e.type === "BRPS_CHANGED")).toBe(false);
  });

  it("applies no growth to the 1940 year: leaving Winter 1939 gives Germany its plain Base", () => {
    const r = endTurn(lastOfWinter(1939));
    expect([r.state.year, r.state.season]).toEqual([1940, "spring"]);
    expect(r.state.nations.germany).toMatchObject({ brpBase: 150, brpTotal: 150 });
  });
});

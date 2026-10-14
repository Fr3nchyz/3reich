import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { applyAction, legalActions } from "../src/engine/actions";
import type { GameState } from "../src/engine/types";
import { BUILD_PRIORITY } from "../src/ai/build";
import { chooseAction, playSide } from "../src/ai";
import { GRANT_RECEIVER_BELOW } from "../src/ai/grant";
import { atStart, ctxFor, CTX } from "./helpers";

const cfg = { seed: 1 };
const withNation = (s: GameState, id: keyof GameState["nations"], patch: Partial<GameState["nations"]["germany"]>): GameState => ({ ...s, nations: { ...s.nations, [id]: { ...s.nations[id], ...patch } } });

describe("step 1: declarations of war (Ref 13.0)", () => {
  it("declares nothing while no plan applies, even though declarations are legal", () => {
    const s = atStart(SCENARIO_1939, 1);
    expect(s.position).toMatchObject({ step: "1" });
    expect(legalActions(CTX, s).some((a) => a.type === "DECLARE_WAR")).toBe(true);
    expect(chooseAction(CTX, s, cfg)!.action).toEqual({ type: "END_STEP", side: "axis", step: "1" });
  });

  it("declares on the Soviet Union from Summer 1941 when it is legal, and not before", () => {
    const ctx = ctxFor(SCENARIO_1942);
    const base = atStart(SCENARIO_1942, 1);
    const early = { ...base, year: 1941, season: "spring" as const, wars: base.wars.filter(([a, b]) => ![a, b].includes("ussr")) };
    const ussr = { ...early.nations.ussr, status: "neutral" as const };
    const at = (season: "spring" | "summer") => ({ ...early, season, nations: { ...early.nations, ussr } });
    expect(legalActions(ctx, at("spring")).some((a) => a.type === "DECLARE_WAR" && a.by === "germany" && a.on === "ussr")).toBe(true);
    expect(chooseAction(ctx, at("spring"), cfg)!.action.type).toBe("END_STEP");
    expect(chooseAction(ctx, at("summer"), cfg)!.action).toEqual({ type: "DECLARE_WAR", by: "germany", on: "ussr" });
  });
});

describe("step 1 for Italy: the plans of a nation that is at war on the Axis side", () => {
  const ctx = ctxFor(SCENARIO_1939);
  const italyAt = (year: number, season: "spring" | "summer"): GameState => ({ ...withNation(atStart(SCENARIO_1939, 1), "italy", { status: "axis" }), year, season });

  it("declares on France and then on Britain from Summer 1940, and not in Spring 1940", () => {
    expect(chooseAction(ctx, italyAt(1940, "spring"), cfg)!.action.type).toBe("END_STEP");
    let s = italyAt(1940, "summer");
    const first = chooseAction(ctx, s, cfg)!;
    expect(first.action).toEqual({ type: "DECLARE_WAR", by: "italy", on: "france" });
    const r = applyAction(ctx, s, first.action);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    // Italy's limit (half of 75) leaves 2 BRPs after the first declaration, so Britain waits for the next Player Turn.
    expect(chooseAction(ctx, s, cfg)!.action.type).toBe("END_STEP");
    s = { ...s, nations: { ...s.nations, italy: { ...s.nations.italy, spent: 0 } } };
    expect(chooseAction(ctx, s, cfg)!.action).toEqual({ type: "DECLARE_WAR", by: "italy", on: "britain" });
  });
});

describe("BRPs kept back for a planned declaration (spec 05)", () => {
  it("a nation with a pending plan does not build into the price of the declaration; one without a plan does", () => {
    const ctx = ctxFor(SCENARIO_1942);
    const s0 = atStart(SCENARIO_1942, 1);
    const at8b = (patch: Partial<GameState["nations"]["germany"]>, wars: GameState["wars"]): GameState => {
      // Only Germany has anything to spend: the others have used their limit.
      const others = Object.fromEntries(Object.entries(s0.nations).map(([id, n]) => [id, { ...n, spent: n.spendLimit }])) as GameState["nations"];
      return withNation({ ...s0, nations: others, wars, position: { part: "player-turn" as const, turn: 1 as const, step: "8b" } }, "germany", patch);
    };
    const noWar = s0.wars.filter(([a, b]) => ![a, b].includes("ussr"));
    const rich = at8b({ brpTotal: 200, spent: 0, spendLimit: 100 }, noWar);
    const builtGermany = (s: GameState) => { const d = chooseAction(ctx, s, cfg)!; return d.action.type === "BUILD" && d.action.owner === "germany"; };
    expect(builtGermany(rich)).toBe(true);
    // 35 BRPs are all that is left and the plan against the Soviet Union costs 35: any build would dip into it.
    const tight = at8b({ brpTotal: 35, spent: 0, spendLimit: 100 }, noWar);
    expect(builtGermany(tight)).toBe(false);
    // With the war already declared there is no plan waiting, and the same BRPs may be built with.
    const declared = at8b({ brpTotal: 35, spent: 0, spendLimit: 100 }, s0.wars);
    expect(s0.wars.some((w) => w.includes("germany") && w.includes("ussr"))).toBe(true);
    expect(builtGermany(declared)).toBe(true);
  });
});

describe("step 8b: construction within the spending limit (Ref 10.0, 11.6)", () => {
  const atBuild = (): GameState => {
    const s = atStart(SCENARIO_1942, 1);
    const r = applyAction(ctxFor(SCENARIO_1942), s, { type: "END_STEP", side: s.activeSide, step: "1" });
    return r.ok ? r.state : s;
  };

  it("builds the first kind on the priority list, only what the engine lists, and never beyond the limit", () => {
    const ctx = ctxFor(SCENARIO_1942);
    let s = atBuild();
    expect(s.position).toMatchObject({ step: "8b" });
    let builds = 0;
    for (; s.position?.part === "player-turn" && s.position.step === "8b"; builds++) {
      const d = chooseAction(ctx, s, cfg)!;
      expect(legalActions(ctx, s)).toContainEqual(d.action);
      if (d.action.type === "BUILD") {
        const kinds = legalActions(ctx, s).flatMap((a) => (a.type === "BUILD" ? [a.unit.type] : []));
        const first = BUILD_PRIORITY.find((t) => kinds.includes(t));
        expect(d.action.unit.type, "first kind on the priority list").toBe(first);
      }
      const r = applyAction(ctx, s, d.action);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
      for (const n of Object.values(s.nations)) expect(n.spent).toBeLessThanOrEqual(n.spendLimit);
    }
    expect(builds).toBeGreaterThan(1);
  });

  it("ends the step when the limit leaves nothing to build", () => {
    const ctx = ctxFor(SCENARIO_1942);
    const s = atBuild();
    const poor = Object.fromEntries(Object.entries(s.nations).map(([id, n]) => [id, { ...n, spent: n.spendLimit }])) as GameState["nations"];
    const state = { ...s, nations: poor };
    expect(chooseAction(ctx, state, cfg)!.action).toEqual({ type: "END_STEP", side: s.activeSide, step: "8b" });
  });
});

describe("step 9a: BRP grants only when allowed (Ref 11.71)", () => {
  /** The Allies at step 9a with the Soviet Union at war with Germany and given totals. */
  const atGrants = (ussrTotal: number): GameState => {
    const ctx = ctxFor(SCENARIO_1942);
    let s = atStart(SCENARIO_1942, 1);
    s = { ...s, activeSide: "allies", position: { part: "player-turn" as const, turn: 2 as const, step: "9a" } };
    s = withNation(s, "ussr", { brpTotal: ussrTotal, spent: 0 });
    s = withNation(s, "britain", { brpTotal: 200, spent: 0, spendLimit: 100 });
    expect(legalActions(ctx, s).some((a) => a.type === "GRANT_BRPS")).toBe(true);
    return s;
  };

  it("grants to an ally that is short", () => {
    const d = chooseAction(ctxFor(SCENARIO_1942), atGrants(20), cfg)!;
    expect(d.action).toMatchObject({ type: "GRANT_BRPS", to: "ussr", amount: 10 });
  });

  it("grants nothing to an ally that is not short, though grants are legal", () => {
    const d = chooseAction(ctxFor(SCENARIO_1942), atGrants(GRANT_RECEIVER_BELOW), cfg)!;
    expect(d.action).toEqual({ type: "END_STEP", side: "allies", step: "9a" });
  });

  it("never grants back to a giver (the engine lists none), so the step ends", () => {
    const ctx = ctxFor(SCENARIO_1942);
    let s = atGrants(20);
    for (let i = 0; i < 20 && s.position?.part === "player-turn" && s.position.step === "9a"; i++) {
      const r = applyAction(ctx, s, chooseAction(ctx, s, cfg)!.action);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect(s.position).not.toMatchObject({ step: "9a", turn: 2 });
  });
});

describe("step 10b and the driver", () => {
  it("ends the Player Turn at 10b", () => {
    const s = { ...atStart(SCENARIO_1939, 1), position: { part: "player-turn" as const, turn: 1 as const, step: "10b" } };
    expect(chooseAction(CTX, s, cfg)!.action).toEqual({ type: "END_PLAYER_TURN", side: "axis" });
  });

  it("has no action in setup or when the game is over", () => {
    expect(chooseAction(CTX, { ...atStart(SCENARIO_1939, 1), phase: "game-over" }, cfg)).toBeNull();
    expect(chooseAction(CTX, { ...atStart(SCENARIO_1939, 1), phase: "setup", position: null }, cfg)).toBeNull();
  });

  it("plays one side's Player Turn and stops when the other side is up", () => {
    const s = atStart(SCENARIO_1939, 1);
    const out = playSide(CTX, s, s.activeSide, cfg);
    expect(out.state.activeSide).not.toBe(s.activeSide);
    expect(out.decisions.at(-1)!.action.type).toBe("END_PLAYER_TURN");
  });

  it("makes the same choices from the same seed and may differ for another", () => {
    const s = atStart(SCENARIO_1942, 1);
    const a = playSide(ctxFor(SCENARIO_1942), s, s.activeSide, { seed: 5 }).decisions;
    expect(playSide(ctxFor(SCENARIO_1942), s, s.activeSide, { seed: 5 }).decisions).toEqual(a);
  });
});

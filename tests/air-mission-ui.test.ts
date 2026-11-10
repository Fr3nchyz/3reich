import { describe, expect, it } from "vitest";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { setManualDas } from "../src/engine/air-defense-wire";
import { markFlown } from "../src/engine/air-record";
import type { GameState, Side } from "../src/engine/types";
import { airMissionKey, airMissionModel } from "../src/ui/airMissionModel";
import { airResultModel, trackAirResults } from "../src/ui/airResultModel";
import { airMissionHtml, takeAirMission, toggleMissionPlane } from "../src/ui/airMissionView";
import { buttonLabels, statusHtml } from "../src/ui/statusView";
import { newSession, run } from "../src/ui/session";
import { CTX, NO_AIRBASES_LEFT } from "./helpers";
import { at6f, inf, okOf } from "./helpers-move";

const end = (step: string, side: Side = "axis"): Action => ({ type: "END_STEP", step, side });
const apply = (s: GameState, a: Action) => okOf(applyAction(CTX, s, a));
function start(seed = 13) {
  return at6f([inf("ground-a", "germany", "M32"), inf("ground-d", "poland", "M33"),
    inf("plane-a", "germany", "J32", 3, 4, "air"), inf("plane-b", "germany", "J32", 1, 4, "air"),
    inf("plane-d", "britain", "M33", 3, 4, "air"), inf("plane-e", "britain", "M33", 1, 4, "air")], "axis", undefined,
  { rngState: seed, airbasesPlaced: NO_AIRBASES_LEFT });
}
const at7b = (s = start()) => apply(s, end("6f")).state;
const at7c = (s = start()) => apply(apply(at7b(s), { type: "DESIGNATE_AIR", side: "axis", mission: "counter-air", units: ["plane-a"], target: "M33" }).state, end("7b")).state;
const at7d = (s = start()) => apply(at7b(setManualDas(s, true)), end("7b")).state;
const at7e = () => apply(apply(at7d(), { type: "DESIGNATE_DAS", side: "allies", units: ["plane-d", "plane-e"], hex: "M33" }).state, end("7d", "allies")).state;
function session(state: GameState, side: Side) { return { ...newSession(CTX.scenario, side, 13), ctx: CTX, state }; }
const resolve: Action = { type: "RESOLVE_COUNTER_AIR", side: "axis" };

describe("09-15 mission cards (spec 09 D3/D4/D6)", () => {
  it("R12/AER73: counter-air lists assigned planes and the real explicit resolve, never pass before resolution", () => {
    const s = at7c(), before = JSON.stringify(s);
    const m = airMissionModel(CTX, s, "axis")!;
    expect(m.title).toBe("Counter-air");
    expect(m.assigned).toEqual([{ place: "Poznan (M33)", planes: ["3-4 German air from Rostock (J32)"] }]);
    expect(m.resolve).toEqual(resolve);
    expect(legalActions(CTX, s)).toContainEqual(m.resolve);
    expect(m.pass).toBeNull();
    expect(m.choices).toEqual([]);
    expect(airMissionModel(CTX, s, "axis")).toEqual(m);
    expect(JSON.stringify(s)).toBe(before);
    const done = apply(s, m.resolve!);
    expect(airMissionModel(CTX, done.state, "axis")).toMatchObject({ resolve: null, pass: end("7c"), assigned: [] });
  });

  it("C5/C6: hides outside the four mission steps, setup, game over and from the non-acting side", () => {
    const s = at7c();
    for (const step of ["6f", "7b", "7g", "7h", "7m"]) {
      expect(airMissionModel(CTX, { ...s, position: { part: "player-turn", turn: 1, step } }, "axis")).toBeNull();
    }
    for (const state of [{ ...s, phase: "setup" as const }, { ...s, phase: "game-over" as const }, { ...s, position: null }]) {
      expect(airMissionModel(CTX, state, "axis")).toBeNull();
    }
    expect(airMissionModel(CTX, s, "allies")).toBeNull();
  });

  it("R10/AER76: defender chooses a threatened hex or legally passes during the opponent's turn", () => {
    const s = at7d(), m = airMissionModel(CTX, s, "allies")!;
    expect(s.activeSide).toBe("axis");
    expect(airMissionModel(CTX, s, "axis")).toBeNull();
    expect(m.title).toBe("Defend with air?");
    expect(m.choices.map(c => c.target)).toEqual(["M33"]);
    expect(m.choices[0]).toMatchObject({ factors: 4, action: { type: "DESIGNATE_DAS", side: "allies", units: ["plane-d", "plane-e"], hex: "M33" } });
    expect(legalActions(CTX, s)).toContainEqual(m.choices[0]!.action);
    expect(m.pass).toEqual(end("7d", "allies"));
    expect(apply(s, m.pass!).state.position).toMatchObject({ step: "7h" });
  });

  it("R10/AER78: selected subset is validated by the engine, commitments shown, empty/stale selections cannot submit", () => {
    const s = at7d(), before = JSON.stringify(s);
    const m = airMissionModel(CTX, s, "allies", [{ target: "M33", units: ["plane-e", "missing"] }])!;
    expect(m.choices[0]).toMatchObject({ factors: 1, action: { units: ["plane-e"] } });
    expect(m.choices[0]!.chips.map(p => p.chosen)).toEqual([false, true]);
    expect(apply(s, m.choices[0]!.action!).state.air?.das).toEqual({ M33: ["plane-e"] });
    const committed = apply(s, m.choices[0]!.action!).state;
    expect(airMissionModel(CTX, committed, "allies")!.choices[0]!.committed).toEqual(["1-4 British air from Poznan (M33)"]);
    expect(airMissionModel(CTX, s, "allies", [{ target: "M33", units: [] }])!.choices[0]!.action).toBeNull();
    const flown = markFlown(s, ["plane-d", "plane-e"], "new");
    expect(airMissionModel(CTX, flown, "allies")!.choices).toEqual([]);
    expect(airMissionModel(CTX, setManualDas(s, false), "allies")).toBeNull();
    expect(JSON.stringify(s)).toBe(before);
  });

  it("R11/AER92: interception shows committed DAS, allows selected interceptors or pass and resolves immediately", () => {
    const s = at7e(), m = airMissionModel(CTX, s, "axis", [{ target: "M33", units: ["plane-b"] }])!;
    expect(m.choices[0]).toMatchObject({ factors: 1, action: { type: "DESIGNATE_DAS_INTERCEPT", units: ["plane-b"] } });
    expect(m.choices[0]!.committed).toHaveLength(2);
    expect(m.pass).toEqual(end("7e"));
    expect(m.resolve).toBeNull();
    const done = apply(s, m.choices[0]!.action!);
    expect(done.events.some(e => e.type === "DAS_INTERCEPTED")).toBe(true);
    expect(airMissionModel(CTX, done.state, "axis")!.choices).toEqual([]);
    expect(apply(s, m.pass!).state.rngState).toBe(s.rngState);
    expect(airMissionModel(CTX, s, "axis", [{ target: "M33", units: [] }])!.choices[0]!.action).toBeNull();
  });

  it("D6: thin cards use pressed chips, readable names, explicit actions and no raw fallback action labels", () => {
    const s = session(at7e(), "axis"), html = airMissionHtml(s);
    expect(html).toContain('aria-labelledby="air-mission-title"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Intercept: Poznan (M33)");
    expect(html).toContain("No more interceptions, continue");
    expect(html).not.toMatch(/>[^<]*(plane-a|plane-d|DESIGNATE_DAS|undefined|NaN)/);
    const labels = buttonLabels(legalActions(CTX, s.state), CTX, s.state);
    expect(labels.some(l => l.text.includes("DESIGNATE_DAS"))).toBe(false);
    expect(statusHtml(s, null, legalActions(CTX, s.state))).toContain("air-mission-title");
    expect(airMissionHtml({ ...s, watch: {} as NonNullable<typeof s.watch> })).toBe("");
    expect(airMissionHtml({ ...s, humanSide: "allies" })).toBe("");
  });

  it("D3/D4: chip toggles and confirm dispatch the chosen force; state changes discard drafts", () => {
    const s = session(at7d(), "allies");
    toggleMissionPlane(s, "M33", "plane-d");
    toggleMissionPlane(s, "M33", "missing");
    expect(airMissionHtml(s)).toContain("1 air factor chosen");
    takeAirMission(s, "M33");
    expect(s.record.at(-1)).toMatchObject({ type: "DESIGNATE_DAS", side: "allies", units: ["plane-e"] });
    expect(airMissionHtml(s)).toContain("3 air factors chosen");
    expect(airMissionHtml(s)).toContain("1-4 British air from Poznan (M33)");
    takeAirMission(s, "pass");
    expect(s.record.at(-1)).toEqual(end("7d", "allies"));
    const c = session(at7c(), "axis");
    takeAirMission(c, "resolve");
    expect(c.airResults?.cards).toHaveLength(1);
    expect(airMissionHtml(c)).toContain("Air mission results");
    expect(airMissionHtml(c)).toContain("Actual losses");
    takeAirMission(c, "resolve");
    expect(c.record).toHaveLength(1);
  });

  it("D3: choices for separate threatened hexes stay independent until an action", () => {
    const initial = start();
    const state = at7d({ ...initial, units: { ...initial.units, other: inf("other", "poland", "L32") } });
    const s = session(state, "allies");
    const targets = airMissionModel(CTX, state, "allies")!.choices.map(c => c.target);
    expect(targets).toContain("M33");
    expect(targets).toContain("L32");
    toggleMissionPlane(s, "M33", "plane-d");
    toggleMissionPlane(s, "L32", "plane-e");
    takeAirMission(s, "M33");
    expect(s.record.at(-1)).toMatchObject({ type: "DESIGNATE_DAS", hex: "M33", units: ["plane-e"] });
  });

  it("D3: other-side and watch commands cannot change the game", () => {
    const s = session(at7d(), "axis"), before = s.state;
    toggleMissionPlane(s, "M33", "plane-d"); takeAirMission(s, "pass");
    expect(s.state).toBe(before);
    const watch = { ...session(at7d(), "allies"), watch: {} as NonNullable<typeof s.watch> };
    takeAirMission(watch, "M33");
    expect(watch.record).toEqual([]);
  });
});

describe("09-15 event result model (spec 09 C3/D4/R7/R15)", () => {
  it("R7/AER74: shows both dice, modifiers, factors, winner and actual counter losses from real resolution", () => {
    const s = at7c(), done = apply(s, resolve), e = done.events.find(e => e.type === "AIR_COMBAT_RESOLVED")!;
    const cards = airResultModel(CTX, done.events);
    expect(cards).toHaveLength(1);
    const text = cards[0]!.lines.join(" ");
    expect(cards[0]!.title).toBe("Counter-air at Poznan (M33)");
    expect(text).toContain(`die ${e.rolls[0]}, advantage +${e.combat.attacker.advantageDrm}`);
    expect(text).toContain(`modified roll ${e.combat.defender.modifiedRoll}`);
    expect(text).toContain(`${e.combat.attacker.factors} factors`);
    expect(text).toContain(`${e.lost.attacker} attacking air factors, ${e.lost.defender} defending air factors`);
    expect(text).toContain("allocated automatically");
    expect(text).not.toMatch(/plane-a|plane-d|undefined|NaN/);
    expect(airResultModel(CTX, [])).toEqual([]);
  });

  it("R7/R15: tie die is shown only when present", () => {
    const events = Array.from({ length: 36 }, (_, n) => apply(at7c(start(n + 1)), resolve).events.find(e => e.type === "AIR_COMBAT_RESOLVED")!);
    const tie = events.find(e => e.combat.tieRoll !== null)!;
    expect(tie).toBeDefined();
    expect(airResultModel(CTX, [tie])[0]!.lines).toContain(`Tie die: ${tie.combat.tieRoll}.`);
    const other = events.find(e => e.combat.tieRoll === null)!;
    expect(airResultModel(CTX, [other])[0]!.lines.join(" ")).not.toContain("Tie die");
  });

  it("R11/AER93/94: interception actual losses and continuation come from the event", () => {
    const s = at7e(), action = legalActions(CTX, s).find(a => a.type === "DESIGNATE_DAS_INTERCEPT")!;
    const done = apply(s, action), e = done.events.find(e => e.type === "DAS_INTERCEPTED")!;
    const text = airResultModel(CTX, done.events)[0]!.lines.join(" ");
    expect(text).toContain(`${e.lost.interceptors} attacking air factors, ${e.lost.support} defending air factors`);
    expect(text).toContain(`${e.continuing.length} defensive air support plane`);
    expect(text).toContain("all other support aborts");
  });

  it("C1/D4: session accumulates same-turn results and clears them at the next Player Turn", () => {
    const s = session(at7c(), "axis"), before = s.state;
    expect(run(s, resolve)).toBe(true);
    const results = s.airResults!;
    expect(results.key).toBe(airMissionKey(before));
    expect(trackAirResults(results, CTX, s.state, s.state, [])).toEqual(results);
    const done = apply(before, resolve);
    expect(trackAirResults(results, CTX, before, done.state, done.events)?.cards).toHaveLength(2);
    const next = { ...s.state, activeSide: "allies" as const };
    expect(trackAirResults(results, CTX, s.state, next, [])).toBeUndefined();
    expect(airMissionHtml({ ...s, state: next })).not.toContain("Air mission results");
    expect(airMissionKey({ ...before, season: "winter" })).not.toBe(results.key);
  });
});

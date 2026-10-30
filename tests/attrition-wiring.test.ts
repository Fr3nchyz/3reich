import { describe, expect, it } from "vitest";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { sideToAct } from "../src/engine/actor";
import { attritionOf } from "../src/engine/attrition-record";
import { chooseAction } from "../src/ai/choose";
import { combatOf, turnKey } from "../src/engine/combat-record";
import { IMPLEMENTED_STEPS } from "../src/engine/sequence";
import { settle } from "../src/engine/turn";
import { replayRecord } from "../src/engine/old-records";
import { buttonLabels } from "../src/ui/statusView";
import type { GameState } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Ref 12.4; spec 16 R8, C3, C5, C6, C8: Attrition is a live step. Hand-built positions on the real map (Germany M32 against France M33).
const at = (step: string, extra: Partial<GameState> = {}, more = [counter("f3", "france", "infantry", 2, "M34")]): GameState => board([
  counter("g", "germany", "infantry", 15, "M32"),
  counter("f", "france", "infantry", 2, "M33"),
  counter("f2", "france", "replacement", 1, "M33"),
  ...more,
], undefined, { activeSide: "axis", control: { M33: "france", M34: "france" }, frontOptions: { eastern: { option: "attrition" } }, position: { part: "player-turn", turn: 1, step }, ...extra });
const types = (s: GameState) => legalActions(CTX, s).map((a) => a.type);
const ok = (s: GameState, a: Action): GameState => { const r = applyAction(CTX, s, a); if (!r.ok) throw new Error(r.error); return r.state; };
const resolve = (s: GameState) => legalActions(CTX, s).find((a) => a.type === "RESOLVE_ATTRITION")!;
/** Finds a seed whose roll gives the wanted result, so the run is deterministic. */
function rolled(step: string, want: (run: NonNullable<ReturnType<typeof attritionOf>["run"]>) => boolean): GameState {
  for (let seed = 1; seed < 400; seed++) {
    const s = at(step, { rngState: seed });
    const r = applyAction(CTX, s, resolve(s));
    if (r.ok && want(attritionOf(r.state, r.state.attrition).run ?? ({} as never))) return r.state;
  }
  throw new Error("no seed");
}

describe("steps 7a and 7p wait for Attrition (C5)", () => {
  it.each(["7a", "7p"])("step %s waits with an Option and a participant, and lists RESOLVE and the move-on", (step) => {
    const s = at(step);
    expect(types(s)).toEqual(["RESOLVE_ATTRITION", "END_STEP"]);
    expect(resolve(s)).toMatchObject({ side: "axis", front: "eastern", units: ["g"] });
  });
  it.each(["7a", "7p"])("step %s is passed with no Attrition Option, with no participant, and (for a done Front) once it is done", (step) => {
    expect(settle(CTX, at(step, { frontOptions: {} })).state.position).not.toEqual(at(step).position);
    const lone = board([counter("g", "germany", "infantry", 15, "M32")], undefined, { activeSide: "axis", frontOptions: { eastern: { option: "attrition" } }, position: { part: "player-turn", turn: 1, step } });
    expect(settle(CTX, lone).state.position).not.toEqual(lone.position); // no enemy in contact, no participant
    expect(settle(CTX, at(step, { attrition: { turn: turnKey(at(step)), done: ["eastern"], run: null, used: [] } })).state.position).not.toEqual(at(step).position);
  });
  it("refuses the actions elsewhere and a wrong side or subset", () => {
    expect(applyAction(CTX, at("7h"), { type: "RESOLVE_ATTRITION", side: "axis", front: "eastern" }).ok).toBe(false);
    expect(applyAction(CTX, at("7a"), { type: "RESOLVE_ATTRITION", side: "allies", front: "eastern" }).ok).toBe(false);
    expect(applyAction(CTX, at("7a"), { type: "RESOLVE_ATTRITION", side: "axis", front: "eastern", units: ["f"] }).ok).toBe(false);
    expect(applyAction(CTX, at("7a"), { type: "RESOLVE_ATTRITION", side: "axis", front: "western" }).ok).toBe(false);
  });
});

describe("a run holds the step and names its chooser (C5, C6, C8)", () => {
  it("losses: the other side chooses; no move-on is listed or accepted; the Front is done and the units are used (AER8)", () => {
    const s = rolled("7p", (r) => r.stage === "losses" && r.mustLose > 0);
    expect(sideToAct(s)).toBe("allies");
    expect(types(s)).toEqual(["CHOOSE_ATTRITION_LOSSES"]);
    expect(applyAction(CTX, s, { type: "END_STEP", side: "axis", step: "7p" }).ok).toBe(false);
    expect(attritionOf(s, s.attrition).done).toEqual(["eastern"]);
    expect(combatOf(s).attacked).toContain("g"); // the participant cannot attack at 7h afterwards
    expect(applyAction(CTX, s, { type: "CHOOSE_ATTRITION_LOSSES", side: "axis", units: ["f"] }).ok).toBe(false);
    expect(applyAction(CTX, s, { type: "CHOOSE_ATTRITION_LOSSES", side: "allies", units: ["g"] }).ok).toBe(false);
  });
  it("the whole run: losses, a hex, the retreat, the occupation; the Front stays done and the step goes on", () => {
    let s = rolled("7p", (r) => r.stage === "losses" && r.mustLose === 1 && r.hexesLeft === 1);
    expect(legalActions(CTX, s)[0]).toMatchObject({ units: ["f2"] }); // Replacements first
    s = ok(s, legalActions(CTX, s)[0]!);
    expect(sideToAct(s)).toBe("axis");
    expect(types(s)).toEqual(["SELECT_ATTRITION_HEX", "END_ATTRITION"]);
    s = ok(s, { type: "SELECT_ATTRITION_HEX", side: "axis", hex: "M33" });
    expect(sideToAct(s)).toBe("allies");
    expect(types(s)).toContain("RETREAT_UNIT");
    const retreat = legalActions(CTX, s)[0]!;
    s = ok(s, retreat);
    expect(sideToAct(s)).toBe("axis");
    expect(types(s)).toEqual(["OCCUPY_ATTRITION_HEX"]);
    s = ok(s, legalActions(CTX, s)[0]!);
    expect(s.units.g!.at).toBe("M33");
    expect(attritionOf(s, s.attrition).run).toBeNull();
    expect(s.position).not.toEqual({ part: "player-turn", turn: 1, step: "7p" }); // nothing left to resolve: the step was passed
  });
  it("END_ATTRITION closes the run between hexes, and the Front cannot be resolved again", () => {
    let s = rolled("7a", (r) => r.stage === "losses" && r.mustLose === 1 && r.hexesLeft === 1);
    s = ok(s, legalActions(CTX, s)[0]!);
    s = ok(s, { type: "END_ATTRITION", side: "axis" });
    expect(attritionOf(s, s.attrition).run).toBeNull();
    expect(attritionOf(s, s.attrition).done).toEqual(["eastern"]);
    expect(types(s)).not.toContain("RESOLVE_ATTRITION");
  });
  it("a loss that leaves no hex allowance closes the run and marks the Front done (16-4 gap)", () => {
    const s = rolled("7a", (r) => r.stage === "losses" && r.hexesLeft === 0);
    const after = ok(s, legalActions(CTX, s)[0]!);
    expect(attritionOf(after, after.attrition)).toMatchObject({ run: null, done: ["eastern"] });
  });
});

describe("the computer answers every stage (Part E, ticket 16-8)", () => {
  const cfg = { seed: 1, memory: undefined as never };
  it("ends 7a, resolves at 7p, and plays a run to the end through applyAction", () => {
    expect(chooseAction(CTX, at("7a"), cfg)!.action.type).toBe("END_STEP");
    let s = at("7p", { rngState: 3 });
    for (let i = 0; i < 12 && s.position?.part === "player-turn" && s.position.step === "7p"; i++) {
      const d = chooseAction(CTX, s, cfg)!;
      s = ok(s, d.action);
    }
    expect(s.position).not.toEqual({ part: "player-turn", turn: 1, step: "7p" });
    expect(attritionOf(s, s.attrition).run).toBeNull();
  });
  it("replays: the recorded actions give the same state", () => {
    const start = at("7p", { rngState: 3 });
    const actions: Action[] = [];
    let s = start;
    while (s.position?.part === "player-turn" && s.position.step === "7p") { const a = chooseAction(CTX, s, cfg)!.action; actions.push(a); s = ok(s, a); }
    expect(replay(CTX, start, actions).state).toEqual(s);
  });
});

describe("loose ends of the wiring", () => {
  it("7a and 7p are implemented steps, so the engine stops there", () => {
    expect(IMPLEMENTED_STEPS.has("7a") && IMPLEMENTED_STEPS.has("7p")).toBe(true);
  });
  it("the default losses give up a Replacement before a weaker unit (R4, Q4)", () => {
    const strong = board([counter("g", "germany", "infantry", 15, "M32"), counter("f", "france", "infantry", 2, "M33"), counter("r", "france", "replacement", 3, "M33")], undefined,
      { activeSide: "axis", control: { M33: "france" }, frontOptions: { eastern: { option: "attrition" } }, position: { part: "player-turn", turn: 1, step: "7p" } });
    for (let seed = 1; seed < 400; seed++) {
      const r = applyAction(CTX, { ...strong, rngState: seed }, resolve(strong));
      const run = r.ok ? attritionOf(r.state, r.state.attrition).run : null;
      if (run?.stage === "losses" && run.mustLose === 1) {
        expect(legalActions(CTX, (r as { state: GameState }).state)[0]).toMatchObject({ type: "CHOOSE_ATTRITION_LOSSES", units: ["r"] });
        return;
      }
    }
    throw new Error("no seed");
  });
  it("a run whose losses empty the only selectable hex closes by itself, the Front done (C8)", () => {
    const s = rolled("7p", (r) => r.stage === "losses" && r.mustLose === 2 && r.hexesLeft === 1);
    const after = ok(s, legalActions(CTX, s)[0]!);
    expect(attritionOf(after, after.attrition)).toMatchObject({ run: null, done: ["eastern"] });
  });
  it("a human is never stuck: every Attrition action has a plain button with words, never ids", () => {
    let s = rolled("7p", (r) => r.stage === "losses" && r.mustLose === 1 && r.hexesLeft === 1);
    const texts: string[] = [];
    for (let i = 0; i < 4 && attritionOf(s, s.attrition).run; i++) {
      const legal = legalActions(CTX, s);
      texts.push(...buttonLabels(legal, CTX, s).map((l) => l.text));
      s = ok(s, legal.find((a) => a.type === "SELECT_ATTRITION_HEX") ?? legal[0]!);
    }
    texts.push(...buttonLabels(legalActions(CTX, at("7a")), CTX, at("7a")).map((l) => l.text));
    expect(texts.some((t) => /^Choose for me: lose /.test(t))).toBe(true);
    expect(texts.some((t) => /^Take .* by Attrition$/.test(t))).toBe(true);
    expect(texts.some((t) => /^Retreat /.test(t))).toBe(true);
    expect(texts.some((t) => /^Resolve Attrition on the Eastern Front/.test(t))).toBe(true);
    expect(texts.join(" ")).not.toMatch(/\bu\d+\b|\bg\b/);
  });
  it("a record made before Attrition was live replays: 7a and 7p are ended for it (old-records)", () => {
    const start = at("7a");
    const recorded: Action[] = [{ type: "END_STEP", side: "axis", step: "7h" }];
    const r = replayRecord(CTX, start, recorded);
    expect(r.ended).toEqual([0]);
    expect(r.actions[0]).toEqual({ type: "END_STEP", side: "axis", step: "7a" });
  });
  it("the self-play check lets the open-set actions through but nothing else (OPEN_SET_ACTIONS)", async () => {
    const { OPEN_SET_ACTIONS } = await import("../src/engine/attrition-step");
    expect([...OPEN_SET_ACTIONS].sort()).toEqual(["CHOOSE_ATTRITION_LOSSES", "OCCUPY_ATTRITION_HEX"]);
  });
});

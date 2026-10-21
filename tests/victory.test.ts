import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import type { Conquest } from "../src/engine/conquest-record";
import { newGame } from "../src/engine/game";
import type { GameState, GameTurn, Scenario } from "../src/engine/types";
import { evaluateVictory, objectiveCount, recordCheckpoint, victoryTarget } from "../src/engine/victory";
import { verdictName } from "../src/engine/victory-record";
import { ctxFor } from "./helpers";
import { allHeld, withSplit } from "./helpers-victory";

// Spec 14 R2, R3 (ticket 14-2): the result function beyond the tables (those are in victory-data.test.ts). Ref 2.0 to 2.4, 11.63.

const at = (year: number, season: GameTurn["season"]): GameTurn => ({ year, season });
const conquest = (country: Conquest["country"], when: GameTurn): Conquest => ({ country, by: "germany", side: "allies", how: "capital", at: when });
const game = (scenario: Scenario, when: GameTurn, more: Partial<GameState> = {}): GameState => ({ ...newGame(scenario, 1), ...when, ...more });
const deepFreeze = <T>(v: T): T => {
  if (v && typeof v === "object") { Object.values(v).forEach(deepFreeze); Object.freeze(v); }
  return v;
};
describe("both sides reach a level at once (R2, TODO(verify) V1: only when 40 or more Objectives are held)", () => {
  const ctx = ctxFor(SCENARIO_1939);
  const verdict = (allies: number) => verdictName(evaluateVictory(ctx, allHeld(SCENARIO_1939, allies), "end-of-play"));
  it("the higher level wins", () => {
    expect(verdict(17)).toBe("Allied Decisive Victory"); // Allies 17 (Decisive), Axis 25 (Marginal)
    expect(verdict(15)).toBe("Axis Decisive Victory"); // Allies 15 (Marginal), Axis 27 (Decisive)
  });
  it("equal levels are a Stalemate", () => {
    expect(verdict(16)).toBe("Stalemate"); // Allies 16 (Tactical), Axis 26 (Tactical)
  });
});

describe("the end of play always answers (R3)", () => {
  it("every scenario gives a result at the end of play, with the counts, the turn and the table used", () => {
    for (const sc of [SCENARIO_1939, SCENARIO_1942, SCENARIO_1944, SCENARIO_CAMPAIGN]) {
      const ctx = ctxFor(sc);
      const s = game(sc, sc.end);
      const r = evaluateVictory(ctx, s, "end-of-play");
      expect(r.objectives).toEqual(objectiveCount(ctx, s));
      expect(r.at).toEqual(sc.end);
      expect(r.early).toBe(false);
      expect(r.siberian).toBe(false);
    }
  });
  it("1939 and 1942 never end early, whatever happens (Ref 2.0: 'at the end of play')", () => {
    for (const sc of [SCENARIO_1939, SCENARIO_1942]) {
      const conquered = game(sc, at(1941, "fall"), { conquests: [conquest("germany", at(1941, "fall")), conquest("italy", at(1941, "fall"))] });
      expect(evaluateVictory(ctxFor(sc), conquered, "after-conquest")).toBeNull();
    }
  });
  it("the Free Siberian Transfer flag switches the table and is recorded in the result (16 Allied Objectives: Tactical, or only Marginal with the Transfer)", () => {
    const ctx = ctxFor(SCENARIO_1939);
    expect(evaluateVictory(ctx, newGame(SCENARIO_1939, 1), "end-of-play").siberian).toBe(false);
    const plain = evaluateVictory(ctx, withSplit(SCENARIO_1939, 16), "end-of-play");
    const transfer = evaluateVictory(ctx, withSplit(SCENARIO_1939, 16, true), "end-of-play");
    expect([plain.objectives.allies, plain.siberian]).toEqual([16, false]);
    expect(verdictName(plain)).toBe("Allied Tactical Victory");
    expect([transfer.objectives.allies, transfer.siberian]).toEqual([16, true]);
    expect(verdictName(transfer)).toBe("Allied Marginal Victory");
  });
});

describe("1944: Germany still standing at the end (TODO(verify) V5)", () => {
  const ctx = ctxFor(SCENARIO_1944);
  it("is read as an Axis Decisive victory, by the turn limit; nothing ends the game early without a conquest", () => {
    const s = game(SCENARIO_1944, at(1946, "spring"));
    const r = evaluateVictory(ctx, s, "end-of-play");
    expect([r.winner, r.level, r.basis, r.early]).toEqual(["axis", "decisive", "turn-limit", false]);
    expect(evaluateVictory(ctx, s, "after-conquest")).toBeNull();
  });
  it("Germany's fall ends the game at once, with the Game Turn of the conquest as the answer (early end, Q1, V3, V4)", () => {
    const s = game(SCENARIO_1944, at(1945, "spring"), { conquests: [conquest("germany", at(1945, "spring"))] });
    const r = evaluateVictory(ctx, s, "after-conquest")!;
    expect([r.winner, r.level, r.basis, r.early]).toEqual(["allies", "tactical", "conquest", true]);
  });
  it("the conquest of Italy or of an Allied Power decides nothing in 1944", () => {
    const s = game(SCENARIO_1944, at(1945, "spring"), { conquests: [conquest("italy", at(1945, "spring")), conquest("britain", at(1945, "spring"))] });
    expect(evaluateVictory(ctx, s, "after-conquest")).toBeNull();
  });
});

describe("the Campaign: when the Allies do not conquer the Axis in time (R2, TODO(verify) V6, V7)", () => {
  const ctx = ctxFor(SCENARIO_CAMPAIGN);
  const end = at(1945, "summer");
  const verdict = (more: Partial<GameState>) => verdictName(evaluateVictory(ctx, game(SCENARIO_CAMPAIGN, end, more), "end-of-play"));
  it("nothing happened: a Stalemate, by the turn limit", () => {
    const r = evaluateVictory(ctx, game(SCENARIO_CAMPAIGN, end), "end-of-play");
    expect([verdictName(r), r.basis]).toEqual(["Stalemate", "turn-limit"]);
  });
  it("28 Objectives held when Winter 1943 ended is an Axis Marginal win; 27 is not", () => {
    expect(verdict({ victory: { checkpoints: { "1943-winter": 28 } } })).toBe("Axis Marginal Victory");
    expect(verdict({ victory: { checkpoints: { "1943-winter": 27 } } })).toBe("Stalemate");
    expect(evaluateVictory(ctx, game(SCENARIO_CAMPAIGN, end, { victory: { checkpoints: { "1943-winter": 30 } } }), "end-of-play").basis).toBe("objectives");
  });
  it("two Allied Major Powers conquered: Axis Tactical; three: Axis Decisive; the higher level beats the checkpoint", () => {
    const two = [conquest("britain", at(1941, "fall")), conquest("france", at(1940, "spring"))];
    expect(verdict({ conquests: two })).toBe("Axis Tactical Victory");
    expect(verdict({ conquests: [...two, conquest("ussr", at(1944, "fall"))] })).toBe("Axis Decisive Victory");
    expect(verdict({ conquests: two, victory: { checkpoints: { "1943-winter": 40 } } })).toBe("Axis Tactical Victory");
  });
  it("only Britain, France and the U.S.S.R. count as Allied Major Powers; Poland, Germany and the U.S.A. do not", () => {
    expect(verdict({ conquests: [conquest("poland", at(1939, "fall")), conquest("britain", at(1941, "fall")), conquest("germany", at(1944, "fall"))] })).toBe("Stalemate");
    expect(verdict({ conquests: [conquest("usa", at(1941, "fall")), conquest("britain", at(1941, "fall"))] })).toBe("Stalemate");
  });
  it("the third Allied Power ends the game at once (Axis Decisive, early); two do not, and neither does one Axis Power's fall", () => {
    const two = [conquest("britain", at(1941, "fall")), conquest("france", at(1940, "spring"))];
    const now = (conquests: Conquest[]) => evaluateVictory(ctx, game(SCENARIO_CAMPAIGN, at(1944, "spring"), { conquests }), "after-conquest");
    expect(now(two)).toBeNull();
    const r = now([...two, conquest("ussr", at(1944, "spring"))])!;
    expect([r.winner, r.level, r.basis, r.early]).toEqual(["axis", "decisive", "powers-conquered", true]);
    expect(now([conquest("germany", at(1944, "spring"))])).toBeNull();
  });
  it("both Germany and Italy are needed for the Allies (V6): Germany alone gives no Allied result", () => {
    expect(verdict({ conquests: [conquest("germany", at(1944, "spring"))] })).toBe("Stalemate");
    const both = evaluateVictory(ctx, game(SCENARIO_CAMPAIGN, at(1944, "spring"), { conquests: [conquest("germany", at(1944, "spring")), conquest("italy", at(1943, "spring"))] }), "after-conquest")!;
    expect([both.winner, both.level, both.early]).toEqual(["allies", "decisive", true]);
  });
  it("with the Transfer a conquest after Spring 1945 is no Allied result: it falls through to the Axis tests, then Stalemate (V7)", () => {
    const late = [conquest("germany", at(1945, "summer")), conquest("italy", at(1945, "summer"))];
    expect(verdictName(evaluateVictory(ctx, game(SCENARIO_CAMPAIGN, end, { conquests: late, siberian: { used: true, taken: {} } }), "end-of-play"))).toBe("Stalemate");
    expect(verdict({ conquests: late })).toBe("Allied Marginal Victory");
    expect(evaluateVictory(ctx, game(SCENARIO_CAMPAIGN, end, { conquests: late, siberian: { used: true, taken: {} } }), "after-conquest")).toBeNull();
  });
  it("an Allied conquest in time wins over Axis conquests", () => {
    const all = [conquest("germany", at(1944, "spring")), conquest("italy", at(1944, "spring")), conquest("britain", at(1941, "fall")), conquest("france", at(1940, "spring")), conquest("ussr", at(1943, "fall"))];
    expect(verdict({ conquests: all })).toBe("Allied Decisive Victory");
  });
});

describe("the Campaign checkpoint: the Axis Objective count when Winter 1943 ends (Ref 2.4)", () => {
  const ctx = ctxFor(SCENARIO_CAMPAIGN);
  it("is recorded once, at the end of Winter 1943 and at no other turn", () => {
    const winter = game(SCENARIO_CAMPAIGN, at(1943, "winter"));
    const recorded = recordCheckpoint(ctx, winter);
    expect(recorded.victory).toEqual({ checkpoints: { "1943-winter": 9 } });
    expect(recordCheckpoint(ctx, game(SCENARIO_CAMPAIGN, at(1943, "fall"))).victory).toBeUndefined();
    expect(recordCheckpoint(ctx, game(SCENARIO_CAMPAIGN, at(1944, "winter"))).victory).toBeUndefined();
    const again = recordCheckpoint(ctx, { ...recorded, control: { Y22: "britain" } });
    expect(again.victory).toEqual({ checkpoints: { "1943-winter": 9 } });
  });
  it("is not recorded in the other scenarios", () => {
    expect(recordCheckpoint(ctxFor(SCENARIO_1939), game(SCENARIO_1939, at(1943, "winter"))).victory).toBeUndefined();
  });
});

describe("what each side needs (victoryTarget)", () => {
  it("1939 at the start: the Allies are at the top; the Axis, with 9, needs 16 more for a Marginal win", () => {
    const t = victoryTarget(ctxFor(SCENARIO_1939), newGame(SCENARIO_1939, 1));
    expect(t.counts).toEqual({ axis: 9, allies: 23, nobody: 10 });
    expect(t.next).toEqual({ allies: null, axis: { level: "marginal", needs: 25, more: 16 } });
    expect(t.table!.allies).toEqual({ marginal: 15, tactical: 16, decisive: 17 });
    expect(t.siberian).toBe(false);
  });
  it("shows the Allied target one higher with the Free Siberian Transfer, and the next level for a side between levels", () => {
    const t = victoryTarget(ctxFor(SCENARIO_1939), allHeld(SCENARIO_1939, 15));
    expect(t.next!.allies).toEqual({ level: "tactical", needs: 16, more: 1 });
    const s = victoryTarget(ctxFor(SCENARIO_1939), { ...allHeld(SCENARIO_1939, 15), siberian: { used: true, taken: {} } });
    expect(s.siberian).toBe(true);
    expect(s.next!.allies).toEqual({ level: "marginal", needs: 16, more: 1 });
  });
  it("gives the windows of the conquest scenarios", () => {
    const g = victoryTarget(ctxFor(SCENARIO_1944), newGame(SCENARIO_1944, 1));
    expect(g.kind).toBe("germany-falls");
    expect(g.windows).toHaveLength(6);
    const c = victoryTarget(ctxFor(SCENARIO_CAMPAIGN), newGame(SCENARIO_CAMPAIGN, 1));
    expect(c.axis).toMatchObject({ tacticalPowers: 2, decisivePowers: 3 });
    expect(c.windows).toHaveLength(3);
  });
});

describe("the queries are pure", () => {
  it("do not change the state they are given, and give the same answer twice; a state without any of the new fields reads as 'nothing has happened'", () => {
    const s = deepFreeze(game(SCENARIO_CAMPAIGN, at(1945, "summer")));
    const ctx = ctxFor(SCENARIO_CAMPAIGN);
    expect(evaluateVictory(ctx, s, "end-of-play")).toEqual(evaluateVictory(ctx, s, "end-of-play"));
    expect(s.conquests).toBeUndefined();
    expect(() => { recordCheckpoint(ctx, s); victoryTarget(ctx, s); }).not.toThrow();
  });
});

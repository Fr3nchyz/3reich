import { describe, expect, it } from "vitest";
import { GAME_TURN_STEPS, PLAYER_TURN_STEPS, YEAR_START_SEQUENCE, playerTurnStepIds } from "../src/engine/sequence";

// The order and numbering printed on the reference map card ("Sequence of Play") and in Ops 5.0.
describe("sequence of play (map card, Ops 5.0)", () => {
  it("has the ten Player Turn steps in order", () => {
    expect(PLAYER_TURN_STEPS.map((s) => s.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(PLAYER_TURN_STEPS.map((s) => s.title.split(";")[0]!.slice(0, 24))).toEqual([
      "Make Declarations of War",
      "Set up forces of newly a",
      "Select Front Options",
      "Movement and Combat Phas",
      "Voluntary destruction of",
      "Movement Phase",
      "Combat Phase",
      "Unit-Construction Phase",
      "Strategic Redeployment P",
      "End-of-Player-Turn Phase",
    ]);
  });

  it("numbers the sub-steps a, b, c ... with the counts the card prints", () => {
    const counts = Object.fromEntries(PLAYER_TURN_STEPS.filter((s) => s.steps).map((s) => [s.id, s.steps!.length]));
    // Movement a-h, Combat a-p, Construction a-c, Redeployment a-k, End-of-turn a-b.
    expect(counts).toEqual({ "6": 8, "7": 16, "8": 3, "9": 11, "10": 2 });
    for (const s of PLAYER_TURN_STEPS) {
      s.steps?.forEach((sub, i) => expect(sub.id, `${s.id} sub-step ${i}`).toBe(`${s.id}${String.fromCharCode(97 + i)}`));
    }
    expect(playerTurnStepIds()).toHaveLength(5 + 8 + 16 + 3 + 11 + 2);
    expect(new Set(playerTurnStepIds()).size).toBe(playerTurnStepIds().length);
  });

  it("points each step at its section of the Operations Manual", () => {
    expect(PLAYER_TURN_STEPS.map((s) => s.ops)).toEqual(["5.41", "5.41a", "5.42", "5.43", "5.44", "5.45", "5.46", "5.47", "5.48", "5.49"]);
    for (const s of PLAYER_TURN_STEPS) s.steps?.forEach((sub) => expect(sub.ops).toBe(`${s.ops}${sub.id.replace(/^\d+/, "")}`));
  });

  it("places Eastern-Front checks at the end of Movement and of Redeployment, and Attrition on both sides of Offensive combat", () => {
    const title = (id: string) => PLAYER_TURN_STEPS.flatMap((s) => s.steps ?? []).find((x) => x.id === id)!.title;
    expect(title("6h")).toMatch(/Eastern-Front factor check/);
    expect(title("9k")).toMatch(/Eastern-Front factor check/);
    expect(title("7a")).toMatch(/Attrition Combat/);
    expect(title("7p")).toMatch(/Attrition Combat not resolved in step "7a"/);
  });

  it("puts the Russian-Winter roll before the Player-Turn order, and the Year Start Sequence before both", () => {
    expect(GAME_TURN_STEPS.map((s) => s.title)).toEqual(["Possible Russian-Winter Die Roll", "Determination of Player-Turn Order"]);
    expect(YEAR_START_SEQUENCE.map((s) => s.id)).toEqual(["A", "B", "C"]);
  });

  it("agrees with the scenario pages on what the Year Start Sequence does at scenario start", () => {
    // "Only SW Construction is allowed in the 1942 YSS": the steps not marked "except at scenario start".
    expect(YEAR_START_SEQUENCE.filter((s) => !s.exceptAtScenarioStart).map((s) => s.title)).toEqual(["Construct Strategic Warfare factors"]);
    expect(YEAR_START_SEQUENCE.filter((s) => s.exceptAtScenarioStart).map((s) => s.title)).toEqual([
      "Resolution of Strategic Warfare",
      "Calculation of initial BRP Totals",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions } from "../src/engine/actions";
import { chooseAction } from "../src/ai/choose";
import { objectiveHexes } from "../src/engine/objectives";
import { occupationOwed, occupationSrProblem, checkOccupation } from "../src/engine/occupation-step";
import { srDestinations, srProblem } from "../src/engine/sr-region";
import type { GameState, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX } from "./helpers";
import { eventsOf, IN, many } from "./helpers-surrender";

// Spec 14 R7c, ticket 14-17b: the Occupation Force at steps 6h and 9k, the Objective the Axis hands back, the SR limit. TODO(verify) V21.

const RUSSIAN_OBJECTIVES = objectiveHexes(CTX).filter((h) => CTX.map.hexes[h]!.country === "ussr");
const [OBJ_A, OBJ_B, OBJ_C] = RUSSIAN_OBJECTIVES;
const ax = (hexes: string[]): GameState["control"] => Object.fromEntries(RUSSIAN_OBJECTIVES.map((h) => [h, hexes.includes(h) ? "germany" : "ussr"]));
const force = (ground: number): Unit[] => (ground === 0 ? [] : many("g", "germany", Math.ceil(ground / 4), 4, IN).map((u, i, all) => ({ ...u, strength: i === all.length - 1 && ground % 4 ? ground % 4 : 4 })));

/** The Axis Player Turn of Winter 1941, the game about to leave `from`, the offer answered with `offer`. */
function axisTurn(units: Unit[], from: string, tweak: Partial<GameState> = {}, offer: "accepted" | "refused" | "none" = "accepted"): GameState {
  const base = board(units, SCENARIO_1939, {});
  return {
    ...base,
    year: 1941,
    season: "winter",
    firstSide: "axis",
    activeSide: "axis",
    position: { part: "player-turn", turn: 1, step: from },
    soviet: { citiesTaken: {}, offer },
    control: ax([OBJ_A!, OBJ_B!]),
    ...tweak,
  };
}
const at = (s: GameState): string => (s.position?.part === "player-turn" ? s.position.step : "?");
const arrive = (s: GameState) => {
  const out = applyAction(CTX, s, { type: "END_STEP", side: s.activeSide, step: (s.position as { step: string }).step });
  if (!out.ok) throw new Error(out.error);
  return out;
};

describe("arriving at 6h (R7c)", () => {
  const short = axisTurn(force(40), "6g");
  it("a shortfall with two Objectives to give back stops the game at 6h and pays nothing yet", () => {
    const r = arrive(short);
    expect(at(r.state)).toBe("6h");
    expect(r.state.soviet?.conceding).toBe(true);
    expect(eventsOf(r.events, "OCCUPATION_SHORT")).toEqual([{ type: "OCCUPATION_SHORT", total: 40, ground: 40 }]);
    expect(r.state.nations.germany.brpTotal).toBe(short.nations.germany.brpTotal);
  });
  it("only the choices are legal, in hex order, and nothing else is accepted", () => {
    const r = arrive(short);
    const legal = legalActions(CTX, r.state);
    expect(legal).toEqual([OBJ_A, OBJ_B].sort().map((hex) => ({ type: "OCCUPATION_CONCEDE", side: "axis", hex })));
    expect(applyAction(CTX, r.state, { type: "END_STEP", side: "axis", step: "6h" }).ok).toBe(false);
    expect(applyAction(CTX, r.state, { type: "OCCUPATION_CONCEDE", side: "axis", hex: OBJ_C! }).ok).toBe(false);
    expect(applyAction(CTX, r.state, { type: "OCCUPATION_CONCEDE", side: "allies" as "axis", hex: OBJ_A! }).ok).toBe(false);
  });
  it("the choice costs Germany 15 BRPs, hands the Objective back for good and moves the game on", () => {
    const r = arrive(short);
    const hex = legalActions(CTX, r.state).find((a) => a.type === "OCCUPATION_CONCEDE")!;
    const done = applyAction(CTX, r.state, hex);
    if (!done.ok) throw new Error(done.error);
    expect(done.state.nations.germany.brpTotal).toBe(short.nations.germany.brpTotal - 15);
    expect(done.state.control[(hex as { hex: string }).hex]).toBe("ussr");
    expect(done.state.soviet?.credited).toEqual([(hex as { hex: string }).hex]);
    expect(done.state.soviet?.conceding).toBe(false);
    expect(done.state.soviet?.shortfallTurn).toBe("1941-winter");
    expect(at(done.state)).not.toBe("6h");
    expect(eventsOf(done.events, "OCCUPATION_PENALTY")).toEqual([{ type: "OCCUPATION_PENALTY", amount: 15, hex: (hex as { hex: string }).hex }]);
  });
  it("the computer hands back the first Objective on the list", () => {
    const r = arrive(short);
    const d = chooseAction(CTX, r.state, { difficulty: "normal" } as never);
    expect(d?.action).toEqual(legalActions(CTX, r.state)[0]);
  });
});

describe("when nothing is asked", () => {
  it("one Objective left: it goes back at once, with no question", () => {
    const r = arrive(axisTurn(force(40), "6g", { control: ax([OBJ_A!]) }));
    expect(at(r.state)).not.toBe("6h");
    expect(r.state.control[OBJ_A!]).toBe("ussr");
    expect(r.state.nations.germany.brpTotal).toBe(axisTurn([], "6g").nations.germany.brpTotal - 15);
  });
  it("no Objective left: only the 15 BRPs are paid", () => {
    const r = arrive(axisTurn(force(40), "6g", { control: ax([]) }));
    expect(eventsOf(r.events, "OCCUPATION_PENALTY")).toEqual([{ type: "OCCUPATION_PENALTY", amount: 15, hex: null }]);
    expect(r.state.nations.germany.brpTotal).toBe(axisTurn([], "6g").nations.germany.brpTotal - 15);
  });
  it("45 factors with 30 ground: nothing happens", () => {
    const r = arrive(axisTurn(force(45), "6g"));
    expect(eventsOf(r.events, "OCCUPATION_SHORT")).toEqual([]);
    expect(r.state.nations.germany.brpTotal).toBe(axisTurn([], "6g").nations.germany.brpTotal);
  });
  it("45 factors with only 28 ground fails the ground test", () => {
    const air = counter("air", "germany", "air", 17, IN[0], 5);
    expect(eventsOf(arrive(axisTurn([...force(28), air], "6g")).events, "OCCUPATION_SHORT")).toHaveLength(1);
  });
  it("no offer made: no force is owed", () => {
    const s = axisTurn(force(10), "6g", {}, "none");
    expect(occupationOwed(s)).toBe(false);
    expect(eventsOf(arrive(s).events, "OCCUPATION_SHORT")).toEqual([]);
  });
  it("a refused offer owes the force too (V21)", () => {
    expect(occupationOwed(axisTurn(force(10), "6g", {}, "refused"))).toBe(true);
  });
  it("the Allied Player Turn is not checked", () => {
    const s = axisTurn(force(10), "6g", { activeSide: "allies" });
    expect(checkOccupation(CTX, s, "6h").events).toEqual([]);
  });
  it("a context that does not build the step is not asked", () => {
    const s = axisTurn(force(10), "6g");
    expect(checkOccupation({ ...CTX, implementedSteps: new Set(["6g"]) }, s, "6h").events).toEqual([]);
  });
});

describe("arriving at 9k and once a turn", () => {
  it("9k asks the same way", () => {
    const r = arrive(axisTurn(force(40), "9j"));
    expect(at(r.state)).toBe("9k");
    expect(r.state.soviet?.conceding).toBe(true);
  });
  it("a penalty at 6h is not charged again at 9k of the same Game Turn", () => {
    const s = axisTurn(force(40), "9j", { soviet: { citiesTaken: {}, offer: "accepted", shortfallTurn: "1941-winter" } });
    expect(eventsOf(arrive(s).events, "OCCUPATION_SHORT")).toEqual([]);
  });
  it("it is charged again in the next Game Turn", () => {
    const s = axisTurn(force(40), "9j", { soviet: { citiesTaken: {}, offer: "accepted", shortfallTurn: "1940-fall" } });
    expect(eventsOf(arrive(s).events, "OCCUPATION_SHORT")).toHaveLength(1);
  });
  it("a full game turn with the force short pays once at 6h and not at 9k", () => {
    const r = arrive(axisTurn(force(40), "6g", { control: ax([OBJ_A!]) }));
    const mid = { ...r.state, position: { part: "player-turn" as const, turn: 1 as const, step: "9j" } };
    expect(eventsOf(arrive(mid).events, "OCCUPATION_PENALTY")).toEqual([]);
  });
});

describe("Strategic Redeployment while the force is short (AER31)", () => {
  const unit = counter("g", "germany", "infantry", 4, "J29", 3);
  const short = (n = 40): GameState => axisTurn([unit, ...force(n)], "9e");
  it("a destination outside Russia is refused, one inside Russia is allowed", () => {
    expect(occupationSrProblem(CTX, short(), unit, "J30")).toMatch(/Occupation Force/);
    expect(occupationSrProblem(CTX, short(), unit, IN[0])).toBeNull();
  });
  it("srProblem refuses the redeployment with the same reason, and accepts it once the force is met", () => {
    expect(srProblem(CTX, short(), ["g"], "J30")).toMatch(/Occupation Force/);
    expect(srProblem(CTX, short(45), ["g"], "J30")).toBeNull();
  });
  it("it is no limit when the force is met, not owed, or for the Allies", () => {
    expect(occupationSrProblem(CTX, short(45), unit, "J30")).toBeNull();
    expect(occupationSrProblem(CTX, axisTurn([unit, ...force(40)], "9e", {}, "none"), unit, "J30")).toBeNull();
    expect(occupationSrProblem(CTX, short(), counter("b", "britain", "infantry", 4, "A47", 3), "A46")).toBeNull();
  });
  it("every destination the region search gives is in Russia while the force is short", () => {
    const dest = srDestinations(CTX, short(), unit);
    const free = srDestinations(CTX, short(45), unit);
    expect(free.some((h) => CTX.map.hexes[h]!.country !== "ussr")).toBe(true);
    expect(dest).toEqual(free.filter((h) => CTX.map.hexes[h]!.country === "ussr"));
  });
});

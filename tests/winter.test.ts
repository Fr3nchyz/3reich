import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_1944 } from "../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { sideToAct } from "../src/engine/actor";
import { applyAction, legalActions, replay, type Action, type GameEvent } from "../src/engine/actions";
import { rollD6 } from "../src/engine/rng";
import { advance, settle } from "../src/engine/turn";
import type { GameState, MinorAlly, Scenario, Unit } from "../src/engine/types";
import { axisUnitsInRussia, germanRussianWar, WINTER_DICE, winterRoll } from "../src/engine/winter";
import { winterAsking, winterInForce, winterStage } from "../src/engine/winter-record";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

// Spec 14 ticket 14-11 (R10; Ref 28.0, Ops 5.2): the Russian winter record, the roll at II.A, the Allied choice, a Russian declaration in a Winter turn.

/** Land hexes of the original Russian border's inside (the map country "ussr"), in map order. */
const RUSSIA = Object.values(MAP.hexes).filter((h) => h.land !== null && h.country === "ussr").map((h) => h.id);
const types = (events: GameEvent[]) => events.map((e) => e.type);
const winterEvents = (events: GameEvent[]) => events.filter((e) => e.type.startsWith("WINTER"));

/** `n` German infantry counters on distinct Russian hexes (their ids are g0, g1, ...). */
const germans = (n: number, owner: "germany" | "finland" = "germany", prefix = "g"): Unit[] => Array.from({ length: n }, (_, i) => counter(`${prefix}${i}`, owner, "infantry", 3, RUSSIA[i + (owner === "finland" ? 100 : 0)]!, 3));

interface Opts {
  scenario?: Scenario;
  /** Germany and the U.S.S.R. at war (the U.S.S.R. then fights for the Allies). */
  war?: boolean;
  units?: Unit[];
  year?: number;
  season?: "fall" | "summer";
  winter?: GameState["winter"];
  minorAllies?: MinorAlly[];
}

/** The second Player Turn of a Fall Game Turn, at its last step: ending it brings the game to II.A of the Winter Game Turn. */
function endOfFall({ scenario = SCENARIO_1939, war = true, units = [], year = 1941, season = "fall", winter, minorAllies }: Opts = {}): GameState {
  const base = board(units, scenario, {});
  const wars = war && !base.wars.some(([a, b]) => [a, b].includes("ussr") && [a, b].includes("germany")) ? [...base.wars, ["germany", "ussr"] as [string, string]] : base.wars;
  return {
    ...base,
    year,
    season,
    lastTurn: { year: 1946, season: "fall" }, // the game does not end before the turns tried here
    firstSide: "axis",
    activeSide: "allies",
    position: { part: "player-turn", turn: 2, step: "10b" },
    wars: wars as GameState["wars"],
    nations: war ? { ...base.nations, ussr: { ...base.nations.ussr, status: "allied" } } : base.nations,
    ...(winter ? { winter } : {}),
    ...(minorAllies ? { minorAllies } : {}),
  };
}

const endTurn = (s: GameState, ctx = CTX) => {
  const r = applyAction(ctx, s, { type: "END_PLAYER_TURN", side: "allies" });
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe("the roll (winterRoll)", () => {
  it("is four dice taken one after the other from the generator, the total, and the generator after the fourth", () => {
    expect(WINTER_DICE).toBe(4);
    let g = 12345;
    const dice: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = rollD6(g);
      dice.push(r.roll);
      g = r.state;
    }
    expect(winterRoll(12345)).toEqual({ dice, total: dice[0]! + dice[1]! + dice[2]! + dice[3]!, rngState: g });
  });
  it("gives four dice of 1 to 6 for any seed, and the same roll for the same seed", () => {
    for (const seed of [0, 1, 7, 99999, 4294967295]) {
      const r = winterRoll(seed);
      expect(r.dice).toHaveLength(4);
      for (const d of r.dice) expect(d >= 1 && d <= 6).toBe(true);
      expect(r.total).toBeGreaterThanOrEqual(4);
      expect(r.total).toBeLessThanOrEqual(24);
      expect(winterRoll(seed)).toEqual(r);
    }
  });
});

describe("the count of Axis units in Russia (V24)", () => {
  const Y = RUSSIA[300]!;
  const at = (units: Unit[], tweak: Partial<GameState> = {}) => board(units, SCENARIO_1939, { wars: [["germany", "ussr"]], ...tweak });
  it("counts infantry, armor, airborne and replacements of the Axis on the map country ussr, one each", () => {
    const s = at([counter("a", "germany", "infantry", 3, RUSSIA[0]!), counter("b", "germany", "armor", 5, RUSSIA[1]!), counter("c", "germany", "airborne", 3, RUSSIA[2]!), counter("d", "germany", "replacement", 7, RUSSIA[3]!)]);
    expect(axisUnitsInRussia(CTX, s)).toBe(4);
  });
  it("does not count Finns, air, fleets, airbases, Allied units, units outside Russia, or an Axis Minor-Ally that is not active", () => {
    const s = at([
      counter("fin", "finland", "infantry", 3, Y),
      counter("air", "germany", "air", 5, RUSSIA[1]!),
      counter("flt", "germany", "fleet", 9, RUSSIA[2]!),
      counter("bas", "germany", "airbase", 1, RUSSIA[3]!),
      counter("rus", "ussr", "infantry", 3, RUSSIA[4]!),
      counter("poland", "germany", "infantry", 3, "N33"),
      counter("rum", "rumania", "infantry", 3, RUSSIA[5]!),
    ]);
    expect(axisUnitsInRussia(CTX, s)).toBe(0);
  });
  it("counts the units of an active Minor-Ally (Rumania) but still not the Finns, active or not", () => {
    const ally: MinorAlly[] = [{ owner: "rumania", of: "germany", active: true }, { owner: "finland", of: "germany", active: true }];
    const s = at([counter("rum", "rumania", "infantry", 3, RUSSIA[5]!), counter("fin", "finland", "armor", 5, Y), counter("g", "germany", "infantry", 3, RUSSIA[6]!)], { minorAllies: ally });
    expect(axisUnitsInRussia(CTX, s)).toBe(2);
  });
  it("does not count units off the map (a unit in a box)", () => {
    expect(axisUnitsInRussia(CTX, at([counter("g", "germany", "infantry", 3, "us-box")]))).toBe(0);
  });
});

describe("the German-Russian war", () => {
  it("is on when Germany and the U.S.S.R. are at war, in either order of the pair", () => {
    expect(germanRussianWar(board([], SCENARIO_1939, { wars: [["germany", "ussr"]] }))).toBe(true);
    expect(germanRussianWar(board([], SCENARIO_1939, { wars: [["ussr", "germany"]] }))).toBe(true);
  });
  it("is not on with no war, with only Italy at war with the U.S.S.R. (V43), or when either is out of the game", () => {
    expect(germanRussianWar(board([], SCENARIO_1939, { wars: [] }))).toBe(false);
    expect(germanRussianWar(board([], SCENARIO_1939, { wars: [["italy", "ussr"]] }))).toBe(false);
    const s = board([], SCENARIO_1939, { wars: [["germany", "ussr"]] });
    expect(germanRussianWar({ ...s, nations: { ...s.nations, ussr: { ...s.nations.ussr, status: "conquered" } } })).toBe(false);
    expect(germanRussianWar({ ...s, nations: { ...s.nations, germany: { ...s.nations.germany, status: "out" } } })).toBe(false);
  });
});

describe("the winter stage and the scenario (first-winter-past)", () => {
  it("1939 and the Campaign start with the first winter ahead; 1942 and 1944 take it as over", () => {
    expect(winterStage(ctxFor(SCENARIO_1939), board([], SCENARIO_1939))).toBe("ahead");
    expect(winterStage(ctxFor(SCENARIO_CAMPAIGN), board([], SCENARIO_CAMPAIGN))).toBe("ahead");
    expect(winterStage(ctxFor(SCENARIO_1942), board([], SCENARIO_1942))).toBe("over");
    expect(winterStage(ctxFor(SCENARIO_1944), board([], SCENARIO_1944))).toBe("over");
  });
  it("the data: the rule is in the 1942 and 1944 scenarios and in neither of the others", () => {
    const has = (s: Scenario) => s.rules.some((r) => r.kind === "first-winter-past");
    expect([SCENARIO_1939, SCENARIO_CAMPAIGN, SCENARIO_1942, SCENARIO_1944].map(has)).toEqual([false, false, true, true]);
  });
  it("a state without the record (an older saved game) reads as no winter in force and nobody asked", () => {
    const s = board([], SCENARIO_1939);
    expect(s.winter).toBeUndefined();
    expect(winterInForce(s)).toBe(false);
    expect(winterAsking(s)).toBe(false);
  });
});

describe("II.A: when the dice are rolled", () => {
  it("not in a Fall turn that ends before a Winter turn is reached: ending Summer goes to Fall with no roll and the generator untouched", () => {
    const s = endOfFall({ season: "summer" });
    const r = endTurn(s);
    expect(r.state.season).toBe("fall");
    expect(winterEvents(r.events)).toEqual([]);
    expect(r.state.winter).toBeUndefined();
    expect(r.state.rngState).toBe(s.rngState);
  });
  it("not in a Winter turn when Germany and Russia are not at war: no roll, no record, the generator untouched, II.A passed", () => {
    const s = endOfFall({ war: false });
    const r = endTurn(s);
    expect([r.state.year, r.state.season]).toEqual([1941, "winter"]);
    expect(winterEvents(r.events)).toEqual([]);
    expect(r.state.winter).toBeUndefined();
    expect(r.state.rngState).toBe(s.rngState);
    expect(r.state.position?.part).toBe("player-turn");
    expect(r.events.find((e) => e.type === "STEPS_PASSED" && e.steps.includes("II.A"))).toBeDefined();
  });
  it("in a Winter turn with the war on: four dice are rolled once, the generator moves on by exactly four dice, and the roll is kept in the record", () => {
    const s = endOfFall({});
    const expected = winterRoll(s.rngState);
    const r = endTurn(s);
    const rolled = r.events.filter((e) => e.type === "WINTER_ROLLED");
    expect(rolled).toHaveLength(1);
    expect(rolled[0]).toEqual({ type: "WINTER_ROLLED", dice: expected.dice, total: expected.total, axisUnits: 0, mayPostpone: true });
    expect(r.state.winter!.roll).toEqual({ dice: expected.dice, total: expected.total, axisUnits: 0, mayPostpone: true });
    expect(r.state.rngState).toBe(expected.rngState);
  });
  it("the same Winter turn rolls the same dice from the same state (determinism)", () => {
    const s = endOfFall({});
    expect(endTurn(s).state).toEqual(endTurn(s).state);
  });
  it("1942 and 1944 never roll, though the war is on: the first winter is taken as over", () => {
    for (const scenario of [SCENARIO_1942, SCENARIO_1944]) {
      const s = endOfFall({ scenario, year: scenario === SCENARIO_1942 ? 1942 : 1944 });
      const r = endTurn(s, ctxFor(scenario));
      expect(r.state.season).toBe("winter");
      expect(winterEvents(r.events)).toEqual([]);
      expect(r.state.rngState).toBe(s.rngState);
      expect(r.state.winter).toBeUndefined();
      expect(winterInForce(r.state)).toBe(false);
    }
  });
  it("after the winter has been, never again: the next Winter turn rolls nothing", () => {
    const s = endOfFall({ year: 1942, winter: { stage: "over", inForce: "1941-winter", asking: false } });
    const r = endTurn(s);
    expect(winterEvents(r.events)).toEqual([]);
    expect(r.state.rngState).toBe(s.rngState);
    expect(winterInForce(r.state)).toBe(false);
  });
});

describe("II.A: the dice against the units (Ref 28.0: fewer units than the total allows postponing)", () => {
  const total = winterRoll(endOfFall({}).rngState).total;
  it("as many units as the total: no question, the winter starts at once", () => {
    const r = endTurn(endOfFall({ units: germans(total) }));
    expect(types(winterEvents(r.events))).toEqual(["WINTER_ROLLED", "WINTER_STARTED"]);
    expect(winterEvents(r.events)[0]).toMatchObject({ axisUnits: total, mayPostpone: false });
    expect(r.state.winter).toMatchObject({ stage: "over", inForce: "1941-winter", asking: false });
    expect(r.state.position?.part).toBe("player-turn");
    expect(winterAsking(r.state)).toBe(false);
  });
  it("more units than the total: the same", () => {
    const r = endTurn(endOfFall({ units: germans(total + 1) }));
    expect(winterEvents(r.events)[0]).toMatchObject({ axisUnits: total + 1, mayPostpone: false });
    expect(winterInForce(r.state)).toBe(true);
  });
  it("one unit fewer than the total: the Allies are asked and the game waits at II.A", () => {
    const r = endTurn(endOfFall({ units: germans(total - 1) }));
    expect(types(winterEvents(r.events))).toEqual(["WINTER_ROLLED"]);
    expect(winterEvents(r.events)[0]).toMatchObject({ axisUnits: total - 1, mayPostpone: true });
    expect(r.state.position).toEqual({ part: "russian-winter" });
    expect(r.state.phase).toBe("player-turn");
    expect(winterAsking(r.state)).toBe(true);
    expect(winterInForce(r.state)).toBe(false);
    expect(r.state.winter!.stage).toBe("ahead");
  });
  it("Finns do not count against the Allies' chance", () => {
    // Finland is an active Axis Minor-Ally here, so only the rule that leaves the Finns out keeps its five counters from being counted
    const r = endTurn(endOfFall({ units: [...germans(total - 1), ...germans(5, "finland", "f")], minorAllies: [{ owner: "finland", of: "germany", active: true }] }));
    expect(winterAsking(r.state)).toBe(true);
  });
});

describe("II.A: the Allies answer (CHOOSE_WINTER)", () => {
  const asked = () => endTurn(endOfFall({})).state;
  const choose = (s: GameState, postpone: boolean, side: "allies" = "allies") => applyAction(CTX, s, { type: "CHOOSE_WINTER", side, postpone });

  it("the legal list at the question holds exactly the two answers, both for the Allies, and nothing that moves the game on", () => {
    const s = asked();
    expect(legalActions(CTX, s)).toEqual([
      { type: "CHOOSE_WINTER", side: "allies", postpone: false },
      { type: "CHOOSE_WINTER", side: "allies", postpone: true },
    ]);
  });
  it("waiting: the winter is postponed, nothing is in force this turn, and the game goes on to the Player Turn", () => {
    const r = choose(asked(), true);
    if (!r.ok) throw new Error(r.error);
    expect(types(r.events).slice(0, 1)).toEqual(["WINTER_POSTPONED"]);
    expect(r.events[0]).toEqual({ type: "WINTER_POSTPONED", turn: { year: 1941, season: "winter" } });
    expect(r.state.winter).toMatchObject({ stage: "postponed", asking: false, postponedFrom: { year: 1941, season: "winter" } });
    expect(r.state.winter!.inForce).toBeUndefined();
    expect(winterInForce(r.state)).toBe(false);
    expect(r.state.position?.part).toBe("player-turn");
    expect(types(r.events)).toContain("PLAYER_TURN_STARTED");
    expect(legalActions(CTX, r.state).length).toBeGreaterThan(0);
  });
  it("starting now: the winter is in force for this Game Turn and the game goes on to the Player Turn", () => {
    const r = choose(asked(), false);
    if (!r.ok) throw new Error(r.error);
    expect(r.events[0]).toEqual({ type: "WINTER_STARTED", turn: { year: 1941, season: "winter" } });
    expect(r.state.winter).toMatchObject({ stage: "over", inForce: "1941-winter", asking: false });
    expect(winterInForce(r.state)).toBe(true);
    expect(r.state.position?.part).toBe("player-turn");
    expect(legalActions(CTX, r.state).length).toBeGreaterThan(0);
  });
  it("the answer uses no dice", () => {
    const s = asked();
    for (const postpone of [true, false]) {
      const r = choose(s, postpone);
      if (!r.ok) throw new Error(r.error);
      // the Player Turn that follows may roll nothing at step 1 and II.B (the Initiative is not a roll)
      expect(r.state.rngState).toBe(s.rngState);
    }
  });
  it("is refused when nothing is asked: in an ordinary step, and after the question was answered", () => {
    const ordinary = endOfFall({});
    expect(applyAction(CTX, ordinary, { type: "CHOOSE_WINTER", side: "allies", postpone: true })).toMatchObject({ ok: false });
    const answered = choose(asked(), true);
    if (!answered.ok) throw new Error(answered.error);
    expect(applyAction(CTX, answered.state, { type: "CHOOSE_WINTER", side: "allies", postpone: false })).toMatchObject({ ok: false });
  });
  it("is refused for the Axis, and for a malformed answer, with a reason and no throw", () => {
    const s = asked();
    const axis = applyAction(CTX, s, { type: "CHOOSE_WINTER", side: "axis", postpone: true } as unknown as Action);
    expect(axis).toMatchObject({ ok: false });
    if (!axis.ok) expect(axis.error).toMatch(/Allies/);
    const bad = applyAction(CTX, s, { type: "CHOOSE_WINTER", side: "allies", postpone: "yes" } as unknown as Action);
    expect(bad).toMatchObject({ ok: false });
    expect(applyAction(CTX, s, { type: "CHOOSE_WINTER" } as unknown as Action)).toMatchObject({ ok: false });
  });
  it("nothing else is accepted while the question waits, and each refusal says why (never a throw)", () => {
    const s = asked();
    const others: Action[] = [
      { type: "END_STEP", side: "allies", step: "10b" },
      { type: "END_STEP", side: "axis", step: "1" },
      { type: "END_PLAYER_TURN", side: "allies" },
      { type: "DECLARE_WAR", by: "germany", on: "norway" },
      { type: "SELECT_FRONT_OPTION", side: "allies", front: "eastern", option: "defensive" },
      { type: "BUILD", owner: "ussr", unit: { type: "infantry", strength: 3 }, at: "H47" },
      { type: "GRANT_BRPS", from: "britain", to: "ussr", amount: 1 },
      { type: "MOVE", side: "allies", units: ["x"], path: ["H47"] },
      { type: "ATTACK", side: "allies", units: ["x"], target: "H47" },
      { type: "ALLOCATE_LOSSES", side: "allies", units: [] },
      { type: "ADVANCE", side: "allies", units: [], to: "H47" },
      { type: "DESIGNATE_AIR", side: "allies", mission: "ground-support", units: [], target: "H47" },
      { type: "DESIGNATE_SEA_SUPPLY", side: "allies", fleets: [], to: "H47", units: [] },
      { type: "PLACE_AIRBASE", owner: "ussr", at: "H47" },
      { type: "STAGE_AIR", side: "allies", units: [], to: "H47" },
      { type: "SPLIT_AIR", side: "allies", unit: "x", parts: [1, 2] },
      { type: "COMBINE_AIR", side: "allies", units: [] },
      { type: "SETUP_DONE", owner: "ussr" },
    ];
    for (const a of others) {
      const r = applyAction(CTX, s, a);
      expect(r.ok, a.type).toBe(false);
      if (!r.ok) expect(r.error, a.type).not.toBe("");
    }
    // a step action says where the game waits, not just that it cannot be done
    const declared = applyAction(CTX, s, { type: "DECLARE_WAR", by: "germany", on: "norway" });
    expect(declared).toEqual({ ok: false, error: expect.stringContaining("step II.A") });
    // and the state is exactly as it was: a refused action changes nothing
    expect(applyAction(CTX, s, { type: "END_STEP", side: "allies", step: "10b" })).toEqual({ ok: false, error: expect.stringContaining("II.A") });
  });
  it("advance and settle on a state that waits at II.A leave it where it is (settle) or refuse (advance)", () => {
    const s = asked();
    expect(settle(CTX, s)).toEqual({ state: s, events: [] });
    expect(() => advance(CTX, s)).toThrow(/II\.A/);
  });
});

describe("the postponed winter", () => {
  it("starts at the next Winter turn with no roll and no question, and says where it was put off from", () => {
    const answered = applyAction(CTX, endTurn(endOfFall({})).state, { type: "CHOOSE_WINTER", side: "allies", postpone: true });
    if (!answered.ok) throw new Error(answered.error);
    const s = { ...answered.state, year: 1942, season: "fall" as const, activeSide: "allies" as const, position: { part: "player-turn", turn: 2, step: "10b" } as const };
    const r = endTurn(s);
    expect(r.state.season).toBe("winter");
    expect(types(winterEvents(r.events))).toEqual(["WINTER_STARTED"]);
    expect(winterEvents(r.events)[0]).toEqual({ type: "WINTER_STARTED", turn: { year: 1942, season: "winter" }, postponedFrom: { year: 1941, season: "winter" } });
    expect(r.state.rngState).toBe(s.rngState);
    expect(r.state.winter).toMatchObject({ stage: "over", inForce: "1942-winter", asking: false });
    expect(winterInForce(r.state)).toBe(true);
    expect(r.state.position?.part).toBe("player-turn");
  });
  it("is not started in the seasons between (Spring, Summer, Fall of 1942)", () => {
    const answered = applyAction(CTX, endTurn(endOfFall({})).state, { type: "CHOOSE_WINTER", side: "allies", postpone: true });
    if (!answered.ok) throw new Error(answered.error);
    const s = { ...answered.state, year: 1942, season: "summer" as const, activeSide: "allies" as const, position: { part: "player-turn", turn: 2, step: "10b" } as const };
    const r = endTurn(s);
    expect(r.state.season).toBe("fall");
    expect(winterEvents(r.events)).toEqual([]);
    expect(r.state.winter!.stage).toBe("postponed");
  });
});

describe("the winter is in force for the whole Game Turn and no longer", () => {
  it("both Player Turns of the Winter turn, and not the Spring turn after it", () => {
    const s0 = endTurn(endOfFall({ units: germans(24) })).state;
    expect(winterInForce(s0)).toBe(true);
    // ...to the second Player Turn of the same Game Turn
    let s = s0;
    for (let guard = 0; guard < 80 && !(s.season === "winter" && s.position?.part === "player-turn" && s.position.turn === 2); guard++) {
      const here = legalActions(CTX, s);
      const a = here.find((x) => x.type === "END_PLAYER_TURN" || x.type === "END_STEP")!;
      const r = applyAction(CTX, s, a);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect([s.season, s.position?.part === "player-turn" ? s.position.turn : 0]).toEqual(["winter", 2]);
    expect(winterInForce(s)).toBe(true);
    // ...and out of it: Spring 1942
    for (let guard = 0; guard < 80 && s.season === "winter"; guard++) {
      const a = legalActions(CTX, s).find((x) => x.type === "END_PLAYER_TURN" || x.type === "END_STEP")!;
      const r = applyAction(CTX, s, a);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect([s.year, s.season]).toEqual([1942, "spring"]);
    expect(winterInForce(s)).toBe(false);
    expect(s.winter).toMatchObject({ stage: "over", inForce: "1941-winter" });
  });
});

describe("a declaration of war in a Winter turn (Ref 28.0; V43)", () => {
  /** The Winter 1941 turn begun with Germany and Russia not at war, at step 1 of the Axis (Germany) or of the Allies (Russia, now an Allied Power). */
  const winterStep1 = (side: "axis" | "allies"): GameState => {
    const r = endTurn(endOfFall({ war: false }));
    const base = { ...r.state, nations: { ...r.state.nations, ussr: { ...r.state.nations.ussr, status: "allied" as const } } };
    return { ...base, activeSide: side, position: { part: "player-turn", turn: side === "axis" ? 1 : 2, step: "1" } };
  };
  it("Russia declaring on Germany: that turn is the first winter at once, no roll, no question, and the Axis having played changes nothing", () => {
    const s = winterStep1("allies");
    const r = applyAction(CTX, s, { type: "DECLARE_WAR", by: "ussr", on: "germany" });
    if (!r.ok) throw new Error(r.error);
    expect(types(r.events)).toEqual(["BRPS_CHANGED", "WAR_DECLARED", "WINTER_STARTED"]);
    expect(r.events[2]).toEqual({ type: "WINTER_STARTED", turn: { year: 1941, season: "winter" }, early: true });
    expect(r.state.winter).toMatchObject({ stage: "over", inForce: "1941-winter", asking: false });
    expect(r.state.winter!.roll).toBeUndefined();
    expect(winterInForce(r.state)).toBe(true);
    expect(r.state.rngState).toBe(s.rngState);
  });
  it("Germany declaring on Russia: no winter this turn (II.A was before), the next Winter turn is the first, with a roll", () => {
    const s = winterStep1("axis");
    const r = applyAction(CTX, s, { type: "DECLARE_WAR", by: "germany", on: "ussr" });
    if (!r.ok) throw new Error(r.error);
    expect(winterEvents(r.events)).toEqual([]);
    expect(r.state.winter).toBeUndefined();
    expect(winterInForce(r.state)).toBe(false);
    // the following Winter turn: the war is on, so the dice are rolled
    const next = endTurn({ ...r.state, year: 1942, season: "fall", lastTurn: { year: 1946, season: "fall" }, activeSide: "allies", position: { part: "player-turn", turn: 2, step: "10b" } });
    expect(types(winterEvents(next.events))[0]).toBe("WINTER_ROLLED");
  });
  it("Russia declaring on Germany outside a Winter turn does nothing to the winter", () => {
    const s = { ...winterStep1("allies"), season: "fall" as const };
    const r = applyAction(CTX, s, { type: "DECLARE_WAR", by: "ussr", on: "germany" });
    if (!r.ok) throw new Error(r.error);
    expect(winterEvents(r.events)).toEqual([]);
    expect(r.state.winter).toBeUndefined();
  });
  it("Russia declaring on someone else (Italy) in a Winter turn does nothing to the winter", () => {
    const s = winterStep1("allies");
    const r = applyAction(CTX, s, { type: "DECLARE_WAR", by: "ussr", on: "italy" });
    if (!r.ok) throw new Error(r.error);
    expect(winterEvents(r.events)).toEqual([]);
    expect(r.state.winter).toBeUndefined();
  });
  it("in the 1942 scenario (first winter past) a Russian declaration starts nothing", () => {
    const base = board([], SCENARIO_1942, { year: 1942, season: "winter", activeSide: "allies", firstSide: "axis", wars: [], position: { part: "player-turn", turn: 2, step: "1" } });
    const r = applyAction(ctxFor(SCENARIO_1942), base, { type: "DECLARE_WAR", by: "ussr", on: "germany" });
    if (!r.ok) throw new Error(r.error);
    expect(winterEvents(r.events)).toEqual([]);
    expect(r.state.winter).toBeUndefined();
  });
  it("the early winter happens once: a second Russian declaration is impossible (already at war), and the stage is over", () => {
    const s = winterStep1("allies");
    const r = applyAction(CTX, s, { type: "DECLARE_WAR", by: "ussr", on: "germany" });
    if (!r.ok) throw new Error(r.error);
    expect(applyAction(CTX, r.state, { type: "DECLARE_WAR", by: "ussr", on: "germany" })).toMatchObject({ ok: false });
    expect(winterStage(CTX, r.state)).toBe("over");
  });
});

describe("who acts (sideToAct)", () => {
  const asked = (): GameState => endTurn(endOfFall({})).state;
  it("the Allies at II.A, whoever played last", () => {
    expect(sideToAct(asked())).toBe("allies");
    const s = asked();
    expect(sideToAct({ ...s, activeSide: "axis" })).toBe("allies");
    expect(sideToAct({ ...s, activeSide: "allies" })).toBe("allies");
  });
  it("otherwise the side whose Player Turn it is", () => {
    const s = endOfFall({});
    expect(sideToAct(s)).toBe("allies");
    expect(sideToAct({ ...s, activeSide: "axis" })).toBe("axis");
  });
  it("the chooser of a pending Exchange, whoever attacks", () => {
    const s = endOfFall({});
    const pending = { chooser: "axis" as const, target: "H47", candidates: [], values: {}, required: 1, attackers: [] };
    const withPending = { ...s, activeSide: "allies" as const, combat: { turn: `${s.year}-${s.season}-allies`, attacked: [], targets: [], pending, advances: [] } };
    expect(sideToAct(withPending)).toBe("axis");
  });
  it("the question's answer wins over a stale record: only while the game stands at II.A", () => {
    const s = endOfFall({ winter: { stage: "ahead", asking: true } });
    expect(sideToAct(s)).toBe("allies"); // activeSide is allies already
    expect(sideToAct({ ...s, activeSide: "axis" })).toBe("axis"); // not at II.A: the flag alone asks nothing
  });
});

describe("a recorded game with the question replays to the same state", () => {
  it("the actions, CHOOSE_WINTER included, give the same final state and the same events", () => {
    const s0 = endOfFall({});
    const a1: Action = { type: "END_PLAYER_TURN", side: "allies" };
    const a2: Action = { type: "CHOOSE_WINTER", side: "allies", postpone: true };
    const direct = applyAction(CTX, s0, a1);
    if (!direct.ok) throw new Error(direct.error);
    const second = applyAction(CTX, direct.state, a2);
    if (!second.ok) throw new Error(second.error);
    const again = replay(CTX, s0, [a1, a2]);
    expect(again.state).toEqual(second.state);
    expect(again.events).toEqual([...direct.events, ...second.events]);
    // survives the JSON round trip a saved game goes through
    const saved = JSON.parse(JSON.stringify(direct.state)) as GameState;
    expect(winterAsking(saved)).toBe(true);
    expect(applyAction(CTX, saved, a2)).toEqual(second);
  });
});

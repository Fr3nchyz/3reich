import { describe, expect, it } from "vitest";
import { SCENARIOS, SCENARIO_KEYS } from "../scripts/selfplay/scenarios";
import { runGame } from "../scripts/selfplay/runner";
import { replay } from "../src/engine/actions";
import { newGame } from "../src/engine/game";
import type { GameState } from "../src/engine/types";
import type { JsonObject } from "../src/save/format";
import { createSnapshotValidator, validateSnapshotInvariants } from "../src/save/snapshotInvariants";
import { ctxFor, CTX } from "./helpers";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fresh = () => newGame(CTX.scenario, 1);
function placed(): GameState {
  const state = fresh();
  const e = state.pools.germany!.forcePool.find(e => e.type === "infantry")!;
  e.count--;
  state.nextUnitId = 2;
  state.units.u1 = { id: "u1", owner: "germany", type: e.type, strength: e.strength, movement: e.movement, at: "K21" };
  return copy(state);
}
const reject = (state: unknown, word: string) => {
  const result = validateSnapshotInvariants(state, CTX);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.problems.join(" ")).toContain(word);
};

describe("spec 11 Parts A/E, AER55 snapshot invariants", () => {
  it.each(SCENARIO_KEYS)("Parts A/E: accepts real %s setup and mid-game snapshots", key => {
    const scenario = SCENARIOS[key], ctx = ctxFor(scenario);
    const game = runGame({ scenario: key, seed: 1, turns: 2, verify: false });
    for (const cut of [0, game.setupActions, game.setupActions + 5, game.actions.length]) {
      const state = replay(ctx, newGame(scenario, 1), game.actions.slice(0, cut)).state;
      expect(validateSnapshotInvariants(copy(state), ctx)).toEqual({ ok: true });
    }
  }, 60_000);
  it("Part A/AER55: rejects missing and malformed fields without throwing", () => {
    for (const value of [null, [], {}, { ...fresh(), units: null }, { ...fresh(), control: [] }]) reject(value, "saved");
    reject({ ...fresh(), unexpected: true }, "unknown field");
    reject({ ...fresh(), rngState: NaN }, "rngState");
  });
  it("Part A/AER55: rejects malformed, mismatched and duplicate unit ids", () => {
    for (const id of ["u0", "u01", "other", "u2"]) {
      const s = placed(); s.units = { [id]: { ...s.units.u1!, id } }; reject(s, "units");
    }
    const s = placed(); s.nextUnitId = 3; s.units.u2 = { ...s.units.u1! }; reject(s, "duplicate id");
  });
  it("Part A/AER55: rejects missing hexes but allows both off-map boxes", () => {
    const s = placed(); s.units.u1!.at = "missing"; reject(s, "units");
    for (const at of ["us-box", "murmansk-box"] as const) {
      s.units.u1!.at = at; expect(validateSnapshotInvariants(s, CTX)).toEqual({ ok: true });
    }
  });
  it("Part A/AER55: rejects unknown owner and nationality", () => {
    const s = copy(placed()) as unknown as JsonObject;
    const units = s.units as JsonObject, u = units.u1 as JsonObject;
    u.owner = "unknown"; reject(s, "units"); u.owner = "germany"; u.nationality = "unknown"; reject(s, "units");
  });
  it("Part A; Ops 9.0: rejects impossible strengths, movement and pool counts", () => {
    const s = placed(); s.units.u1!.strength = 99; reject(s, "definition");
    s.units.u1!.strength = 3; s.units.u1!.movement = 99; reject(s, "definition");
    const p = fresh(); p.pools.germany!.forcePool[0]!.count = -1; reject(p, "pools");
    const excess = placed(); excess.pools.germany!.forcePool.find(e => e.type === "infantry")!.count++;
    reject(excess, "too many");
  });
  it("Part A; Ref 9.2, spec 14 R8/V27: checks production and permits BRP deficits", () => {
    for (const field of ["brpBase", "spent", "spendLimit", "growthRate"] as const) {
      const s = fresh(); s.nations.germany[field] = -1; reject(s, "nations");
    }
    const s = fresh(); s.nations.britain.brpTotal = -25;
    expect(validateSnapshotInvariants(s, CTX)).toEqual({ ok: true });
    s.strategicWarfare.germany.submarines = -1; reject(s, "strategicWarfare");
  });
  it("Part A; Ops 5.0: rejects turn, setup, phase and RNG ranges", () => {
    const s = fresh(); s.year = 1938; reject(s, "year");
    s.year = 1939; s.season = "spring"; reject(s, "outside");
    const p = fresh(); p.setup!.index = p.setup!.order.length; reject(p, "deployment");
    p.setup!.index = 0; p.phase = "player-turn"; reject(p, "disagree");
    const r = fresh(); r.rngState = 0x100000000; reject(r, "rngState");
  });
  it("Part A; Ref 19.4/spec 12 R6: checks supply and convoy references", () => {
    const s = placed(); s.unsuppliedAtStart = ["u2"]; reject(s, "unsuppliedAtStart");
    s.unsuppliedAtStart = ["u1"];
    s.naval = { turn: "1939-fall-axis", gameTurn: "1939-fall", used: {}, moved: [], triedIntercept: [],
      supply: [{ fleets: [], units: ["u1"], from: "missing", to: "K21" }] };
    reject(s, "naval"); s.naval.supply[0]!.from = "K21";
    expect(validateSnapshotInvariants(s, CTX)).toEqual({ ok: true });
  });
  it("Part A; spec 15 R3/R10/R13: checks minor, garrison and occupation references", () => {
    const s = fresh() as unknown as JsonObject;
    s.countries = { missing: { status: "neutral" } }; reject(s, "countries");
    s.countries = { finland: { status: "neutral", closedTo: ["missing"] } }; reject(s, "countries");
    s.countries = {}; s.soviet = { citiesTaken: {}, credited: ["missing"] }; reject(s, "soviet");
    delete s.soviet; s.control = { missing: "germany" }; reject(s, "control");
    s.control = { K21: "missing" }; reject(s, "control");
  });
  it("Part A/AER55: allows allocated destroyed ids in historical records", () => {
    const s = placed(); delete s.units.u1;
    s.moves = { turn: "1939-fall-axis", moved: ["u1"] };
    s.grayFleets = { u1: { year: 1940, season: "fall" } };
    expect(validateSnapshotInvariants(s, CTX)).toEqual({ ok: true });
    s.moves.moved = ["u2"]; reject(s, "moves");
  });
  it("Part A/AER55; Ops 5.45g: permits temporary stored overstacks", () => {
    const s = placed(), e = s.pools.germany!.forcePool.find(e => e.type === "infantry")!;
    for (let n = 2; n <= 3; n++) { e.count--; s.units[`u${n}`] = { ...s.units.u1!, id: `u${n}` }; }
    s.nextUnitId = 4;
    reject(s, "impossible stack");
    s.phase = "player-turn"; s.setup = null; s.position = { part: "player-turn", turn: 1, step: "6f" };
    expect(validateSnapshotInvariants(s, CTX)).toEqual({ ok: true });
  });
  it("Part A/AER55: factory returns a detached unchanged copy or refuses", () => {
    const input = copy(placed()) as unknown as JsonObject, before = copy(input);
    const validate = createSnapshotValidator(), result = validate(input, CTX);
    expect(result).toEqual(input); expect(result).not.toBe(input); expect(input).toEqual(before);
    result!.units.u1!.strength = 99; expect(input).toEqual(before);
    expect(validate({}, CTX)).toBeUndefined();
  });
});

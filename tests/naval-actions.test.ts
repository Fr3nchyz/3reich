import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/ai";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import type { GameContext } from "../src/engine/context";
import { IMPLEMENTED_STEPS } from "../src/engine/sequence";
import { hasUsed, navalOf, useOf } from "../src/engine/naval-record";
import { settle } from "../src/engine/turn";
import { wasCutOff } from "../src/engine/supply-effects";
import { unsuppliedUnits } from "../src/engine/supply";
import type { GameState, Unit } from "../src/engine/types";
import { eventSide } from "../src/ui/logSide";
import { run } from "../src/ui/session";
import { atMovement } from "./helpers-move-session";
import { board, counter } from "./board";
import { CTX } from "./helpers";

// Spec 12 ticket 12-3 (R5, R6, R8, C2, C3, C5; Ref 19.31, 19.1, 5.45e, 5.48f): DESIGNATE_SEA_SUPPLY at steps 6e and 9f.
// Norway pocket: German infantry at Oslo (C35), C34 and Bergen (C33), a German fleet at Wilhelmshaven (K28). Sardinia: Italian infantry at Cagliari.
const ON: GameContext = { ...CTX, supplyEffects: true };
const OFF: GameContext = { ...CTX, supplyEffects: false };
const inf = (id: string, at: string, owner: Unit["owner"] = "germany"): Unit => counter(id, owner, "infantry", 2, at, 3);
const fleet = (id: string, at: string, strength = 9, owner: Unit["owner"] = "germany"): Unit => counter(id, owner, "fleet", strength, at);
const pocket = (ids = ["g1", "g2", "g3"]): Unit[] => ids.map((id, i) => inf(id, ["C35", "C34", "C33"][i % 3]!));

/** A position at this step of the Axis Player Turn, the units that were cut off at its start recorded. */
function at(step: string, units: Unit[], extra: Partial<GameState> = {}): GameState {
  const base = board([]);
  const s = board(units, undefined, {
    nations: { ...base.nations, italy: { ...base.nations.italy, status: "axis" } },
    control: { C33: "germany", C34: "germany", C35: "germany" },
    position: { part: "player-turn", turn: 1, step },
    ...extra,
  });
  return { unsuppliedAtStart: unsuppliedUnits(ON, s, "axis"), ...s };
}
const ok = (r: ReturnType<typeof applyAction>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
const sea = (fleets: string[], to: string, units: string[], side: "axis" | "allies" = "axis"): Action => ({ type: "DESIGNATE_SEA_SUPPLY", side, fleets, to, units });
const stepOf = (s: GameState): string => (s.position?.part === "player-turn" ? s.position.step : "?");
const done = (s: GameState): Action => ({ type: "END_STEP", side: s.activeSide, step: stepOf(s) });

describe("the steps wait only when there is something to save", () => {
  it("6e and 9f are built steps", () => {
    expect(IMPLEMENTED_STEPS.has("6e")).toBe(true);
    expect(IMPLEMENTED_STEPS.has("9f")).toBe(true);
  });

  it("with the supply effects on and a cut-off unit a fleet can reach, the game stops at 6e and lists the proposals and the way on", () => {
    const s = at("6b", [...pocket(), fleet("f1", "K28")]);
    const settled = settle(ON, s).state;
    expect(stepOf(settled)).toBe("6e");
    const legal = legalActions(ON, settled);
    expect(legal.filter((a) => a.type === "DESIGNATE_SEA_SUPPLY")).toEqual([sea(["f1"], "C33", ["g1", "g2", "g3"])]);
    expect(legal.at(-1)).toEqual({ type: "END_STEP", side: "axis", step: "6e" });
  });

  it("with the effects off, as shipped, 6e and 9f are passed as they always were", () => {
    const s = at("6b", [...pocket(), fleet("f1", "K28")]);
    const r = settle(OFF, s);
    expect(stepOf(r.state)).toBe("6f");
    expect(r.events).toEqual([{ type: "STEPS_PASSED", steps: ["6b", "6c", "6d", "6e"] }]);
    expect(stepOf(settle(OFF, at("9e", [...pocket(), fleet("f1", "K28")])).state)).toBe("10b");
    expect(stepOf(settle({ ...CTX }, s).state)).toBe("6f"); // and the shipped setting is off
  });

  it("with the effects on but nobody cut off, or no fleet that can reach them, the step is passed", () => {
    expect(stepOf(settle(ON, at("6b", [inf("g1", "L32"), fleet("f1", "K28")])).state)).toBe("6f");
    expect(stepOf(settle(ON, at("6b", pocket())).state)).toBe("6f");
    expect(stepOf(settle(ON, at("6b", [...pocket(), fleet("f1", "C33")])).state)).toBe("6f"); // the fleet sits in the cut-off port
  });

  it("9f waits the same way", () => {
    const s = at("9e", [...pocket(), fleet("f1", "K28")]);
    const settled = settle(ON, s).state;
    expect(stepOf(settled)).toBe("9f");
    expect(legalActions(ON, settled).some((a) => a.type === "DESIGNATE_SEA_SUPPLY")).toBe(true);
  });

  it("the other side's cut-off units are not offered to the side to move", () => {
    const s = at("6b", [...pocket(), fleet("f1", "K28"), inf("b1", "AA19", "britain")], { activeSide: "allies" });
    expect(legalActions(ON, settle(ON, s).state).some((a) => a.type === "DESIGNATE_SEA_SUPPLY")).toBe(false);
  });
});

describe("DESIGNATE_SEA_SUPPLY", () => {
  const start = (): GameState => at("6e", [...pocket(["g1", "g2", "g3", "g4"]), fleet("f1", "K28"), fleet("f2", "K28", 2)]);

  it("records the designation, uses up the fleet for the Game Turn and says so", () => {
    const s = start();
    const r = ok(applyAction(ON, s, sea(["f1"], "C33", ["g1", "g2"])));
    expect(r.events).toEqual([{ type: "FLEET_DESIGNATED_FOR_SUPPLY", fleets: ["f1"], from: "K28", to: "C33", units: ["g1", "g2"] }]);
    expect(navalOf(r.state).supply).toEqual([{ fleets: ["f1"], from: "K28", to: "C33", units: ["g1", "g2"] }]);
    expect(useOf(r.state, "f1")).toBe("supply");
    expect(hasUsed(r.state, "f2")).toBe(false);
    expect(unsuppliedUnits(ON, r.state, "axis")).toEqual(["g3", "g4"]);
    expect(s.naval).toBeUndefined(); // the old state is untouched
  });

  it("the step goes on by itself when no legal designation could save another unit, and stays while one could", () => {
    const all = ok(applyAction(ON, start(), sea(["f1"], "C33", ["g1", "g2", "g3", "g4"])));
    expect(stepOf(all.state)).toBe("6f"); // all four are saved
    expect(all.events.map((e) => e.type)).toEqual(["FLEET_DESIGNATED_FOR_SUPPLY", "STEPS_PASSED"]);
    const some = ok(applyAction(ON, start(), sea(["f1"], "C33", ["g1"])));
    expect(stepOf(some.state)).toBe("6e");
    expect(some.events.map((e) => e.type)).toEqual(["FLEET_DESIGNATED_FOR_SUPPLY"]);
    expect(legalActions(OFF, all.state).some((a) => a.type === "END_STEP" && a.step === "6e")).toBe(false);
  });

  it("a fleet may be named again for the capacity it has left (N8), and a spent one is not offered", () => {
    const s = ok(applyAction(ON, start(), sea(["f1"], "C33", ["g1", "g2"]))).state;
    const again = legalActions(ON, s).filter((a) => a.type === "DESIGNATE_SEA_SUPPLY");
    expect(again).toEqual([sea(["f1"], "C33", ["g3", "g4"])]);
    const twice = ok(applyAction(ON, s, again[0]!)).state;
    expect(unsuppliedUnits(ON, twice, "axis")).toEqual([]);
    expect(navalOf(twice).supply.length).toBe(2);
    expect(legalActions(ON, twice).some((a) => a.type === "DESIGNATE_SEA_SUPPLY")).toBe(false);
  });

  it("is refused with the rule that is broken, never thrown, and changes nothing", () => {
    const s = start();
    const refused = (a: Action): string => {
      const r = applyAction(ON, s, a);
      expect(r.ok).toBe(false);
      return r.ok ? "" : r.error;
    };
    expect(refused(sea(["f1"], "C33", ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9", "g10"]))).toMatch(/not a ground unit or airbase/);
    expect(refused(sea(["f2"], "C33", ["g1", "g2", "g3"]))).toMatch(/carries only 2 more units.*3 are named/);
    expect(refused(sea(["g1"], "C33", ["g2"]))).toMatch(/not a fleet on the map/);
    expect(refused(sea(["f1"], "C34", ["g2"]))).toMatch(/not a port or a one-hex island/);
    expect(refused(sea(["f1"], "L25", ["g2"]))).toMatch(/not held by the axis side/);
    expect(refused(sea(["f1"], "C33", ["g1"], "allies"))).toMatch(/It is the axis player turn, not allies/);
    expect(refused(sea([], "C33", ["g1"]))).toMatch(/names one or more distinct fleets/);
    expect(refused({ type: "DESIGNATE_SEA_SUPPLY", side: "axis", fleets: "f1" as unknown as string[], to: "C33", units: ["g1"] })).toMatch(/names one or more distinct fleets/);
    expect(refused({ type: "DESIGNATE_SEA_SUPPLY", side: "axis", fleets: [5] as unknown as string[], to: "C33", units: ["g1"] })).toMatch(/names one or more distinct fleets/);
    expect(refused({ type: "DESIGNATE_SEA_SUPPLY", side: "axis", fleets: ["f1"], to: undefined as unknown as string, units: ["g1"] })).toMatch(/names one or more distinct fleets/);
    expect(refused(sea(["f1", "f1"], "C33", ["g1"]))).toMatch(/names one or more distinct fleets/);
    expect(refused(sea(["nobody"], "C33", ["g1"]))).toMatch(/not a fleet on the map/);
    for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(refused(sea(["f1"], id, ["g1"])), id).toMatch(/not a port or a one-hex island/);
      expect(refused(sea([id], "C33", ["g1"])), id).toMatch(/not a fleet on the map/);
      expect(refused(sea(["f1"], "C33", [id])), id).toMatch(/not a ground unit or airbase/);
    }
    expect(s.naval).toBeUndefined();
  });

  it("a fleet used for something else this Game Turn, or built in it, is refused", () => {
    const used = { ...start(), naval: { ...navalOf(start()), used: { f1: "intercept" as const } } };
    expect(ok(applyAction(ON, used, done(used)))).toBeTruthy();
    const r = applyAction(ON, used, sea(["f1"], "C33", ["g1"]));
    expect(!r.ok && r.error).toMatch(/already been used this Game Turn \(intercept\)/);
    expect(legalActions(ON, used).filter((a) => a.type === "DESIGNATE_SEA_SUPPLY").every((a) => a.type === "DESIGNATE_SEA_SUPPLY" && !a.fleets.includes("f1"))).toBe(true); // only the small fleet is offered
  });

  it("is refused at any other step, naming 6e and 9f", () => {
    const s = at("6f", [...pocket(), fleet("f1", "K28")]);
    const r = applyAction(ON, s, sea(["f1"], "C33", ["g1"]));
    expect(!r.ok && r.error).toMatch(/Fleets are named to carry supply in step 6e or 9f; the game is at step 6f/);
    const none = applyAction(ON, { ...s, position: null }, sea(["f1"], "C33", ["g1"]));
    expect(none.ok).toBe(false);
  });

  it("works at 9f as well, and a recorded game replays to the same state", () => {
    const s = at("9f", [...pocket(), fleet("f1", "K28")]);
    const actions: Action[] = [sea(["f1"], "C33", ["g1", "g2", "g3"])];
    const a = replay(ON, s, actions);
    const b = replay(ON, s, actions);
    expect(b.state).toEqual(a.state);
    expect(a.events[0]).toMatchObject({ type: "FLEET_DESIGNATED_FOR_SUPPLY" });
    expect(unsuppliedUnits(ON, a.state, "axis")).toEqual([]);
  });
});

describe("supply is read again when 6e is left (R8, Ref 19.1)", () => {
  const moves = (s: GameState): string[] => legalActions(ON, s).flatMap((a) => (a.type === "MOVE" ? a.units : []));

  it("a unit saved at 6e is no longer cut off at 6f and may move; one that was not saved still cannot", () => {
    const s = at("6e", [...pocket(["g1", "g2", "g3"]), fleet("f1", "K28", 2)]);
    expect(s.unsuppliedAtStart).toEqual(["g1", "g2", "g3"]);
    // The small fleet is used up by two units, so no designation could save the third: the step goes on by itself and supply is read again.
    const left = ok(applyAction(ON, s, sea(["f1"], "C33", ["g1", "g2"])));
    expect(stepOf(left.state)).toBe("6f");
    expect(left.events.map((e) => e.type)).toEqual(["FLEET_DESIGNATED_FOR_SUPPLY", "STEPS_PASSED"]);
    expect(left.state.unsuppliedAtStart).toEqual(["g3"]);
    expect(moves(left.state)).toContain("g1");
    expect(moves(left.state)).not.toContain("g3");
  });

  it("the record is not changed while the step still waits for another designation, and is when it is left", () => {
    const s = at("6e", [...pocket(["g1", "g2", "g3"]), fleet("f1", "K28")]);
    const named = ok(applyAction(ON, s, sea(["f1"], "C33", ["g1"]))).state;
    expect(stepOf(named)).toBe("6e"); // the fleet could still carry the others
    expect(wasCutOff(named, "g1")).toBe(true);
    const left = ok(applyAction(ON, named, done(named))).state;
    expect(stepOf(left)).toBe("6f");
    expect(left.unsuppliedAtStart).toEqual(["g2", "g3"]);
  });

  it("with the effects off the record is not touched, and leaving 6e changes nothing else", () => {
    const s = at("6e", [...pocket(), fleet("f1", "K28")], { unsuppliedAtStart: ["g1"] });
    const left = ok(applyAction(OFF, s, done(s))).state;
    expect(left.unsuppliedAtStart).toEqual(["g1"]);
  });

  it("the record is replaced by the list of 6e, so a unit cut off then and not saved is the only one eliminated at the end (N34)", () => {
    const s = at("6e", [...pocket(["g1", "g2", "g3"]), fleet("f1", "K28", 2)]);
    const named = ok(applyAction(ON, s, sea(["f1"], "C33", ["g1", "g2"]))).state;
    let t = ok(applyAction(ON, named, done(named))).state;
    t = { ...t, position: { part: "player-turn", turn: 1, step: "10b" } };
    const end = ok(applyAction(ON, t, { type: "END_PLAYER_TURN", side: "axis" }));
    expect(end.events.filter((e) => e.type === "UNIT_ELIMINATED").map((e) => e.type === "UNIT_ELIMINATED" && e.unitId)).toEqual(["g3"]);
    expect(Object.keys(end.state.units).sort()).toEqual(["f1", "g1", "g2"]);
  });

  it("a designation made at 9f saves a unit that is still cut off at the end", () => {
    const s = at("9f", [...pocket(["g1", "g2", "g3"]), fleet("f1", "K28")]);
    const named = ok(applyAction(ON, s, sea(["f1"], "C33", ["g1", "g2", "g3"]))).state;
    const t = { ...named, position: { part: "player-turn" as const, turn: 1 as const, step: "10b" } };
    const end = ok(applyAction(ON, t, { type: "END_PLAYER_TURN", side: "axis" }));
    expect(end.events.some((e) => e.type === "UNIT_ELIMINATED")).toBe(false);
  });
});

describe("a designation that no longer holds lapses at the end of the Player Turn (R7, R8)", () => {
  it("a fleet lost after it was named: a SEA_SUPPLY_LAPSED event with the rule, the units are cut off again, and the one at 10b still goes by the 6e list", () => {
    const s = at("6e", [...pocket(["g1", "g2"]), fleet("f1", "K28")]);
    const named = ok(applyAction(ON, s, sea(["f1"], "C33", ["g1", "g2"]))).state;
    const left = ok(applyAction(ON, named, done(named))).state;
    const { f1: _sunk, ...units } = left.units;
    const sunk: GameState = { ...left, units, position: { part: "player-turn", turn: 1, step: "10b" } };
    expect(unsuppliedUnits(ON, sunk, "axis")).toEqual(["g1", "g2"]);
    const end = ok(applyAction(ON, sunk, { type: "END_PLAYER_TURN", side: "axis" }));
    const lapsed = end.events.filter((e) => e.type === "SEA_SUPPLY_LAPSED");
    expect(lapsed).toEqual([{ type: "SEA_SUPPLY_LAPSED", fleets: ["f1"], from: "K28", to: "C33", units: ["g1", "g2"], reason: expect.stringMatching(/not a fleet on the map/) as string }]);
    expect(end.events.indexOf(lapsed[0]!)).toBeLessThan(end.events.findIndex((e) => e.type === "PLAYER_TURN_STARTED"));
  });

  it("the place taken after it was named lapses it too; a designation that still holds does not", () => {
    const s = at("6e", [...pocket(["g1", "g2"]), fleet("f1", "K28"), fleet("f2", "K28")]);
    const a = ok(applyAction(ON, s, sea(["f1"], "C33", ["g1"]))).state;
    const b = ok(applyAction(ON, a, sea(["f2"], "C33", ["g2"]))).state;
    const taken: GameState = { ...b, control: { ...b.control, C33: "britain" }, position: { part: "player-turn", turn: 1, step: "10b" } };
    const end = ok(applyAction(ON, taken, { type: "END_PLAYER_TURN", side: "axis" }));
    expect(end.events.filter((e) => e.type === "SEA_SUPPLY_LAPSED").length).toBe(2);
    const fine: GameState = { ...b, position: { part: "player-turn", turn: 1, step: "10b" } };
    expect(ok(applyAction(ON, fine, { type: "END_PLAYER_TURN", side: "axis" })).events.some((e) => e.type === "SEA_SUPPLY_LAPSED")).toBe(false);
  });

  it("a turn with no designation looks no further", () => {
    const s = at("10b", [...pocket(), fleet("f1", "K28")]);
    const end = ok(applyAction(ON, s, { type: "END_PLAYER_TURN", side: "axis" }));
    expect(end.events.some((e) => e.type === "SEA_SUPPLY_LAPSED")).toBe(false);
  });
});

describe("the computer answers the prompt with sea supply (ticket 12-5)", () => {
  it("at 6e and at 9f it designates a legal saving proposal", () => {
    for (const step of ["6e", "9f"]) {
      const s = at(step, [...pocket(), fleet("f1", "K28")]);
      expect(legalActions(ON, s).some((a) => a.type === "DESIGNATE_SEA_SUPPLY")).toBe(true);
      const d = chooseAction(ON, s, { seed: 1 });
      expect(d?.action.type).toBe("DESIGNATE_SEA_SUPPLY");
      expect(legalActions(ON, s)).toContainEqual(d!.action);
      const after = ok(applyAction(ON, s, d!.action)).state;
      expect(unsuppliedUnits(ON, after, "axis")).toEqual([]);
    }
  });
});

describe("the log knows the new events", () => {
  it("the side of a fleet designation or a lapse is the side of its fleets, else the side that acted", () => {
    const s = at("6e", [...pocket(), fleet("f1", "K28")]);
    const named = { type: "FLEET_DESIGNATED_FOR_SUPPLY" as const, fleets: ["f1"], from: "K28", to: "C33", units: ["g1"] };
    expect(eventSide(named, "allies", s)).toBe("axis");
    expect(eventSide({ type: "SEA_SUPPLY_LAPSED", fleets: ["f1"], from: "K28", to: "C33", units: ["g1"], reason: "x" }, "allies", s)).toBe("axis");
    expect(eventSide(named, "allies", { ...s, units: {} })).toBe("allies");
  });
});

describe("the activity log says it in words", () => {
  it("naming fleets writes one line with the fleets, the ports and the units, and a lapse writes the rule", () => {
    const s = atMovement();
    s.ctx = ON;
    s.state = at("6e", [...pocket(["g1", "g2"]), fleet("f1", "K28")]);
    s.log = [];
    expect(run(s, sea(["f1"], "C33", ["g1", "g2"]))).toBe(true);
    expect(s.log).toEqual(["Supply by sea from Wilhelmshaven (K28) to Bergen (C33), carried by 9 German fleet, for 2 x 2-3 German infantry."]);
    const lost = { ...s.state, units: Object.fromEntries(Object.entries(s.state.units).filter(([id]) => id !== "f1")), position: { part: "player-turn" as const, turn: 1 as const, step: "10b" } };
    s.state = lost;
    s.log = [];
    run(s, { type: "END_PLAYER_TURN", side: "axis" });
    expect(s.log.some((l) => /^The supply by sea from Wilhelmshaven \(K28\) to Bergen \(C33\) no longer holds: .*not a fleet on the map/.test(l))).toBe(true);
  });
});

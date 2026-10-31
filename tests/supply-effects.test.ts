import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "../src/engine/actions";
import { combatOf, turnKey } from "../src/engine/combat-record";
import { movableProblem } from "../src/engine/movement";
import { SUPPLY_EFFECTS_ENABLED, eliminateUnsupplied, recordUnsupplied, wasCutOff } from "../src/engine/supply-effects";
import { LAST_STEP } from "../src/engine/sequence";
import type { GameState } from "../src/engine/types";
import { CTX } from "./helpers";
import { at6f, errorOf, inf, move, okOf } from "./helpers-move";

// What being out of supply does (Ref 19.4, 11.74, 12.21). Positions on the real 1939 map: V28 is neutral Yugoslav land nobody controls (not S30: Hungary sleeps and supplies Germans, spec 15 R10),
// so a German unit there has no line to Berlin (L31); L32 and L33 are German plain next to Berlin.
const cut = () => at6f([inf("g1", "germany", "V28", 3, 3), inf("g2", "germany", "L32", 3, 3)]);

describe("the record of who is cut off when the Player Turn begins", () => {
  it("is switched off for now: nothing is recorded, so supply changes nothing in play (see SUPPLY_EFFECTS_ENABLED)", () => {
    expect(SUPPLY_EFFECTS_ENABLED).toBe(false);
    const s = cut();
    expect(recordUnsupplied(CTX, s)).toBe(s);
    expect(recordUnsupplied(CTX, s).unsuppliedAtStart).toBeUndefined();
  });

  it("when switched on, lists the side's ground units with no supply line", () => {
    const s = recordUnsupplied(CTX, cut(), true);
    expect(s.unsuppliedAtStart).toEqual(["g1"]);
    expect(wasCutOff(s, "g1")).toBe(true);
    expect(wasCutOff(s, "g2")).toBe(false);
  });

  it("an empty list is not recorded when there was none before", () => {
    const fine = at6f([inf("g2", "germany", "L32", 3, 3)]);
    expect(recordUnsupplied(CTX, fine, true)).toBe(fine);
  });
});

describe("cut off at the start: cannot move (Ref 19.4)", () => {
  it("is refused with the reason, while a supplied unit moves", () => {
    const s: GameState = { ...cut(), unsuppliedAtStart: ["g1"] };
    expect(movableProblem(CTX, s, s.units.g1!)).toMatch(/out of supply and cannot move/);
    expect(movableProblem(CTX, s, s.units.g2!)).toBeNull();
    expect(errorOf(move(s, ["g1"], ["S31"]))).toMatch(/out of supply/);
    expect(okOf(move(s, ["g2"], ["L33"])).state.units.g2!.at).toBe("L33");
  });
});

describe("cut off at the start: cannot advance after combat (Ref 12.21), but may attack", () => {
  it("is left out of the advance sets", () => {
    const base = at6f([inf("g1", "germany", "M32", 3, 3), inf("g2", "germany", "M32", 3, 3), inf("p1", "poland", "M33", 2, 3)]);
    const s: GameState = { ...base, position: { part: "player-turn", turn: 1, step: "7h" }, combat: { ...combatOf(base), turn: turnKey(base), attacked: ["g1", "g2"], targets: ["M33"], advances: [{ to: "M33", units: ["g1", "g2"] }] }, units: { g1: base.units.g1!, g2: base.units.g2! }, unsuppliedAtStart: ["g1"] };
    const advances = legalActions(CTX, s).filter((a) => a.type === "ADVANCE");
    expect(advances.length).toBeGreaterThan(0);
    for (const a of advances) expect(a.type === "ADVANCE" && a.units).not.toContain("g1");
    const refused = applyAction(CTX, s, { type: "ADVANCE", side: "axis", units: ["g1"], to: "M33" });
    expect(!refused.ok && refused.error).toMatch(/cannot advance/);
    expect(applyAction(CTX, s, { type: "ADVANCE", side: "axis", units: ["g2"], to: "M33" }).ok).toBe(true);
  });

  it("a cut-off unit is still in the pool of attackers (Ref 19.4: unsupplied units keep their full combat factor)", () => {
    const s: GameState = { ...at6f([inf("g1", "germany", "M32", 6, 3), inf("p1", "poland", "M33", 1, 3)]), position: { part: "player-turn", turn: 1, step: "7h" }, unsuppliedAtStart: ["g1"] };
    expect(legalActions(CTX, s).some((a) => a.type === "ATTACK")).toBe(true);
  });
});

describe("the Player Turn ends: cut-off units are eliminated (Ref 19.4, 11.74)", () => {
  it("eliminates the units that were cut off at the start and still are, with the reason, and forgets the record", () => {
    const s: GameState = { ...cut(), unsuppliedAtStart: ["g1"] };
    const r = eliminateUnsupplied(CTX, s);
    expect(r.state.units.g1).toBeUndefined();
    expect(r.state.units.g2).toBeDefined();
    expect(r.state.unsuppliedAtStart).toBeUndefined();
    expect(r.events).toEqual([
      { type: "UNIT_ELIMINATED", unitId: "g1", owner: "germany", at: "V28", reason: "unsupplied" },
      { type: "UNIT_RETURNED_TO_POOL", unitId: "g1", owner: "germany", unitType: "infantry", strength: 3, at: "V28", pool: "germany" }, // spec 17 R1 (Ref 11.74)
    ]);
  });

  it("spares a unit that got back into supply during the turn (it was cut off at the start only)", () => {
    const s: GameState = { ...cut(), unsuppliedAtStart: ["g1"], units: { ...cut().units, g1: { ...cut().units.g1!, at: "L33" } } };
    expect(eliminateUnsupplied(CTX, s).state.units.g1).toBeDefined();
  });

  it("spares a unit that was supplied at the start and is cut off only at the end (the 11.74 reading; TODO(verify) against 19.4)", () => {
    const s = cut();
    expect(eliminateUnsupplied(CTX, s).state.units.g1).toBeDefined();
  });

  it("happens when the last step of the Player Turn is left", () => {
    const base: GameState = { ...cut(), position: { part: "player-turn", turn: 1, step: LAST_STEP }, unsuppliedAtStart: ["g1"] };
    const r = okOf(applyAction(CTX, base, { type: "END_PLAYER_TURN", side: "axis" }));
    expect(r.state.units.g1).toBeUndefined();
    expect(r.events.some((e) => e.type === "UNIT_ELIMINATED" && e.reason === "unsupplied")).toBe(true);
  });
});

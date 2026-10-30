import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import { combatOf, turnKey } from "../src/engine/combat-record";
import { sideToAct } from "../src/engine/actor";
import { MC23_UNPLACEABLE_ARMY_PASSES, firstPendingMinor, placingSide } from "../src/engine/minors-step";
import { settle } from "../src/engine/turn";
import type { CountryRecord } from "../src/engine/minors-record";
import type { GameState, MinorCountry } from "../src/engine/types";
import { chooseAction } from "../src/ai/choose";
import { CTX, atStart } from "./helpers";

// Spec 15 C2, C3, C5, C6 (ticket 15-3b): step 2, PLACE_MINOR_FORCES, the side that acts, the events.
type Countries = Partial<Record<MinorCountry, CountryRecord>>;
const attacked = (toPlace: "axis" | "allies"): CountryRecord => ({ status: "attacked", attacker: toPlace === "allies" ? "germany" : "britain", toPlace });
/** A game standing at step 1 of a Player Turn of `active`, with these records; leaving 1 reaches step 2. */
function at1(countries: Countries, active: "axis" | "allies" = "axis"): GameState {
  const s = atStart(SCENARIO_1939, 1);
  return { ...s, activeSide: active, countries: { ...s.countries, ...countries }, position: { part: "player-turn", turn: 1, step: "1" } };
}
const at2 = (countries: Countries, active: "axis" | "allies" = "axis"): GameState => {
  const s = at1(countries, active);
  return settle(CTX, { ...s, position: { part: "player-turn", turn: 1, step: "2" } }).state;
};
const step = (s: GameState) => (s.position?.part === "player-turn" ? s.position.step : "?");
const place = (s: GameState): Extract<Action, { type: "PLACE_MINOR_FORCES" }> =>
  legalActions(CTX, s).find((a): a is Extract<Action, { type: "PLACE_MINOR_FORCES" }> => a.type === "PLACE_MINOR_FORCES")!;

describe("step 2: an attacked minor's army (spec 15 R3, C5)", () => {
  it("C5: the step waits while a country has toPlace, and the non-active side acts", () => {
    const s = at2({ belgium: attacked("allies") });
    expect(step(s)).toBe("2");
    expect(sideToAct(s)).toBe("allies");
    expect(s.activeSide).toBe("axis");
    expect(placingSide(s)).toBe("allies");
    expect(firstPendingMinor(s)).toBe("belgium");
  });

  it("C5: with nothing to place the step is passed, and the active side acts as before", () => {
    const s = at1({});
    const r = applyAction(CTX, s, { type: "END_STEP", side: "axis", step: "1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(step(r.state)).not.toBe("2");
      expect(r.events.some((e) => e.type === "STEPS_PASSED" && e.steps.includes("2"))).toBe(true);
    }
    expect(sideToAct(s)).toBe("axis");
  });

  it("C5: leaving step 1 reaches step 2 and waits there", () => {
    const r = applyAction(CTX, at1({ belgium: attacked("allies") }), { type: "END_STEP", side: "axis", step: "1" });
    expect(r.ok && step(r.state)).toBe("2");
  });

  it("C2: legalActions lists only the one placement for the placing side; no way to move on while an army waits", () => {
    const s = at2({ belgium: attacked("allies") });
    const legal = legalActions(CTX, s);
    expect(legal).toHaveLength(1);
    expect(legal[0]).toMatchObject({ type: "PLACE_MINOR_FORCES", side: "allies", minor: "belgium" });
    expect(applyAction(CTX, s, { type: "END_STEP", side: "axis", step: "2" }).ok).toBe(false);
  });

  it("R3, C3: placing sets the army up, clears toPlace, emits the event and moves the game on", () => {
    const s = at2({ belgium: attacked("allies") });
    const a = place(s);
    const r = applyAction(CTX, s, a);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const mine = Object.values(r.state.units).filter((u) => u.owner === "belgium");
    expect(mine).toHaveLength(a.placements.length);
    expect(r.state.countries?.belgium?.toPlace).toBeUndefined();
    expect(r.state.countries?.belgium?.status).toBe("attacked");
    expect(r.events).toContainEqual({ type: "MINOR_FORCES_PLACED", minor: "belgium", side: "allies", units: mine.map((u) => u.id) });
    expect(step(r.state)).not.toBe("2");
  });

  it("C2: the active side, a wrong minor, a wrong placement and a replay of the action are refused", () => {
    const s = at2({ belgium: attacked("allies") });
    const a = place(s);
    expect(applyAction(CTX, s, { ...a, side: "axis" }).ok).toBe(false);
    expect(applyAction(CTX, s, { ...a, minor: "norway" }).ok).toBe(false);
    expect(applyAction(CTX, s, { ...a, placements: a.placements.slice(1) }).ok).toBe(false);
    expect(applyAction(CTX, s, { ...a, placements: "x" as never }).ok).toBe(false);
    const done = applyAction(CTX, s, a);
    expect(done.ok && applyAction(CTX, done.state, a).ok).toBe(false);
  });

  it("C2: PLACE_MINOR_FORCES is refused at any other step", () => {
    const s = at2({ belgium: attacked("allies") });
    const a = place(s);
    const elsewhere = { ...s, position: { part: "player-turn" as const, turn: 1 as const, step: "6f" } };
    expect(applyAction(CTX, elsewhere, a).ok).toBe(false);
  });

  it("C5: two armies are set up one after the other, each by its own side (a declaration and a wake-up in one turn)", () => {
    const s = at2({ belgium: attacked("allies"), hungary: attacked("axis") });
    expect(firstPendingMinor(s)).toBe("belgium");
    const first = applyAction(CTX, s, place(s));
    expect(first.ok && step(first.state)).toBe("2");
    if (!first.ok) return;
    expect(sideToAct(first.state)).toBe("axis");
    expect(legalActions(CTX, first.state)).toHaveLength(1);
    const second = applyAction(CTX, first.state, place(first.state));
    expect(second.ok && step(second.state)).not.toBe("2");
  });

  it("C5: a defenseless or neutral record, or a conquered country, holds nothing up", () => {
    expect(step(at2({ persia: { status: "attacked", attacker: "britain" } }))).not.toBe("2");
    expect(step(at2({ belgium: { status: "neutral", toPlace: "allies" } }))).not.toBe("2");
    const conquered = { ...at1({ belgium: attacked("allies") }), conquests: [{ country: "belgium" } as never] };
    expect(step(settle(CTX, { ...conquered, position: { part: "player-turn", turn: 1, step: "2" } }).state)).not.toBe("2");
  });

  it("MC23: an army with no legal placement does not stall the game", () => {
    expect(MC23_UNPLACEABLE_ARMY_PASSES).toBe(true);
    const full = at1({ belgium: attacked("allies") });
    const blocked = { ...full, units: { ...full.units, ...Object.fromEntries(Object.values(CTX.map.hexes).filter((h) => h.country === "belgium")
      .flatMap((h, i) => [0, 1, 2].map((k) => [`x${i}${k}`, { id: `x${i}${k}`, owner: "germany", type: "infantry", strength: 3, at: h.id, movement: 3 }]))) } };
    expect(step(settle(CTX, { ...blocked, position: { part: "player-turn", turn: 1, step: "2" } }).state)).not.toBe("2");
  });

  it("C6: the computer answers step 2 for the placing side with the suggested placement", () => {
    const s = at2({ belgium: attacked("allies") });
    const d = chooseAction(CTX, s, { seed: 1 });
    expect(d?.action).toEqual(place(s));
    // and for the Axis when the Allies are the active side
    const t = at2({ belgium: { status: "attacked", attacker: "britain", toPlace: "axis" } }, "allies");
    expect(sideToAct(t)).toBe("axis");
    expect(chooseAction(CTX, t, { seed: 1 })?.action).toMatchObject({ type: "PLACE_MINOR_FORCES", side: "axis" });
  });

  it("C6: the step 7h Exchange chooser is still the side to act", () => {
    const s = at2({ belgium: attacked("allies") });
    const exchange = (g: GameState, chooser: "axis" | "allies"): GameState => ({ ...g, combat: { ...combatOf(g), turn: turnKey(g),
      pending: { chooser, target: "M35", candidates: ["a"], values: { a: 1 }, required: 1, attackers: ["a"] } } });
    const here = { ...s, position: { part: "player-turn" as const, turn: 1 as const, step: "7h" } };
    expect(sideToAct(exchange(here, "allies"))).toBe("allies");
    expect(sideToAct(exchange({ ...here, activeSide: "allies" }, "axis"))).toBe("axis");
    expect(sideToAct(here), "the pending army of step 2 does not leak into 7h").toBe("axis");
  });

  it("replay: the recorded placement reproduces the same state", () => {
    const s = at2({ belgium: attacked("allies") });
    const a = place(s);
    const r = applyAction(CTX, s, a);
    expect(r.ok && replay(CTX, s, [a]).state).toEqual(r.ok && r.state);
  });

  it("flow: a declaration at step 1 leaves the Allies to set the army up at step 2, whoever the computer plays", () => {
    const s0 = atStart(SCENARIO_1939, 1);
    const decl = legalActions(CTX, s0).find((a) => a.type === "DECLARE_WAR" && a.on === "denmark");
    expect(decl).toBeDefined();
    const declared = applyAction(CTX, s0, decl!);
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    const left = applyAction(CTX, declared.state, { type: "END_STEP", side: "axis", step: "1" });
    expect(left.ok && step(left.state)).toBe("2");
    if (!left.ok) return;
    expect(sideToAct(left.state)).toBe("allies");
    const done = applyAction(CTX, left.state, chooseAction(CTX, left.state, { seed: 1 })!.action);
    expect(done.ok && Object.values(done.state.units).some((u) => u.owner === "denmark")).toBe(true);
    expect(done.ok && done.state.countries?.denmark?.toPlace).toBeUndefined();
  });
});

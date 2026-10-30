import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { minorDeclarationProblem } from "../src/engine/minors-declare";
import { MC24_REVOKED_BRPS_LOST, MC3_ONLY_DECLARERS_UNITS, checkMinorDuties, noteMinorEntry } from "../src/engine/minors-duty";
import { applyMinorPlacement, suggestMinorPlacement } from "../src/engine/minors-place";
import { settle } from "../src/engine/turn";
import { adjacentHexes } from "../src/engine/zoc";
import type { GameState, Unit } from "../src/engine/types";
import { CTX, atStart } from "./helpers";

// Spec 15 R4 (ticket 15-4): the duty after declaring on a minor; entries from MOVE and ATTACK; the check leaving 7p; the revocation.
const BELGIUM = Object.entries(CTX.map.hexes).filter(([, h]) => h.country === "belgium").map(([id]) => id);
const outside = (): string => BELGIUM.flatMap((b) => adjacentHexes(CTX, b)).find((h) => CTX.map.hexes[h]?.country === "germany" && !CTX.map.hexes[h]?.sea)!;
const unit = (id: string, owner: Unit["owner"], at: string, type: Unit["type"] = "infantry"): Unit => ({ id, owner, type, strength: 3, movement: 4, at });

/** Germany declared on Belgium this Game Turn (duty open), Belgium's army placed, at `step` of the Axis turn. */
function declared(step: string): GameState {
  const s = atStart(SCENARIO_1939, 1);
  const d: GameState = {
    ...s, activeSide: "axis", units: {}, wars: [...s.wars, ["germany", "belgium"]],
    countries: { ...s.countries, belgium: { status: "attacked", attacker: "germany", toPlace: "allies", duty: { by: "germany", declared: { year: 1939, season: "fall" } } } },
    position: { part: "player-turn", turn: 1, step },
  };
  const placed = applyMinorPlacement(CTX, d, "belgium", suggestMinorPlacement(CTX, d, "belgium")!);
  if (!placed.ok) throw new Error(placed.error);
  return placed.state;
}
const withUnits = (s: GameState, ...us: Unit[]): GameState => ({ ...s, units: { ...s.units, ...Object.fromEntries(us.map((u) => [u.id, u])) } });
const dutyOf = (s: GameState) => s.countries?.belgium?.duty;

describe("R4: entries meet the duty", () => {
  it("a declarer's unit ending a move in the minor clears the duty, with no event", () => {
    const s = noteMinorEntry(CTX, declared("6f"), [unit("g", "germany", "X")], [BELGIUM[0]!]);
    expect(dutyOf(s)).toBeUndefined();
    expect(s.countries?.belgium?.status).toBe("attacked");
  });
  it("a pass-through counts: any hex of the path", () => {
    expect(dutyOf(noteMinorEntry(CTX, declared("6f"), [unit("g", "germany", "X")], [outside(), BELGIUM[1]!, outside()]))).toBeUndefined();
  });
  it("MC3: an ally's unit entering does not meet it", () => {
    expect(MC3_ONLY_DECLARERS_UNITS).toBe(true);
    expect(dutyOf(noteMinorEntry(CTX, declared("6f"), [unit("i", "italy", "X")], [BELGIUM[0]!]))).toBeDefined();
  });
  it("a move that stays outside the minor does not meet it", () => {
    expect(dutyOf(noteMinorEntry(CTX, declared("6f"), [unit("g", "germany", "X")], [outside()]))).toBeDefined();
  });
  it("the MOVE action: a German unit moving into Belgium clears the duty", () => {
    const s = withUnits(declared("6f"), unit("g1", "germany", outside()));
    const move = legalActions(CTX, s).find((a): a is Extract<Action, { type: "MOVE" }> => a.type === "MOVE" && a.units.includes("g1") && a.path.some((h) => BELGIUM.includes(h)));
    expect(move).toBeDefined();
    const r = applyAction(CTX, s, move!);
    expect(r.ok && dutyOf(r.state)).toBeUndefined();
  });
  it("the MOVE action: a move elsewhere leaves the duty open", () => {
    const s = withUnits(declared("6f"), unit("g1", "germany", outside()));
    const move = legalActions(CTX, s).find((a): a is Extract<Action, { type: "MOVE" }> => a.type === "MOVE" && a.units.includes("g1") && !a.path.some((h) => BELGIUM.includes(h)));
    expect(move).toBeDefined();
    const r = applyAction(CTX, s, move!);
    expect(r.ok && dutyOf(r.state)).toBeDefined();
  });
  it("the ATTACK action: attacking a hex of the minor clears the duty, whatever the roll", () => {
    const target = Object.values(declared("7h").units).find((u) => u.owner === "belgium")!.at;
    const from = adjacentHexes(CTX, target).find((h) => CTX.map.hexes[h]?.country !== "belgium" && !CTX.map.hexes[h]?.sea)!;
    const s = withUnits(declared("7h"), unit("g1", "germany", from));
    const attack = legalActions(CTX, s).find((a): a is Extract<Action, { type: "ATTACK" }> => a.type === "ATTACK" && a.units.includes("g1") && a.target === target);
    expect(attack).toBeDefined();
    const r = applyAction(CTX, s, attack!);
    expect(r.ok && dutyOf(r.state)).toBeUndefined();
  });
});

describe("R4: the check leaving 7p", () => {
  it("a met duty: nothing happens", () => {
    const s = { ...declared("7p"), countries: { ...declared("7p").countries, belgium: { status: "attacked" as const, attacker: "germany" as const } } };
    const r = checkMinorDuties(CTX, s);
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });
  it("an unmet duty: neutral again, army removed, war ended, BRPs stay spent, one event", () => {
    const s = declared("7p");
    const army = Object.values(s.units).filter((u) => u.owner === "belgium").map((u) => u.id);
    expect(army.length).toBeGreaterThan(0);
    const r = checkMinorDuties(CTX, s);
    expect(r.state.countries?.belgium).toEqual({ status: "neutral" });
    expect(Object.values(r.state.units).some((u) => u.owner === "belgium")).toBe(false);
    expect(r.state.wars.some(([a, b]) => a === "belgium" || b === "belgium")).toBe(false);
    expect(r.state.nations.germany.brpTotal).toBe(s.nations.germany.brpTotal);
    const ev = r.events.filter((e) => e.type === "MINOR_DECLARATION_REVOKED");
    expect(ev).toEqual([{ type: "MINOR_DECLARATION_REVOKED", by: "germany", minor: "belgium", brpsLost: MC24_REVOKED_BRPS_LOST, removed: expect.arrayContaining(army) }]);
    expect(MC24_REVOKED_BRPS_LOST).toBe(10);
  });
  it("other nations' units inside are eliminated to their pools; units outside stay", () => {
    const s = withUnits(declared("7p"), unit("i1", "italy", BELGIUM[0]!), unit("g9", "germany", outside()));
    const r = checkMinorDuties(CTX, s);
    expect(r.state.units["i1"]).toBeUndefined();
    expect(r.state.units["g9"]).toBeDefined();
    expect(r.events.some((e) => e.type === "UNIT_ELIMINATED" && e.unitId === "i1")).toBe(true);
    expect(r.events.some((e) => e.type === "MINOR_DECLARATION_REVOKED" && e.removed.includes("i1"))).toBe(true);
  });
  it("the check is made only at the end of the declarer's own Player Turn", () => {
    const s = { ...declared("7p"), activeSide: "allies" as const };
    expect(checkMinorDuties(CTX, s).state).toBe(s);
  });
  it("leaving 7p runs the check (turn.ts), and a declaration on a minor can then be made again", () => {
    const r = settle(CTX, declared("7p"));
    expect(r.state.countries?.belgium?.status).toBe("neutral");
    expect(r.events.some((e) => e.type === "MINOR_DECLARATION_REVOKED")).toBe(true);
  });
  it("after a revocation the country is neutral and a new declaration is allowed (R4, R2)", () => {
    const r = settle(CTX, declared("7p")).state;
    expect(minorDeclarationProblem(CTX, r, "germany", "belgium")).toBeNull();
  });
  it("a minor with no duty (Poland, recorded from the start) is untouched", () => {
    const s = { ...declared("7p"), countries: { poland: { status: "attacked" as const, attacker: "germany" as const } } };
    expect(checkMinorDuties(CTX, s).state).toBe(s);
  });
});

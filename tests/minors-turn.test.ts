import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { combatOf } from "../src/engine/combat-record";
import { MC15_MINOR_OPTION_IMPLICIT, MC26_POLAND_OWN_TURN, ownTurnMinor } from "../src/engine/minors-turn";
import { movableUnits } from "../src/engine/movement";
import type { GameState, Unit } from "../src/engine/types";
import { adjacentHexes } from "../src/engine/zoc";
import { CTX, atStart } from "./helpers";

// Spec 15 R15 (ticket 15-18 slice A): an attacked, un-helped minor plays its own turn at step 4 of its controller's Player Turn.
const hexesOf = (country: string) => Object.entries(CTX.map.hexes).filter(([, h]) => h.country === country && h.land).map(([id]) => id);
const BELGIUM = hexesOf("belgium");
const BORDER = BELGIUM.find((b) => adjacentHexes(CTX, b).some((n) => CTX.map.hexes[n]?.country === "germany" && CTX.map.hexes[n]?.land))!;
const ACROSS = adjacentHexes(CTX, BORDER).find((n) => CTX.map.hexes[n]?.country === "germany" && CTX.map.hexes[n]?.land)!;
const INSIDE = BELGIUM.find((b) => b !== BORDER && adjacentHexes(CTX, BORDER).includes(b))!;
const unit = (id: string, owner: Unit["owner"], at: string): Unit => ({ id, owner, type: "infantry", strength: 3, movement: 4, at });
const withUnits = (s: GameState, ...us: Unit[]): GameState => ({ ...s, units: { ...s.units, ...Object.fromEntries(us.map((u) => [u.id, u])) } });

/** Germany attacked Belgium (duty met); the Allied Player Turn of 1939 at `step`; a Belgian unit on the border, a British unit near it, a German unit across the border. */
function attacked(step: string, status: "attacked" | "allied" = "attacked"): GameState {
  const s = atStart(SCENARIO_1939, 1);
  const base: GameState = {
    ...s, activeSide: "allies", units: {}, wars: [...s.wars, ["germany", "belgium"]],
    countries: { ...s.countries, belgium: { status, attacker: "germany", ...(status === "allied" ? { helpers: ["britain" as const] } : {}) } },
    position: { part: "player-turn", turn: 1, step },
  };
  return withUnits(base, unit("m1", "belgium", BORDER), unit("b1", "britain", INSIDE), unit("g1", "germany", ACROSS));
}
const movers = (s: GameState) => legalActions(CTX, s).filter((a): a is Extract<Action, { type: "MOVE" }> => a.type === "MOVE").flatMap((a) => a.units);
const attackers = (s: GameState) => legalActions(CTX, s).filter((a): a is Extract<Action, { type: "ATTACK" }> => a.type === "ATTACK").flatMap((a) => a.units);

describe("R15: which units act at step 4", () => {
  it("the settings", () => {
    expect(MC26_POLAND_OWN_TURN).toBe(false);
    expect(MC15_MINOR_OPTION_IMPLICIT).toBe(true);
  });
  it("only an attacked, un-helped minor's units move at step 4; not the Major Powers'", () => {
    const m = movers(attacked("4"));
    expect(m).toContain("m1");
    expect(m).not.toContain("b1");
  });
  it("and they do not move at 6f any more: the Major Power does", () => {
    const m = movers(attacked("6f"));
    expect(m).toContain("b1");
    expect(m).not.toContain("m1");
  });
  it("the minor's units attack at step 4 only (not 7h); the others attack at 7h only", () => {
    expect(attackers(attacked("4"))).toContain("m1");
    expect(attackers(attacked("7h"))).not.toContain("m1");
  });
  it("a helped (allied) minor keeps acting at 6f and 7h, with its ally", () => {
    const s = attacked("6f", "allied");
    expect(ownTurnMinor(s, "belgium")).toBe(false);
    expect(movers(s)).toContain("m1");
    expect(movers({ ...s, position: { part: "player-turn", turn: 1, step: "4" } })).toEqual([]);
  });
  it("MC26: Poland has no step-4 turn (it moves at 6f)", () => {
    const s = atStart(SCENARIO_1939, 1);
    expect(ownTurnMinor(s, "poland")).toBe(false);
  });
  it("an old state without a position keeps the old rule (the minor moves)", () => {
    const { position: _p, ...rest } = attacked("6f");
    void _p;
    expect(movableUnits(CTX, rest as GameState).map((u) => u.id)).toContain("m1");
  });
});

describe("R15: the step, its order and its end", () => {
  it("leaving step 3 stops at step 4 while an attacked minor has work, and passes it when none is attacked", () => {
    const stops = applyAction(CTX, attacked("3"), { type: "END_STEP", side: "allies", step: "3" });
    expect(stops.ok && stops.state.position).toEqual({ part: "player-turn", turn: 1, step: "4" });
    const none = applyAction(CTX, { ...attacked("3"), countries: atStart(SCENARIO_1939, 1).countries, wars: atStart(SCENARIO_1939, 1).wars }, { type: "END_STEP", side: "allies", step: "3" });
    expect(none.ok && none.state.position).not.toEqual({ part: "player-turn", turn: 1, step: "4" });
  });
  it("a human may Pass: END_STEP is listed and moves on to the controller's own turn", () => {
    const s = attacked("4");
    const end = legalActions(CTX, s).find((a) => a.type === "END_STEP");
    expect(end).toEqual({ type: "END_STEP", side: "allies", step: "4" });
    const r = applyAction(CTX, s, end!);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.position).toMatchObject({ part: "player-turn" });
    if (r.ok && r.state.position?.part === "player-turn") expect(r.state.position.step).not.toBe("4");
  });
  it("movement before combat: after an attack no more MOVE is legal or accepted", () => {
    const s = attacked("4");
    const moved = applyAction(CTX, s, { type: "MOVE", side: "allies", units: ["m1"], path: [INSIDE] });
    expect(moved.ok).toBe(true);
    const fresh = withUnits(attacked("4"), unit("m2", "belgium", BORDER));
    const hit = applyAction(CTX, fresh, { type: "ATTACK", side: "allies", units: ["m1"], target: ACROSS });
    expect(hit.ok).toBe(true);
    if (!hit.ok) return;
    expect(combatOf(hit.state).attacked).toContain("m1");
    expect(movers(hit.state)).toEqual([]);
    const late = applyAction(CTX, hit.state, { type: "MOVE", side: "allies", units: ["m2"], path: [INSIDE] });
    expect(late.ok).toBe(false);
    expect(late.ok === false && late.error).toMatch(/before its combat|R15/);
  });
  it("leaving step 4 forgets the hexes attacked: the controller's combat starts clean", () => {
    const hit = applyAction(CTX, attacked("4"), { type: "ATTACK", side: "allies", units: ["m1"], target: ACROSS });
    expect(hit.ok).toBe(true);
    if (!hit.ok) return;
    const rec = combatOf(hit.state);
    expect(rec.targets).toEqual([ACROSS]);
    if (rec.pending) return; // an Exchange waits for its losses: END_STEP is refused (checked below)
    const end = applyAction(CTX, hit.state, { type: "END_STEP", side: "allies", step: "4" });
    expect(end.ok).toBe(true);
    if (end.ok) {
      expect(combatOf(end.state).targets).toEqual([]);
      expect(combatOf(end.state).attacked).toContain("m1");
    }
  });
  it("an Exchange pending at step 4 holds the step", () => {
    const s = attacked("4");
    const pending = { ...s, combat: { turn: "1939-fall-allies", attacked: ["m1"], targets: [ACROSS], pending: { chooser: "allies" as const, target: ACROSS, candidates: ["m1"], values: { m1: 3 }, required: 3, attackers: ["m1"] }, advances: [] } };
    const r = applyAction(CTX, pending, { type: "END_STEP", side: "allies", step: "4" });
    expect(r.ok).toBe(false);
  });
  it("the minor's attack may not advance over its border", () => {
    const s = attacked("4");
    const st: GameState = { ...s, units: { m1: s.units.m1! }, combat: { turn: "1939-fall-allies", attacked: ["m1"], targets: [ACROSS], pending: null, advances: [{ to: ACROSS, units: ["m1"] }] } };
    expect(legalActions(CTX, st).some((a) => a.type === "ADVANCE")).toBe(false);
    const r = applyAction(CTX, st, { type: "ADVANCE", side: "allies", units: ["m1"], to: ACROSS });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/R8/);
  });
  it("moves and attacks of step 4 are refused at other steps, and 6f moves at step 4", () => {
    expect(applyAction(CTX, attacked("6f"), { type: "MOVE", side: "allies", units: ["m1"], path: [INSIDE] }).ok).toBe(false);
    expect(applyAction(CTX, attacked("7h"), { type: "ATTACK", side: "allies", units: ["m1"], target: ACROSS }).ok).toBe(false);
    expect(applyAction(CTX, attacked("4"), { type: "MOVE", side: "allies", units: ["b1"], path: [BELGIUM.find((b) => adjacentHexes(CTX, INSIDE).includes(b) && b !== BORDER) ?? BORDER] }).ok).toBe(false);
  });
});

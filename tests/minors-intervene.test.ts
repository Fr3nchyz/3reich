import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { sideInWar } from "../src/engine/control";
import { MC25_HOME_LIMIT_SPARES_MINOR_ALLIES, MC26_POLAND_MOVES_FREELY, fightingRecord, minorEntryProblem, noteIntervention } from "../src/engine/minors-intervene";
import { entryProblem, neutralLandProblem } from "../src/engine/movement";
import { supplyStatus } from "../src/engine/supply";
import type { GameState, Unit } from "../src/engine/types";
import { adjacentHexes } from "../src/engine/zoc";
import { CTX, atStart } from "./helpers";

// Spec 15 R5, R6, R8 (ticket 15-6): who may enter an attacked minor, the Intervention, a minor's units stay home, the minor's supply.
const hexesOf = (country: string) => Object.entries(CTX.map.hexes).filter(([, h]) => h.country === country && h.land).map(([id]) => id);
const BELGIUM = hexesOf("belgium");
const next = (to: string) => adjacentHexes(CTX, to).find((h) => CTX.map.hexes[h]?.land && CTX.map.hexes[h]?.country !== "belgium")!;
const unit = (id: string, owner: Unit["owner"], at: string, type: Unit["type"] = "infantry"): Unit => ({ id, owner, type, strength: 3, movement: 4, at });
const withUnits = (s: GameState, ...us: Unit[]): GameState => ({ ...s, units: { ...s.units, ...Object.fromEntries(us.map((u) => [u.id, u])) } });

/** Germany attacked Belgium (duty already met), Allied turn at `step`. */
function attacked(step = "6f", record: Partial<NonNullable<GameState["countries"]>["belgium"]> = {}): GameState {
  const s = atStart(SCENARIO_1939, 1);
  return {
    ...s, activeSide: "allies", units: {}, wars: [...s.wars, ["germany", "belgium"]],
    countries: { ...s.countries, belgium: { status: "attacked", attacker: "germany", ...record } },
    position: { part: "player-turn", turn: 1, step },
  };
}

describe("R5: who may enter an attacked minor's land", () => {
  const s = attacked();
  const h = BELGIUM[0]!;
  it("the declarer may", () => expect(minorEntryProblem(CTX, s, ["germany"], h)).toBeNull());
  it("a Major Power of the other side may (that entry is the Intervention)", () => {
    expect(minorEntryProblem(CTX, s, ["britain"], h)).toBeNull();
    expect(minorEntryProblem(CTX, s, ["france"], h)).toBeNull();
  });
  it("the minor's own units may", () => expect(minorEntryProblem(CTX, s, ["belgium"], h)).toBeNull());
  it("the declarer's ally may not", () => {
    const ally = { ...s, nations: { ...s.nations, italy: { ...s.nations.italy, status: "axis" as const } } };
    expect(minorEntryProblem(CTX, ally, ["italy"], h)).toMatch(/R5/);
    expect(neutralLandProblem(CTX, ally, ["italy"], h)).toMatch(/R5/);
  });
  it("a neutral Major Power may not", () => expect(minorEntryProblem(CTX, s, ["ussr"], h)).toMatch(/R5/));
  it("another minor's units may not", () => expect(minorEntryProblem(CTX, s, ["portugal"], h)).toMatch(/stay in their country|R5/));
  it("ground movement and air flight read the same test (entryProblem and neutralLandProblem)", () => {
    expect(entryProblem(CTX, s, ["britain"], h)).toBeNull();
    expect(neutralLandProblem(CTX, s, ["britain"], h)).toBeNull();
    const ally = { ...s, nations: { ...s.nations, italy: { ...s.nations.italy, status: "axis" as const } } };
    expect(entryProblem(CTX, ally, ["italy"], h)).not.toBeNull();
  });
  it("a conquered minor is not fighting: its land is no longer under these rules", () => {
    const conquered = { ...s, conquests: [{ country: "belgium" } as never] };
    expect(fightingRecord(conquered, "belgium")).toBeNull();
    expect(minorEntryProblem(CTX, conquered, ["italy"], h)).toBeNull();
  });
  it("a neutral minor has no fighting record", () => {
    expect(fightingRecord(atStart(SCENARIO_1939, 1), "belgium")).toBeNull();
  });
});

describe("R6: Intervention", () => {
  it("the first entry by a Major Power of the other side records the helper; the minor is allied; one event", () => {
    const r = noteIntervention(CTX, attacked(), [unit("b1", "britain", next(BELGIUM[0]!))], [BELGIUM[0]!]);
    expect(r.state.countries?.belgium).toEqual({ status: "allied", attacker: "germany", helpers: ["britain"] });
    expect(r.events).toEqual([{ type: "MINOR_INTERVENED", minor: "belgium", by: "britain" }]);
  });
  it("a second helper is added after the first (MC19: first to Intervene first); the same helper again changes nothing", () => {
    const a = noteIntervention(CTX, attacked(), [unit("b1", "britain", "X")], [BELGIUM[0]!]);
    const b = noteIntervention(CTX, a.state, [unit("f1", "france", "X")], [BELGIUM[1]!]);
    expect(b.state.countries?.belgium?.helpers).toEqual(["britain", "france"]);
    const again = noteIntervention(CTX, b.state, [unit("b2", "britain", "X")], [BELGIUM[2]!]);
    expect(again.events).toEqual([]);
    expect(again.state).toBe(b.state);
  });
  it("the declarer, the minor's own unit and the declarer's ally do not Intervene", () => {
    const s = attacked();
    expect(noteIntervention(CTX, s, [unit("g", "germany", "X"), unit("m", "belgium", "X")], [BELGIUM[0]!]).events).toEqual([]);
    const ally = { ...s, nations: { ...s.nations, italy: { ...s.nations.italy, status: "axis" as const } } };
    expect(noteIntervention(CTX, ally, [unit("i", "italy", "X")], [BELGIUM[0]!]).events).toEqual([]);
  });
  it("MC5: a won attack's advance into a hex of the minor Intervenes too", () => {
    const to = BELGIUM[0]!;
    const from = next(to);
    const st: GameState = { ...withUnits(attacked("7h"), unit("b1", "britain", from)), combat: { turn: "1939-fall-allies", attacked: ["b1"], targets: [to], pending: null, advances: [{ to, units: ["b1"] }] } };
    const r = applyAction(CTX, st, { type: "ADVANCE", side: "allies", units: ["b1"], to });
    expect(r.ok && r.state.countries?.belgium?.helpers).toEqual(["britain"]);
  });
  it("a path that never enters the minor is no Intervention", () => {
    expect(noteIntervention(CTX, attacked(), [unit("b1", "britain", "X")], [next(BELGIUM[0]!)]).events).toEqual([]);
  });
  it("a conquered minor cannot be helped", () => {
    const conquered = { ...attacked(), conquests: [{ country: "belgium" } as never] };
    expect(noteIntervention(CTX, conquered, [unit("b1", "britain", "X")], [BELGIUM[0]!]).events).toEqual([]);
  });
  it("a neutral minor is not helped (no war)", () => {
    expect(noteIntervention(CTX, atStart(SCENARIO_1939, 1), [unit("b1", "britain", "X")], [BELGIUM[0]!]).events).toEqual([]);
  });
  it("the helper's side owns the minor's side: the minor fights beside it", () => {
    const r = noteIntervention(CTX, attacked(), [unit("b1", "britain", "X")], [BELGIUM[0]!]);
    expect(sideInWar(r.state, "belgium")).toBe("allies");
  });
  it("the MOVE action: a British unit moving into Belgium Intervenes", () => {
    const s = withUnits(attacked(), unit("b1", "britain", next(BELGIUM[0]!)));
    const move = legalActions(CTX, s).find((a): a is Extract<Action, { type: "MOVE" }> => a.type === "MOVE" && a.units.includes("b1") && a.path.some((x) => BELGIUM.includes(x)));
    expect(move).toBeDefined();
    const r = applyAction(CTX, s, move!);
    expect(r.ok && r.state.countries?.belgium?.helpers).toEqual(["britain"]);
    expect(r.ok && r.events.some((e) => e.type === "MINOR_INTERVENED")).toBe(true);
  });
  it("a pass-through counts: a path that crosses the minor and ends outside", () => {
    const r = noteIntervention(CTX, attacked(), [unit("b1", "britain", "X")], [BELGIUM[0]!, next(BELGIUM[0]!)]);
    expect(r.events).toHaveLength(1);
  });
  it("a move that stays out leaves the minor un-helped", () => {
    const s = withUnits(attacked(), unit("b1", "britain", next(BELGIUM[0]!)));
    const move = legalActions(CTX, s).find((a): a is Extract<Action, { type: "MOVE" }> => a.type === "MOVE" && !a.path.some((x) => BELGIUM.includes(x)));
    if (move) expect(applyAction(CTX, s, move).ok && (applyAction(CTX, s, move) as { state: GameState }).state.countries?.belgium?.status).toBe("attacked");
  });
  it("air and naval units never Intervene through a move (the hook is for ground moves; air flight is not a move)", () => {
    const s = withUnits(attacked(), unit("a1", "britain", next(BELGIUM[0]!), "air"));
    expect(legalActions(CTX, s).filter((a) => a.type === "MOVE" && a.units.includes("a1"))).toEqual([]);
  });
});

describe("R8: a minor's units stay home", () => {
  const s = withUnits(attacked(), unit("m1", "belgium", BELGIUM[0]!));
  it("refuse any hex outside the country, ground (entryProblem) and air (neutralLandProblem)", () => {
    const out = next(BELGIUM[0]!);
    expect(entryProblem(CTX, s, ["belgium"], out)).toMatch(/R8/);
    expect(neutralLandProblem(CTX, s, ["belgium"], out)).toMatch(/R8/);
  });
  it("a hex inside the country is fine", () => expect(entryProblem(CTX, s, ["belgium"], BELGIUM[1]!)).toBeNull());
  it("legal moves of a minor's unit never leave the country", () => {
    const moves = legalActions(CTX, s).filter((a): a is Extract<Action, { type: "MOVE" }> => a.type === "MOVE" && a.units.includes("m1"));
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) expect(m.path.every((x) => CTX.map.hexes[x]?.country === "belgium")).toBe(true);
  });
  it("after a cross-border attack it may not advance over the border", () => {
    const at = BELGIUM.find((b) => adjacentHexes(CTX, b).some((n) => CTX.map.hexes[n]?.country === "germany" && CTX.map.hexes[n]?.land))!;
    const target = adjacentHexes(CTX, at).find((n) => CTX.map.hexes[n]?.country === "germany" && CTX.map.hexes[n]?.land)!;
    const st: GameState = { ...withUnits(attacked("7h"), unit("m1", "belgium", at), unit("g1", "germany", target)), combat: { turn: "1939-fall-allies", attacked: [], targets: [], pending: null, advances: [{ to: target, units: ["m1"] }] } };
    expect(legalActions(CTX, st).some((a) => a.type === "ADVANCE")).toBe(false);
    const r = applyAction(CTX, st, { type: "ADVANCE", side: "allies", units: ["m1"], to: target });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/R8/);
    const ok = applyAction(CTX, { ...st, combat: { turn: "1939-fall-allies", attacked: [], targets: [], pending: null, advances: [{ to: BELGIUM.find((b) => b !== at && adjacentHexes(CTX, at).includes(b))!, units: ["m1"] }] } }, { type: "ADVANCE", side: "allies", units: ["m1"], to: BELGIUM.find((b) => b !== at && adjacentHexes(CTX, at).includes(b))! });
    expect(ok.ok).toBe(true);
  });
  it("MC26: Poland, played by the Allied side from the opening setup, is not held to the limit", () => {
    expect(MC26_POLAND_MOVES_FREELY).toBe(true);
    expect(minorEntryProblem(CTX, s, ["poland"], next(BELGIUM[0]!))).toBeNull();
  });
  it("MC25: the four Axis Minor-Allies are not held to the home limit", () => {
    expect(MC25_HOME_LIMIT_SPARES_MINOR_ALLIES).toBe(true);
    expect(minorEntryProblem(CTX, s, ["finland"], next(BELGIUM[0]!))).toBeNull();
  });
});

describe("R8: supply of a minor's units", () => {
  // Poland is attacked by Germany from the start; Warsaw is taken, so only a Soviet source can feed a Polish unit near the Soviet border.
  const POLAND = hexesOf("poland");
  const east = POLAND.find((p) => adjacentHexes(CTX, p).some((n) => CTX.map.hexes[n]?.country === "ussr"))!;
  const base = (): GameState => {
    const s = atStart(SCENARIO_1939, 1);
    const warsaw = POLAND.find((p) => CTX.map.hexes[p]!.features.includes("capital"))!;
    return withUnits({ ...s, units: {}, control: { ...s.control, [warsaw]: "germany" }, nations: { ...s.nations, ussr: { ...s.nations.ussr, status: "allied" } } }, unit("p1", "poland", east));
  };
  it("a minor's unit is supplied from its own capital", () => {
    const s = withUnits({ ...atStart(SCENARIO_1939, 1), units: {} }, unit("p1", "poland", POLAND.find((p) => CTX.map.hexes[p]!.features.includes("capital"))!));
    expect(supplyStatus(CTX, s, "allies").unsupplied).not.toContain("p1");
  });
  it("or from a Major Power's source of its side, even a Soviet one and before any Intervention", () => {
    const st = supplyStatus(CTX, base(), "allies");
    expect(st.unsupplied).not.toContain("p1");
    expect(st.supplied.find((l) => l.unitId === "p1")?.source).not.toBe(POLAND.find((p) => CTX.map.hexes[p]!.features.includes("capital")));
  });
  it("with no source reaching it, it is out of supply", () => {
    const s = base();
    const cut: GameState = { ...s, nations: { ...s.nations, ussr: { ...s.nations.ussr, status: "neutral" } } };
    expect(supplyStatus(CTX, cut, "allies").unsupplied).toContain("p1");
  });
});

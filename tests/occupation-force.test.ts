import { describe, expect, it } from "vitest";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { objectiveHexes } from "../src/engine/objectives";
import { applyShortfall, handBackCandidates, OCCUPATION_GROUND, OCCUPATION_PENALTY, OCCUPATION_TOTAL, occupationCount, occupationCountWith, occupationShortfall, V21_NAVAL_COUNTS } from "../src/engine/occupation-force";
import type { ForceOwner, GameState, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { ctxFor } from "./helpers";
import { OUT } from "./helpers-surrender";

// Spec 14 R7c (Ref 18.41, Ops 5.45h), ticket 14-17a: the Occupation Force count, shortfall, hand-back candidates and penalty. TODO(verify) V21.

const CTX = ctxFor(SCENARIO_1942);
const ground = (id: string, n: number, owner: ForceOwner = "germany", at = "A49"): Unit => counter(id, owner, "infantry", n, at, 3);
const airU = (id: string, n: number, owner: ForceOwner = "germany", at = "A50"): Unit => counter(id, owner, "air", n, at, 5);
const navy = (id: string, n: number, at = "A50"): Unit => counter(id, "germany", "fleet", n, at);
const pos = (units: Unit[], tweak: Partial<GameState> = {}): GameState => board(units, SCENARIO_1942, tweak);
const RUSSIAN_OBJECTIVES = objectiveHexes(CTX).filter((h) => CTX.map.hexes[h]!.country === "ussr");
/** Every Russian Objective Russian-held, except the given hexes, which the Axis holds (the 1942 start has the Axis on some). */
const axisHolds = (hexes: string[]): Partial<GameState> => ({ control: Object.fromEntries(RUSSIAN_OBJECTIVES.map((h) => [h, hexes.includes(h) ? "germany" : "ussr"])) });

describe("occupationCount", () => {
  it("30 ground + 15 air is 45 and met", () => {
    const c = occupationCount(CTX, pos([ground("g", 30), airU("a", 15)]));
    expect(c).toMatchObject({ ground: 30, air: 15, total: 45, groundOk: true, totalOk: true, met: true });
    expect([OCCUPATION_TOTAL, OCCUPATION_GROUND, OCCUPATION_PENALTY]).toEqual([45, 30, 15]);
  });
  it("29 ground + 16 air fails the ground test", () => {
    expect(occupationCount(CTX, pos([ground("g", 29), airU("a", 16)]))).toMatchObject({ total: 45, groundOk: false, totalOk: true, met: false });
  });
  it("44 in total fails the total test", () => {
    expect(occupationCount(CTX, pos([ground("g", 30), airU("a", 14)]))).toMatchObject({ groundOk: true, totalOk: false, met: false });
  });
  it("a unit just outside the country and an Allied unit are not counted", () => {
    const c = occupationCount(CTX, pos([ground("g", 10), ground("out", 20, "germany", OUT), ground("r", 20, "ussr"), ground("b", 20, "britain", "A50")]));
    expect(c.total).toBe(10);
  });
  it("an Italian and an active Minor-Ally unit count, an inactive one does not", () => {
    const s = pos([ground("i", 5, "italy"), ground("h", 6, "hungary", "B49"), ground("p", 7, "poland", "B50")], { minorAllies: [{ owner: "hungary", of: "germany", active: true }, { owner: "poland", of: "germany", active: false }] });
    expect(occupationCount(CTX, s).ground).toBe(11);
  });
  it("naval factors count toward the total only when the switch is on, never toward ground", () => {
    const s = pos([ground("g", 20), airU("a", 10), navy("n", 15)]);
    expect(V21_NAVAL_COUNTS).toBe(false);
    expect(occupationCount(CTX, s)).toMatchObject({ naval: 15, total: 30, met: false });
    expect(occupationCountWith(CTX, s, { navalCounts: false }).total).toBe(30);
    expect(occupationCountWith(CTX, s, { navalCounts: true })).toMatchObject({ ground: 20, total: 45, groundOk: false, met: false });
    expect(occupationCountWith(CTX, pos([ground("g", 30), navy("n", 15)]), { navalCounts: true }).met).toBe(true);
  });
});

describe("the other V21 switches", () => {
  it("air factors count only when the air switch is on", () => {
    const s = pos([ground("g", 30), airU("a", 15)]);
    expect(occupationCountWith(CTX, s, { navalCounts: false, airCounts: true })).toMatchObject({ air: 15, total: 45, met: true });
    expect(occupationCountWith(CTX, s, { navalCounts: false, airCounts: false })).toMatchObject({ air: 0, total: 30, totalOk: false, met: false });
  });
  it("airborne and replacements are ground only when the airborne switch is on", () => {
    const s = pos([ground("g", 20), counter("ab", "germany", "airborne", 6, "A50", 4), counter("rp", "germany", "replacement", 4, "B49")]);
    expect(occupationCountWith(CTX, s, { navalCounts: false, airborneIsGround: true })).toMatchObject({ ground: 30, groundOk: true });
    expect(occupationCountWith(CTX, s, { navalCounts: false, airborneIsGround: false })).toMatchObject({ ground: 20, total: 20, groundOk: false });
  });
});

describe("occupationShortfall", () => {
  it("met costs nothing", () => {
    expect(occupationShortfall(CTX, pos([ground("g", 40), airU("a", 10)]))).toEqual({ met: true, missingTotal: 0, missingGround: 0, penalty: 0, redeployOnlyToFix: false });
  });
  it("numbers for several mixes", () => {
    expect(occupationShortfall(CTX, pos([ground("g", 20), airU("a", 10)]))).toEqual({ met: false, missingTotal: 15, missingGround: 10, penalty: 15, redeployOnlyToFix: true });
    expect(occupationShortfall(CTX, pos([ground("g", 29), airU("a", 16)]))).toEqual({ met: false, missingTotal: 0, missingGround: 1, penalty: 15, redeployOnlyToFix: true });
    expect(occupationShortfall(CTX, pos([ground("g", 35)]))).toEqual({ met: false, missingTotal: 10, missingGround: 0, penalty: 15, redeployOnlyToFix: true });
    expect(occupationShortfall(CTX, pos([]))).toMatchObject({ missingTotal: 45, missingGround: 30, penalty: 15 });
  });
});

describe("handBackCandidates", () => {
  it("only Axis-held Russian Objectives, sorted, without the credited ones", () => {
    const [a, b, c] = RUSSIAN_OBJECTIVES;
    const outside = objectiveHexes(CTX).find((h) => CTX.map.hexes[h]!.country !== "ussr")!;
    const s = pos([], { control: { ...axisHolds([c!, a!]).control, [outside]: "germany" }, soviet: { citiesTaken: {}, credited: [b!] } });
    expect(handBackCandidates(CTX, s)).toEqual([a, c].sort());
    expect(handBackCandidates(CTX, { ...s, soviet: { citiesTaken: {}, credited: [a!, b!] } })).toEqual([c]);
  });
  it("a Russian-held Objective is no candidate", () => {
    const [a] = RUSSIAN_OBJECTIVES;
    expect(handBackCandidates(CTX, pos([], axisHolds([a!])))).toEqual([a]);
  });
});

describe("applyShortfall", () => {
  const [a, b] = RUSSIAN_OBJECTIVES.slice().sort();
  const base = pos([], axisHolds([a!, b!]));
  it("Germany pays 15 and the hex goes back to Russia and is credited", () => {
    const r = applyShortfall(CTX, base, b!);
    expect(r).toMatchObject({ ok: true, penalty: 15 });
    expect(r.state.nations.germany.brpTotal).toBe(base.nations.germany.brpTotal - 15);
    expect(r.state.control[b!]).toBe("ussr");
    expect(r.state.soviet?.credited).toEqual([b]);
    expect(handBackCandidates(CTX, r.state)).toEqual([a]);
  });
  it("a second hand-back adds to the credited list; BRPs may go negative", () => {
    const poor = { ...base, nations: { ...base.nations, germany: { ...base.nations.germany, brpTotal: 5 } } };
    const r2 = applyShortfall(CTX, applyShortfall(CTX, poor, b!).state, a!);
    expect(r2.state.soviet?.credited).toEqual([a, b].sort());
    expect(r2.state.nations.germany.brpTotal).toBe(-25);
  });
  it("a non-candidate or a null hex is refused and nothing changes", () => {
    expect(applyShortfall(CTX, base, "A49")).toEqual({ state: base, ok: false, penalty: 0 });
    expect(applyShortfall(CTX, base, null)).toEqual({ state: base, ok: false, penalty: 0 });
    expect(applyShortfall(CTX, { ...base, soviet: { citiesTaken: {}, credited: [a!] } }, a!).ok).toBe(false);
  });
  it("with no candidates only the penalty is paid", () => {
    const none = pos([], axisHolds([]));
    const r = applyShortfall(CTX, none, null);
    expect(r).toMatchObject({ ok: true, penalty: 15 });
    expect(r.state.nations.germany.brpTotal).toBe(none.nations.germany.brpTotal - 15);
    expect(r.state.control).toEqual(none.control);
    expect(handBackCandidates(CTX, none)).toEqual([]);
    expect(r.state.soviet).toBeUndefined();
  });
  it("does not mutate its input and is deterministic", () => {
    const frozen = JSON.stringify(base);
    const r = applyShortfall(CTX, base, a!);
    expect(JSON.stringify(base)).toBe(frozen);
    expect(JSON.stringify(applyShortfall(CTX, base, a!))).toBe(JSON.stringify(r));
    const s = pos([ground("g", 20), airU("a", 10)]);
    expect(occupationShortfall(CTX, s)).toEqual(occupationShortfall(CTX, s));
  });
});

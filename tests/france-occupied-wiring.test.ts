import { describe, expect, it } from "vitest";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { attritionParticipants } from "../src/engine/attrition";
import { capitalOf } from "../src/engine/capital";
import * as occupied from "../src/engine/france-occupied";
import { legalMoves } from "../src/engine/move-action";
import { crossable, neighborIds } from "../src/engine/attack-rules";
import { hex, hexId, neighbors } from "../src/engine/hex";
import { supplyStatus } from "../src/engine/supply";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { declarationTargets } from "../src/engine/war";
import type { ForceOwner, GameState, Unit, UnitType } from "../src/engine/types";
import { CTX, atStart } from "./helpers";

// spec 14 R5 (Ref 18.3), ticket 14-9b: the limits on France while Paris is Axis-held, read by the real rules.
const PARIS = capitalOf(CTX, "france")!;
const LONDON = capitalOf(CTX, "britain")!;
const near = neighbors(hex(PARIS)).map(hexId).filter((h) => CTX.map.hexes[h]?.land && crossable(CTX, h, PARIS));
const [N1, N2] = near as [string, string];
const unit = (id: string, owner: ForceOwner, type: UnitType, strength: number, at: string): Unit => ({ id, owner, type, strength, at, movement: 3 });
const nations = (s: GameState): GameState["nations"] => ({ ...s.nations, germany: { ...s.nations.germany, status: "axis" }, britain: { ...s.nations.britain, status: "allied" }, france: { ...s.nations.france, status: "allied" } });
const room = (units: Unit[], step: string, over: Partial<GameState> = {}, held = true): GameState => {
  const s = atStart(SCENARIO_1939, 1);
  return { ...s, nations: nations(s), wars: [["germany", "france"], ["germany", "britain"]], activeSide: "allies", position: { part: "player-turn", turn: 1, step },
    units: Object.fromEntries(units.map((u) => [u.id, u])), control: { ...s.control, ...(held ? { [PARIS]: "germany" } : {}) }, ...over };
};
const attacks = (s: GameState) => legalActions(CTX, s).filter((a): a is Extract<Action, { type: "ATTACK" }> => a.type === "ATTACK");
const german = (n: number) => unit("g1", "germany", "infantry", n, PARIS);
const FORT = { [N1]: true } as Record<string, boolean>;

describe("French attacks while Paris is Axis-held", () => {
  it("allows a supplied French attack on Paris at 1:2 or better and refuses worse odds", () => {
    const ok = room([german(1), unit("f1", "france", "infantry", 2, N1)], "7h", { fortresses: FORT });
    expect(attacks(ok).map((a) => a.target)).toContain(PARIS);
    const bad = room([german(9), unit("f1", "france", "infantry", 1, N1)], "7h", { fortresses: FORT });
    expect(attacks(bad)).toEqual([]);
    expect(applyAction(CTX, bad, { type: "ATTACK", side: "allies", units: ["f1"], target: PARIS })).toEqual({ ok: false, error: occupied.OCCUPIED_ATTACK_ODDS_TEXT });
  });

  it("refuses an unsupplied French attacker (London alone supplies France)", () => {
    const s = room([german(1), unit("f1", "france", "infantry", 6, N1)], "7h");
    expect(supplyStatus(CTX, s, "allies").unsupplied).toContain("f1");
    expect(attacks(s)).toEqual([]);
    expect(applyAction(CTX, s, { type: "ATTACK", side: "allies", units: ["f1"], target: PARIS })).toEqual({ ok: false, error: occupied.OCCUPIED_ATTACK_SUPPLY_TEXT });
  });

  it("refuses a target beyond Paris and its neighbours", () => {
    const inFrance = (h: string) => CTX.map.hexes[h]!.country === "france" && CTX.map.hexes[h]!.land;
    const ring = (h: string) => neighborIds(CTX, h).filter((x) => inFrance(x) && crossable(CTX, x, h) && !near.includes(x) && x !== PARIS);
    const far = Object.keys(CTX.map.hexes).find((h) => inFrance(h) && !near.includes(h) && h !== PARIS && ring(h).length > 0)!;
    const n = ring(far)[0]!;
    const s = room([unit("g1", "germany", "infantry", 1, far), unit("f1", "france", "infantry", 9, n)], "7h", { fortresses: { [n]: true } });
    expect(attacks(s)).toEqual([]);
    expect(applyAction(CTX, s, { type: "ATTACK", side: "allies", units: ["f1"], target: far })).toEqual({ ok: false, error: occupied.OCCUPIED_ATTACK_TARGET_TEXT });
  });

  it("leaves British attackers, and French attackers once Paris is back in Allied hands, unlimited", () => {
    const brit = room([german(9), unit("b1", "britain", "infantry", 1, N1)], "7h");
    expect(attacks(brit).map((a) => a.target)).toContain(PARIS);
    const freed = room([german(9), unit("f1", "france", "infantry", 1, N1)], "7h", {}, false);
    expect(attacks(freed).map((a) => a.target)).toContain(PARIS);
  });

  it("offers a mixed stack without its French part when the French cannot attack", () => {
    const s = room([german(2), unit("f1", "france", "infantry", 1, N1), unit("b1", "britain", "infantry", 1, N1)], "7h");
    expect(attacks(s).map((a) => a.units)).toEqual([["b1"]]);
  });

  it("has no combat work when only barred French units could attack", () => {
    const s = room([german(2), unit("f1", "france", "infantry", 1, N1)], "7h");
    expect(legalActions(CTX, s).some((a) => a.type === "ATTACK")).toBe(false);
  });
});

describe("French Options, declarations, moves and supply while Paris is Axis-held", () => {
  it("never offers France as payer of an Offensive Option off the Western Front, and never lets it pay", () => {
    const s = room([], "3");
    const selects = legalActions(CTX, s).filter((a): a is Extract<Action, { type: "SELECT_FRONT_OPTION" }> => a.type === "SELECT_FRONT_OPTION");
    expect(selects.some((a) => a.front === "western" && a.option === "offensive" && a.payer === "france")).toBe(true);
    expect(selects.some((a) => a.front !== "western" && a.option === "offensive" && a.payer === "france")).toBe(false);
    expect(selects.some((a) => a.front !== "western" && a.option === "offensive" && a.payer === "britain")).toBe(true);
    const r = applyAction(CTX, s, { type: "SELECT_FRONT_OPTION", side: "allies", front: "eastern", option: "offensive", payer: "france" });
    expect(r).toEqual({ ok: false, error: occupied.OCCUPIED_OFFENSIVE_TEXT });
    expect(legalActions(CTX, room([], "3", {}, false)).some((a) => a.type === "SELECT_FRONT_OPTION" && a.front === "eastern" && a.payer === "france")).toBe(true);
  });

  it("keeps French units out of Attrition", () => {
    const s = room([german(2), unit("f1", "france", "infantry", 1, N1), unit("b1", "britain", "infantry", 1, N2)], "7h", { frontOptions: { western: { option: "attrition" } } });
    const ids = attritionParticipants(CTX, s, "western").units.map((u) => u.id);
    expect(ids).toContain("b1");
    expect(ids).not.toContain("f1");
    const freed = room([german(2), unit("f1", "france", "infantry", 1, N1)], "7h", { frontOptions: { western: { option: "attrition" } } }, false);
    expect(attritionParticipants(CTX, freed, "western").units.map((u) => u.id)).toContain("f1");
  });

  it("stops France declaring war, and only while Paris is held", () => {
    const held = room([], "1", { activeSide: "allies" });
    expect(declarationTargets(CTX, held, "france")).toEqual([]);
    expect(applyAction(CTX, held, { type: "DECLARE_WAR", by: "france", on: "italy" })).toEqual({ ok: false, error: occupied.OCCUPIED_DECLARE_TEXT });
    expect(declarationTargets(CTX, held, "britain").length).toBeGreaterThan(0);
    expect(declarationTargets(CTX, room([], "1", {}, false), "france").length).toBeGreaterThan(0);
  });

  it("keeps French moves inside France", () => {
    const edge = Object.keys(CTX.map.hexes).find((h) => CTX.map.hexes[h]!.country === "france" && CTX.map.hexes[h]!.land && neighborIds(CTX, h).some((x) => CTX.map.hexes[x]!.country === "germany" && crossable(CTX, h, x)))!;
    const s = room([unit("f1", "france", "infantry", 2, edge), unit("b1", "britain", "infantry", 2, N1)], "6f");
    const ends = (id: string) => legalMoves(CTX, s).filter((a) => a.type === "MOVE" && a.units.join() === id).map((a) => CTX.map.hexes[(a as { path: string[] }).path.at(-1)!]!.country);
    expect(ends("f1").length).toBeGreaterThan(0);
    expect(new Set(ends("f1"))).toEqual(new Set(["france"]));
    expect(ends("b1").length).toBeGreaterThan(0);
    const freed = room([unit("f1", "france", "infantry", 2, edge)], "6f", {}, false);
    const freeEnds = legalMoves(CTX, freed).filter((a) => a.type === "MOVE" && a.units.join() === "f1").map((a) => CTX.map.hexes[(a as { path: string[] }).path.at(-1)!]!.country);
    expect(new Set(freeEnds).size).toBeGreaterThan(1);
  });

  it("supplies French units from London only", () => {
    const s = room([unit("f1", "france", "infantry", 2, LONDON), unit("f2", "france", "infantry", 2, N1), unit("b2", "britain", "infantry", 2, N1)], "6f");
    const st = supplyStatus(CTX, s, "allies");
    expect(st.supplied.find((l) => l.unitId === "f1")?.source).toBe(LONDON);
    expect(st.unsupplied).toContain("f2");
    const freed = supplyStatus(CTX, room([unit("f2", "france", "infantry", 2, N1)], "6f", {}, false), "allies");
    expect(freed.supplied.some((l) => l.unitId === "f2")).toBe(true);
  });
});

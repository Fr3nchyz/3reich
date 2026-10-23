import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "../src/engine/actions";
import { ANGLO_FRENCH_STOP_BAN_UNTIL, ANGLO_FRENCH_STOP_HEXES, angloFrenchStopBanHolds, angloFrenchStopProblem } from "../src/engine/anglo-french";
import { combatOf } from "../src/engine/combat-record";
import type { Conquest } from "../src/engine/conquest-record";
import { buildPlaces } from "../src/engine/construction";
import { reachableHexes } from "../src/engine/movement";
import type { ForceOwner, GameState } from "../src/engine/types";
import { canCross } from "../src/engine/zoc";
import { board, counter } from "./board";
import { CTX } from "./helpers";
import { at6f, errorOf, inf, move, movesIn, okOf } from "./helpers-move";

// Ref 26.0, 4.8; spec 16 R32, AER40/AER42. All positions use the real map.
const places = ["P24", "P25", "Q24", "O22", "V19", "R20"];
const neighbor: Record<string, string> = { P24: "P23", P25: "P24", Q24: "Q23", O22: "N22", V19: "U19", R20: "Q20" };
const fall: Conquest = { country: "france", by: "germany", side: "allies", how: "capital", at: { year: 1940, season: "spring" } };
const problem = (s: GameState, hex = "O22", owner: ForceOwner = "britain") => angloFrenchStopProblem(CTX, s, owner, hex);

/** Survivors of a battle standing next to the emptied target, waiting to choose an advance. */
function afterBattle(to = "O22", owners: ForceOwner[] = ["britain"], tweak: Partial<GameState> = {}): GameState {
  const units = owners.map((owner, i) => counter(`u${i + 1}`, owner, "infantry", 3, neighbor[to]!, 3));
  const s = board(units, undefined, { activeSide: "allies", position: { part: "player-turn", turn: 1, step: "7h" }, ...tweak });
  return { ...s, combat: { ...combatOf(s), attacked: units.map((u) => u.id), targets: [to], advances: [{ to, units: units.map((u) => u.id) }] } };
}

describe("British stopping places (Ref 26.0, 4.8; spec 16 R32)", () => {
  it("names exactly the three Maginot hexes, Paris, Marseilles and Vichy, with a 1942 cutoff (AER42)", () => {
    expect(ANGLO_FRENCH_STOP_HEXES).toEqual(places);
    expect(ANGLO_FRENCH_STOP_BAN_UNTIL).toBe(1942);
    for (const hex of places) expect(CTX.map.hexes[hex]?.country).toBe("france");
  });

  it.each(places)("refuses ending a British move in %s and omits it from legalActions", (to) => {
    const s = at6f([inf("u1", "britain", neighbor[to]!)], "allies");
    expect(canCross(CTX, neighbor[to]!, to)).toBe(true);
    expect(errorOf(move(s, ["u1"], [to]))).toMatch(/British units may not stop/);
    expect(movesIn(legalActions(CTX, s)).some((a) => a.path.at(-1) === to)).toBe(false);
  });

  it("returns a readable reason naming Paris and both ways the ban ends", () => {
    expect(problem(board([]))).toBe("British units may not stop in Paris until the Allied Player Turn after France falls or 1942.");
    expect(problem(board([]), "P25")).toContain("P25");
  });

  it("allows passing through Paris, including the listed shortest path to the far side", () => {
    const s = at6f([inf("u1", "britain", "N22", 3, 2)], "allies");
    const path = ["O22", "P22"];
    expect(reachableHexes(CTX, s, [s.units.u1!]).get("P22")).toEqual(path);
    expect(movesIn(legalActions(CTX, s))).toContainEqual({ type: "MOVE", side: "allies", units: ["u1"], path });
    expect(okOf(move(s, ["u1"], path)).state.units.u1!.at).toBe("P22");
  });

  it("allows passing through Metz to an ordinary French hex", () => {
    const s = at6f([inf("u1", "britain", "P23", 3, 2)], "allies");
    expect(okOf(move(s, ["u1"], ["P24", "O24"])).state.units.u1!.at).toBe("O24");
  });

  it.each(["france", "free-france", "usa"] as const)("does not apply to owner %s", (owner) => {
    for (const hex of places) expect(problem(board([]), hex, owner)).toBeNull();
  });

  it("allows a French move into Paris", () => {
    const s = at6f([inf("u1", "france", "N22")], "allies");
    expect(okOf(move(s, ["u1"], ["O22"])).state.units.u1!.at).toBe("O22");
  });

  it("keeps the separate British/French sharing ban in an ordinary hex", () => {
    const s = at6f([inf("u1", "britain", "N22"), inf("u2", "france", "O21")], "allies");
    expect(errorOf(move(s, ["u1"], ["O21"]))).toMatch(/may not stack together before 1942/);
  });

  it("does not need a placement change: British builds stay on home territory", () => {
    for (const type of ["infantry", "armor", "airborne", "replacement", "air", "fleet"] as const) {
      const built = buildPlaces(CTX, board([]), "britain", { type, strength: 1 });
      for (const hex of places) expect(built, type).not.toContain(hex);
    }
  });
});

describe("when the stop ban ends (spec 16 R32; TODO(verify) AER42)", () => {
  it.each([1939, 1940, 1941])("still holds in %i while France stands", (year) => {
    expect(angloFrenchStopBanHolds(board([], undefined, { year }))).toBe(true);
  });

  it("ends at the start of 1942 even while France stands and before the Allied turn", () => {
    const s = at6f([inf("u1", "britain", "N22")], "allies", undefined, { year: 1942, season: "spring" });
    expect(problem({ ...s, activeSide: "axis" })).toBeNull();
    expect(okOf(move(s, ["u1"], ["O22"])).state.units.u1!.at).toBe("O22");
  });

  it("waits through the fall's Allied turn and the next Axis turn, then stays lifted", () => {
    const s = board([], undefined, { year: 1940, season: "spring", activeSide: "allies", conquests: [fall] });
    expect(problem(s)).not.toBeNull();
    expect(problem({ ...s, season: "summer", activeSide: "axis" })).not.toBeNull();
    expect(problem({ ...s, season: "summer", activeSide: "allies" })).toBeNull();
    expect(problem({ ...s, season: "fall", activeSide: "axis" })).toBeNull();
    const moving = at6f([inf("u1", "britain", "N22")], "allies", undefined, { year: 1940, season: "summer", conquests: [fall] });
    expect(okOf(move(moving, ["u1"], ["O22"])).state.units.u1!.at).toBe("O22");
  });

  it("handles a winter fall across the year boundary before 1942", () => {
    const conquests: Conquest[] = [{ ...fall, at: { year: 1940, season: "winter" } }];
    const s = board([], undefined, { year: 1941, season: "spring", activeSide: "axis", conquests });
    expect(problem(s)).not.toBeNull();
    expect(problem({ ...s, activeSide: "allies" })).toBeNull();
  });

  it("does not treat another country's conquest as France falling", () => {
    const s = board([], undefined, { year: 1941, conquests: [{ ...fall, country: "poland" }] });
    expect(problem(s)).not.toBeNull();
  });
});

describe("Axis-held Maginot exception (Ref 4.8; spec 16 R32; TODO(verify) AER40)", () => {
  it.each(["P24", "P25", "Q24"])("allows a British stop in Axis-held %s", (to) => {
    const s = at6f([inf("u1", "britain", neighbor[to]!)], "allies", undefined, { control: { [to]: "germany" } });
    expect(problem(s, to)).toBeNull();
    expect(okOf(move(s, ["u1"], [to])).state.units.u1!.at).toBe(to);
  });

  it("does not extend the exception to Paris or to an unoccupied Maginot hex", () => {
    const s = board([], undefined, { control: { O22: "germany", P24: "britain", P25: null } });
    expect(problem(s)).not.toBeNull();
    expect(problem(s, "P24")).not.toBeNull();
    expect(problem(s, "P25")).not.toBeNull();
  });
});

describe("advance after combat (Ref 26.0; spec 16 R32)", () => {
  it.each(places)("neither offers nor accepts a British advance into banned %s", (to) => {
    const s = afterBattle(to);
    expect(legalActions(CTX, s).some((a) => a.type === "ADVANCE")).toBe(false);
    expect(applyAction(CTX, s, { type: "ADVANCE", side: "allies", units: ["u1"], to })).toMatchObject({ ok: false, error: expect.stringMatching(/British units may not stop/) });
  });

  it("still offers the non-British survivor's subset, but never one containing the British unit", () => {
    const s = afterBattle("O22", ["britain", "free-france"]);
    const advances = legalActions(CTX, s).filter((a) => a.type === "ADVANCE");
    expect(advances).toEqual([{ type: "ADVANCE", side: "allies", units: ["u2"], to: "O22" }]);
    expect(okOf(applyAction(CTX, s, advances[0]!)).state.units.u2!.at).toBe("O22");
  });

  it("allows a French advance into Paris", () => {
    const s = afterBattle("O22", ["france"]);
    const action = { type: "ADVANCE", side: "allies", units: ["u1"], to: "O22" } as const;
    expect(legalActions(CTX, s)).toContainEqual(action);
    expect(okOf(applyAction(CTX, s, { ...action, units: [...action.units] })).state.units.u1!.at).toBe("O22");
  });

  it("allows British advances after the date cutoff, the conquest cutoff, or into Axis-held Metz", () => {
    for (const s of [
      afterBattle("O22", undefined, { year: 1942 }),
      afterBattle("O22", undefined, { year: 1940, season: "summer", conquests: [fall] }),
      afterBattle("P24", undefined, { control: { P24: "germany" } }),
    ]) {
      const to = s.combat!.advances[0]!.to;
      const action = { type: "ADVANCE", side: "allies", units: ["u1"], to } as const;
      expect(legalActions(CTX, s)).toContainEqual(action);
      expect(okOf(applyAction(CTX, s, { ...action, units: [...action.units] })).state.units.u1!.at).toBe(to);
    }
  });
});

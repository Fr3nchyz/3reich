import { describe, expect, it } from "vitest";
import { capitalOf } from "../src/engine/capital";
import * as occupied from "../src/engine/france-occupied";
import { hex, hexId, neighbors } from "../src/engine/hex";
import type { ForceOwner } from "../src/engine/types";
import { board } from "./board";
import { CTX } from "./helpers";

// spec 14 R5 (Ref 18.3), ticket 14-9a: pure queries, deliberately unwired.
const PARIS = capitalOf(CTX, "france")!;
const LONDON = capitalOf(CTX, "britain")!;
const start = board([]);
const held = board([], undefined, { control: { [PARIS]: "germany" } });
const conquered = { ...held, conquests: [{ country: "france", by: "germany", side: "allies", how: "capital", at: { year: 1940, season: "spring" } }] } as const;
const fallen = { ...held, conquests: [...conquered.conquests] };
const attack = (target = PARIS, attack = 1, defense = 2, supplied = true, owner: ForceOwner = "france", state = held) =>
  occupied.occupiedAttackProblem(CTX, state, owner, target, { attack, defense }, supplied);
const countryHex = (country: string) => Object.values(CTX.map.hexes).find((h) => h.land && h.country === country)!.id;

describe("France while Paris is Axis-held (spec 14 R5, Ref 18.3)", () => {
  it("ends the occupied interval on conquest or Allied control", () => {
    expect(occupied.franceOccupied(CTX, start)).toBe(false);
    expect(occupied.franceOccupied(CTX, held)).toBe(true);
    expect(occupied.franceOccupied(CTX, fallen)).toBe(false);
    for (const owner of ["france", "britain", "germany"] as const) {
      expect(occupied.franceOccupied(CTX, { ...held, control: { [PARIS]: owner } })).toBe(owner === "germany");
    }
  });

  it("allows Paris and all six neighbours at 1:2 or better", () => {
    const targets = [PARIS, ...neighbors(hex(PARIS)).map(hexId)];
    expect(targets).toHaveLength(7);
    for (const target of targets) {
      expect(attack(target)).toBeNull();
      expect(attack(target, 2, 3)).toBeNull();
      expect(attack(target, 1, 3)).toBe(occupied.OCCUPIED_ATTACK_ODDS_TEXT);
      expect(attack(target, 1, 2, false)).toBe(occupied.OCCUPIED_ATTACK_SUPPLY_TEXT);
    }
  });

  it("refuses distant and two-away targets, including sea", () => {
    for (const target of [LONDON, "O24", Object.values(CTX.map.hexes).find((h) => !h.land)!.id]) {
      expect(attack(target)).toBe(occupied.OCCUPIED_ATTACK_TARGET_TEXT);
    }
  });

  it("limits only French attackers and only during occupation (V63)", () => {
    for (const owner of ["britain", "free-france", "vichy-france", "germany"] as const) expect(attack(LONDON, 1, 3, false, owner)).toBeNull();
    for (const state of [start, fallen]) expect(attack(LONDON, 1, 3, false, "france", state)).toBeNull();
  });

  it("bans Attrition everywhere and Offensive outside the Western Front", () => {
    for (const front of ["western", "eastern", "mediterranean"] as const) {
      for (const option of ["attrition", "offensive", "defensive"] as const) {
        const expected = option === "attrition" ? occupied.OCCUPIED_ATTRITION_TEXT : option === "offensive" && front !== "western" ? occupied.OCCUPIED_OFFENSIVE_TEXT : null;
        expect(occupied.occupiedOptionProblem(held, "france", front, option, CTX)).toBe(expected);
        expect(occupied.occupiedOptionProblem(held, "britain", front, option, CTX)).toBeNull();
        for (const state of [start, fallen]) expect(occupied.occupiedOptionProblem(state, "france", front, option, CTX)).toBeNull();
      }
    }
  });

  it("bans French declarations only during occupation", () => {
    expect(occupied.occupiedDeclareProblem(CTX, held, "france")).toBe(occupied.OCCUPIED_DECLARE_TEXT);
    expect(occupied.occupiedDeclareProblem(CTX, held, "britain")).toBeNull();
    for (const state of [start, fallen]) expect(occupied.occupiedDeclareProblem(CTX, state, "france")).toBeNull();
  });

  it("keeps French moves inside map France, excluding colonies (V63)", () => {
    expect(occupied.occupiedMoveOutProblem(CTX, held, "france", PARIS)).toBeNull();
    for (const target of [countryHex("belgium"), countryHex("algeria")]) {
      expect(occupied.occupiedMoveOutProblem(CTX, held, "france", target)).toBe(occupied.OCCUPIED_MOVE_OUT_TEXT);
      for (const owner of ["britain", "free-france", "vichy-france"] as const) expect(occupied.occupiedMoveOutProblem(CTX, held, owner, target)).toBeNull();
      for (const state of [start, fallen]) expect(occupied.occupiedMoveOutProblem(CTX, state, "france", target)).toBeNull();
    }
  });

  it("restricts supply to exactly London, returning independent arrays", () => {
    expect(occupied.occupiedSupplySources(CTX, held)).toEqual([LONDON]);
    occupied.occupiedSupplySources(CTX, held)!.push(PARIS);
    expect(occupied.occupiedSupplySources(CTX, held)).toEqual([LONDON]);
    for (const state of [start, fallen]) expect(occupied.occupiedSupplySources(CTX, state)).toBeNull();
  });

  it("is deterministic and leaves context, state and factor totals untouched", () => {
    const odds = { attack: 1, defense: 2 };
    const before = JSON.stringify({ ctx: CTX, state: held, odds });
    const query = () => [occupied.franceOccupied(CTX, held), occupied.occupiedAttackProblem(CTX, held, "france", PARIS, odds, true), occupied.occupiedOptionProblem(held, "france", "eastern", "offensive", CTX), occupied.occupiedDeclareProblem(CTX, held, "france"), occupied.occupiedMoveOutProblem(CTX, held, "france", LONDON), occupied.occupiedSupplySources(CTX, held)];
    expect(query()).toEqual(query());
    expect(JSON.stringify({ ctx: CTX, state: held, odds })).toBe(before);
  });
});

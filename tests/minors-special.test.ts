import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { openPersia, MC14_PERSIA_CONTROLLER, PERSIAN_HEXES } from "../src/engine/minors-special";
import { neutralLandProblem, entryProblem } from "../src/engine/movement";
import { applyDeclaration, declarationTargets, legalDeclarations } from "../src/engine/war";
import { CTX } from "./helpers";
import { at6f, inf, move, okOf } from "./helpers-move";

const persianHexes = Object.values(MAP.hexes).filter((h) => h.country === "persia");

describe("spec 15 R11: opening Persia", () => {
  it("R11 / MC14: all Persian hexes pass to the payer without mutating the input or charging BRPs", () => {
    const state = at6f([], "axis", undefined, { control: { L32: "germany" }, countries: { ireland: { status: "neutral" } } });
    const before = structuredClone(state);
    expect([...PERSIAN_HEXES].sort()).toEqual(persianHexes.map((h) => h.id).sort());
    for (const by of ["britain", "france", "usa"] as const) {
      const next = openPersia(state, by);
      expect(MC14_PERSIA_CONTROLLER(by)).toBe(by);
      expect(next).not.toBe(state);
      expect(next.countries?.persia).toEqual({ status: "neutral", opened: true });
      for (const hex of persianHexes) expect(next.control[hex.id]).toBe(by);
      expect(next).toEqual({ ...state, control: { ...state.control, ...Object.fromEntries(persianHexes.map((h) => [h.id, by])) }, countries: { ...state.countries, persia: { status: "neutral", opened: true } } });
    }
    expect(state).toEqual(before);
  });

  it("R11: supports old saves without countries and preserves existing minor records", () => {
    const state = at6f([]);
    delete state.countries;
    expect(openPersia(state, "britain").countries?.persia?.opened).toBe(true);
    const recorded = { ...state, countries: { persia: { status: "attacked" as const, attacker: "germany" as const } } };
    expect(openPersia(recorded, "britain").countries?.persia).toEqual({ ...recorded.countries.persia, opened: true });
  });

  it("R11: a second opening returns the identical state even with another payer or changed control", () => {
    const opened = openPersia(at6f([]), "britain");
    const changed = { ...opened, control: { ...opened.control, [persianHexes[0]!.id]: "germany" as const } };
    expect(openPersia(opened, "france")).toBe(opened);
    expect(openPersia(changed, "britain")).toBe(changed);
  });

  it("R11 / MC14: before opening either side declares for 10 BRPs with no defending army", () => {
    for (const [side, by] of [["axis", "germany"], ["allies", "britain"]] as const) {
      const state = at6f([], side);
      expect(declarationTargets(CTX, state, by)).toContain("persia");
      const result = okOf(applyDeclaration(CTX, state, { type: "DECLARE_WAR", by, on: "persia" }));
      expect(result.state.nations[by].brpTotal).toBe(state.nations[by].brpTotal - 10);
      expect(result.state.countries?.persia?.toPlace).toBeUndefined();
      expect(result.state.units).toEqual(state.units);
    }
  });

  it("R11: opening removes Persia from every power's declaration list and rejects a direct declaration", () => {
    for (const side of ["axis", "allies"] as const) {
      const opened = openPersia(at6f([], side), "britain");
      for (const by of Object.keys(opened.nations) as (keyof typeof opened.nations)[]) {
        expect(declarationTargets(CTX, opened, by)).not.toContain("persia");
        expect(applyDeclaration(CTX, opened, { type: "DECLARE_WAR", by, on: "persia" }).ok).toBe(false);
      }
      expect(legalDeclarations(CTX, opened).some((a) => a.type === "DECLARE_WAR" && a.on === "persia")).toBe(false);
    }
  });

  it("R11: opened Persia is exempt from closed land even when its controller is neutral", () => {
    const state = at6f([]);
    const opened = openPersia(state, "usa");
    for (const hex of persianHexes) {
      expect(neutralLandProblem(CTX, state, ["germany"], hex.id)).toMatch(/neutral land/);
      expect(neutralLandProblem(CTX, opened, ["germany", "italy", "britain"], hex.id)).toBeNull();
    }
    expect(neutralLandProblem(CTX, opened, ["germany"], "M26")).toMatch(/neutral land/);
  });

  it("R11: Axis entry after opening needs no war and costs no BRPs; enemy occupants still block entry", () => {
    const target = persianHexes.find((h) => h.land)!;
    const state = at6f([inf("u1", "germany", target.id)]);
    // R11: use a Persian land neighbour so a real MOVE exercises the entry rule.
    const neighbour = persianHexes.find((h) => h.land && h.id !== target.id && move(state, ["u1"], [h.id]).ok);
    // R11: unopened neutral land is closed; find a legal neighbour after opening instead.
    expect(neighbour).toBeUndefined();
    const opened = openPersia(state, "britain");
    const destination = persianHexes.find((h) => h.land && h.id !== target.id && move(opened, ["u1"], [h.id]).ok)!;
    expect(destination).toBeDefined();
    const moved = okOf(move(opened, ["u1"], [destination.id])).state;
    expect(moved.nations).toEqual(state.nations);
    expect(moved.wars).toEqual(state.wars);
    const occupied = { ...opened, units: { ...opened.units, enemy: inf("enemy", "britain", destination.id) } };
    expect(entryProblem(CTX, occupied, ["germany"], destination.id)).toMatch(/holds enemy/);
  });
});

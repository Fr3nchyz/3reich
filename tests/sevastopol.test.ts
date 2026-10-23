import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { refreshFortresses } from "../src/engine/fortress";
import { sevastopolConditions } from "../src/engine/fortress-rules";
import type { ForceOwner, GameState } from "../src/engine/types";
import { board } from "./board";
import { CTX, ctxFor } from "./helpers";

const ctx = ctxFor(SCENARIO_1942);
// Real land corridors; the second crosses the Crimea-Kerch Strait U40-U41 (Ref 19.2).
const odessa = ["T37", "S38", "R39", "Q40", "P41", "O42", "N43", "M44", "L45", "K46", "J47", "I48", "H48", "H47"];
const edge = ["V38", "U39", "U40", "U41", "U42", "U43", "U44", "U45", "U46", "T47", "S48", "R49", "R50", "Q51", "Q52", "P53", "P54", "P55", "Q55", "R55", "S55", "T55", "U55", "V55", "W55", "X54", "Y54", "Z53"];
function position(owned: string[], tweak: Partial<GameState> = {}): GameState {
  const control: Record<string, ForceOwner> = Object.fromEntries(Object.keys(MAP.hexes).map((h) => [h, "germany"]));
  for (const h of ["V38", ...owned]) control[h] = "ussr";
  return board([], SCENARIO_1942, { activeSide: "allies", control, ...tweak });
}
const status = (s: GameState) => refreshFortresses(ctx, s).fortresses.V38 === true;

describe("Sevastopol's supply conditions (Ref 4.8, 19.2; spec 16 R28; AER37)", () => {
  it("reports the supplied Soviet port independently of the east-edge line", () => {
    const s = position(odessa);
    expect(sevastopolConditions(ctx, s)).toEqual({ port: "T37", supplyLine: false });
    expect(status(s)).toBe(true);
  });

  it("does not count a held port cut off from Soviet sources", () => {
    const s = position(odessa.filter((h) => h !== "S38"));
    expect(sevastopolConditions(ctx, s)).toEqual({ port: null, supplyLine: false });
    expect(status(s)).toBe(false);
  });

  it("does not count an enemy-held port even when its land connects to Soviet sources", () => {
    const s = position(odessa);
    expect(sevastopolConditions(ctx, { ...s, control: { ...s.control, T37: "britain" } }).port).toBeNull();
  });

  it("cannot supply a Soviet port from Western Allied sources", () => {
    const s = position(odessa);
    expect(sevastopolConditions(ctx, { ...s, control: { ...s.control, H47: "britain" } }).port).toBeNull();
  });

  it("reports a Soviet east-edge line even with all five other ports lost", () => {
    const s = position(edge);
    expect(sevastopolConditions(ctx, s)).toEqual({ port: null, supplyLine: true });
    expect(status(s)).toBe(true);
  });

  it("uses the Crimea-Kerch crossing arrow in the existing supply search", () => {
    expect(MAP.hexsides["U40-U41"]?.crossingArrow).toBe(true);
    const s = position(edge);
    expect(sevastopolConditions(ctx, s).supplyLine).toBe(true);
    expect(sevastopolConditions(ctx, { ...s, control: { ...s.control, U41: "germany" } }).supplyLine).toBe(false);
  });

  it("reports both conditions and is independent of the previous fortress status", () => {
    const s = position([...odessa, ...edge]);
    expect(sevastopolConditions(ctx, { ...s, fortresses: { V38: false } })).toEqual({ port: "T37", supplyLine: true });
    expect(sevastopolConditions(ctx, { ...s, fortresses: { V38: true } })).toEqual({ port: "T37", supplyLine: true });
  });
});

describe("when Sevastopol loses and regains fortress status (spec 16 R28; AER35/AER36)", () => {
  it("keeps its last Allied result through Axis turns, then loses on the next Allied turn", () => {
    const supplied = refreshFortresses(ctx, position(odessa));
    const cut = position([], { activeSide: "axis", fortresses: supplied.fortresses });
    expect(status(cut)).toBe(true);
    const lost = refreshFortresses(ctx, { ...cut, activeSide: "allies" });
    expect(lost.fortresses.V38).not.toBe(true);
    expect(status({ ...lost, activeSide: "axis" })).toBe(false);
  });

  it("does not regain during an Axis turn, but regains when the next Allied turn begins", () => {
    const lost = refreshFortresses(ctx, position([]));
    const restored = position(odessa, { activeSide: "axis", fortresses: lost.fortresses });
    expect(status(restored)).toBe(false);
    expect(status({ ...restored, activeSide: "allies" })).toBe(true);
  });

  it.each(["axis", "allies"] as const)("loses immediately when the Axis controls V38 on an %s turn", (activeSide) => {
    const s = position(odessa, { activeSide, fortresses: { V38: true } });
    const taken = { ...s, control: { ...s.control, V38: "germany" as const } };
    expect(status(taken)).toBe(false);
  });

  it("uses only Soviet ownership before the Soviet war, even when all supply routes are cut", () => {
    const s = board([], undefined, { control: position([]).control, activeSide: "allies" });
    expect(refreshFortresses(CTX, s).fortresses.V38).toBe(true);
    expect(refreshFortresses(CTX, { ...s, control: { ...s.control, V38: "germany" } }).fortresses.V38).not.toBe(true);
  });

  it("initializes the first Axis turn from ownership, before an Allied result exists", () => {
    expect(status(position([], { activeSide: "axis" }))).toBe(true);
  });

  it("returns the same state when the recorded result is unchanged", () => {
    const once = refreshFortresses(ctx, position(odessa));
    expect(refreshFortresses(ctx, once)).toBe(once);
  });
});

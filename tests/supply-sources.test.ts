import { describe, expect, it } from "vitest";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { refreshFortresses } from "../src/engine/fortress";
import { isUnitSupplied } from "../src/engine/supply";
import { specialNets } from "../src/engine/supply-sources";
import type { GameState, Unit } from "../src/engine/types";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

// The supply sources of Ref 19.2 beyond the capitals (supply-sources.ts). Named hexes: GG19 Malta, AA7 Gibraltar, LL29 Alexandria, MM30 Suez, II17 Tripoli,
// KK24 Tobruk, DD17 Tunis, HH35 Beirut, J36 Konigsberg, AA26 Durazzo, V38 Sevastopol.
const inf = (id: string, owner: Unit["owner"], at: string): Unit => counter(id, owner, "infantry", 2, at, 3);
const supplied = (s: GameState, id: string, ctx = CTX): boolean => isUnitSupplied(ctx, refreshFortresses(ctx, s), id);
const withItaly = (units: Unit[], extra: Partial<GameState> = {}): GameState => {
  const s = board([]);
  return board(units, undefined, { nations: { ...s.nations, italy: { ...s.nations.italy, status: "axis" } }, ...extra });
};

describe("a Fortress supplies the units inside it, and only them (Ref 19.2, 4.8)", () => {
  it("Gibraltar and Malta: British infantry inside is supplied; Malta needs Gibraltar, Alexandria and Suez", () => {
    const s = board([inf("b1", "britain", "AA7"), inf("b2", "britain", "GG19")]);
    expect(supplied(s, "b1")).toBe(true);
    expect(supplied(s, "b2")).toBe(true);
    for (const taken of ["AA7", "LL29", "MM30"]) {
      const cut = board([inf("b2", "britain", "GG19")], undefined, { control: { [taken]: "germany" } });
      expect(supplied(cut, "b2"), `without ${taken}`).toBe(false);
    }
  });

  it("a unit next to a Fortress cannot trace supply into it", () => {
    const s = board([inf("b1", "britain", "AA6")]);
    expect(supplied(s, "b1")).toBe(false);
  });

  it("a Fortress that has lost its status supplies nobody", () => {
    const s = refreshFortresses(CTX, board([inf("f1", "france", "P24")]));
    expect(isUnitSupplied(CTX, s, "f1")).toBe(true); // Metz is still a Fortress (and France's land is joined to Paris anyway)
    const lost = { ...s, fortresses: { ...s.fortresses, P24: false }, control: { ...s.control, N24: "germany" as const, O24: "germany" as const, O23: "germany" as const, P23: "germany" as const, Q23: "germany" as const, Q24: "germany" as const, P25: "germany" as const, O25: "germany" as const } };
    expect(isUnitSupplied(CTX, lost, "f1")).toBe(false);
  });
});

describe("Libyan and Egyptian ports (Ref 19.2)", () => {
  it("Axis units at Tripoli and Tobruk are supplied; the Allies hold Egyptian ports", () => {
    const s = withItaly([inf("i1", "italy", "II17"), inf("i2", "italy", "KK24"), inf("b1", "britain", "LL29"), inf("b2", "britain", "MM30")]);
    for (const id of ["i1", "i2", "b1", "b2"]) expect(supplied(s, id), id).toBe(true);
  });

  it("a Libyan port serves the Axis only and an Egyptian port the Allies only, whoever holds it", () => {
    const s = withItaly([inf("b1", "britain", "II17"), inf("i1", "italy", "LL29")], { control: { II17: "britain", LL29: "italy" } });
    expect(supplied(s, "b1")).toBe(false);
    expect(supplied(s, "i1")).toBe(false);
  });

  it("the Soviets do not draw on Egyptian ports", () => {
    const ctx = ctxFor(SCENARIO_1942);
    const s = board([inf("r1", "ussr", "LL29")], SCENARIO_1942);
    expect(specialNets(ctx, s, "allies").find((n) => n.id === "egypt")!.serves({ owner: "ussr" })).toBe(false);
    expect(specialNets(ctx, s, "allies").find((n) => n.id === "egypt")!.serves({ owner: "britain" })).toBe(true);
  });
});

describe("Tunis and Beirut supply the French who hold them, and nobody else (Ref 19.2)", () => {
  it("French units are supplied there; others are not; a port held by Free France serves Free French units only", () => {
    const s = board([inf("f1", "france", "DD17"), inf("f2", "france", "HH35"), inf("b1", "britain", "DD17")]);
    expect(supplied(s, "f1")).toBe(true);
    expect(supplied(s, "f2")).toBe(true);
    expect(supplied(s, "b1")).toBe(false);
    const free = board([inf("f1", "france", "DD17"), inf("ff", "free-france", "HH35")], undefined, { control: { HH35: "free-france" } });
    expect(supplied(free, "ff")).toBe(true);
    expect(specialNets(CTX, free, "allies").find((n) => n.id === "beirut")!.serves({ owner: "france" })).toBe(false);
  });
});

describe("the east edge of the map supplies Soviet units (Ref 19.2)", () => {
  it("a Soviet unit on the last hex of a row north of Z is supplied; a British one is not; none south of Z53", () => {
    const ctx = ctxFor(SCENARIO_1942);
    const s = board([inf("r1", "ussr", "Z53"), inf("r2", "ussr", "A66"), inf("b1", "britain", "Z53")], SCENARIO_1942);
    expect(isUnitSupplied(ctx, s, "r1")).toBe(true);
    expect(isUnitSupplied(ctx, s, "r2")).toBe(true);
    expect(specialNets(ctx, s, "allies").find((n) => n.id === "soviet-edge")!.sources).toContain("Z53");
    const edge = specialNets(ctx, s, "allies").find((n) => n.id === "soviet-edge")!.sources;
    expect(edge).toHaveLength(26); // one hex for each of the rows A to Z, from A66 to Z53
    expect(edge).toContain("A66");
    expect(edge).not.toContain("R22"); // France: a gap in a row must not make an inland hex an edge hex
    expect(edge).not.toContain("S21");
    expect(edge.every((h) => /^[A-Z]\d+$/.test(h) && Number(h.slice(1)) >= 52)).toBe(true);
  });
});

describe("Konigsberg and Durazzo at the start of the 1939 and Campaign scenarios (Ref 19.2)", () => {
  it("a German unit in Konigsberg and an Italian one in Durazzo are supplied though the Polish Corridor lies between", () => {
    const s = withItaly([inf("g1", "germany", "J36"), inf("i1", "italy", "AA26")]);
    expect(supplied(s, "g1")).toBe(true);
    expect(supplied(s, "i1")).toBe(true);
  });

  it("not once an enemy holds the hex, and not in the later scenarios", () => {
    const lost = withItaly([inf("g1", "germany", "J36")], { control: { J36: "britain" } });
    expect(specialNets(CTX, lost, "axis").some((n) => n.id === "konigsberg")).toBe(false);
    const ctx = ctxFor(SCENARIO_1942);
    expect(specialNets(ctx, board([], SCENARIO_1942), "axis").some((n) => n.id === "konigsberg")).toBe(false);
  });
});

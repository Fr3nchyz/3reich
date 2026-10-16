import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { adjacentHexes, armorZocCrosses, canCross, enemyZocFor, exertsZoc, inEnemyZoc, ZOC_EXIT_COST, zocExitCost, zocHexes, zocOfUnit, zocSources, type ZocPolicy } from "../src/engine/zoc";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

const german = (id: string, at: string, type: "infantry" | "armor" = "armor") => counter(id, "germany", type, 3, at, 4);
const panzer = german;
const foot = (id: string, at: string) => german(id, at, "infantry");
const french = (id: string, at: string) => counter(id, "france", "armor", 2, at, 3);
const sorted = (xs: Iterable<string>) => [...xs].sort();
const EMPTY = board([]);

// Ref 7.0 (Zones of Control, PC Reference Manual), 4.3 and 4.6 (hexsides ground units cross), 4.51 (Qattara), 4.8 (Fortress). Spec 13.
describe("which hexes a ground unit exerts a ZOC into", () => {
  it("all six neighbours on open ground", () => {
    expect(sorted(zocOfUnit(CTX, EMPTY, german("u1", "M33")))).toEqual(["L33", "L34", "M32", "M34", "N32", "N33"]);
  });

  it("across a river (Ref 4.51: a river changes defence, not who can cross)", () => {
    expect(MAP.hexsides["B42-C42"]!.river).toBe(true);
    expect(zocOfUnit(CTX, EMPTY, german("u1", "B42"))).toContain("C42");
    expect(zocOfUnit(CTX, EMPTY, german("u1", "C42"))).toContain("B42");
  });

  it("never into or out of the Qattara Depression (Ref 4.51)", () => {
    expect(MAP.hexsides["MM26-NN26"]!.qattara).toBe(true);
    for (const from of ["MM26", "MM27", "NN25", "NN27"]) expect(zocOfUnit(CTX, EMPTY, german("u1", from)), from).not.toContain("NN26");
    expect(zocOfUnit(CTX, EMPTY, german("u1", "NN26"))).toEqual([]);
    expect(zocOfUnit(CTX, EMPTY, german("u1", "MM26"))).toContain("MM27"); // the rest of Egypt is open
  });

  it("the Qattara flag alone forbids it, whatever the hexside's land flag says", () => {
    const hexsides = { ...MAP.hexsides, "MM26-NN26": { ...MAP.hexsides["MM26-NN26"]!, land: true } };
    const odd = { ...CTX, map: { ...MAP, hexsides } };
    expect(canCross(odd, "MM26", "NN26")).toBe(false);
    expect(canCross(odd, "NN26", "MM26")).toBe(false);
  });

  it("not across open water: the Channel stops it (Harwich to Calais)", () => {
    expect(adjacentHexes(CTX, "K24")).toContain("L24");
    expect(canCross(CTX, "K24", "L24")).toBe(false);
    expect(zocOfUnit(CTX, EMPTY, german("u1", "K24"))).not.toContain("L24");
    expect(zocOfUnit(CTX, EMPTY, german("u1", "L24"))).not.toContain("K24");
  });

  it("Sicily: the island's armor ZOC stays inside; the Messina arrow carries none to the mainland", () => {
    expect(sorted(zocOfUnit(CTX, EMPTY, german("u1", "DD21")))).toEqual(["DD20", "EE20", "EE21"]);
    const inland = zocOfUnit(CTX, EMPTY, german("u1", "DD20"));
    expect(sorted(inland)).toEqual(["DD19", "DD21", "EE19", "EE20"]);
    expect(inland).not.toContain("DD22");
  });

  it("only into land: a coastal unit's ZOC stops at the water", () => {
    for (const id of ["DD21", "K24", "Z33", "B42"]) for (const h of zocOfUnit(CTX, EMPTY, german("u1", id))) expect(MAP.hexes[h]!.land, h).not.toBeNull();
  });

  it("only armor reaches the adjacent hexes (Ref 7.0: 'an armor unit, only'); infantry and airborne exert none there, nor do air, fleets, replacements, bridgeheads or boxes", () => {
    expect(zocOfUnit(CTX, EMPTY, counter("u1", "germany", "armor", 3, "M33"))).toHaveLength(6);
    for (const type of ["infantry", "airborne", "air", "fleet", "replacement", "airbase", "bridgehead"] as const) expect(zocOfUnit(CTX, EMPTY, counter("u1", "germany", type, 3, "M33")), type).toEqual([]);
    expect(zocOfUnit(CTX, EMPTY, counter("u1", "usa", "armor", 3, "us-box"))).toEqual([]);
  });

  it("every ground unit exerts a ZOC on its own hex, which does nothing by itself (Ref 7.0, 19.3)", () => {
    for (const type of ["infantry", "armor", "airborne"] as const) expect(exertsZoc(CTX, counter("u1", "germany", type, 3, "M33")), type).toBe(true);
    for (const type of ["air", "fleet", "replacement", "airbase", "bridgehead"] as const) expect(exertsZoc(CTX, counter("u1", "germany", type, 3, "M33")), type).toBe(false);
    const s = board([foot("u1", "M33")]);
    expect(enemyZocFor(CTX, s, "allies").size).toBe(0); // infantry alone puts no hex in anyone's ZOC
  });

  it("armor ZOC does not extend across a Crossing Arrow hexside, though the unit may cross it (Ref 7.0, 4.6)", () => {
    for (const [a, b] of [["DD21", "DD22"], ["Z33", "Z34"], ["I30", "I31"]]) {
      expect(canCross(CTX, a!, b!), `${a}-${b} can be crossed`).toBe(true);
      expect(armorZocCrosses(CTX, a!, b!), `${a}-${b}`).toBe(false);
      expect(zocOfUnit(CTX, EMPTY, german("u1", a!)), `${a} into ${b}`).not.toContain(b);
      expect(zocOfUnit(CTX, EMPTY, german("u1", b!)), `${b} into ${a}`).not.toContain(a);
    }
  });

  it("armor ZOC does not extend into a Fortress hex but does extend out of one (Ref 7.0, 4.8)", () => {
    const fort = { ...EMPTY, fortresses: { P24: true } };
    const at = adjacentHexes(CTX, "P24").find((n) => armorZocCrosses(CTX, n, "P24"))!;
    expect(zocOfUnit(CTX, EMPTY, german("u1", at))).toContain("P24");
    expect(zocOfUnit(CTX, fort, german("u1", at))).not.toContain("P24");
    expect(zocOfUnit(CTX, fort, german("u1", "P24")).length).toBeGreaterThan(0);
    expect(zocOfUnit(CTX, fort, german("u1", "P24"))).toContain(at);
  });
});

describe("whose ZOC", () => {
  it("a side's ZOC is its units' ZOCs together; a neutral power's units exert none", () => {
    const s = board([german("u1", "M33"), french("u2", "O22"), counter("u3", "italy", "armor", 2, "Y22", 3)]);
    expect(zocHexes(CTX, s, "axis").has("M34")).toBe(true);
    expect(zocHexes(CTX, s, "axis").has("O23")).toBe(false);
    expect(zocHexes(CTX, s, "allies").has("O23")).toBe(true);
    expect(zocHexes(CTX, s, "axis").has("Y23")).toBe(false); // Italy is neutral in 1939
    const war = { ...s, nations: { ...s.nations, italy: { ...s.nations.italy, status: "axis" as const } } };
    expect(zocHexes(CTX, war, "axis").has("Y23")).toBe(true);
  });

  it("names the units behind a ZOC", () => {
    const s = board([german("u1", "M33"), german("u2", "M35")]);
    expect(zocSources(CTX, s, "allies", "M34")).toEqual(["u1", "u2"]);
    expect(zocSources(CTX, s, "allies", "M33")).toEqual([]);
    expect(zocSources(CTX, s, "axis", "M34")).toEqual([]);
  });

  it("Minor-Allies exert a ZOC only while active; Free France fights on the Allied side", () => {
    const ctx = ctxFor(SCENARIO_1942);
    const at = { finland: "D43", rumania: "S33", hungary: "P33", bulgaria: "AA33" } as const;
    for (const [owner, hex] of Object.entries(at)) {
      const unit = counter("u1", owner as keyof typeof at, "armor", 2, hex, 3);
      const on = board([unit], SCENARIO_1942);
      expect(zocHexes(ctx, on, "axis").size, `${owner} active`).toBeGreaterThan(0);
      expect(zocHexes(ctx, on, "allies").size).toBe(0);
      const off = board([unit], SCENARIO_1942, { minorAllies: on.minorAllies.map((m) => ({ ...m, active: false })) });
      expect(zocHexes(ctx, off, "axis").size, `${owner} inactive`).toBe(0);
      expect(zocHexes(ctx, off, "allies").size).toBe(0);
      // Only the named ally is switched off: the others still count.
      const one = board([unit], SCENARIO_1942, { minorAllies: on.minorAllies.map((m) => ({ ...m, active: m.owner !== owner })) });
      expect(zocHexes(ctx, one, "axis").size, `${owner} alone inactive`).toBe(0);
    }
    const free = board([counter("u1", "free-france", "armor", 2, "M33", 3)], SCENARIO_1942);
    expect(zocHexes(ctx, free, "allies").has("M34")).toBe(true);
    expect(zocHexes(ctx, free, "axis").size).toBe(0);
  });

  it("1942: Soviet units exert ZOC against the Germans", () => {
    const ctx = ctxFor(SCENARIO_1942);
    const s = board([counter("u1", "ussr", "armor", 3, "M33", 3)], SCENARIO_1942);
    expect(zocHexes(ctx, s, "allies").has("M34")).toBe(true);
    expect(zocHexes(ctx, s, "axis").size).toBe(0);
  });
});

describe("leaving costs two more; entering costs nothing and never forces a stop (Ref 7.0, 11.41)", () => {
  const s = board([german("u1", "M33"), french("u2", "M35")]); // German armor at Poznan; a French armor unit stands in Warsaw
  const noNegation: ZocPolicy = { friendlyUnitNegates: false };

  it("a hex next to enemy armor is in its ZOC; a free hex and the armor's own hex are not", () => {
    expect(inEnemyZoc(CTX, s, "allies", "M34")).toBe(true);
    expect(inEnemyZoc(CTX, s, "allies", "M37")).toBe(false);
    expect(inEnemyZoc(CTX, s, "axis", "M32")).toBe(false); // the German's own ZOC does not hold the German
    expect(inEnemyZoc(CTX, s, "axis", "M34")).toBe(true); // but the French armor in Warsaw reaches M34 too
  });

  it("leaving a hex in enemy armor ZOC costs ZOC_EXIT_COST (2) more; any other hex costs nothing", () => {
    expect(ZOC_EXIT_COST).toBe(2);
    const zoc = enemyZocFor(CTX, s, "allies");
    expect(zocExitCost(zoc, "M34")).toBe(2);
    expect(zocExitCost(zoc, "M37")).toBe(0);
  });

  it("a friendly unit in the hex does NOT cancel the enemy ZOC there (Ref 7.0)", () => {
    const covered = board([german("u1", "M33"), french("u2", "M34")]);
    expect(inEnemyZoc(CTX, covered, "allies", "M34")).toBe(true);
    expect(inEnemyZoc(CTX, covered, "allies", "M34", { friendlyUnitNegates: true })).toBe(false); // the switch still exists
    expect(noNegation.friendlyUnitNegates).toBe(false);
    expect(enemyZocFor(CTX, covered, "allies").has("N33")).toBe(true);
  });

  it("an air or naval unit does not negate a ZOC either", () => {
    const air = board([german("u1", "M33"), counter("u2", "france", "air", 2, "M34", 4)]);
    expect(inEnemyZoc(CTX, air, "allies", "M34")).toBe(true);
  });

  it("the Qattara Depression is never in a ZOC, even with enemy armor on both rims", () => {
    const q = board([counter("u1", "britain", "armor", 3, "MM26", 3), counter("u2", "germany", "armor", 3, "MM27", 4)]);
    expect(inEnemyZoc(CTX, q, "allies", "NN26")).toBe(false);
    expect(inEnemyZoc(CTX, q, "axis", "NN26")).toBe(false);
  });

  it("infantry next to a unit puts nothing in a ZOC: only armor does", () => {
    const inf = board([foot("u1", "M33")]);
    expect(inEnemyZoc(CTX, inf, "allies", "M34")).toBe(false);
    expect(zocHexes(CTX, inf, "axis").size).toBe(0);
  });
});

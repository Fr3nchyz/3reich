import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { adjacentHexes, canCross, enemyZocFor, inEnemyZoc, mustStop, zocHexes, zocOfUnit, zocPathProblem, zocSources, zocStopIndex, type ZocPolicy } from "../src/engine/zoc";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

const german = (id: string, at: string, type: "infantry" | "armor" = "infantry") => counter(id, "germany", type, 3, at, 4);
const french = (id: string, at: string) => counter(id, "france", "infantry", 2, at, 3);
const sorted = (xs: Iterable<string>) => [...xs].sort();

// Ref 6.0 (Zones of Control), 4.3 and 4.6 (hexsides ground units cross), 4.51 (Qattara).
describe("which hexes a ground unit exerts a ZOC into", () => {
  it("all six neighbours on open ground", () => {
    expect(sorted(zocOfUnit(CTX, german("u1", "M33")))).toEqual(["L33", "L34", "M32", "M34", "N32", "N33"]);
  });

  it("across a river (Ref 4.51: a river changes defence, not who can cross)", () => {
    expect(MAP.hexsides["B42-C42"]!.river).toBe(true);
    expect(zocOfUnit(CTX, german("u1", "B42"))).toContain("C42");
    expect(zocOfUnit(CTX, german("u1", "C42"))).toContain("B42");
  });

  it("never into or out of the Qattara Depression (Ref 4.51)", () => {
    expect(MAP.hexsides["MM26-NN26"]!.qattara).toBe(true);
    for (const from of ["MM26", "MM27", "NN25", "NN27"]) expect(zocOfUnit(CTX, german("u1", from)), from).not.toContain("NN26");
    expect(zocOfUnit(CTX, german("u1", "NN26"))).toEqual([]);
    expect(zocOfUnit(CTX, german("u1", "MM26"))).toContain("MM27"); // the rest of Egypt is open
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
    expect(zocOfUnit(CTX, german("u1", "K24"))).not.toContain("L24");
    expect(zocOfUnit(CTX, german("u1", "L24"))).not.toContain("K24");
  });

  it("across a crossing arrow, in both directions: Messina, the Turkish Straits, Denmark (Ref 4.6)", () => {
    for (const [a, b] of [["DD21", "DD22"], ["Z33", "Z34"], ["AA31", "BB31"], ["I30", "I31"], ["I31", "I32"], ["F33", "G32"]]) {
      expect(MAP.hexsides[[a, b].sort().join("-")] ?? MAP.hexsides[`${a}-${b}`], `${a}-${b}`).toBeDefined();
      expect(zocOfUnit(CTX, german("u1", a!)), `${a} into ${b}`).toContain(b);
      expect(zocOfUnit(CTX, german("u1", b!)), `${b} into ${a}`).toContain(a);
    }
  });

  it("Sicily: the island is joined inside and to the mainland only by the Messina arrow", () => {
    expect(sorted(zocOfUnit(CTX, german("u1", "DD21")))).toEqual(["DD20", "DD22", "EE20", "EE21"]);
    const inland = zocOfUnit(CTX, german("u1", "DD20"));
    expect(sorted(inland)).toEqual(["DD19", "DD21", "EE19", "EE20"]);
    expect(inland).not.toContain("DD22");
  });

  it("only into land: a coastal unit's ZOC stops at the water", () => {
    for (const id of ["DD21", "K24", "Z33", "B42"]) for (const h of zocOfUnit(CTX, german("u1", id))) expect(MAP.hexes[h]!.land, h).not.toBeNull();
  });

  it("only infantry, armor and airborne exert one; not air, fleets, replacements, bridgeheads or boxes", () => {
    for (const type of ["infantry", "armor", "airborne"] as const) expect(zocOfUnit(CTX, counter("u1", "germany", type, 3, "M33")), type).toHaveLength(6);
    for (const type of ["air", "fleet", "replacement", "airbase", "bridgehead"] as const) expect(zocOfUnit(CTX, counter("u1", "germany", type, 3, "M33")), type).toEqual([]);
    expect(zocOfUnit(CTX, counter("u1", "usa", "infantry", 3, "us-box"))).toEqual([]);
  });
});

describe("whose ZOC", () => {
  it("a side's ZOC is its units' ZOCs together; a neutral power's units exert none", () => {
    const s = board([german("u1", "M33"), french("u2", "O22"), counter("u3", "italy", "infantry", 2, "Y22", 3)]);
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

  it("1942: Soviet units exert ZOC against the Germans", () => {
    const ctx = ctxFor(SCENARIO_1942);
    const s = board([counter("u1", "ussr", "infantry", 3, "M33", 3)], SCENARIO_1942);
    expect(zocHexes(ctx, s, "allies").has("M34")).toBe(true);
    expect(zocHexes(ctx, s, "axis").size).toBe(0);
  });
});

describe("must stop, may leave", () => {
  const s = board([german("u1", "M33"), french("u2", "M35")]); // German at Poznan; the French unit stands in Warsaw
  const noNegation: ZocPolicy = { friendlyUnitNegates: false };

  it("a unit entering an enemy ZOC must stop; one entering a free hex need not", () => {
    expect(mustStop(CTX, s, "allies", "M34")).toBe(true);
    expect(mustStop(CTX, s, "allies", "M37")).toBe(false);
    expect(mustStop(CTX, s, "axis", "M32")).toBe(false); // the German's own ZOC does not stop the German
    expect(mustStop(CTX, s, "axis", "M34")).toBe(true); // but the French unit in Warsaw reaches M34 too
  });

  it("starting in a ZOC and walking out is allowed; walking on from a ZOC hex is not", () => {
    // M34 is in the German ZOC; M35 (Warsaw, French unit) is two hexes from M33; M36, M37 are free.
    expect(zocPathProblem(CTX, s, "allies", ["M36", "M37"])).toBeNull();
    expect(zocStopIndex(CTX, s, "allies", ["M36", "M37"])).toBeNull();
    expect(zocStopIndex(CTX, s, "allies", ["M37", "M34"])).toBe(1);
    expect(zocPathProblem(CTX, s, "allies", ["M37", "M34"])).toBeNull(); // may end its move there
    expect(zocPathProblem(CTX, s, "allies", ["M34", "M37"])).toMatch(/must stop/);
    expect(zocPathProblem(CTX, s, "allies", ["L34", "M34"])).toMatch(/must stop/); // two ZOC hexes in a row
    expect(zocPathProblem(CTX, s, "allies", [])).toBeNull();
  });

  it("a friendly ground unit in the hex cancels the ZOC there (spec 03; TODO verify) unless the policy says otherwise", () => {
    const covered = board([german("u1", "M33"), french("u2", "M34")]);
    expect(inEnemyZoc(CTX, covered, "allies", "M34")).toBe(false);
    expect(inEnemyZoc(CTX, covered, "allies", "M34", noNegation)).toBe(true);
    expect(enemyZocFor(CTX, covered, "allies").has("N33")).toBe(true); // the neighbouring hexes stay in the zone
    expect(zocPathProblem(CTX, covered, "allies", ["M34", "M37"])).toBeNull();
    expect(zocPathProblem(CTX, covered, "allies", ["M34", "M37"], noNegation)).toMatch(/must stop/);
  });

  it("an air or naval unit does not negate a ZOC", () => {
    const air = board([german("u1", "M33"), counter("u2", "france", "air", 2, "M34", 4)]);
    expect(inEnemyZoc(CTX, air, "allies", "M34")).toBe(true);
  });

  it("the Qattara Depression is never in a ZOC, even with enemy units on both rims", () => {
    const q = board([counter("u1", "britain", "infantry", 3, "MM26", 3), counter("u2", "germany", "infantry", 3, "MM27", 4)]);
    expect(inEnemyZoc(CTX, q, "allies", "NN26")).toBe(false);
    expect(inEnemyZoc(CTX, q, "axis", "NN26")).toBe(false);
  });
});

describe("property: a legal path never goes on after a hex where the unit must stop", () => {
  it("holds on random walks over a real front, with and without negation", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const land = Object.values(MAP.hexes).filter((h) => h.country === "poland" || h.country === "germany").map((h) => h.id);
    const pick = () => land[Math.floor(rnd() * land.length)]!;
    let refused = 0;
    for (let round = 0; round < 400; round++) {
      const units = Array.from({ length: 6 }, (_, i) => (i % 2 ? french(`f${i}`, pick()) : german(`g${i}`, pick())));
      const s = board(units);
      for (const policy of [{ friendlyUnitNegates: true }, { friendlyUnitNegates: false }]) {
        const zoc = enemyZocFor(CTX, s, "allies", policy);
        let at = pick();
        const path: string[] = [];
        for (let i = 0; i < 8; i++) {
          const next = adjacentHexes(CTX, at).filter((n) => canCross(CTX, at, n));
          at = next[Math.floor(rnd() * next.length)]!;
          path.push(at);
        }
        const problem = zocPathProblem(CTX, s, "allies", path, policy);
        const inZoc = path.map((h) => zoc.has(h));
        const stop = inZoc.indexOf(true);
        // legal if and only if no ZOC hex comes before the last hex
        expect(problem === null).toBe(stop < 0 || stop === path.length - 1);
        if (problem) refused++;
      }
    }
    expect(refused).toBeGreaterThan(5); // the property is not vacuous
  });
});

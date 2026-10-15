import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { attackMarkCells } from "../src/ui/attackMarks";
import { ATTACKER_INSET, CHOSEN_INSET, TARGET_INSET, attackMarksMarkup } from "../src/ui/mapMarks";
import { hexCenter } from "../src/ui/mapGeometry";
import { hex } from "../src/engine/hex";

// Spec 07 Part B / ticket 07-5: the marks are decoration for a list that has the same facts; here we test only what is drawn where.
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("which hexes the attack marks cover", () => {
  it("lists targets, the chosen target and attacker hexes, each once, in the order given", () => {
    const c = attackMarkCells(MAP, { targets: ["M35", "N33", "M35", "M33"], chosen: "N33", attackers: ["L34", "L33", "L34"] });
    expect(c.targets).toEqual(["M35", "M33"]); // the chosen target is drawn thick, not also dashed
    expect(c.chosen).toBe("N33");
    expect(c.attackers).toEqual(["L34", "L33"]);
  });

  it("draws the chosen target even if the caller left it out of the target list", () => {
    expect(attackMarkCells(MAP, { targets: ["M35"], chosen: "N33" }).chosen).toBe("N33");
  });

  it("never lists a hex that is not on the map, and an empty or missing input draws nothing", () => {
    const c = attackMarkCells(MAP, { targets: ["M35", "ZZ99"], chosen: "ZZ99", attackers: ["nope"] });
    expect(c).toEqual({ targets: ["M35"], chosen: null, attackers: [], from: null });
    expect(attackMarkCells(MAP, null)).toEqual({ targets: [], chosen: null, attackers: [], from: null });
    expect(attackMarkCells(MAP, {})).toEqual({ targets: [], chosen: null, attackers: [], from: null });
    expect(attackMarksMarkup(MAP, null)).toBe("");
  });

  it("accepts any iterable (a Set from the session)", () => {
    const c = attackMarkCells(MAP, { targets: new Set(["M35", "N33"]), attackers: new Set(["L34"]) });
    expect(c.targets).toEqual(["M35", "N33"]);
    expect(c.attackers).toEqual(["L34"]);
  });
});

describe("the SVG of the attack marks", () => {
  const svg = attackMarksMarkup(MAP, { targets: ["M35", "N33", "M33"], chosen: "M35", attackers: ["L34", "L33"] });

  it("draws one dashed-class shape per other target, one chosen shape and a solid ring plus a diamond per attacker", () => {
    expect(count(svg, /class="mk-target"/g)).toBe(2);
    expect(svg).toContain('data-mk-chosen="M35"');
    expect(count(svg, /class="mk-chosen"/g)).toBe(1);
    expect(count(svg, /class="mk-attacker"/g)).toBe(2);
    expect(count(svg, /class="pip"/g)).toBe(2); // the non-colour cue on attacker hexes
    expect(svg).not.toContain('data-mk-target="M35"');
  });

  it("keeps a bounded node count: marks only for the listed hexes", () => {
    expect(count(svg, /<(polygon|path)/g)).toBe(2 + 2 * 3 + 2 * 1);
  });

  it("puts the chosen target last so it is on top, and sizes the shapes thick > attacker > target", () => {
    expect(svg.lastIndexOf("mk-chosen")).toBeGreaterThan(svg.lastIndexOf("mk-attacker"));
    expect(svg.indexOf("mk-target")).toBeLessThan(svg.indexOf("mk-attacker"));
    expect(CHOSEN_INSET).toBeLessThan(ATTACKER_INSET);
    expect(ATTACKER_INSET).toBeLessThan(TARGET_INSET);
  });

  it("draws each shape inside its own hex, around its centre", () => {
    const [cx, cy] = hexCenter(hex("M35"));
    const pts = /data-mk-chosen="M35" points="([^"]+)"/.exec(svg)![1]!.split(" ").map((p) => p.split(",").map(Number) as [number, number]);
    expect(pts).toHaveLength(6);
    for (const [x, y] of pts) expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(10 * CHOSEN_INSET, 1);
  });
});

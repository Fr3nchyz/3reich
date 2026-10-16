import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { whyNot } from "../src/ui/moveWhy";
import * as T from "../src/ui/moveText";
import { CTX } from "./helpers";
import { at6f, inf } from "./helpers-move";

// Spec 10, ticket 10-7: why a tapped hex is not a destination, in words and never an id. Positions on the real 1939 map: L32-L33-L34-L35 is a row
// of plain, M34 Polish plain next to L34 and L35, K24 Harwich and L24 Calais across the Channel.
const ID = /\b[A-Z]{1,2}\d{1,2}\b(?!\))/; // a bare hex id; "(N34)" after a place name is the printed place

describe("why a tapped hex is refused (Ref 5.0, 4.3, 7.0, 13.0)", () => {
  it("water", () => {
    const s = at6f([inf("u1", "germany", "L32", 3, 3)]);
    const sea = Object.values(MAP.hexes).find((h) => !h.land)!.id;
    expect(whyNot(CTX, s, [s.units.u1!], sea)).toBe(T.whyWater(sea));
  });

  it("an edge between two land hexes that ground units cannot cross: the Channel", () => {
    const s = at6f([inf("u1", "britain", "K24", 3, 3)], "allies");
    expect(whyNot(CTX, s, [s.units.u1!], "L24")).toMatch(/cannot cross into Calais/);
  });

  it("an enemy unit there: that is an attack, not a move", () => {
    const s = at6f([inf("u1", "germany", "M32", 3, 3), inf("p1", "poland", "M33", 2, 3)]);
    const text = whyNot(CTX, s, [s.units.u1!], "M33");
    expect(text).toBe("Poznan (M33) holds an enemy unit: that is an attack, not a move.");
    expect(text.replace(/\(M33\)/, "")).not.toMatch(ID);
  });

  it("neutral land: Hungary", () => {
    const s = at6f([inf("u1", "germany", "R30", 3, 3)]);
    const hex = Object.values(MAP.hexes).find((h) => h.country === "hungary" && h.land)!.id;
    expect(whyNot(CTX, s, [s.units.u1!], hex)).toMatch(/neutral land/);
  });

  it("too many ground units: the hex would hold more than two", () => {
    const s = at6f([inf("u1", "germany", "L32", 3, 3), inf("u2", "germany", "L33", 3, 3), inf("u3", "germany", "L33", 3, 3)]);
    expect(whyNot(CTX, s, [s.units.u1!], "L33")).toMatch(/could not hold this unit: a hex holds at most 2 ground units/);
    const two = at6f([inf("u1", "germany", "L32", 3, 3), inf("u4", "germany", "L32", 3, 3), inf("u2", "germany", "L33", 3, 3)]);
    expect(whyNot(CTX, two, [two.units.u1!, two.units.u4!], "L33")).toMatch(/could not hold all 2 of them/);
  });

  it("too far, and the extra cost of leaving an enemy zone of control", () => {
    const s = at6f([inf("u1", "germany", "L32", 3, 2)]);
    expect(whyNot(CTX, s, [s.units.u1!], "L36")).toMatch(/too far for them: they can go up to 2 hexes\./);
    const zoc = at6f([inf("u1", "germany", "L34", 3, 4), inf("p1", "poland", "M34", 2, 3, "armor")]);
    expect(whyNot(CTX, zoc, [zoc.units.u1!], "L29")).toMatch(/leaving an enemy zone of control costs 2 more/);
  });

  it("never puts a bare unit id or hex id in a sentence", () => {
    const s = at6f([inf("u1", "germany", "M32", 3, 2), inf("p1", "poland", "M33", 2, 3)]);
    for (const hex of ["M33", "N33", "K24"]) expect(whyNot(CTX, s, [s.units.u1!], hex)).not.toMatch(/\bu1\b|\bp1\b/);
    expect(whyNot(CTX, s, [s.units.u1!], "M33").replace(/\(M33\)/, "")).not.toMatch(ID);
  });

  it("falls back to the general sentence with nothing ticked", () => {
    const s = at6f([inf("u1", "germany", "L32", 3, 3)]);
    expect(whyNot(CTX, s, [], "L33")).toBe(T.CANNOT_GET_THERE);
  });
});

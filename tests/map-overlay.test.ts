import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { controllerOf, sideInWar } from "../src/engine/control";
import { zocHexes } from "../src/engine/zoc";
import { HATCH_ID, overlayMarkup } from "../src/ui/mapOverlay";
import { overlayCells, overlayLegend } from "../src/ui/overlayModel";
import { board, counter } from "./board";
import { CTX, ctxFor } from "./helpers";

// The overlay only shows what engine/control.ts (Ref 7.0) and engine/zoc.ts (Ref 6.0) already say.
const german = (id: string, at: string) => counter(id, "germany", "infantry", 3, at, 4);
const polish = (id: string, at: string) => counter(id, "poland", "infantry", 2, at, 3);

describe("who holds each hex", () => {
  it("groups every held land hex by the side its holder fights on, and never lists sea or land nobody holds", () => {
    const s = board([]);
    const { control } = overlayCells(CTX, s);
    expect(control.axis).toContain("L31"); // Berlin: Germany
    expect(control.allies).toContain("M35"); // Warsaw: Poland, allied for good
    expect(control.allies).toContain("O22"); // France
    expect(control.neutral).toContain("Y22"); // Italy is neutral in 1939
    const all = [...control.axis, ...control.allies, ...control.neutral];
    expect(new Set(all).size).toBe(all.length);
    const sea = Object.values(MAP.hexes).find((h) => !h.land)!;
    expect(all).not.toContain(sea.id);
    expect(all).not.toContain("M25"); // Brussels' neighbour: nobody's territory in 1939
    for (const [list, side] of [[control.axis, "axis"], [control.allies, "allies"]] as const) {
      for (const h of list) expect(sideInWar(s, controllerOf(CTX, s, h)!), h).toBe(side);
    }
    for (const h of control.neutral) expect(sideInWar(s, controllerOf(CTX, s, h)!), h).toBeNull();
  });

  it("follows a change of control: a hex taken from Poland moves from the Allies to the Axis list", () => {
    const before = overlayCells(CTX, board([]));
    const after = overlayCells(CTX, board([], undefined, { control: { M35: "germany" } }));
    expect(before.control.allies).toContain("M35");
    expect(after.control.allies).not.toContain("M35");
    expect(after.control.axis).toContain("M35");
    expect(after.control.axis).toHaveLength(before.control.axis.length + 1);
  });

  it("reads the 1942 start: Warsaw is German, Vichy's zone is dotted-neutral", () => {
    const ctx = ctxFor(SCENARIO_1942);
    const { control } = overlayCells(ctx, board([], SCENARIO_1942));
    expect(control.axis).toContain("M35");
    expect(control.neutral.length).toBeGreaterThan(0);
  });

  it("lists are in hex-id order, so the drawing is the same every time", () => {
    const { control, zoc } = overlayCells(CTX, board([german("u1", "M34"), polish("u2", "M35")]));
    for (const list of [control.axis, control.allies, control.neutral, zoc]) expect(list).toEqual([...list].sort());
  });
});

describe("Zones of Control of the side not to move", () => {
  it("shows the side that does not have the move: Polish ZOC while the Axis move, German ZOC while the Allies move", () => {
    const units = [german("u1", "M34"), polish("u2", "M35")];
    const axisMove = overlayCells(CTX, board(units, undefined, { activeSide: "axis" }));
    expect(axisMove.zocSide).toBe("allies");
    expect(axisMove.zoc).toEqual([...zocHexes(CTX, board(units), "allies")].sort());
    expect(axisMove.zoc).toContain("M34"); // the Polish infantry reach the German hex
    const alliesMove = overlayCells(CTX, board(units, undefined, { activeSide: "allies" }));
    expect(alliesMove.zocSide).toBe("axis");
    expect(alliesMove.zoc).toEqual([...zocHexes(CTX, board(units), "axis")].sort());
    expect(alliesMove.zoc).toContain("M35");
    expect(alliesMove.zoc).not.toEqual(axisMove.zoc);
  });

  it("is empty with no ground units, and air units and fleets exert none", () => {
    expect(overlayCells(CTX, board([])).zoc).toEqual([]);
    const air = counter("u3", "poland", "air", 4, "M35", 6);
    expect(overlayCells(CTX, board([air], undefined, { activeSide: "axis" })).zoc).toEqual([]);
  });
});

describe("drawing", () => {
  it("draws nothing when off, and one inset polygon per held hex plus one hatched polygon per ZOC hex when on", () => {
    expect(overlayMarkup(MAP, null)).toBe("");
    const cells = overlayCells(CTX, board([german("u1", "M34"), polish("u2", "M35")], undefined, { activeSide: "axis" }));
    const svg = overlayMarkup(MAP, cells);
    const held = cells.control.axis.length + cells.control.allies.length + cells.control.neutral.length;
    expect(svg.match(/data-ctl=/g)).toHaveLength(held);
    expect(svg.match(/data-zoc=/g)).toHaveLength(cells.zoc.length);
    expect(svg).toContain(`fill="url(#${HATCH_ID})"`);
    expect(svg).toMatch(/class="ctl-axis" data-ctl="L31"/);
    expect(svg).toMatch(/class="ctl-allies" data-ctl="M35"/);
  });

  it("skips ids that are not on the map", () => {
    const svg = overlayMarkup(MAP, { control: { axis: ["ZZ99"], allies: [], neutral: [] }, zoc: ["ZZ98"], zocSide: "axis" });
    expect(svg).not.toContain("data-");
  });
});

describe("the key", () => {
  it("names the side whose ZOC is hatched and the side that must stop, in plain words", () => {
    const axisMove = overlayLegend(overlayCells(CTX, board([], undefined, { activeSide: "axis" }))).join(" ");
    expect(axisMove).toMatch(/Allies Zones of Control\. Axis ground units entering one must stop/);
    const alliesMove = overlayLegend(overlayCells(CTX, board([], undefined, { activeSide: "allies" }))).join(" ");
    expect(alliesMove).toMatch(/Axis Zones of Control\. Allies ground units entering one must stop/);
    expect(axisMove).toMatch(/Axis/);
    expect(axisMove).toMatch(/green = Allies/);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { attackMarkCells } from "../src/ui/attackMarks";
import type { MapView } from "../src/ui/mapView";
import { unitsMarkup } from "../src/ui/mapCounters";
import { attackMarksMarkup } from "../src/ui/mapMarks";
import { syncMap } from "../src/ui/mapSync";
import { NO_MOVE_MARKS, moveMarksOf } from "../src/ui/moveMarks";
import { selectionFor } from "../src/ui/moveSelection";
import { chooseStack, tickNone, toggleTick, selectionNow } from "../src/ui/moveTap";
import { at6f, inf } from "./helpers-move";
import { crafted, withUnits } from "./helpers-move-session";
import { CTX } from "./helpers";

// Spec 10, ticket 10-5: what the map marks while a stack is chosen to move. Nothing here is a rule: the marks only show the Move card's ticks.
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("the pure model of what is marked", () => {
  it("nothing chosen marks nothing", () => {
    expect(moveMarksOf(null)).toBe(NO_MOVE_MARKS);
    expect(NO_MOVE_MARKS.from).toBeNull();
  });

  it("ticked units are ringed, free (left behind) units get the dash, greyed units are not marked, and the hex is the chosen one", () => {
    const state = at6f([inf("u1", "germany", "L32", 3, 4), inf("u2", "germany", "L32", 2, 1), inf("a1", "germany", "L32", 2, 6, "air"), inf("u3", "germany", "L33", 3, 3)]);
    const m = moveMarksOf(selectionFor(CTX, state, "L32", ["u1"]));
    expect(m.from).toBe("L32");
    expect([...m.units.ticked]).toEqual(["u1"]);
    expect([...m.units.left]).toEqual(["u2"]); // the air counter cannot move on the ground: neither ringed nor dashed
    const all = moveMarksOf(selectionFor(CTX, state, "L32", ["u1", "u2"]));
    expect([...all.units.ticked].sort()).toEqual(["u1", "u2"]);
    expect(all.units.left.size).toBe(0);
    const none = moveMarksOf(selectionFor(CTX, state, "L32", []));
    expect(none.units.ticked.size).toBe(0);
    expect([...none.units.left].sort()).toEqual(["u1", "u2"]);
  });

  it("a unit of another hex is never marked", () => {
    const state = at6f([inf("u1", "germany", "L32", 3, 4), inf("u3", "germany", "L33", 3, 3)]);
    const m = moveMarksOf(selectionFor(CTX, state, "L32", ["u1"]));
    expect(m.units.ticked.has("u3") || m.units.left.has("u3")).toBe(false);
  });
});

describe("what is drawn", () => {
  const units = [inf("u1", "germany", "L32", 3, 4), inf("u2", "germany", "L32", 2, 1), inf("u3", "germany", "L33", 3, 3)];
  const marks = { ticked: new Set(["u1"]), left: new Set(["u2"]) };

  it("a ring on each ticked counter, a veil and a bar on each left-behind one, nothing on the rest; the shapes differ", () => {
    const svg = unitsMarkup(MAP, units, marks);
    expect(count(svg, /class="ring"/g)).toBe(1);
    expect(count(svg, /class="ring-case"/g)).toBe(1);
    expect(count(svg, /class="veil"/g)).toBe(1);
    expect(count(svg, /class="dash"/g)).toBe(1);
    expect(svg).toContain('data-mark="ticked"');
    expect(svg).toContain('data-mark="left"');
    expect(count(svg, /data-mark=/g)).toBe(2);
    expect(count(unitsMarkup(MAP, units), /data-mark=|class="ring"|class="veil"/g)).toBe(0);
  });

  it("the ring sits inside the counter's own group (u1, drawn first), the veil in u2's: a counter above covers a mark as it covers the cardboard", () => {
    const groups = unitsMarkup(MAP, units, marks).split("<g data-at=").slice(1).filter((g) => g.startsWith('"L32"'));
    expect(groups).toHaveLength(2);
    expect(groups[0]).toContain('data-mark="ticked"');
    expect(groups[0]).toContain('class="ring"');
    expect(groups[0]).not.toContain('class="veil"');
    expect(groups[1]).toContain('data-mark="left"');
    expect(groups[1]).toContain('class="veil"');
    expect(groups[1]).not.toContain('class="ring"');
  });

  it("the chosen hex is a thick outline in the marks layer, once, and a hex off the map draws nothing", () => {
    const svg = attackMarksMarkup(MAP, { from: "L32" });
    expect(count(svg, /data-mk-from="L32"/g)).toBe(1);
    expect(attackMarkCells(MAP, { from: "ZZ99" }).from).toBeNull();
    expect(attackMarksMarkup(MAP, { from: null })).toBe("");
  });

  it("the ring's gold and its dark case differ enough to see on any paper (contrast of at least 3 to 1)", () => {
    const css = readFileSync("src/move.css", "utf8");
    const colour = (sel: string) => css.match(new RegExp(`${sel}\\s*\\{[^}]*stroke:\\s*(#[0-9a-f]{6})`, "i"))![1]!;
    const lum = (hexColour: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hexColour.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const [a, b] = [lum(colour("svg.map .units .ring")), lum(colour("svg.map .units .ring-case, svg.map .units .dash-case"))].sort((x, y) => y - x);
    expect((a! + 0.05) / (b! + 0.05)).toBeGreaterThanOrEqual(3);
  });
});

/** A map view that only records what it is told. */
function fakeView() {
  const seen = { units: null as null | { ticked: string[]; left: string[] }, marks: [] as unknown[] };
  const view = {
    setUnits: (_: unknown, m?: { ticked: ReadonlySet<string>; left: ReadonlySet<string> }) => { seen.units = m ? { ticked: [...m.ticked], left: [...m.left] } : null; },
    setHighlights: () => undefined,
    focus: () => undefined,
    setAttackMarks: (m: unknown) => { seen.marks.push(m); },
    clearAttackMarks: () => { seen.marks.push(null); },
  } as unknown as MapView;
  return { view, seen };
}

describe("the map follows the ticks", () => {
  it("choosing a stack marks it, unticking moves the ring to a dash, cancelling clears the marks", () => {
    const s = crafted();
    const { view, seen } = fakeView();
    syncMap(view, s, null, []);
    expect(seen.units?.ticked).toEqual([]);
    expect(seen.marks.at(-1)).toBeNull();
    chooseStack(s, "L32");
    syncMap(view, s, null, []);
    expect(seen.units).toEqual({ ticked: ["u1", "u2"], left: [] });
    expect(seen.marks.at(-1)).toEqual({ from: "L32" });
    toggleTick(s, "u2");
    syncMap(view, s, null, []);
    expect(seen.units).toEqual({ ticked: ["u1"], left: ["u2"] });
    tickNone(s);
    syncMap(view, s, null, []);
    expect(seen.units).toEqual({ ticked: [], left: ["u1", "u2"] });
    expect(selectionNow(s)?.ticked).toEqual([]);
    s.moveChosen = null;
    syncMap(view, s, null, []);
    expect(seen.units?.left).toEqual([]);
    expect(seen.marks.at(-1)).toBeNull();
  });

  it("with nothing chosen the counters carry no marks", () => {
    const s = withUnits([inf("u1", "germany", "L32", 3, 4)]);
    const { view, seen } = fakeView();
    s.moveChosen = null;
    syncMap(view, s, null, []);
    expect(seen.units?.ticked).toEqual([]);
    expect(seen.units?.left).toEqual([]);
  });
});

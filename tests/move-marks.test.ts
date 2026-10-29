import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { attackMarkCells } from "../src/ui/attackMarks";
import type { MapView } from "../src/ui/mapView";
import { COUNTER_ABOVE, COUNTER_LEFT, COUNTER_SIZE, STACK_STEP, unitsMarkup } from "../src/ui/mapCounters";
import { BADGE_R, SLOT, badgesFor, shownOf, unitMarksMarkup } from "../src/ui/mapUnitMarks";
import { OWNER_COLOURS } from "../src/ui/mapStyle";
import { attackMarksMarkup } from "../src/ui/mapMarks";
import { syncMap } from "../src/ui/mapSync";
import { NO_MOVE_MARKS, NO_UNIT_MARKS, moveMarksOf, type UnitMarks } from "../src/ui/moveMarks";
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

  it("the counters are drawn exactly as without marks: nothing is laid over a counter, so no number or symbol is covered or dimmed", () => {
    expect(unitsMarkup(MAP, units)).not.toMatch(/class="(ring|veil|dash)|data-mark/);
  });

  it("a ringed badge with a tick for each ticked counter, a flat dash for each left-behind one, none for the rest; the shapes differ", () => {
    const svg = unitMarksMarkup(MAP, units, marks);
    expect(count(svg, /data-mark="ticked"/g)).toBe(1);
    expect(count(svg, /data-mark="left"/g)).toBe(1);
    expect(count(svg, /class="bd-ring"/g)).toBe(1);
    expect(count(svg, /class="bd-tick"/g)).toBe(1);
    expect(count(svg, /class="bd-dash"/g)).toBe(1);
    expect(count(svg, /<circle/g)).toBe(2); // ring: case and ring; dash: rectangles only
    expect(unitMarksMarkup(MAP, units, NO_UNIT_MARKS)).toBe("");
    expect(unitMarksMarkup(MAP, units, { ticked: new Set(["u3"]), left: new Set() })).toContain('data-unit="u3"');
  });

  it("the chosen hex is a thick outline in the marks layer, once, and a hex off the map draws nothing", () => {
    const svg = attackMarksMarkup(MAP, { from: "L32" });
    expect(count(svg, /data-mk-from="L32"/g)).toBe(1);
    expect(attackMarkCells(MAP, { from: "ZZ99" }).from).toBeNull();
    expect(attackMarksMarkup(MAP, { from: null })).toBe("");
  });

  const css = readFileSync("src/move.css", "utf8");
  const rule = (cls: string, prop: string) => css.match(new RegExp(`\\.${cls} \\{[^}]*${prop}: (#[0-9a-f]{6})`, "i"))![1]!;
  const lum = (c: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const contrast = (a: string, b: string) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi! + 0.05) / (lo! + 0.05); };

  it("the gold ring against its dark case, and the dash against its case, differ enough to see on any paper (at least 3 to 1)", () => {
    expect(contrast(rule("bd-ring", "stroke"), rule("bd-case", "fill"))).toBeGreaterThanOrEqual(3);
    expect(contrast(rule("bd-dash", "fill"), rule("bd-case", "fill"))).toBeGreaterThanOrEqual(3);
  });

  it("the number on every nation's counter reads at 4.5 to 1 or better, marked or not (a mark never dims a counter)", () => {
    for (const [owner, c] of Object.entries(OWNER_COLOURS)) expect(contrast(c.text, c.fill), owner).toBeGreaterThanOrEqual(4.5);
  });
});

describe("where the badges go (geometry)", () => {
  const CX = 100, CY = 100;
  const stack = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `u${i}` }));
  const allTicked = (n: number): UnitMarks => ({ ticked: new Set(stack(n).map((u) => u.id)), left: new Set() });
  /** The counters' squares as the map draws them, bottom first. */
  const counters = (n: number) => Array.from({ length: n }, (_, i) => ({ x: CX - COUNTER_LEFT + i * STACK_STEP, y: CY - COUNTER_ABOVE - i * STACK_STEP }));
  const hits = (b: { x: number; y: number }, r: { x: number; y: number }) => b.x + BADGE_R > r.x && b.x - BADGE_R < r.x + COUNTER_SIZE && b.y + BADGE_R > r.y && b.y - BADGE_R < r.y + COUNTER_SIZE;

  for (const n of [1, 2, 3, 4]) {
    it(`a stack of ${n}: every counter has its own badge, in stack order, none touching another badge or any counter (so none covers a number or symbol)`, () => {
      const b = badgesFor(stack(n), CX, CY, allTicked(n));
      expect(b.map((x) => x.id)).toEqual(stack(n).map((u) => u.id));
      for (let i = 1; i < b.length; i++) expect(b[i]!.x - b[i - 1]!.x, "left to right, bottom counter first").toBeGreaterThanOrEqual(2 * BADGE_R);
      for (const m of b) for (const c of counters(n)) expect(hits(m, c), `badge ${m.id} clear of every counter`).toBe(false);
      b.forEach((m, i) => {
        const c = counters(n)[i]!;
        expect(m.ly, "the line meets its own counter's bottom edge").toBeCloseTo(c.y + COUNTER_SIZE);
        expect(m.lx).toBeGreaterThan(c.x);
        expect(m.lx).toBeLessThan(c.x + COUNTER_SIZE);
        expect(m.y - BADGE_R, "below the lowest counter").toBeGreaterThanOrEqual(CY - COUNTER_ABOVE + COUNTER_SIZE);
      });
    });
  }

  it("the row is centred on the hex and keeps one slot per drawn counter, so an unmarked counter leaves a gap rather than shifting the others", () => {
    const b = badgesFor(stack(3), CX, CY, { ticked: new Set(["u0", "u2"]), left: new Set(["u1"]) });
    expect(b.map((x) => x.kind)).toEqual(["ticked", "left", "ticked"]);
    expect((b[0]!.x + b[2]!.x) / 2).toBeCloseTo(CX);
    const gap = badgesFor(stack(3), CX, CY, { ticked: new Set(["u0", "u2"]), left: new Set() });
    expect(gap[1]!.x - gap[0]!.x).toBeCloseTo(2 * SLOT);
  });

  it("a counter that is neither ticked nor left behind (greyed, or another hex) has no badge; a stack over the drawn four marks only the drawn ones", () => {
    expect(badgesFor(stack(2), CX, CY, NO_UNIT_MARKS)).toEqual([]);
    const six = Array.from({ length: 6 }, (_, i) => inf(`s${i}`, "germany", "L32", 1, 1));
    const all: UnitMarks = { ticked: new Set(six.map((u) => u.id)), left: new Set() };
    expect(badgesFor(shownOf(six), CX, CY, all).map((x) => x.id)).toEqual(["s2", "s3", "s4", "s5"]);
  });

  it("badges stay clear of the numbers and the symbols: nothing of a badge lies inside any counter's square", () => {
    const b = badgesFor(stack(4), CX, CY, allTicked(4));
    for (const m of b) expect(counters(4).some((c) => hits(m, c))).toBe(false);
  });
});

/** A map view that only records what it is told. */
function fakeView() {
  const seen = { units: null as null | { ticked: string[]; left: string[] }, marks: [] as unknown[], fortresses: {} as Record<string, boolean> };
  const view = {
    setFortresses: (fortresses: Record<string, boolean>) => { seen.fortresses = { ...fortresses }; },
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

// Spec 16 R31/Q5: state changes reach the view even while the selection stays the same.
it("syncs fortress loss and regain to the map", () => {
  const s = crafted();
  const { view, seen } = fakeView();
  s.state = { ...s.state, fortresses: { P24: true, V38: false } };
  syncMap(view, s, null, []);
  expect(seen.fortresses).toEqual({ P24: true, V38: false });
  s.state = { ...s.state, fortresses: { P24: false, V38: true } };
  syncMap(view, s, null, []);
  expect(seen.fortresses).toEqual({ P24: false, V38: true });
});

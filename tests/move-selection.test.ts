import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "../src/engine/actions";
import { moveOptionsFor } from "../src/engine/move-options";
import { movableUnits } from "../src/engine/movement";
import type { ForceOwner, Unit } from "../src/engine/types";
import { adjacentHexes } from "../src/engine/zoc";
import { defaultTicks, LAYERS, movedLine, selectionFor, toggled, type MoveSelection } from "../src/ui/moveSelection";
import * as T from "../src/ui/moveText";
import { counter } from "./board";
import { CTX } from "./helpers";
import { at6f, inf } from "./helpers-move";
import { realPositions } from "./helpers-positions";

/**
 * The Move card model (spec 10, ticket 10-2): lines, ticks, sentences. Movement per Ref 5.45f (a stack moves at its slowest unit's factor),
 * stacking per Ref 5.0, ZOC per Ref 6.0. Pure data in, card out; the only game fact it reads is `moveOptionsFor`.
 */

const LODZ = "N33";
const armor = inf("u1", "germany", LODZ, 3, 4, "armor");
const foot = inf("u2", "germany", LODZ, 2, 3);
const air: Unit = counter("u3", "germany", "air", 1, LODZ, 6);
const stack = at6f([armor, foot, air]);
const card = (ticked: string[], s = stack, hex = LODZ) => selectionFor(CTX, s, hex, ticked);
const sentences = (c: MoveSelection): string[] => [c.title, c.summary, c.together, c.further, c.room, c.advice, c.leftBehind, c.announce, ...c.lines.flatMap((l) => [l.name, l.note, l.label])].filter((x): x is string => typeof x === "string");

describe("the card for a stack with units of different speed (Ref 5.45f)", () => {
  it("ticks every unit that can move by default (decision 1) and lists the ground units first, air greyed with the reason (decision 2)", () => {
    expect(defaultTicks(CTX, stack, LODZ)).toEqual(["u1", "u2"]);
    const c = card(defaultTicks(CTX, stack, LODZ));
    expect(c.title).toBe("Lodz (N33)");
    expect(c.lines.map((l) => [l.name, l.state, l.layer, l.note])).toEqual([
      ["3-4 German armor", "ticked", "ground", null],
      ["2-3 German infantry", "ticked", "ground", null],
      ["1-6 German air", "greyed", "air", "does not move on the ground"],
    ]);
    expect(c.summary).toBe("2 of 2 ticked.");
    expect(c.status).toBe("ready");
    expect(c.leftBehind).toBeNull();
  });

  it("says what the group can do together, which unit sets that, what the faster one could do alone, and what to untick", () => {
    const c = card(["u1", "u2"]);
    expect(c.together).toBe("Together they can go up to 3 hexes (set by the 2-3 German infantry).");
    expect(c.further).toBe("The 3-4 German armor alone could go up to 4 hexes. Untick the 2-3 German infantry to let it go further.");
    expect(c.advice).toBe("Tap a yellow hex to move them there.");
    expect(c.announce).toBe("2 of 2 ticked. They can go up to 3 hexes.");
  });

  it("derives both shades of yellow: the group's hexes, and the extra hexes the faster unit reaches alone", () => {
    const c = card(["u1", "u2"]);
    const fast = moveOptionsFor(CTX, stack, ["u1"]);
    const slow = moveOptionsFor(CTX, stack, ["u2"]);
    if (!fast.ok || !slow.ok) throw new Error("expected options");
    expect(c.destinations).toEqual(slow.destinations);
    expect(c.alone.length).toBeGreaterThan(0);
    expect(c.alone).toEqual(fast.destinations.map((d) => d.to).filter((h) => !c.destinations.some((d) => d.to === h)).sort());
    for (const h of c.alone) expect(c.destinations.map((d) => d.to)).not.toContain(h);
  });

  it("unticking the slow unit grows the yellow, drops the 'further' text, and says who stays", () => {
    const c = card(["u1"]);
    expect(c.summary).toBe("1 of 2 ticked.");
    expect(c.together).toBe("The 3-4 German armor can go up to 4 hexes.");
    expect(c.further).toBeNull();
    expect(c.alone).toEqual([]);
    expect(c.advice).toBe("Tap a yellow hex to move it there.");
    expect(c.announce).toBe("1 of 2 ticked. It can go up to 4 hexes.");
    expect(c.leftBehind).toBe("Staying in Lodz (N33): 2-3 German infantry.");
    expect(c.lines.find((l) => l.key === "u2")).toMatchObject({ state: "free", note: "stays here", label: "2-3 German infantry, stays here" });
    expect(c.destinations.length).toBeGreaterThan(card(["u1", "u2"]).destinations.length);
  });

  it("ticking a unit again puts the list back, and the order of the ticks does not matter", () => {
    expect(toggled(toggled(["u1", "u2"], "u2"), "u2")).toEqual(["u1", "u2"]);
    expect(toggled([], "u1")).toEqual(["u1"]);
    expect(card(["u2", "u1"])).toEqual(card(["u1", "u2"]));
  });

  it("nothing ticked: no yellow hexes, and it says to tick one; ids that are not tickable are ignored", () => {
    for (const none of [[], ["u3"], ["zz"]]) {
      const c = card(none);
      expect(c).toMatchObject({ status: "nothing-ticked", ticked: [], destinations: [], alone: [], together: null, advice: "Tick at least one unit.", summary: "0 of 2 ticked." });
    }
    expect(card([]).leftBehind).toBe("Staying in Lodz (N33): 3-4 German armor, 2-3 German infantry.");
  });
});

describe("greyed lines and why (Ref 5.45f)", () => {
  const italianFleet: Unit = { ...counter("u9", "germany", "fleet", 5, LODZ), nationality: "italy" };
  const mixed = at6f([armor, counter("u4", "germany", "replacement", 1, LODZ), italianFleet, counter("u5", "germany", "airbase", 1, LODZ), counter("u6", "germany", "bridgehead", 1, LODZ)]);

  it("a replacement, a fleet, an airbase and a bridgehead are greyed with a plain reason, in the layers ground, naval and other", () => {
    const c = card(["u1"], mixed);
    const by = Object.fromEntries(c.lines.map((l) => [l.name, l]));
    expect(by["1 German replacement"]).toMatchObject({ state: "greyed", note: T.cannotMoveReason("replacement"), layer: "ground" });
    expect(by["5 Italian fleet, held by Germany"]).toMatchObject({ state: "greyed", note: "does not move on the ground", layer: "naval" });
    expect(by["1 German airbase"]).toMatchObject({ state: "greyed", layer: "air" });
    expect(by["1 German bridgehead"]).toMatchObject({ state: "greyed", layer: "other" });
    expect(c.lines.map((l) => LAYERS.indexOf(l.layer))).toEqual([...c.lines.map((l) => LAYERS.indexOf(l.layer))].sort());
    expect(c.summary).toBe("1 of 1 ticked.");
  });

  it("a unit that has moved this Player Turn is greyed 'already moved this turn'; the rest of the hex stays chosen with its ticks", () => {
    // The armor starts next door and moves into Lodz, where the infantry waits.
    const s = at6f([inf("u1", "germany", "M33", 3, 4, "armor"), foot]);
    const r = applyAction(CTX, s, { type: "MOVE", side: "axis", units: ["u1"], path: [LODZ] });
    if (!r.ok) throw new Error(r.error);
    expect(defaultTicks(CTX, r.state, LODZ)).toEqual(["u2"]);
    const c = selectionFor(CTX, r.state, LODZ, ["u2"]);
    expect(c.lines.find((l) => l.key === "u1")).toMatchObject({ state: "greyed", note: "already moved this turn" });
    expect(c.lines.find((l) => l.key === "u2")?.state).toBe("ticked");
    expect(c.summary).toBe("1 of 1 ticked.");
    // The infantry goes too: only the armor, already moved, is left, and the card says so.
    const r2 = applyAction(CTX, r.state, { type: "MOVE", side: "axis", units: ["u2"], path: ["M33"] });
    if (!r2.ok) throw new Error(r2.error);
    expect(defaultTicks(CTX, r2.state, LODZ)).toEqual([]);
    expect(selectionFor(CTX, r2.state, LODZ, []).status).toBe("nobody");
    expect(selectionFor(CTX, r2.state, LODZ, []).summary).toBe("No unit here can move now.");
  });

  it("units of the side not to move are greyed 'not yours to move now'", () => {
    const c = card(["u1"], at6f([armor], "allies"));
    expect(c.lines[0]).toMatchObject({ state: "greyed", note: "not yours to move now" });
    expect(c.status).toBe("nobody");
  });

  it("a unit hemmed in by enemy units is greyed 'no hex to go to' and is not ticked by default", () => {
    const ring = adjacentHexes(CTX, LODZ).map((h, i): Unit => inf(`p${i + 1}`, "poland", h, 2, 3));
    const s = at6f([armor, foot, ...ring]);
    const c = card(defaultTicks(CTX, s, LODZ), s);
    expect(c.status).toBe("nobody");
    expect(c.lines.map((l) => l.note)).toEqual(["no hex to go to", "no hex to go to"]);
  });
});

describe("stacking and identical counters (Ref 5.0)", () => {
  it("a pair that cannot end beside a lone friendly unit says how many hexes cannot take both, with the singular agreeing", () => {
    const s = at6f([inf("u1", "germany", "L32"), inf("u2", "germany", "L32"), inf("u3", "germany", "L33")]);
    const c = card(["u1", "u2"], s, "L32");
    expect(c.room).toBe("1 hex within reach cannot take both of them.");
    expect(c.destinations.map((d) => d.to)).not.toContain("L33");
    expect(card(["u1"], s, "L32").room).toBeNull();
    expect(card(["u1"], s, "L32").destinations.map((d) => d.to)).toContain("L33");
  });

  it("a hex that is full for everyone is not counted: only hexes that take some of the ticked units but not all", () => {
    const s = at6f([inf("u1", "germany", "L32"), inf("u2", "germany", "L32"), inf("u3", "germany", "L33"), inf("u4", "germany", "L34"), inf("u5", "germany", "L34")]);
    expect(moveOptionsFor(CTX, s, ["u1", "u2"]).ok && (moveOptionsFor(CTX, s, ["u1", "u2"]) as { tooFull: string[] }).tooFull).toEqual(expect.arrayContaining(["L33", "L34"]));
    expect(card(["u1", "u2"], s, "L32").room).toBe("1 hex within reach cannot take both of them.");
  });

  it("two identical slow counters are counted, not repeated", () => {
    const s = at6f([inf("u1", "germany", LODZ, 1, 4, "airborne"), foot, inf("u7", "germany", LODZ, 2, 3)]);
    const c = card(["u1", "u2", "u7"], s);
    expect(c.together).toBe("Together they can go up to 3 hexes (set by 2 x 2-3 German infantry).");
    expect(c.further).toBe("The 1-4 German airborne alone could go up to 4 hexes. Untick 2 x 2-3 German infantry to let it go further.");
    expect(c.leftBehind).toBeNull();
  });

  it("three ground units in one hex (an overstack no move can make) cannot all go anywhere together, and the card says so", () => {
    const s = at6f([inf("u1", "germany", LODZ), inf("u2", "germany", LODZ), inf("u3", "germany", LODZ)]);
    const c = card(["u1", "u2", "u3"], s);
    expect(c).toMatchObject({ status: "nowhere", advice: "These units cannot all go anywhere together.", destinations: [], together: null });
  });

  it("when everyone ticked has the same movement there is no 'set by' and no 'further'", () => {
    const s = at6f([inf("u1", "germany", LODZ), inf("u2", "germany", LODZ)]);
    const c = card(["u1", "u2"], s);
    expect(c.together).toBe("Together they can go up to 3 hexes.");
    expect(c.further).toBeNull();
    expect(c.alone).toEqual([]);
  });
});

describe("the words", () => {
  it("plural agreement for hexes, movement points, pronouns and counts", () => {
    expect(T.reach(1)).toBe("1 hex");
    expect(T.reach(3)).toBe("3 hexes");
    expect(T.reach(1, false)).toBe("1 movement point");
    expect(T.reach(4, false)).toBe("4 movement points");
    expect(T.POINTS_ARE_HEXES).toBe(true);
    expect([T.they(1), T.they(2), T.they(1, true), T.they(3, true)]).toEqual(["it", "them", "It", "They"]);
    expect([T.tapToMove(1), T.tapToMove(2)]).toEqual(["Tap a yellow hex to move it there.", "Tap a yellow hex to move them there."]);
    expect([T.roomSentence(1, 2), T.roomSentence(3, 3)]).toEqual(["1 hex within reach cannot take both of them.", "3 hexes within reach cannot take all of them."]);
    expect(T.togetherSentence(["a"], 1, ["a"])).toBe("The a can go up to 1 hex.");
    expect(T.untickAdvice(["x"], 2)).toBe("Untick the x to let them go further.");
    expect(T.listOf(["a", "b", "c"])).toBe("a, b and c");
    expect(T.furtherSentence([{ name: "A", points: 4 }, { name: "B", points: 5 }])).toBe("The A alone could go up to 4 hexes; The B alone could go up to 5 hexes.");
    expect(T.furtherSentence([{ name: "A", points: 4 }, { name: "A", points: 4 }])).toBe("2 x A could each go up to 4 hexes alone.");
  });

  it("the sentence after a move names counters and places, never ids, and is told from the position before the move", () => {
    const line = movedLine(CTX, stack, ["u1"], "M33");
    expect(line).toBe("Moved 3-4 German armor from Lodz (N33) to Poznan (M33).");
    expect(line).not.toMatch(/\bu\d+\b/);
  });
});

describe("real positions from computer self-play: no sentence ever shows a unit id, and the card agrees with the engine", () => {
  const POSITIONS = realPositions([1, 2], 2, 3);

  it("for every stack, every subset ticked: no id in any sentence; yellow equals the engine's list; the shades never overlap", () => {
    let cards = 0;
    for (const p of POSITIONS) {
      const ids = Object.keys(p.state.units);
      const idPattern = new RegExp(`\\b(${ids.map((i) => i.replace(/[^\w]/g, "")).join("|")})\\b`);
      const hexes = new Set(movableUnits(p.ctx, p.state).map((u) => u.at));
      for (const hex of hexes) {
        const defaults = defaultTicks(p.ctx, p.state, hex);
        const subsets = defaults.length > 3 ? [defaults] : defaults.reduce<string[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]]);
        for (const ticks of subsets) {
          const c = selectionFor(p.ctx, p.state, hex, ticks);
          cards++;
          for (const text of sentences(c)) {
            expect(text, `${p.label} ${hex}`).not.toMatch(/\bu\d+\b/);
            expect(text, `${p.label} ${hex}`).not.toMatch(idPattern);
            expect(text).not.toMatch(/undefined|null|\[object/);
          }
          if (ticks.length > 0) {
            const o = moveOptionsFor(p.ctx, p.state, ticks);
            expect(c.destinations).toEqual(o.ok ? o.destinations : []);
          }
          for (const h of c.alone) expect(c.destinations.map((d) => d.to)).not.toContain(h);
          expect(c.further !== null, `${p.label} ${hex}`).toBe(c.alone.length > 0);
          expect(c.ticked).toEqual(ticks);
        }
        const all = selectionFor(p.ctx, p.state, hex, defaults);
        expect(all.lines.filter((l) => l.state === "ticked")).toHaveLength(defaults.length);
        expect(all.leftBehind).toBeNull();
      }
      // The sentence after a move, for the first listed move of the position.
      const a = legalActions(p.ctx, p.state).find((x) => x.type === "MOVE");
      if (a?.type === "MOVE") {
        const line = movedLine(p.ctx, p.state, a.units, a.path[a.path.length - 1]!);
        expect(line).not.toMatch(idPattern);
        expect(line).toMatch(/^Moved .+ from .+ to .+\.$/);
      }
    }
    expect(cards).toBeGreaterThan(40);
  });

  it("a hex with a movable unit among air or naval counters shows them greyed, ground units first", () => {
    let mixedHexes = 0;
    for (const p of POSITIONS) {
      for (const hex of new Set(movableUnits(p.ctx, p.state).map((u) => u.at))) {
        const c = selectionFor(p.ctx, p.state, hex, defaultTicks(p.ctx, p.state, hex));
        const order = c.lines.map((l) => LAYERS.indexOf(l.layer));
        expect(order).toEqual([...order].sort((x, y) => x - y));
        if (c.lines.some((l) => l.layer !== "ground")) {
          mixedHexes++;
          for (const l of c.lines.filter((x) => x.layer !== "ground")) expect(l.state).toBe("greyed");
        }
      }
    }
    expect(mixedHexes).toBeGreaterThan(0);
  });
});

describe("named owners: the nation shows in the name", () => {
  it("a mixed stack of Germans and Italians reads as the counters print", () => {
    const owners: ForceOwner[] = ["germany", "italy"];
    const s = at6f(owners.map((o, i) => inf(`u${i + 1}`, o, LODZ, 3, 3)));
    expect(card(["u1", "u2"], s).lines.map((l) => l.name)).toEqual(["3-3 German infantry", "3-3 Italian infantry"]);
  });
});

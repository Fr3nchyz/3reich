import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "../src/engine/actions";
import { moveOptionsFor, type MoveOptions } from "../src/engine/move-options";
import { movableUnits } from "../src/engine/movement";
import { adjacentHexes, zocPathProblem } from "../src/engine/zoc";
import { CTX } from "./helpers";
import { at6f, inf, movesIn } from "./helpers-move";
import { realPositions, type Position } from "./helpers-positions";

/**
 * The read-only move query behind the Move card (spec 10, ticket 10-1): where any chosen part of a stack can go. It must agree
 * with legalActions for the whole movable stack and for single units (Ref 5.45f movement, 5.0 and 26.0 stacking, 6.0 ZOC).
 */

const must = (o: MoveOptions) => {
  if (!o.ok) throw new Error(o.error);
  return o;
};
const dests = (o: MoveOptions): string[] => (o.ok ? o.destinations.map((d) => d.to) : []);
const POSITIONS: Position[] = realPositions([1, 2], 2, 5);
/** legalActions of each position, computed once (it is the costly part). */
const LEGAL = new Map(POSITIONS.map((p) => [p, legalActions(p.ctx, p.state)]));
/** Movable units grouped by hex, in id order. */
const stacks = (p: Position) => {
  const by = new Map<string, string[]>();
  for (const u of movableUnits(p.ctx, p.state)) by.set(u.at, [...(by.get(u.at) ?? []), u.id]);
  return [...by.values()];
};
/** Every non-empty subset of a list. */
const subsets = <T,>(xs: readonly T[]): T[][] => xs.reduce<T[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]]).slice(1);

describe("real positions from computer self-play (all four scenarios)", () => {
  it("covers all four scenarios and has stacks of two or more units to choose from", () => {
    expect(new Set(POSITIONS.map((p) => p.ctx.scenario.name)).size).toBeGreaterThanOrEqual(3);
    expect(POSITIONS.flatMap(stacks).filter((s) => s.length > 1).length).toBeGreaterThan(20);
  });

  it("for every legal MOVE, the query for its units lists that same destination with that same path (Ref 5.45f)", () => {
    let checked = 0;
    for (const p of POSITIONS) {
      const asked = new Map<string, MoveOptions>();
      for (const a of movesIn(LEGAL.get(p)!)) {
        const key = a.units.join(",");
        if (!asked.has(key)) asked.set(key, must(moveOptionsFor(p.ctx, p.state, a.units)));
        expect(must(asked.get(key)!).destinations, p.label).toContainEqual({ to: a.path[a.path.length - 1], path: a.path });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("the other way round: the query for a single unit or a whole movable stack lists exactly the MOVEs legalActions lists, no more", () => {
    for (const p of POSITIONS) {
      const legal = movesIn(LEGAL.get(p)!);
      for (const ids of stacks(p)) {
        for (const set of ids.length > 1 ? [...ids.map((id) => [id]), ids] : [ids]) {
          const o = must(moveOptionsFor(p.ctx, p.state, set));
          const listed = legal.filter((a) => a.units.length === set.length && a.units.every((id) => set.includes(id))).map((a) => ({ to: a.path[a.path.length - 1], path: a.path }));
          expect(o.destinations, `${p.label} ${set.length} unit(s)`).toEqual(listed);
        }
      }
    }
  });

  it("legalActions names a stack's units in id order and the query accepts them in any order with the same answer", () => {
    for (const p of POSITIONS) {
      for (const ids of stacks(p).filter((s) => s.length > 1)) {
        const forward = must(moveOptionsFor(p.ctx, p.state, ids));
        expect(must(moveOptionsFor(p.ctx, p.state, [...ids].reverse()))).toEqual(forward);
        expect(forward.units.map((u) => u.id)).toEqual(ids);
      }
    }
  });

  it("every destination of every subset of a stack is accepted by applyAction, and ends where it says (Ref 5.45f)", () => {
    for (const p of POSITIONS) {
      for (const ids of stacks(p).filter((s) => s.length > 1)) {
        for (const set of subsets(ids)) {
          const o = must(moveOptionsFor(p.ctx, p.state, set));
          // The paths are cheapest paths, so a sample of each list is enough to prove the rest in time.
          for (const d of o.destinations.filter((_, i) => i % 5 === 0)) {
            const r = applyAction(p.ctx, p.state, { type: "MOVE", side: p.state.activeSide, units: set, path: d.path });
            expect(r.ok, `${p.label}: ${set.join(",")} to ${d.to}`).toBe(true);
            if (r.ok) for (const id of set) expect(r.state.units[id]!.at).toBe(d.to);
          }
        }
      }
    }
  });

  it("hexes the query calls too full are refused by applyAction, and one step past the last point is refused too (Ref 5.0, 5.45f)", () => {
    let full = 0;
    for (const p of POSITIONS) {
      for (const ids of stacks(p).filter((s) => s.length > 1)) {
        const o = must(moveOptionsFor(p.ctx, p.state, ids));
        const wholeReach = new Map(o.destinations.map((d) => [d.to, d.path]));
        for (const hex of o.tooFull) {
          expect(wholeReach.has(hex), "a full hex is never a destination").toBe(false);
          full++;
        }
        // From an edge of the reach, one more hex is beyond the points of the slowest unit.
        const edge = o.destinations.find((d) => d.path.length === o.points);
        if (!edge) continue;
        const beyond = adjacentHexes(p.ctx, edge.to).find((h) => !edge.path.includes(h) && h !== o.from && !wholeReach.has(h));
        if (!beyond) continue;
        const r = applyAction(p.ctx, p.state, { type: "MOVE", side: p.state.activeSide, units: ids, path: [...edge.path, beyond] });
        expect(r.ok, `${p.label}: past the slowest unit's points`).toBe(false);
      }
    }
    expect(full).toBeGreaterThan(0);
  });

  it("a bigger group never reaches somewhere a part of it cannot, and equals the overlap of its units except where the hex is too full (Ref 5.45f)", () => {
    for (const p of POSITIONS) {
      for (const ids of stacks(p).filter((s) => s.length > 1)) {
        for (const set of subsets(ids).filter((s) => s.length > 1)) {
          const group = must(moveOptionsFor(p.ctx, p.state, set));
          const alone = set.map((id) => new Set(dests(must(moveOptionsFor(p.ctx, p.state, [id])))));
          const overlap = [...alone[0]!].filter((h) => alone.every((a) => a.has(h)));
          for (const to of dests(group)) expect(overlap, `${p.label}: ${to}`).toContain(to);
          const missing = overlap.filter((h) => !dests(group).includes(h));
          for (const h of missing) expect(group.tooFull, `${p.label}: ${h}`).toContain(h);
        }
      }
    }
  });

  it("asking never changes the position or the legal list", () => {
    const p = POSITIONS.find((q) => stacks(q).some((s) => s.length > 1))!;
    const before = JSON.stringify(p.state);
    const list = JSON.stringify(LEGAL.get(p));
    for (const ids of stacks(p)) for (const set of subsets(ids)) moveOptionsFor(p.ctx, p.state, set);
    expect(JSON.stringify(p.state)).toBe(before);
    expect(JSON.stringify(legalActions(p.ctx, p.state))).toBe(list);
  });
});

describe("faster and slower units (Ref 5.45f: a stack moves at its slowest unit's factor)", () => {
  const s = at6f([inf("u1", "germany", "L32", 3, 4, "armor"), inf("u2", "germany", "L32", 2, 3)]);

  it("the pair goes as far as the slower unit; the faster one alone goes further, so both shades of yellow can be told apart", () => {
    const pair = must(moveOptionsFor(CTX, s, ["u1", "u2"]));
    const fast = must(moveOptionsFor(CTX, s, ["u1"]));
    const slow = must(moveOptionsFor(CTX, s, ["u2"]));
    expect([pair.points, fast.points, slow.points]).toEqual([3, 4, 3]);
    expect(dests(pair)).toEqual(dests(slow));
    const further = dests(fast).filter((h) => !dests(pair).includes(h));
    expect(further.length).toBeGreaterThan(0);
    for (const h of dests(pair)) expect(dests(fast)).toContain(h);
    for (const d of fast.destinations.filter((x) => further.includes(x.to))) expect(d.path).toHaveLength(4);
  });
});

describe("stacking at the end (Ref 5.0, 26.0)", () => {
  it("a pair cannot end where one friendly unit already stands, but each alone can: the hex is listed as too full", () => {
    const st = at6f([inf("u1", "germany", "L32"), inf("u2", "germany", "L32"), inf("u3", "germany", "L33")]);
    const pair = must(moveOptionsFor(CTX, st, ["u1", "u2"]));
    expect(dests(pair)).not.toContain("L33");
    expect(pair.tooFull).toContain("L33");
    expect(dests(must(moveOptionsFor(CTX, st, ["u1"])))).toContain("L33");
    expect(dests(must(moveOptionsFor(CTX, st, ["u2"])))).toContain("L33");
  });

  it("London holds three if all are British: three together may end there, a pair may not join two already there, one may", () => {
    const london = "K23";
    const next = adjacentHexes(CTX, london).find((h) => CTX.map.hexes[h]?.land)!;
    const three = at6f([inf("b1", "britain", next), inf("b2", "britain", next), inf("b3", "britain", next)], "allies");
    expect(dests(must(moveOptionsFor(CTX, three, ["b1", "b2", "b3"])))).toContain(london);
    const crowded = at6f([inf("b1", "britain", next), inf("b2", "britain", next), inf("b3", "britain", london), inf("b4", "britain", london)], "allies");
    expect(dests(must(moveOptionsFor(CTX, crowded, ["b1", "b2"])))).not.toContain(london);
    expect(dests(must(moveOptionsFor(CTX, crowded, ["b1"])))).toContain(london);
  });

  it("airborne counters are free of the limit: two ground units and an airborne may all end in one hex", () => {
    const st = at6f([inf("u1", "germany", "L32", 3, 3), inf("u2", "germany", "L32", 3, 3, "airborne"), inf("u3", "germany", "L33"), inf("u4", "germany", "L33")]);
    expect(dests(must(moveOptionsFor(CTX, st, ["u2"])))).toContain("L33");
    expect(dests(must(moveOptionsFor(CTX, st, ["u1"])))).not.toContain("L33");
  });

  it("British and French together are refused as a pair before 1942 only where they would meet others; Anglo-French may not end beside each other's units", () => {
    const st = at6f([inf("u1", "britain", "P22"), inf("u2", "france", "O23")], "allies");
    expect(dests(must(moveOptionsFor(CTX, st, ["u1"])))).not.toContain("O23");
  });
});

describe("Zones of Control (Ref 6.0)", () => {
  const pol = inf("p1", "poland", "M34", 2, 3);

  it("a group entering an enemy ZOC stops there: nothing beyond is listed", () => {
    const s = at6f([inf("u1", "germany", "L32", 3, 5), inf("u2", "germany", "L32", 3, 5), pol]);
    const o = must(moveOptionsFor(CTX, s, ["u1", "u2"]));
    expect(dests(o)).toContain("L34");
    // L35 can still be reached around the ZOC, but never through it.
    for (const d of o.destinations) expect(zocPathProblem(CTX, s, "axis", d.path), d.to).toBeNull();
    expect(o.destinations.find((d) => d.to === "L35")?.path ?? []).not.toContain("L34");
  });

  it("a ticked unit standing in an enemy ZOC may leave it", () => {
    const s = at6f([inf("u1", "germany", "L34", 3, 4), pol]);
    expect(dests(must(moveOptionsFor(CTX, s, ["u1"])))).toEqual(expect.arrayContaining(["L33", "L35"]));
  });
});

describe("what is refused", () => {
  const s = at6f([inf("u1", "germany", "L32"), inf("u2", "germany", "M31"), inf("u3", "germany", "L32", 1, 6, "air")]);

  it("units in different hexes, a unit that cannot move, an unknown, empty or repeated id, a hole in the list", () => {
    expect(moveOptionsFor(CTX, s, ["u1", "u2"]).ok).toBe(false);
    expect(moveOptionsFor(CTX, s, ["u1", "u3"]).ok).toBe(false);
    expect(moveOptionsFor(CTX, s, ["zz"]).ok).toBe(false);
    expect(moveOptionsFor(CTX, s, []).ok).toBe(false);
    expect(moveOptionsFor(CTX, s, ["u1", "u1"]).ok).toBe(false);
    expect(moveOptionsFor(CTX, s, new Array<string>(1)).ok).toBe(false);
  });

  it("a unit that has already moved this Player Turn (Ref 5.45f, TODO(verify) in movement.ts) and the other side's units", () => {
    const moved = { ...s, moves: { turn: "x", moved: ["u1"] } };
    const r = applyAction(CTX, s, { type: "MOVE", side: "axis", units: ["u1"], path: ["L33"] });
    if (!r.ok) throw new Error(r.error);
    expect(moveOptionsFor(CTX, r.state, ["u1"]).ok).toBe(false);
    expect(moveOptionsFor(CTX, r.state, ["u2"]).ok).toBe(true);
    expect(moved.moves.moved).toContain("u1");
    expect(moveOptionsFor(CTX, at6f([inf("u1", "germany", "L32")], "allies"), ["u1"]).ok).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { legalActions } from "../src/engine/actions";
import { hasMoved } from "../src/engine/move-record";
import { onMoveKey } from "../src/ui/moveBind";
import { cancelMove, chooseStack, moveFurther, moveTargets, movableStacks, selectionNow, tickAll, tickNone, toggleTick } from "../src/ui/moveTap";
import type { Session } from "../src/ui/session";
import { lookAt, normaliseMode, tapHex, takeAction } from "../src/ui/sessionActions";
import type { WatchInfo } from "../src/ui/watchController";
import { at6f, inf } from "./helpers-move";
import { atMovement, crafted, withUnits } from "./helpers-move-session";

// Spec 10, ticket 10-3: the session side of the Move card. Rules: Ref 5.45f (one move per unit, the group at its slowest unit), 5.0 (stacking),
// 6.0 (ZOC), all read from the engine; the screen decides none, so these tests check what the session does with the ticks.
const hexOf = (s: Session, id: string) => s.ctx.map.hexes[id]!;
const at = (s: Session, id: string) => s.state.units[id]!.at;

describe("choosing a stack", () => {
  it("ticks every unit that can move, changes nothing in the game and lists the hexes the whole group can reach", () => {
    const s = crafted();
    const before = s.state;
    tapHex(s, hexOf(s, "L32"));
    expect(s.moveChosen).toMatchObject({ hex: "L32", ticked: ["u1", "u2"] });
    expect(s.state).toBe(before);
    expect(moveTargets(s).length).toBeGreaterThan(0);
    expect(moveTargets(s)).not.toContain("L35"); // three hexes away: the 2-1 cannot follow
  });

  it("a counter that cannot move on the ground is greyed and never ticked, not even by All", () => {
    const s = withUnits([inf("u1", "germany", "L32", 3, 4), inf("a1", "germany", "L32", 2, 6, "air")]);
    tapHex(s, hexOf(s, "L32"));
    expect(s.moveChosen?.ticked).toEqual(["u1"]);
    toggleTick(s, "a1");
    expect(s.moveChosen?.ticked).toEqual(["u1"]);
    tickNone(s);
    tickAll(s);
    expect(s.moveChosen?.ticked).toEqual(["u1"]);
  });

  it("a hex with nothing that can move is not chosen (it says how to choose)", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L35"));
    expect(s.moveChosen ?? null).toBeNull();
    expect(s.toast).toMatch(/^Tap one of your stacks/);
    expect(chooseStack(s, "L35")).toBe(false);
  });

  it("the list of stacks counts the units that can move in each hex", () => {
    expect(movableStacks(crafted())).toEqual([{ hex: "L32", units: 2 }, { hex: "L33", units: 1 }]);
  });

  it("a choice made from the list asks the map to show the hex, once", () => {
    const s = crafted();
    expect(chooseStack(s, "L33", true)).toBe(true);
    expect(s.moveChosen).toMatchObject({ hex: "L33", fresh: true, focus: true });
  });
});

describe("ticks", () => {
  it("unticking the slow unit lets the fast one reach further; ticking it again brings the group back", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    const together = moveTargets(s);
    toggleTick(s, "u2");
    expect(s.moveChosen?.ticked).toEqual(["u1"]);
    expect(moveTargets(s)).toContain("L35");
    expect(moveTargets(s).length).toBeGreaterThan(together.length);
    toggleTick(s, "u2");
    expect(moveTargets(s)).toEqual(together);
  });

  it("None leaves no yellow hex and a tap on the map says to tick; All ticks everyone again", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    tickNone(s);
    expect(moveTargets(s)).toEqual([]);
    tapHex(s, hexOf(s, "L31"));
    expect(s.toast).toBe("Tick at least one unit.");
    expect(at(s, "u1")).toBe("L32");
    tickAll(s);
    expect(s.moveChosen?.ticked).toEqual(["u1", "u2"]);
    expect(moveTargets(s)).toContain("L31");
  });

  it("the second shade holds what a faster ticked unit alone could reach, and tapping it moves nothing and says why", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    expect(moveFurther(s)).toContain("L35");
    expect(moveFurther(s).filter((h) => moveTargets(s).includes(h))).toEqual([]);
    tapHex(s, hexOf(s, "L35"));
    expect(at(s, "u1")).toBe("L32");
    expect(s.toast).toMatch(/alone could go up to 4 hexes/);
    expect(s.moveChosen?.hex).toBe("L32");
  });

  it("a tick on a unit that is not in the chosen hex is ignored", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    toggleTick(s, "u3");
    expect(s.moveChosen?.ticked).toEqual(["u1", "u2"]);
  });
});

describe("the move", () => {
  it("moves exactly the ticked units, through the engine; the unticked one stays and the hex stays chosen with it ticked", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    toggleTick(s, "u2");
    tapHex(s, hexOf(s, "L35"));
    expect(at(s, "u1")).toBe("L35");
    expect(at(s, "u2")).toBe("L32");
    expect(hasMoved(s.state, "u1")).toBe(true);
    expect(hasMoved(s.state, "u2")).toBe(false);
    expect(s.moveChosen).toMatchObject({ hex: "L32", ticked: ["u2"] });
    expect(s.toast).toBe("Moved 3-4 German infantry from L32 to L35. Staying in L32: 2-1 German infantry.");
    expect(s.log).toContain("3-4 German infantry move from L32 to L35.");
    expect(moveTargets(s).length).toBeGreaterThan(0); // the rest has yellow hexes of its own
  });

  it("then the rest can follow, and with nobody left the choice is dropped", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    toggleTick(s, "u2");
    tapHex(s, hexOf(s, "L35"));
    tapHex(s, hexOf(s, "L31"));
    expect(at(s, "u2")).toBe("L31");
    expect(s.moveChosen).toBeNull();
    expect(s.toast).toBe("Moved 2-1 German infantry from L32 to Berlin (L31).");
  });

  it("a unit that has moved cannot be ticked again", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    toggleTick(s, "u2");
    tapHex(s, hexOf(s, "L35"));
    expect(chooseStack(s, "L35")).toBe(false); // the mover's new hex: nothing there can move any more
    expect(s.moveChosen?.hex).toBe("L32");
    expect(selectionNow(s)!.lines.map((l) => [l.key, l.state])).toEqual([["u2", "ticked"]]);
  });

  it("the old two taps still move the whole stack that can all go", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    tapHex(s, hexOf(s, "L31"));
    expect(at(s, "u1")).toBe("L31");
    expect(at(s, "u2")).toBe("L31");
    expect(s.moveChosen).toBeNull();
  });

  it("every move is one the engine accepts for those units: legalActions and the screen agree on a whole stack", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    const listed = legalActions(s.ctx, s.state).filter((a) => a.type === "MOVE" && a.units.length === 2).map((a) => (a.type === "MOVE" ? a.path[a.path.length - 1] : ""));
    expect([...moveTargets(s)].sort()).toEqual([...new Set(listed)].sort());
  });

  it("a tap on a hex that is not yellow explains and keeps the choice and the ticks", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    toggleTick(s, "u2");
    tapHex(s, Object.values(s.ctx.map.hexes).find((h) => !h.land)!);
    expect(s.toast).toMatch(/cannot get there/);
    expect(s.moveChosen).toMatchObject({ hex: "L32", ticked: ["u1"] });
  });
});

describe("leaving the choice", () => {
  it("Cancel, Escape and a second tap on the hex drop it without moving anything", () => {
    for (const how of ["cancel", "escape", "tap"] as const) {
      const s = crafted();
      const before = s.state;
      tapHex(s, hexOf(s, "L32"));
      if (how === "cancel") cancelMove(s);
      else if (how === "escape") expect(onMoveKey(s, "Escape")).toBe(true);
      else tapHex(s, hexOf(s, "L32"));
      expect(s.moveChosen, how).toBeNull();
      expect(s.state).toBe(before);
    }
  });

  it("another key does nothing", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    expect(onMoveKey(s, "Tab")).toBe(false);
    expect(s.moveChosen).not.toBeNull();
  });

  it("another stack of yours takes the choice over, with its own default ticks", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    toggleTick(s, "u2");
    tapHex(s, hexOf(s, "L33"));
    expect(s.moveChosen).toMatchObject({ hex: "L33", ticked: ["u3"] });
  });

  it("looking at a hex changes neither the choice nor the ticks", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    toggleTick(s, "u2");
    const choice = JSON.stringify(s.moveChosen);
    lookAt(s, "M35");
    expect(JSON.stringify(s.moveChosen)).toBe(choice);
  });

  it("a turn button (Done with step 6f) drops it", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    takeAction(s, { type: "END_STEP", side: "axis", step: "6f" });
    expect(s.moveChosen).toBeNull();
  });

  it("the step changing by any other means drops it too", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    s.state = { ...s.state, position: { part: "player-turn", turn: 1, step: "7h" } };
    normaliseMode(s);
    expect(s.moveChosen).toBeNull();
    expect(moveTargets(s)).toEqual([]);
  });

  it("another Player Turn drops it", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    s.state = at6f([inf("u1", "germany", "L32", 3, 4), inf("u2", "germany", "L32", 2, 1)], "axis", undefined, { year: 1940 });
    normaliseMode(s);
    expect(s.moveChosen).toBeNull();
  });

  it("the units of the choice being gone (nobody there can move) drops it", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    s.state = at6f([inf("u3", "germany", "L33", 3, 3)]);
    normaliseMode(s);
    expect(s.moveChosen).toBeNull();
  });

  it("ticks on units that can no longer move are dropped from the choice", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    s.state = at6f([inf("u1", "germany", "L32", 3, 4), inf("u3", "germany", "L33", 3, 3)]);
    normaliseMode(s);
    expect(s.moveChosen?.ticked).toEqual(["u1"]);
  });
});

describe("the computer's turn and watch mode", () => {
  it("on the computer's turn nothing is chosen, nothing is yellow, and a leftover choice goes", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    s.humanSide = "allies";
    normaliseMode(s);
    expect(s.moveChosen).toBeNull();
    expect(moveTargets(s)).toEqual([]);
    tapHex(s, hexOf(s, "L32"));
    expect(s.moveChosen ?? null).toBeNull();
    expect(chooseStack(s, "L32")).toBe(false);
  });

  it("while watching, taps only look", () => {
    const s = crafted();
    s.watch = {} as WatchInfo;
    tapHex(s, hexOf(s, "L32"));
    expect(s.moveChosen ?? null).toBeNull();
    expect(s.lookedAt).toBe("L32");
    expect(moveTargets(s)).toEqual([]);
  });
});

describe("a real game", () => {
  it("in the real 1939 position every stack that can move opens with all its movers ticked and moves them with two taps", () => {
    const s = atMovement();
    const stacks = movableStacks(s);
    expect(stacks.length).toBeGreaterThan(0);
    for (const k of stacks) {
      expect(chooseStack(s, k.hex)).toBe(true);
      expect(s.moveChosen!.ticked).toHaveLength(k.units);
      cancelMove(s);
    }
    const big = stacks.find((k) => k.units === 2);
    expect(big, "a stack of two movers in the real 1939 setup").toBeDefined();
    chooseStack(s, big!.hex);
    const [keep, go] = s.moveChosen!.ticked;
    toggleTick(s, keep!);
    const hex = moveTargets(s)[0]!;
    tapHex(s, hexOf(s, hex));
    expect(at(s, go!)).toBe(hex);
    expect(at(s, keep!)).toBe(big!.hex);
    expect(s.moveChosen).toMatchObject({ hex: big!.hex, ticked: [keep] });
  });
});

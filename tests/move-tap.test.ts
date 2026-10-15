import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { legalActions } from "../src/engine/actions";
import { moveListStats } from "../src/engine/move-action";
import type { MapView } from "../src/ui/mapView";
import { syncMap } from "../src/ui/mapSync";
import { at6f, inf } from "./helpers-move";
import { moveTargets, movesNow } from "../src/ui/moveTap";
import { createSession, setupView, type Session } from "../src/ui/session";
import { fillRest, finishOwner, tapHex, takeAction } from "../src/ui/sessionActions";
import { statusHtml } from "../src/ui/statusView";

// The tap flow at step 6f: tap a stack, its destinations are outlined, tap one. Every move is a legal MOVE of the engine.

function atMovement(): Session {
  const s = createSession(SCENARIO_1939, "axis", 1);
  for (let i = 0; i < 20 && s.state.phase === "setup"; i++) {
    fillRest(s);
    const v = setupView(s);
    if (v) finishOwner(s, v.owner);
  }
  for (const step of ["1", "3"]) if (s.state.position?.part === "player-turn" && s.state.position.step === step) takeAction(s, { type: "END_STEP", side: "axis", step });
  expect(s.state.position).toMatchObject({ step: "6f" });
  return s;
}
const hexOf = (s: Session, id: string) => s.ctx.map.hexes[id]!;

describe("tapping a stack and then a destination (step 6f)", () => {
  it("outlines the destinations of the tapped stack and moves it on the second tap", () => {
    const s = atMovement();
    const m = movesNow(s).find((a) => a.units.length === 1)!;
    const unit = s.state.units[m.units[0]!]!;
    tapHex(s, hexOf(s, unit.at));
    expect(s.moveFrom).toBe(unit.at);
    const targets = moveTargets(s);
    expect(targets).toContain(m.path[m.path.length - 1]);
    tapHex(s, hexOf(s, m.path[m.path.length - 1]!));
    expect(s.toast).not.toMatch(/cannot/);
    expect(s.moveFrom).toBeNull();
    expect(s.state.units[unit.id]!.at).toBe(m.path[m.path.length - 1]);
  });

  it("tapping a hex that is not a destination of the chosen stack explains and keeps the choice", () => {
    const s = atMovement();
    const m = movesNow(s)[0]!;
    const from = s.state.units[m.units[0]!]!.at;
    tapHex(s, hexOf(s, from));
    tapHex(s, Object.values(s.ctx.map.hexes).find((h) => !h.land)!);
    expect(s.moveFrom).toBe(from);
    expect(s.toast).toMatch(/cannot get there/);
  });

  it("shows no button for the moves, and says how to move", () => {
    const s = atMovement();
    const html = statusHtml(s, null, legalActions(s.ctx, s.state));
    expect(html).toContain("Ground movement (step 6f)");
    expect(html).not.toMatch(/>MOVE</);
  });
});

// Crafted positions: u1 (3-4) and u2 (2-1) stand together in L32, u3 alone in L33, nothing is near an enemy.
function crafted(): Session {
  const s = atMovement();
  s.state = at6f([inf("u1", "germany", "L32", 3, 4), inf("u2", "germany", "L32", 2, 1), inf("u3", "germany", "L33", 3, 3)]);
  s.moveFrom = null;
  s.toast = "";
  s.log = [];
  return s;
}
const highlights = (s: Session): string[] => {
  let got: string[] = [];
  const view = { setUnits() {}, focus() {}, setHighlights: (ids: Iterable<string>) => { got = [...ids]; } } as unknown as MapView;
  syncMap(view, s, null);
  return got;
};

describe("the tap flow in detail", () => {
  it("moves the whole stack when it can, and says so when only part of it can go", () => {
    const whole = crafted();
    tapHex(whole, hexOf(whole, "L32"));
    tapHex(whole, hexOf(whole, "L31"));
    expect(whole.state.units.u1!.at).toBe("L31");
    expect(whole.state.units.u2!.at).toBe("L31");
    expect(whole.toast).toBe("");
    const part = crafted();
    tapHex(part, hexOf(part, "L32"));
    tapHex(part, hexOf(part, "L35")); // three hexes: only the 4-factor unit has the points
    expect(part.state.units.u1!.at).toBe("L35");
    expect(part.state.units.u2!.at).toBe("L32");
    expect(part.toast).toMatch(/^Only 3-4 German infantry could get there; the rest of the stack stays\.$/);
  });

  it("logs the move", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L33")); // u3 alone
    tapHex(s, hexOf(s, "L34"));
    expect(s.log).toContain("3-3 German infantry move from L33 to L34.");
  });

  it("tapping the chosen stack again lets it go, without a message", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    tapHex(s, hexOf(s, "L32"));
    expect(s.moveFrom).toBeNull();
    expect(s.toast).toBe("");
  });

  it("tapping another stack of yours chooses it, even when it stands on a yellow hex", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    expect(moveTargets(s)).toContain("L33"); // u3's hex is a destination of the first stack (it has room for one more)
    tapHex(s, hexOf(s, "L33"));
    expect(s.moveFrom).toBe("L33");
    expect(s.state.units.u1!.at).toBe("L32");
  });

  it("a hex with nothing to choose and nothing chosen explains how", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L35"));
    expect(s.toast).toMatch(/Tap one of your stacks/);
    expect(s.moveFrom).toBeNull();
  });

  it("outlines the chosen stack's destinations on the map and nothing before it is chosen", () => {
    const s = crafted();
    expect(highlights(s)).toEqual([]);
    tapHex(s, hexOf(s, "L33"));
    expect(highlights(s)).toEqual(moveTargets(s));
    expect(highlights(s)).toContain("L34");
  });

  it("a turn button lets the choice go", () => {
    const s = crafted();
    tapHex(s, hexOf(s, "L32"));
    takeAction(s, { type: "END_STEP", side: "axis", step: "6f" });
    expect(s.moveFrom).toBeNull();
  });

  it("lists the moves once per game state: selecting, outlining and moving cost one listing", () => {
    const s = crafted();
    const before = moveListStats.computed;
    legalActions(s.ctx, s.state); // what the render does
    tapHex(s, hexOf(s, "L32"));
    highlights(s);
    legalActions(s.ctx, s.state);
    tapHex(s, hexOf(s, "L31"));
    expect(moveListStats.computed - before).toBe(1);
    legalActions(s.ctx, s.state); // the render after the move: a new state, one more listing
    highlights(s);
    expect(moveListStats.computed - before).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { legalActions } from "../src/engine/actions";
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
    expect(s.toast).toBe("");
    expect(s.moveFrom).toBeNull();
    expect(s.state.units[unit.id]!.at).toBe(m.path[m.path.length - 1]);
  });

  it("tapping a hex that is not a destination of the chosen stack, or has nothing that can move, explains and clears", () => {
    const s = atMovement();
    const m = movesNow(s)[0]!;
    tapHex(s, hexOf(s, s.state.units[m.units[0]!]!.at));
    const sea = Object.values(s.ctx.map.hexes).find((h) => !h.land)!;
    tapHex(s, sea);
    expect(s.moveFrom).toBeNull();
    expect(s.toast).toMatch(/Tap one of your stacks/);
  });

  it("shows no button for the moves, and says how to move", () => {
    const s = atMovement();
    const html = statusHtml(s, null, legalActions(s.ctx, s.state));
    expect(html).toContain("Ground movement (step 6f)");
    expect(html).not.toMatch(/>MOVE</);
  });
});

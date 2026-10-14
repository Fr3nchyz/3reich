import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions } from "../src/engine/actions";
import type { Side } from "../src/engine/types";
import { computerSide, computerTick, computerToMove } from "../src/ui/computerPlay";
import { createSession, setupView, type Session } from "../src/ui/session";
import { fillRest, finishOwner, tapHex } from "../src/ui/sessionActions";
import { statusHtml } from "../src/ui/statusView";
import { MAP } from "../src/data/map";

/** The computer plays the side the player did not pick (spec 05, roadmap phase 7). */

function inPlay(human: Side): Session {
  const s = createSession(SCENARIO_1939, human, 3);
  for (let i = 0; i < 20 && s.state.phase === "setup"; i++) {
    fillRest(s);
    const v = setupView(s);
    if (v) finishOwner(s, v.owner);
  }
  expect(s.state.phase).toBe("player-turn");
  return s;
}

describe("the computer's turns in the browser", () => {
  it("plays the side the player did not pick", () => {
    expect(computerSide(createSession(SCENARIO_1939, "axis", 1))).toBe("allies");
    expect(computerSide(createSession(SCENARIO_1939, "allies", 1))).toBe("axis");
  });

  for (const human of ["axis", "allies"] as const) {
    it(`${human} player: the other side's turn is played step by step, logged with reasons, and then the player is up`, () => {
      const s = inPlay(human);
      // Make it the computer's turn: if the player is first, the player ends the turn.
      for (let i = 0; i < 20 && !computerToMove(s); i++) {
        const { state } = s;
        const a = legalActions(s.ctx, state).at(-1)!;
        expect(["END_STEP", "END_PLAYER_TURN"]).toContain(a.type);
        s.state = applied(s, a);
      }
      expect(computerToMove(s)).toBe(true);
      const html = statusHtml(s, null, []);
      expect(html).toContain("Computer is playing");
      expect(html).not.toContain("data-action");
      const logBefore = s.log.length;
      let ticks = 0;
      for (; computerToMove(s) && ticks < 20; ticks++) expect(computerTick(s)).toBe(true);
      expect(computerToMove(s)).toBe(false);
      expect(ticks).toBeGreaterThan(0);
      expect(s.toast).toBe("");
      expect(s.log.slice(logBefore).some((l) => l.startsWith("Computer ("))).toBe(true);
      expect(statusHtml(s, null, legalActions(s.ctx, s.state))).not.toContain("Computer is playing");
    });
  }

  it("a tap on the map during the computer's turn changes nothing", () => {
    const s = inPlay("allies");
    expect(computerToMove(s)).toBe(true);
    const before = JSON.stringify(s.state);
    for (const h of Object.values(MAP.hexes).slice(0, 50)) tapHex(s, h);
    expect(JSON.stringify(s.state)).toBe(before);
  });
});

function applied(s: Session, a: ReturnType<typeof legalActions>[number]) {
  const r = applyAction(s.ctx, s.state, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

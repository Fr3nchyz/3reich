import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { applyAction, legalActions } from "../src/engine/actions";
import type { Side } from "../src/engine/types";
import { computerSide, computerTick, computerToMove } from "../src/ui/computerPlay";
import { createSession, setupView, type Session } from "../src/ui/session";
import { builds, fillRest, finishOwner, pickBuild, tapHex } from "../src/ui/sessionActions";
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
      for (; computerToMove(s) && ticks < 20; ticks++) expect(computerTick(s, 1e9)).not.toBe("stuck");
      expect(computerToMove(s)).toBe(false);
      expect(ticks).toBeGreaterThan(0);
      expect(s.toast).toBe("");
      expect(s.log.slice(logBefore).some((l) => l.startsWith("Computer ("))).toBe(true);
      expect(statusHtml(s, null, legalActions(s.ctx, s.state))).not.toContain("Computer is playing");
    });
  }

  it("a tap on the map during the computer's turn builds nothing, even with a build chosen", () => {
    const s = inPlay("allies");
    expect(computerToMove(s)).toBe(true);
    // Bring the computer's turn to its construction step and choose a build, as a tap would need.
    toConstruction(s);
    pickBuild(s, "germany:infantry:3");
    const target = builds(s).find((a) => a.owner === "germany" && a.unit.type === "infantry" && a.unit.strength === 3)!;
    expect(target, "an unguarded tap here would build").toBeDefined();
    const before = JSON.stringify(s.state);
    tapHex(s, MAP.hexes[target.at]!);
    expect(JSON.stringify(s.state)).toBe(before);
  });

  it("a tick yields when its time budget is spent and the next one carries on", () => {
    const s = inPlay("allies");
    let clock = 0;
    const slow = () => (clock += 100);
    // The steps before construction (declarations, Front Options) are one action each: they finish within a tick.
    toConstruction(s, slow);
    const result = computerTick(s, 50, slow);
    expect(result).toBe("more"); // construction needs many actions
    const builtAfterFirst = Object.keys(s.state.units).length;
    for (let i = 0; i < 200 && computerToMove(s); i++) computerTick(s, 50, slow);
    expect(Object.keys(s.state.units).length).toBeGreaterThan(builtAfterFirst);
    expect(computerToMove(s)).toBe(false);
  });

  it("does not start an action whose predecessor cost more than the budget has left", () => {
    const s = inPlay("allies");
    toConstruction(s);
    // Clock readings in the order the tick takes them: start, before and after the first action (50 ms), then the budget check twice.
    const readings = [0, 0, 50, 50, 50, 50, 50, 50];
    const scripted = () => readings.shift() ?? 50;
    const before = Object.keys(s.state.units).length;
    expect(computerTick(s, 60, scripted)).toBe("more");
    expect(Object.keys(s.state.units).length - before).toBe(1); // one build; 10 ms are left but the last action took 50
  });

  it("writes the ground moves of a turn up in one log line, not one line each", () => {
    const s = inPlay("allies");
    const logBefore = s.log.length;
    for (let i = 0; i < 30 && computerToMove(s); i++) expect(computerTick(s, 1e9)).not.toBe("stuck");
    const mine = s.log.slice(logBefore).filter((l) => l.startsWith("Computer ("));
    expect(mine.filter((l) => / Moves (a unit|\d+ units) from /.test(l))).toEqual([]);
    expect(mine.filter((l) => /moved \d+ units? in \d+ moves?/.test(l))).toHaveLength(1);
  });
});

/** Ticks the computer through the steps before construction, each of which must finish in one tick, until it waits at 8b. */
function toConstruction(s: Session, now?: () => number): void {
  for (let i = 0; i < 5 && !(s.state.position?.part === "player-turn" && s.state.position.step === "8b"); i++) {
    expect(computerTick(s, 1e9, now)).toBe("done");
  }
  expect(s.state.position).toMatchObject({ step: "8b" });
}

function applied(s: Session, a: ReturnType<typeof legalActions>[number]) {
  const r = applyAction(s.ctx, s.state, a);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

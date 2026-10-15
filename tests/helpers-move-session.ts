import { SCENARIO_1939 } from "../src/data/scenario-1939";
import type { Unit } from "../src/engine/types";
import { createSession, setupView, type Session } from "../src/ui/session";
import { fillRest, finishOwner, takeAction } from "../src/ui/sessionActions";
import { at6f, inf } from "./helpers-move";

/** A real 1939 game as Axis, set up and standing at step 6f of the first Player Turn. */
export function atMovement(): Session {
  const s = createSession(SCENARIO_1939, "axis", 1);
  for (let i = 0; i < 20 && s.state.phase === "setup"; i++) {
    fillRest(s);
    const v = setupView(s);
    if (v) finishOwner(s, v.owner);
  }
  for (const step of ["1", "3"]) if (s.state.position?.part === "player-turn" && s.state.position.step === step) takeAction(s, { type: "END_STEP", side: "axis", step });
  if (s.state.position?.part !== "player-turn" || s.state.position.step !== "6f") throw new Error("not at step 6f");
  return s;
}

/** The same session with exactly these counters at step 6f (Axis to move), no choice, no log. */
export function withUnits(units: Unit[]): Session {
  const s = atMovement();
  s.state = at6f(units);
  s.moveChosen = null;
  s.toast = "";
  s.log = [];
  return s;
}

/** u1 (3-4) and u2 (2-1) stand together in L32, u3 (3-3) alone in L33; nothing is near an enemy. */
export const crafted = (): Session => withUnits([inf("u1", "germany", "L32", 3, 4), inf("u2", "germany", "L32", 2, 1), inf("u3", "germany", "L33", 3, 3)]);

/** A session at step 6f in a real position taken from a computer game (the Axis or the Allies to move, the player on that side). */
export function sessionAt(p: { ctx: Session["ctx"]; state: Session["state"] }): Session {
  const s = atMovement();
  s.ctx = p.ctx;
  s.state = p.state;
  s.humanSide = p.state.activeSide;
  s.moveChosen = null;
  s.toast = "";
  return s;
}

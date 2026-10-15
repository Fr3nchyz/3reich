import type { Action } from "../engine/actions";
import type { Scenario, Side } from "../engine/types";
import { newSession, run, type Session } from "./session";

/**
 * TEST ONLY (spec 07, open builder question B3). The browser tests reach step 7h of a 1939 game by loading a recorded list of actions instead
 * of clicking through a dozen steps. main.ts listens for the "e2e-load" event on the document only in the e2e build (`vite build --mode e2e`, so the code is absent from the production bundle) and only when the page address carries `?e2e`; the
 * event's detail is an `E2eLoad`. Every action goes through `run`, hence `applyAction`, like any tap would; a refused action throws. Nothing here
 * is reachable from the screen, and a normal build does not contain this code at all.
 */

export interface E2eLoad {
  scenario: string;
  side: Side;
  seed: number;
  actions: Action[];
}

/** A session of `scenario` for the player on `side` after these actions, from a new game with this seed. */
export function sessionFromRecord(scenario: Scenario, side: Side, seed: number, actions: readonly Action[]): Session {
  const s = newSession(scenario, side, seed);
  if (!run(s, ...actions)) throw new Error(`The recorded actions were refused: ${s.toast}`);
  s.log.push("(Loaded from a recorded game for a browser test.)");
  return s;
}

/** Listens for "e2e-load" on `target` when the address has `?e2e`; `start` receives the session to play. */
export function installE2eLoad(target: EventTarget, search: string, scenarios: readonly Scenario[], start: (scenario: Scenario, s: Session) => void): void {
  if (!new URLSearchParams(search).has("e2e")) return;
  target.addEventListener("e2e-load", (e) => {
    const d = (e as CustomEvent<E2eLoad>).detail;
    const scenario = scenarios.find((x) => x.id === d.scenario);
    if (!scenario) throw new Error(`Unknown scenario ${d.scenario}`);
    start(scenario, sessionFromRecord(scenario, d.side, d.seed, d.actions));
  });
}

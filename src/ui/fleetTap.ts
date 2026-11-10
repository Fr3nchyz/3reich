import type { GameState } from "../engine/types";
import { computerToMove } from "./computerPlay";
import { fleetInterceptModel, fleetMoveModel, type FleetDraft } from "./fleetModel";
import type { Session } from "./session";
import { takeAction } from "./sessionActions";

type Screen = { state: GameState; draft: FleetDraft; fresh: boolean };
const screens = new WeakMap<Session, Screen>();
export function fleetScreen(s: Session): Screen {
  let d = screens.get(s);
  // Spec 07/10: completed actions, load, undo and replacement states discard the transient draft.
  if (!d || d.state !== s.state || computerToMove(s) || s.watch) {
    d = { state: s.state, draft: {}, fresh: false }; screens.set(s, d);
  }
  return d;
}
export function updateFleet(s: Session, change: Partial<FleetDraft>): void {
  const d = fleetScreen(s);
  d.fresh ||= change.fleet !== undefined && change.fleet !== d.draft.fleet;
  d.draft = { ...d.draft, ...change };
}
export function fleetNow(s: Session) {
  if (s.watch || computerToMove(s) || s.state.naval?.manualFleetMove !== true) return null;
  const step = s.state.position?.part === "player-turn" ? s.state.position.step : "";
  return step === "6b" ? fleetMoveModel(s.ctx, s.state, fleetScreen(s).draft) : null;
}
/** Spec 12 D3: map and accessible list edit the same confirmation draft. */
export function tapFleet(s: Session, hex: string): boolean {
  const m = fleetNow(s);
  if (!m) return false;
  const fleet = m.fleets.find(f => s.state.units[f.id]?.at === hex);
  if (fleet) updateFleet(s, { fleet: fleet.id, destination: undefined });
  else {
    const dest = m.destinations.find(d => d.action.to === hex);
    if (dest) updateFleet(s, { destination: dest.key });
  }
  return true;
}

/** Rebuild before dispatch: stale controls cannot submit a draft from a replaced position. */
export function confirmFleet(s: Session, kind: "move" | "intercept" | "pass" | "resolve" | "end"): void {
  if (s.watch || computerToMove(s)) return;
  const d = fleetScreen(s), m = fleetNow(s), p = fleetInterceptModel(s.ctx, s.state, d.draft);
  const action = kind === "move" ? m?.action : kind === "end" ? m?.end : kind === "intercept" ? p.action : kind === "pass" ? p.pass : p.resolve;
  if (action) takeAction(s, action);
}

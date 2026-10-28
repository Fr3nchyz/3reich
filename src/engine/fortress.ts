import { controllerOf, controllingSide, sideInWar, startingControl } from "./control";
import type { GameContext } from "./context";
import { MAGINOT_GONE_YEAR, WEST_WALL_YEAR, sevastopolConditions } from "./fortress-rules";
import { isGone } from "./nations";
import { sideOfOwner } from "./setup";
import type { GameState } from "./types";

/**
 * Fortress status (Ref 4.8, spec 04). `GameState.fortresses[hex]` is true while a hex is a Fortress; false is permanent loss except for Sevastopol's cached supply result;
 * absent means "not a Fortress (yet)". `enterHexes` (control.ts) ends the status the moment an enemy ground unit enters a Fortress; `refreshFortresses`
 * (called by turn.ts when each Player Turn begins) sets the statuses that depend on the date and the nation (West Wall, Maginot Line, Sevastopol, Malta
 * and Gibraltar) and catches any other loss.
 *
 * Rules built from Ref 4.8: Malta and Gibraltar are always Fortresses. Every other Fortress loses the status for good as soon as an enemy
 * occupies it (here: when its controller fights on the other side from the one whose territory it was at the start). Maginot-Line hexes are not
 * Fortresses in the 1942 and 1944 scenarios, and lose the status on the fall of France (here: France Vichy or out of the scenario). West Wall hexes
 * become Fortresses at the start of 1944 if the Axis controls them then. Sevastopol needs Soviet control and, once the Soviets are at war,
 * another supplied Soviet Black Sea port or a line to the east edge. TODO(verify): AER35 to AER37 (Ref 4.8, 19.2; spec 16 R28).
 * Its supply result is refreshed on Allied turns and kept on Axis turns; false here is a temporary result, never a permanent loss.
 */

/** The Fortress statuses of the position after the refresh described above; the same object when nothing changes. */
export function refreshFortresses(ctx: GameContext, state: GameState): GameState {
  const next: Record<string, boolean> = { ...state.fortresses };
  const franceFallen = state.nations.france?.status === "vichy" || (state.nations.france !== undefined && isGone(state.nations.france));
  const startYear = ctx.scenario.start.year;
  const initial = startingControl(ctx);
  for (const hex of Object.values(ctx.map.hexes)) {
    const kind = hex.fortress;
    if (!kind) continue;
    const id = hex.id;
    if (kind === "sevastopol") {
      if (controllerOf(ctx, state, id) !== "ussr") delete next[id];
      else if (sideInWar(state, "ussr") === null) next[id] = true; // AER36: no Soviet war yet
      else if (state.activeSide === "allies") {
        const { port, supplyLine } = sevastopolConditions(ctx, state);
        next[id] = port !== null || supplyLine; // AER35: can lose and regain on every Allied turn
      } else if (next[id] === undefined) {
        const { port, supplyLine } = sevastopolConditions(ctx, state); // no Allied result kept yet: read the conditions now (R28)
        next[id] = port !== null || supplyLine;
      }
      continue;
    }
    if (next[id] === false) continue; // lost for good
    if (kind === "permanent") {
      next[id] = true;
      continue;
    }
    if (kind === "maginot" && (startYear >= MAGINOT_GONE_YEAR || franceFallen)) {
      next[id] = false;
      continue;
    }
    if (kind === "west-wall" && state.year < WEST_WALL_YEAR) continue;
    const owner = initial.get(id);
    const holder = controllingSide(ctx, state, id);
    const taken = owner !== undefined && holder !== null && holder !== sideOfOwner(owner);
    if (kind === "west-wall" && next[id] === undefined) {
      next[id] = holder === "axis"; // decided once, at the start of 1944
      continue;
    }
    next[id] = !taken;
  }
  const same = Object.keys(next).length === Object.keys(state.fortresses).length && Object.entries(next).every(([k, v]) => state.fortresses[k] === v);
  return same ? state : { ...state, fortresses: next };
}

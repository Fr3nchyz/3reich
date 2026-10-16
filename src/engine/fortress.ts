import { controllerOf, controllingSide, startingControl } from "./control";
import type { GameContext } from "./context";
import { sideOfOwner } from "./setup";
import type { GameState } from "./types";

/**
 * Fortress status (Ref 4.8, spec 04). `GameState.fortresses[hex]` is true while a hex is a Fortress and false once it has lost the status for good;
 * absent means "not a Fortress (yet)". It is refreshed at the start of every Player Turn (`refreshFortresses`, called by turn.ts), so a hex
 * taken by an enemy keeps its status until the next Player Turn begins, which is soon enough: the next attack on it comes from the other side.
 *
 * Rules built from Ref 4.8: Malta and Gibraltar are always Fortresses. Every other Fortress loses the status for good as soon as an enemy
 * occupies it (here: when its controller fights on the other side from the one whose territory it was at the start). Maginot-Line hexes are not
 * Fortresses in the 1942 and 1944 scenarios, and lose the status on the fall of France (here: France Vichy or out of the scenario). West Wall hexes
 * become Fortresses at the start of 1944 if the Axis controls them then. Sevastopol is a Fortress while the U.S.S.R. holds it.
 * TODO(verify, Ref 4.8): Sevastopol also needs another Soviet-controlled Black Sea port in supply, or a supply line to the east map edge at the
 * start of the Soviet Player Turn; only the first condition (the U.S.S.R. holds the hex) is built. TODO(verify): the fall of France is read from the
 * nation's status, since no surrender rule exists yet.
 */

/** The Fortress statuses of the position after the refresh described above; the same object when nothing changes. */
export function refreshFortresses(ctx: GameContext, state: GameState): GameState {
  const next: Record<string, boolean> = { ...state.fortresses };
  const franceFallen = state.nations.france?.status === "vichy" || state.nations.france?.status === "out";
  const startYear = ctx.scenario.start.year;
  const initial = startingControl(ctx);
  for (const hex of Object.values(ctx.map.hexes)) {
    const kind = hex.fortress;
    if (!kind) continue;
    const id = hex.id;
    if (kind === "sevastopol") {
      if (controllerOf(ctx, state, id) === "ussr") next[id] = true;
      else delete next[id];
      continue;
    }
    if (next[id] === false) continue; // lost for good
    if (kind === "permanent") {
      next[id] = true;
      continue;
    }
    if (kind === "maginot" && (startYear >= 1942 || franceFallen)) {
      next[id] = false;
      continue;
    }
    if (kind === "west-wall" && state.year < 1944) continue;
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

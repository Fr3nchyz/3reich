import type { GameEvent } from "./action-types";
import { fall } from "./conquest";
import { germanNavalShare, italianNavalFactors, italySurrenderTest } from "./conquest-italy";
import type { FallStep } from "./conquest-stages";
import type { GameContext } from "./context";
import { mayBasePort, portCapacity, portFronts, portsOnFront } from "./naval-ports";
import { stackingProblem } from "./placement";
import { rollD6 } from "./rng";
import type { GameState, Unit } from "./types";

/**
 * Italy's surrender (spec 14 R6, ticket 14-8; Ref 18.2; TODO(verify) V16), wired into the end of the Axis Combat Phase (leaving step 7p, `endCombatPhase`
 * in turn.ts). The pure test is `italySurrenderTest` (conquest-italy.ts); the Initiative it needs is `firstSide`, set at step II.B. Nobody is asked: the
 * rule has no choice in it, so there is no prompt. When it holds, Italy falls to Germany like any Power (`fall`, how "italian-surrender": every
 * Italian-held hex passes to Germany) and, in the same moment, one die plus two decides how many Italian naval factors Germany keeps (`germanNavalShare`).
 */

const idNumber = (u: Pick<Unit, "id">): number => Number(u.id.replace(/\D/g, ""));

/** The Italian fleet counters (partial ones included) that make up `share` factors, lowest numbers first; the last may be cut down to what is left. */
export function chooseFleets(state: GameState, share: number): Unit[] {
  const fleets = Object.values(state.units).filter((u) => u.owner === "italy" && u.type === "fleet").sort((a, b) => idNumber(a) - idNumber(b));
  const chosen: Unit[] = [];
  let left = share;
  for (const u of fleets) {
    if (left <= 0) break;
    const take = Math.min(u.strength, left);
    chosen.push({ ...u, strength: take });
    left -= take;
  }
  return chosen;
}

/** The two steps of the surrender: `before` rolls the die and picks the fleets (they are about to leave with Italy), `after` sets them up in German-held ports. */
export function italySteps(): { before: FallStep; after: FallStep } {
  let die = 0;
  let available = 0;
  let kept: Unit[] = [];
  let origin = new Map<string, string>();
  return {
    before: (_ctx, state) => {
      const rolled = rollD6(state.rngState);
      die = rolled.roll;
      available = italianNavalFactors(state);
      kept = chooseFleets(state, germanNavalShare(die, available));
      origin = new Map(kept.map((u) => [u.id, u.at]));
      return { state: { ...state, rngState: rolled.state }, events: [] };
    },
    after: (ctx, state) => {
      let s = state;
      let placed = 0;
      for (const u of kept) {
        const was = origin.get(u.id)!;
        const front = ctx.map.hexes[was]?.front ?? "mediterranean";
        const fleet: Unit = { ...u, owner: "germany", nationality: "italy" }; // keeps the Italian naval DRM; Italy's pool is gone, so it is never rebuilt
        const ports = [...(portFronts(ctx, was).length > 0 ? [was] : []), ...portsOnFront(ctx, front)];
        const used = (h: string): number => Object.values(s.units).reduce((n, o) => n + (o.type === "fleet" && o.at === h ? o.strength : 0), 0);
        const at = ports.find((h) => mayBasePort(ctx, s, fleet, h) === null && used(h) + u.strength <= portCapacity(ctx, h) && stackingProblem(ctx, s, "germany", { type: "fleet", strength: u.strength, nationality: "italy" }, h) === null);
        if (at === undefined) continue; // no German-held port with room on the Front: lost with Italy
        s = { ...s, units: { ...s.units, [u.id]: { ...fleet, at } } };
        placed++;
      }
      const events: GameEvent[] = [{ type: "ITALIAN_FLEET_KEPT", die, available, share: kept.reduce((n, u) => n + u.strength, 0), placed, counters: kept.length }];
      return { state: s, events };
    },
  };
}

/** Leaving the Axis 7p: Italy surrenders if the test holds (nothing happens before it is at war with the Allies, or once it is conquered). */
export function settleItalySurrender(ctx: GameContext, state: GameState): { state: GameState; events: GameEvent[] } {
  if (state.phase !== "player-turn" || state.activeSide !== "axis" || state.nations.italy.status !== "axis") return { state, events: [] };
  if (!italySurrenderTest(ctx, state, state.firstSide === "allies").surrenders) return { state, events: [] };
  return fall(ctx, state, "italy", "germany", "italian-surrender", italySteps());
}

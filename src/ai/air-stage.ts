import { applyAction } from "../engine/actions";
import { airbasePlacements } from "../engine/air-actions";
import { isGroundCombatUnit, neighborIds } from "../engine/attack-rules";
import { sideInWar, areEnemies } from "../engine/control";
import type { GameContext } from "../engine/context";
import { distance, hex } from "../engine/hex";
import { freeAir } from "../engine/air-missions";
import { stagingTargets } from "../engine/air-stage";
import { isMajorPower } from "../engine/war";
import type { GameState } from "../engine/types";
import type { Decision } from "./types";

/** TODO(verify) AER105, spec 09 E: minimum staging improvement, in hexes. */
export const AIR_STAGE_MIN_GAIN = 1;
const capital = (ctx: GameContext, at: string) => ctx.map.hexes[at]?.features.some(f => f === "capital" || f === "capital-port") ?? false;

/** Spec 09 E / R4: engine queries enforce bases, range, capacity and turn ownership. */
export function chooseAirStage(ctx: GameContext, state: GameState): Decision | undefined {
  const planes = freeAir(ctx, state).sort((a, b) => a.id.localeCompare(b.id));
  for (const u of planes) {
    const enemies = Object.values(state.units).filter(e => isGroundCombatUnit(e) && areEnemies(state, u.owner, e.owner) && ctx.map.hexes[e.at]);
    if (!enemies.length) continue;
    if (capital(ctx, u.at) && Object.values(state.units).filter(p => p.type === "air" && p.at === u.at && sideInWar(state, p.owner) === state.activeSide).length <= 1) continue;
    const gap = (at: string) => Math.min(...enemies.map(e => distance(hex(at), hex(e.at))));
    const safe = (at: string) => capital(ctx, at) || !enemies.some(e => neighborIds(ctx, at).includes(e.at));
    const useful = (at: string) => safe(at) && gap(u.at) - gap(at) >= AIR_STAGE_MIN_GAIN;
    const targets = stagingTargets(ctx, state, [u.id]).filter(useful).sort((a, b) => gap(a) - gap(b) || a.localeCompare(b));
    if (targets[0]) return { action: { type: "STAGE_AIR", side: state.activeSide, units: [u.id], to: targets[0] }, why: "Stages a plane closer to enemy ground at a safe base." };
    // AER105: a base next to the front may be prepared for a later turn; do not stage into danger.
    if (!isMajorPower(u.owner)) continue;
    for (const at of airbasePlacements(ctx, state, u.owner)) {
      if (!Object.values(state.units).some(g => g.at === at && isGroundCombatUnit(g) && g.owner === u.owner) ||
        !enemies.some(e => neighborIds(ctx, at).includes(e.at))) continue;
      const action = { type: "PLACE_AIRBASE" as const, side: state.activeSide, owner: u.owner, at };
      const placed = applyAction(ctx, state, action);
      if (placed.ok && stagingTargets(ctx, placed.state, [u.id]).includes(at)) return { action, why: "Prepares an airbase on ground held at the front." };
    }
  }
  return undefined;
}

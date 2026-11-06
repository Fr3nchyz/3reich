import { baseProblem } from "./air-bases";
import { flightProblem } from "./air-range";
import { hasFlown } from "./air-record";
import { MISSION_RANGE } from "./air-rules";
import { isGroundCombatUnit } from "./attack-rules";
import { oddsColumn } from "./combat";
import type { GameContext } from "./context";
import { sideInWar } from "./control";
import type { HexId } from "./hex";
import type { GameState } from "./types";

/** Ref 20.51: counted DAS is capped at three times basic defending ground factors. */
export const DAS_CAP_MULTIPLE = 3;
/** TODO(verify) AER61: spec 09 R10 leaves potential attack undefined; caller must supply targets,
 * including invasion/airdrop threats. This slice makes no adjacency or Front Option ruling. */
export const DAS_POTENTIAL_ATTACK_POLICY = "caller-supplied";
/** TODO(verify) AER62: spec 09 R5 follows Ref 20.3's Game Turn over Ops 5.46k/m's Player Turn.
 * `hasFlown` supplies that existing Game Turn ledger, including newly built planes. */
export const DAS_MISSION_PERIOD = "game-turn";

/** Caller-owned inputs, never persisted here. Ref 20.51; Ops 5.46d.
 * Pass only current potential targets. Recompute after any relevant position change. */
export interface DefensiveAirInput {
  potentialTargets: readonly HexId[];
  /** Ref 20.3, 20.44: counter-air result's aborted ids. Do not include larger winning defenders
   * whose participating survivors remain free. Prior mission use is still checked separately. */
  counterAirUnavailable: readonly string[];
}

/** Ref 20.51: only ground defenders of the Non-Phasing side support a DAS commitment. */
export function defensiveGroundFactors(state: GameState, target: HexId): number {
  return Object.values(state.units).filter((u) => u.at === target && isGroundCombatUnit(u) &&
    sideInWar(state, u.owner) === (state.activeSide === "axis" ? "allies" : "axis"))
    .reduce((sum, u) => sum + u.strength, 0);
}

/** Eligibility only; no commitment, action, mission marking, loss handling or battle wiring.
 * Ref 20.51; Ops 5.46d: Non-Phasing air at 7d, at a usable base (Ref 20.1), within four
 * flight hexes avoiding neutral land (Ref 20.2). Same-hex support is within range. */
export function defensiveAirProblem(ctx: GameContext, state: GameState, input: DefensiveAirInput, id: string, target: HexId): string | null {
  if (state.phase !== "player-turn" || state.position?.part !== "player-turn" || state.position.step !== "7d") return "Defensive air support requires step 7d.";
  if (!ctx.map.hexes[target]?.land || !input.potentialTargets.includes(target)) return "The hex must be a potential ground attack target.";
  if (defensiveGroundFactors(state, target) <= 0) return "The hex must hold Non-Phasing ground defenders.";
  const u = Object.hasOwn(state.units, id) ? state.units[id] : undefined;
  if (!u || u.type !== "air" || u.strength <= 0) return "Only an air unit on the map may support defense.";
  if (sideInWar(state, u.owner) !== (state.activeSide === "axis" ? "allies" : "axis")) return "The plane must belong to the Non-Phasing side.";
  // Ref 20.3, 20.44: used missions, new planes and counter-air aborts cannot fly DAS.
  if (hasFlown(state, id) || input.counterAirUnavailable.includes(id)) return "The plane is unavailable for another mission this Game Turn.";
  if (!ctx.map.hexes[u.at]?.land) return "The plane must be on an on-map land base.";
  return baseProblem(ctx, state, u, u.at) ?? flightProblem(ctx, state, u.owner, u.at, target, MISSION_RANGE);
}

/** Eligible ids in stable lexical order; Ref 20.51. Capacity is applied to counted factors below. */
export const defensiveAirUnits = (ctx: GameContext, state: GameState, input: DefensiveAirInput, target: HexId): string[] =>
  Object.keys(state.units).sort().filter((id) => defensiveAirProblem(ctx, state, input, id, target) === null);

/** Ref 20.51, 12.1; spec 09 C4: add surviving committed DAS AFTER terrain multiplication,
 * capped by basic ground factors. Caller supplies actual battle ground totals and DAS factors
 * after interception, plus attackTotal including GS. No air combat occurs in this arithmetic.
 * Counterattacks, commitments and loss allocation are outside this slice. */
export function defensiveAirNumbers(attackTotal: number, groundBasic: number, multiplier: number, dasFactors: number) {
  if (![attackTotal, groundBasic, dasFactors].every((n) => Number.isFinite(n) && n >= 0) || !Number.isFinite(multiplier) || multiplier < 1) {
    throw new RangeError("Combat totals must be finite and nonnegative; the terrain multiplier must be at least one.");
  }
  const countedDas = Math.min(dasFactors, DAS_CAP_MULTIPLE * groundBasic);
  const defenseTotal = groundBasic * multiplier + countedDas;
  return { countedDas, defenseTotal, column: oddsColumn(attackTotal, defenseTotal) };
}

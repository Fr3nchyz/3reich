import { baseProblem } from "./air-bases";
import { AIR_COMBAT_RULES } from "./air-combat";
import { applyAirLosses, type AirLossTake } from "./air-losses";
import { flightProblem } from "./air-range";
import { hasFlown } from "./air-record";
import { MISSION_RANGE } from "./air-rules";
import type { GameContext } from "./context";
import { controllerOf, sideInWar } from "./control";
import type { HexId } from "./hex";
import { breakDownFleet } from "./naval-losses";
import { isPort } from "./naval-ports";
import { rollD6 } from "./rng";
import type { GameState, Unit } from "./types";

/** TODO(verify) AER68: inherit Ref 20.3's Game Turn mission ledger over Ops wording (spec 09 R5). */
export const PORT_ATTACK_MISSION_PERIOD = "game-turn";
/** TODO(verify) AER69: inherit counter sizes and excess air breakdown loss (Ref 20.6; spec 09 R6).
 * Fleet breakdown reuses N1/N2 (Ref 21.7); fleet allocation remains caller-supplied (N29). */
export const PORT_ATTACK_AIR_RULES = AIR_COMBAT_RULES;

/** Ref 20.45; Ops 5.46b: designation at 7b, Phasing planes against an enemy port with ships.
 * Ref 20.1/20.2/20.3: usable base, unused mission, four-hex flight avoiding neutral land.
 * Caller supplies other commitments/Counter-Air aborts; no shared mission or action is added. */
export function portAttackProblem(
  ctx: GameContext, state: GameState, unavailable: readonly string[], id: string, target: HexId,
): string | null {
  if (state.phase !== "player-turn" || state.position?.part !== "player-turn" || state.position.step !== "7b") return "Port attacks are designated at step 7b.";
  const holder = controllerOf(ctx, state, target);
  const side = holder === null ? null : sideInWar(state, holder);
  if (!isPort(ctx, target) || side === null || side === state.activeSide) return "The target must be an enemy port.";
  if (!Object.values(state.units).some((u) => u.at === target && u.type === "fleet" && u.strength > 0 && sideInWar(state, u.owner) === side)) return "The port must hold an enemy fleet.";
  const u = Object.hasOwn(state.units, id) ? state.units[id] : undefined;
  if (!u || u.type !== "air" || !Number.isInteger(u.strength) || u.strength <= 0) return "Only positive whole-strength air units may attack a port.";
  if (sideInWar(state, u.owner) !== state.activeSide) return "The plane must belong to the Phasing side.";
  if (hasFlown(state, id) || unavailable.includes(id)) return "The plane is unavailable this Game Turn.";
  if (!Object.hasOwn(ctx.map.hexes, u.at) || !ctx.map.hexes[u.at]?.land) return "The plane must be on an on-map land base.";
  return baseProblem(ctx, state, u, u.at) ?? flightProblem(ctx, state, u.owner, u.at, target, MISSION_RANGE);
}

/** Ref 20.45: deterministic eligible ids; this preview consumes no dice. */
export const portAttackers = (ctx: GameContext, state: GameState, unavailable: readonly string[], target: HexId): string[] =>
  Object.keys(state.units).sort().filter((id) => portAttackProblem(ctx, state, unavailable, id, target) === null);

/** Ref 20.45; spec 12 R14: current based enemy air only, never planes at nearby bases. */
export const portCounterAirDefenders = (state: GameState, target: HexId): string[] =>
  Object.values(state.units).filter((u) => u.at === target && u.type === "air" && u.strength > 0 &&
    sideInWar(state, u.owner) === (state.activeSide === "axis" ? "allies" : "axis") && !hasFlown(state, u.id))
    .map((u) => u.id).sort();

export interface PortAttackInput {
  target: HexId;
  /** Already designated at 7b; only factors NOT used for Counter-Air, in designation order.
   * Caller performs any splitting before this call. Bases remain in `at`. Ref 20.45. */
  attacker: readonly Unit[];
  /** Current enemy fleets still at the target at 7i, after ground combat/displacement. */
  fleets: readonly Unit[];
  /** Caller resolves the prerequisite with resolveCounterAir, including at Malta (Peele).
   * `not-needed` certifies no unused based enemy air; `beaten` certifies it was beaten.
   * No nearby air may defend. Counter-Air participants never enter `attacker`. Ref 20.45. */
  counterAir: "not-needed" | "beaten" | "not-beaten";
  rngState: number;
}

/** TODO(verify) N29: no automatic fleet loss policy; caller supplies exact nominal factors. */
export type PortFleetLossChooser = (pool: readonly Readonly<Unit>[], owed: number) => readonly AirLossTake[];

export interface PortAttackResult {
  status: "resolved" | "no-fleets" | "counter-air-blocked";
  rolls: { id: string; roll: number }[];
  air: { surviving: Unit[]; eliminated: string[]; lost: number };
  /** Ref 21.7: remaining counter sizes by original fleet id; caller owns replacement ids. */
  fleets: { id: string; counters: number[]; lost: number }[];
  navalHits: number;
  navalLost: number;
  /** Ref 20.3/20.45: mission consumed even when ground combat displaced the targets. */
  flown: string[];
  rngState: number;
}

/** Ref 20.45; Ops 5.46i: pure local resolution at 7i; caller checks designation and supplies
 * current fleets and the Counter-Air outcome. No action, state, capacity, ledger or pool changes.
 * Ref 20.45 damages ships only; port capacity is not a target of this rule. */
export function resolvePortAttack(input: PortAttackInput, choose: PortFleetLossChooser): PortAttackResult {
  const all = [...input.attacker, ...input.fleets];
  if (input.attacker.length === 0 || new Set(all.map((u) => u.id)).size !== all.length ||
    all.some((u) => !Number.isInteger(u.strength) || u.strength <= 0) ||
    input.attacker.some((u) => u.type !== "air") ||
    input.fleets.some((u) => u.type !== "fleet" || u.at !== input.target)) {
    throw new RangeError("Port attack needs distinct positive air attackers and fleets at the target.");
  }
  const result: PortAttackResult = {
    status: input.fleets.length === 0 ? "no-fleets" : input.counterAir === "not-beaten" ? "counter-air-blocked" : "resolved",
    rolls: [], air: { surviving: input.attacker.map((u) => ({ ...u })), eliminated: [], lost: 0 },
    fleets: input.fleets.map((u) => ({ id: u.id, counters: [u.strength], lost: 0 })),
    navalHits: 0, navalLost: 0, flown: input.attacker.map((u) => u.id), rngState: input.rngState,
  };
  // Ref 20.45: displaced ships or unbeaten based air prevent all ship-attack rolls.
  if (result.status !== "resolved") return result;
  const airTake: AirLossTake[] = [];
  // Ref 20.45; spec 12 R21: one roll per original attacking factor, in designation order.
  // Simultaneous factor rolls: losses/breakdown do not reduce the number of dice.
  for (const u of input.attacker) {
    let lost = 0;
    for (let n = 0; n < u.strength; n++) {
      const die = rollD6(result.rngState);
      result.rngState = die.state;
      result.rolls.push({ id: u.id, roll: die.roll });
      if (die.roll <= 2) result.navalHits++;
      else if (die.roll >= 5) lost++;
    }
    // Ref 20.45: a 5 or 6 loses the attacking factor, not another plane's factor.
    if (lost > 0) airTake.push({ id: u.id, factors: lost });
  }
  const air = applyAirLosses(input.attacker, airTake, airTake.reduce((n, t) => n + t.factors, 0), PORT_ATTACK_AIR_RULES);
  if ("problem" in air) throw new RangeError(air.problem);
  result.air = { surviving: [], eliminated: [], lost: air.lost };
  for (const u of input.attacker) {
    const remaining = air.applied.find((a) => a.id === u.id)?.remaining ?? u.strength;
    if (remaining > 0) result.air.surviving.push({ ...u, strength: remaining });
    else result.air.eliminated.push(u.id);
  }
  // Ref 20.45, 21.7; N29: cap at available naval factors; validate explicit allocation.
  const owed = Math.min(result.navalHits, input.fleets.reduce((n, u) => n + u.strength, 0));
  const take = owed === 0 ? [] : choose(input.fleets.map((u) => ({ ...u })), owed);
  const seen = new Set<string>();
  let total = 0;
  for (const t of take) {
    const u = input.fleets.find((f) => f.id === t.id);
    if (!u || seen.has(t.id) || !Number.isInteger(t.factors) || t.factors <= 0 || t.factors > u.strength) throw new RangeError("Invalid fleet loss allocation.");
    seen.add(t.id);
    total += t.factors;
  }
  if (total !== owed) throw new RangeError(`Exactly ${owed} naval factors must be chosen.`);
  result.fleets = input.fleets.map((u) => {
    const factors = take.find((t) => t.id === u.id)?.factors;
    const loss = factors === undefined ? { counters: [u.strength], lost: 0 } : breakDownFleet(u.strength, factors);
    return { id: u.id, ...loss };
  });
  result.navalLost = result.fleets.reduce((n, u) => n + u.lost, 0);
  return result;
}

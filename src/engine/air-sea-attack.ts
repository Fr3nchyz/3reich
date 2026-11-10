import { AIR_COMBAT_RULES } from "./air-combat";
import { applyAirLosses, type AirLossTake } from "./air-losses";
import type { PortAttackResult, PortFleetLossChooser } from "./air-port-attack";
import { breakDownFleet } from "./naval-losses";
import { rollD6 } from "./rng";
import type { Unit } from "./types";

/** Ref 20.52 / spec 12 R15; TODO(verify) AER102: inherit AER69/N1/N2 breakdown. */
export interface SeaAttackInput { attacker: readonly Unit[]; fleets: readonly Unit[]; rngState: number }
/** Pure factor resolution; bases stay in Unit.at, caller supplies participating fleets. AER100/AER102. */
export function resolveSeaAttack(input: SeaAttackInput, choose: PortFleetLossChooser): PortAttackResult {
  const all = [...input.attacker, ...input.fleets];
  if (input.attacker.length === 0 || new Set(all.map((u) => u.id)).size !== all.length ||
    all.some((u) => !Number.isInteger(u.strength) || u.strength <= 0) ||
    input.attacker.some((u) => u.type !== "air") ||
    input.fleets.some((u) => u.type !== "fleet")) {
    throw new RangeError("Sea attack needs distinct positive air attackers and fleets at the target.");
  }
  const result: PortAttackResult = {
    status: input.fleets.length === 0 ? "no-fleets" : "resolved",
    rolls: [], air: { surviving: input.attacker.map((u) => ({ ...u })), eliminated: [], lost: 0 },
    fleets: input.fleets.map((u) => ({ id: u.id, counters: [u.strength], lost: 0 })),
    navalHits: 0, navalLost: 0, flown: input.attacker.map((u) => u.id), rngState: input.rngState,
  };
  // AER100/AER103: no participating ships means no dice.
  if (result.status !== "resolved") return result;
  const airTake: AirLossTake[] = [];
  // Ref 20.52 / spec 12 R15; spec 12 R21: one roll per original attacking factor, in designation order.
  // Simultaneous factor rolls: losses/breakdown do not reduce the number of dice.
  for (const u of input.attacker) {
    let lost = 0;
    for (let n = 0; n < u.strength; n++) {
      const die = rollD6(result.rngState);
      result.rngState = die.state;
      result.rolls.push({ id: u.id, roll: die.roll });
      if (die.roll === 1) result.navalHits++;
      else if (die.roll === 6) lost++;
    }
    // Ref 20.52 / spec 12 R15: a 6 loses the attacking factor, not another plane's factor.
    if (lost > 0) airTake.push({ id: u.id, factors: lost });
  }
  const air = applyAirLosses(input.attacker, airTake, airTake.reduce((n, t) => n + t.factors, 0), AIR_COMBAT_RULES);
  if ("problem" in air) throw new RangeError(air.problem);
  result.air = { surviving: [], eliminated: [], lost: air.lost };
  for (const u of input.attacker) {
    const remaining = air.applied.find((a) => a.id === u.id)?.remaining ?? u.strength;
    if (remaining > 0) result.air.surviving.push({ ...u, strength: remaining });
    else result.air.eliminated.push(u.id);
  }
  // Ref 20.52 / spec 12 R15, 21.7; N29: cap at available naval factors; validate explicit allocation.
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

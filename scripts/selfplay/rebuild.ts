import type { GameEvent, LostReason } from "../../src/engine/action-types";
import type { ForceOwner, GameState, PowerId, UnitType } from "../../src/engine/types";
import type { Finding } from "./audit";

/** Spec 17 ticket 17-5 (Part E, Part D): what happened to lost units in a game, counted from its events, and the check of RB13. */

export interface NationRebuild {
  returned: number;
  rebuilt: number;
  lostForGood: Partial<Record<LostReason, number>>;
  /** BRPs the nation paid for counters rebuilt from the pool. */
  brps: number;
  siberian: number;
}

export interface YearStart {
  year: number;
  /** BRPs each nation had left when the year ended (the figure that feeds its growth, Ref 9.2). */
  unspent: Partial<Record<PowerId, number>>;
}

export interface RebuildStats {
  nations: Partial<Record<ForceOwner, NationRebuild>>;
  yearStarts: YearStart[];
  surrenderOffers: number;
}

const empty = (): NationRebuild => ({ returned: 0, rebuilt: 0, lostForGood: {}, brps: 0, siberian: 0 });

/** Adds up the events of a whole game for the rebuild report. */
export class RebuildTally {
  private stats: RebuildStats = { nations: {}, yearStarts: [], surrenderOffers: 0 };
  private of(owner: ForceOwner): NationRebuild {
    return (this.stats.nations[owner] ??= empty());
  }

  /** `before` and `after` are the states around the action that produced `events`. */
  add(events: readonly GameEvent[], before: GameState, after: GameState): void {
    for (const e of events) {
      switch (e.type) {
        case "UNIT_RETURNED_TO_POOL": this.of(e.pool).returned++; break;
        case "UNIT_LOST_FOR_GOOD": { const n = this.of(e.owner); n.lostForGood[e.reason] = (n.lostForGood[e.reason] ?? 0) + 1; break; }
        case "UNIT_BUILT":
          if (e.returned) { this.of(e.pool ?? e.owner).rebuilt++; this.of(e.owner).brps += e.cost; }
          break;
        case "SIBERIAN_TRANSFER_USED": this.of("ussr").siberian++; break;
        case "RUSSIA_OFFERS_SURRENDER": this.stats.surrenderOffers++; break;
        default: break;
      }
    }
    // The year changed with this action: the Year Start Sequence ran, and `before` still holds what each nation left unspent.
    if (after.year !== before.year) {
      const unspent: YearStart["unspent"] = {};
      for (const n of Object.values(before.nations)) if (n.status !== "conquered") unspent[n.id] = n.brpTotal;
      this.stats.yearStarts.push({ year: after.year, unspent });
    }
  }

  result(): RebuildStats {
    return this.stats;
  }
}

/** Counters whose number is the measure (the others are measured in factors: a unit may break down into smaller counters). */
const BY_FACTORS: readonly UnitType[] = ["air", "fleet"];
const amount = (type: UnitType, strength: number, count: number): number => (BY_FACTORS.includes(type) ? strength * count : count);

/** For each nation (the pool it belongs to) and kind of counter, how many the pools and the map hold: counters, or factors for air units and fleets. */
function holdings(state: GameState): Map<string, number> {
  const out = new Map<string, number>();
  // The fall of France splits France's counters into Vichy and Free French ones (spec 14 R5): the three are one nation's counters.
  const nation = (o: ForceOwner): ForceOwner => (o === "vichy-france" || o === "free-france" ? "france" : o);
  const add = (owner: ForceOwner, type: UnitType, n: number) => out.set(`${nation(owner)} ${type}`, (out.get(`${nation(owner)} ${type}`) ?? 0) + n);
  for (const u of Object.values(state.units)) if (u.type !== "airbase" && u.type !== "bridgehead") add(u.nationality ?? u.owner, u.type, amount(u.type, u.strength, 1));
  for (const [owner, pool] of Object.entries(state.pools) as [ForceOwner, NonNullable<GameState["pools"][ForceOwner]>][]) {
    for (const e of [...pool.forcePool, ...pool.allowableBuilds]) add(e.nationality ?? owner, e.type, amount(e.type, e.strength, e.count));
  }
  return out;
}

/** RB13: at the end, no nation holds more counters of a kind (map plus pool) than its scenario lists. `initial` is the state before setup (or the position play began from). Each excess is an anomaly. */
export function auditCounters(initial: GameState, final: GameState): Finding[] {
  const start = holdings(initial);
  const end = holdings(final);
  const out: Finding[] = [];
  for (const [key, n] of end) if (n > (start.get(key) ?? 0)) out.push({ kind: "counter-excess", detail: `${key}: ${n} at the end (map plus pool), the scenario lists ${start.get(key) ?? 0}` });
  return out;
}

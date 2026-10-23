import type { GameEvent } from "../../src/engine/actions";
import { controlMap, sideInWar } from "../../src/engine/control";
import type { GameContext } from "../../src/engine/context";
import { sideOfOwner } from "../../src/engine/setup";
import type { GameState, PowerId, Side } from "../../src/engine/types";
import type { TurnStats } from "./types";

const POWERS: readonly PowerId[] = ["germany", "italy", "ussr", "britain", "france", "usa"];
const FACTOR_TYPES = ["infantry", "armor", "airborne", "replacement", "air"];
const GROUND_TYPES = ["infantry", "armor", "airborne"];
const OBJECTIVE_FEATURES = ["capital", "capital-port", "objective"];

export const turnLabel = (s: Pick<GameState, "year" | "season">): string => `${s.season[0]!.toUpperCase()}${s.season.slice(1)} ${s.year}`;

const zero = <T>(make: () => T): Record<PowerId, T> => Object.fromEntries(POWERS.map((p) => [p, make()])) as Record<PowerId, T>;

/** Hexes and objectives held by each side, by the side its controller fights on now (neutral: no side). */
export function holdings(ctx: GameContext, state: GameState): Pick<TurnStats, "hexes" | "objectives"> {
  const hexes = { axis: 0, allies: 0, neutral: 0 };
  const objectives = { axis: 0, allies: 0, neutral: 0 };
  for (const [hex, owner] of controlMap(ctx, state)) {
    const side = sideInWar(state, owner) ?? "neutral";
    hexes[side]++;
    if (ctx.map.hexes[hex]?.features.some((f) => OBJECTIVE_FEATURES.includes(f))) objectives[side]++;
  }
  return { hexes, objectives };
}

/** Ground units (those that move on foot) on the map, by the side that sets them up. */
const groundUnits = (state: GameState): TurnStats["ground"] => {
  const n = { axis: 0, allies: 0 };
  for (const u of Object.values(state.units)) if (GROUND_TYPES.includes(u.type)) n[sideOfOwner(u.owner)]++;
  return n;
};

/** Counters in play and their factors, by the side that sets them up. */
function forces(state: GameState): Pick<TurnStats, "units" | "factors"> {
  const units = { axis: 0, allies: 0 };
  const factors = { axis: 0, allies: 0 };
  for (const u of Object.values(state.units)) {
    const side = sideOfOwner(u.owner);
    units[side]++;
    if (FACTOR_TYPES.includes(u.type)) factors[side] += u.strength;
  }
  return { units, factors };
}

/** Adds up the events of one Game Turn. `before` is the state the action was taken in (to look up units that an event removed). */
export class TurnTally {
  private t: TurnStats;
  constructor(readonly label: string) {
    this.t = {
      label, brp: zero(() => 0), spent: zero(() => 0), spentOn: { war: 0, build: 0, grant: 0, option: 0, other: 0 }, wars: [], built: 0, builtList: [], grants: 0, grantAmount: 0, redeployed: zero(() => 0),
      moves: 0, unitsMoved: 0, movedBy: { axis: 0, allies: 0 }, ground: { axis: 0, allies: 0 }, combats: { total: 0, attackerEliminated: 0, defenderEliminated: 0, exchange: 0 }, attacks: { axis: 0, allies: 0 }, lost: { axis: 0, allies: 0 }, lostUnsupplied: { axis: 0, allies: 0 }, lostFactors: { axis: 0, allies: 0 },
      hexChanges: 0, hexes: { axis: 0, allies: 0, neutral: 0 }, objectives: { axis: 0, allies: 0, neutral: 0 }, units: { axis: 0, allies: 0 }, factors: { axis: 0, allies: 0 }, frontOptions: [], actions: 0, partial: false,
    };
  }

  /** Actions tallied so far. */
  get count(): number {
    return this.t.actions;
  }

  add(events: readonly GameEvent[], before: GameState): void {
    const t = this.t;
    t.actions++;
    for (const e of events) {
      switch (e.type) {
        case "BRPS_CHANGED":
          if (e.delta < 0) {
            t.spent[e.nation] -= e.delta;
            const kind = /^declaring war/.test(e.reason) ? "war" : /^building/.test(e.reason) ? "build" : /^a grant/.test(e.reason) ? "grant" : / Option on /.test(e.reason) ? "option" : "other";
            t.spentOn[kind] -= e.delta;
          }
          break;
        case "WAR_DECLARED": t.wars.push(`${e.by} on ${e.on}`); break;
        case "UNIT_BUILT": t.built++; t.builtList.push(`${e.owner} ${e.strength}-${e.unitType}`); break;
        case "BRPS_GRANTED": t.grants++; t.grantAmount += e.amount; break;
        case "UNITS_REDEPLOYED": t.redeployed[e.nation] += e.units.length; break;
        case "UNITS_MOVED": t.moves++; t.unitsMoved += e.units.length; t.movedBy[before.activeSide] += e.units.length; break;
        case "COMBAT_RESOLVED":
          t.combats.total++;
          t.attacks[e.side]++;
          if (e.outcome === "exchange") t.combats.exchange++;
          else if (e.outcome === "attacker-eliminated") t.combats.attackerEliminated++;
          else t.combats.defenderEliminated++;
          break;
        case "UNIT_ELIMINATED":
        case "OVERSTACK_ELIMINATED": {
          const side: Side = sideOfOwner(e.owner);
          t.lost[side]++;
          if (e.type === "UNIT_ELIMINATED" && e.reason === "unsupplied") t.lostUnsupplied[side]++;
          const u = before.units[e.unitId];
          if (u && FACTOR_TYPES.includes(u.type)) t.lostFactors[side] += u.strength;
          break;
        }
        case "HEX_CONTROL_CHANGED": t.hexChanges++; break;
        case "FRONT_OPTION_SELECTED": t.frontOptions.push(`${e.side} ${e.front} ${e.option}`); break;
        default: break;
      }
    }
  }

  /** The Game Turn's numbers, with BRP totals, holdings and forces read from `state` (the state at its end). */
  close(ctx: GameContext, state: GameState, partial: boolean): TurnStats {
    const brp = Object.fromEntries(POWERS.map((p) => [p, state.nations[p].brpTotal])) as Record<PowerId, number>;
    return { ...this.t, brp, ...holdings(ctx, state), ...forces(state), ground: groundUnits(state), partial };
  }
}

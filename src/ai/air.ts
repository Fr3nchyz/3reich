import { applyAction, legalActions, type Action } from "../engine/actions";
import { groundSupportTargets, freeAir } from "../engine/air-missions";
import { flightProblem } from "../engine/air-range";
import { MISSION_RANGE } from "../engine/air-rules";
import { airOf, hasFlown } from "../engine/air-record";
import { dasSide } from "../engine/air-defense-wire";
import { defensiveGroundFactors } from "../engine/air-defense";
import { attackNumbers, defendersAt } from "../engine/attack-rules";
import { ODDS_COLUMNS } from "../engine/combat";
import { areEnemies, sideInWar } from "../engine/control";
import type { GameContext } from "../engine/context";
import type { GameState } from "../engine/types";
import { chooseAttack } from "./assault";
import { chooseAirStage } from "./air-stage";
import type { AiConfig, Decision } from "./types";

/** TODO(verify) AER104: spec 09 E; default games and saved states keep their exact choices. */
export const AI_USES_AIR = false;
/** TODO(verify) AER106: conservative counter-air factor superiority. */
export const COUNTER_AIR_RATIO = 2;
/** TODO(verify) AER107/AER108: disjoint support targets; preserve a defending reserve. */
export const AIR_SUPPORT_TARGETS = 2;
export const DAS_THREAT_RATIO = 1;
export const DAS_RESERVE_PLANES = 1;
const decision = (action: Action, why: string): Decision => ({ action, why });
const order = (a: Action) => JSON.stringify(a);
const battleState = (state: GameState): GameState => ({ ...state, position: { part: "player-turn", turn: state.position?.part === "player-turn" ? state.position.turn : 1, step: "7h" } });

/** AER107 / Ref 20.41: honor commitments before spending their ground force elsewhere. */
function committedAttack(state: GameState, legal: readonly Action[]): Decision | undefined {
  const targets = Object.keys(airOf(state).groundSupport).sort();
  const action = legal.find(a => a.type === "ATTACK" && targets.includes(a.target));
  return action ? decision(action, "Attacks a hex with committed ground support.") : undefined;
}

/** AER107: existing attack scoring, legal whole counters, disjoint attackers, improved column. */
function support(ctx: GameContext, state: GameState, cfg: AiConfig, legal: readonly Action[]): Decision | undefined {
  const committed = Object.keys(airOf(state).groundSupport);
  if (committed.length >= AIR_SUPPORT_TARGETS) return undefined;
  const ground = groundSupportTargets(ctx, state);
  const reserved = new Set(committed.flatMap(t => (ground.get(t) ?? []).map(u => u.id)));
  const battle = battleState(state);
  let attacks = legalActions(ctx, battle).filter(a => a.type === "ATTACK" && !committed.includes(a.target) && !a.units.some(id => reserved.has(id)));
  while (attacks.length) {
    // Do not let the scoring helper mutate caller-owned memory during a prospective choice.
    const picked = chooseAttack(ctx, battle, attacks, { seed: cfg.seed });
    if (!picked || picked.action.type !== "ATTACK") break;
    const attack = picked.action;
    attacks = attacks.filter(a => a !== attack);
    const candidates = legal.filter(a => a.type === "DESIGNATE_AIR" && a.mission === "ground-support" && a.target === attack.target).sort((a, b) => order(a).localeCompare(order(b)));
    const units = attack.units.map(id => state.units[id]!);
    const defenders = defendersAt(state, units, attack.target);
    const before = attackNumbers(ctx, battle, units, defenders, attack.target).column;
    for (const candidate of candidates) for (let count = 1; candidate.type === "DESIGNATE_AIR" && count <= candidate.units.length; count++) {
      const a = { ...candidate, units: [...candidate.units].sort().slice(0, count) };
      const result = applyAction(ctx, state, a);
      if (!result.ok) continue;
      const after = attackNumbers(ctx, result.state, units, defenders, attack.target).column;
      if (before !== null && after !== null && ODDS_COLUMNS.indexOf(after) > ODDS_COLUMNS.indexOf(before)) return decision(a, "Adds air to an accepted attack to improve its odds column.");
    }
  }
  return undefined;
}

/** AER106 / R12: candidate validation delegates range, enemy bases and mission use to the engine. */
function counterAir(ctx: GameContext, state: GameState): Decision | undefined {
  const planes = freeAir(ctx, state).sort((a, b) => a.id.localeCompare(b.id));
  const targets = [...new Set(Object.values(state.units).filter(u => u.type === "air").map(u => u.at))].sort();
  for (const target of targets) {
    const units = planes.filter(u => applyAction(ctx, state, { type: "DESIGNATE_AIR", side: state.activeSide, mission: "counter-air", units: [u.id], target }).ok);
    if (!units.length) continue;
    const enemies = Object.values(state.units).filter(u => u.type === "air" && u.at === target && areEnemies(state, units[0]!.owner, u.owner));
    if (units.reduce((n, u) => n + u.strength, 0) < COUNTER_AIR_RATIO * enemies.reduce((n, u) => n + u.strength, 0)) continue;
    return decision({ type: "DESIGNATE_AIR", side: state.activeSide, mission: "counter-air", units: units.map(u => u.id), target }, "Uses superior free air against an enemy base.");
  }
  return undefined;
}

/** AER108 / R10: legal manual DAS only, most threatened first, always retain a free plane. */
function defense(ctx: GameContext, state: GameState, legal: readonly Action[]): Decision | undefined {
  if (Object.keys(airOf(state).das ?? {}).length >= AIR_SUPPORT_TARGETS) return undefined;
  const available = Object.values(state.units).filter(u => u.type === "air" && sideInWar(state, u.owner) === dasSide(state) && !hasFlown(state, u.id));
  const threats = groundSupportTargets(ctx, state);
  const ratio = (at: string) => (threats.get(at) ?? []).reduce((n, u) => n + u.strength, 0) / defensiveGroundFactors(state, at);
  const choices = legal.filter((a): a is Extract<Action, { type: "DESIGNATE_DAS" }> => a.type === "DESIGNATE_DAS" && ratio(a.hex) >= DAS_THREAT_RATIO)
    .sort((a, b) => ratio(b.hex) - ratio(a.hex) || a.hex.localeCompare(b.hex));
  for (const a of choices) {
    // TODO(verify) AER127: reserve must be able to reach this threatened hex.
    const nearby = available.filter(u => flightProblem(ctx, state, u.owner, u.at, a.hex, MISSION_RANGE) === null);
    const units = [...a.units].sort().slice(0, Math.max(0, nearby.length - DAS_RESERVE_PLANES));
    if (units.length) return decision({ ...a, units }, "Defends a threatened hex while keeping a plane in reserve.");
  }
  return undefined;
}

/** AER104/AER109: pure policy dispatch; never changes state, RNG, Options or opt-in flags. */
export function chooseAir(ctx: GameContext, state: GameState, cfg: AiConfig, legal: readonly Action[]): Decision | undefined {
  if (!(cfg.usesAir ?? AI_USES_AIR) || state.position?.part !== "player-turn") return undefined;
  switch (state.position.step) {
    case "6f": return chooseAirStage(ctx, state);
    case "7b": return support(ctx, state, cfg, legal) ?? counterAir(ctx, state);
    case "7c": {
      const action = legal.find(a => a.type === "RESOLVE_COUNTER_AIR");
      return action ? decision(action, "Resolves assigned counter-air.") : undefined;
    }
    case "7d": return defense(ctx, state, legal);
    case "7h": return committedAttack(state, legal);
    default: return undefined;
  }
}

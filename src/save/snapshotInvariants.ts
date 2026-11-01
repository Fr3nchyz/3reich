import type { GameContext } from "../engine/context";
import { ATTRITION_COLUMNS } from "../engine/combat";
import { SEASONS, turnIndex } from "../engine/game";
import { MINOR_COUNTRIES } from "../engine/minors-ids";
import { minorForceEntries } from "../engine/minors";
import { AIR_COMBAT_RULES } from "../engine/air-combat";
import { FLEET_COUNTER_SIZES } from "../engine/naval-record";
import { overstacks } from "../engine/stacking";
import { PLAYER_TURN_STEPS } from "../engine/sequence";
import type { ForceEntry, ForceOwner, GameState } from "../engine/types";
import type { RestoreOptions } from "./restore";

// Spec 11 Parts A/E, TODO(verify) AER55: retain allocated historical ids and temporary
// overstacks. No global storage stack cap exists in the engine (Ops 5.45g/5.48j).
export const SNAPSHOT_REFERENCE_POLICY = "allocated-history";
export const SNAPSHOT_STACK_POLICY = "temporary-overstacks-allowed";
export type SnapshotValidation = { ok: true } | { ok: false; problems: string[] };
type Check = (v: unknown) => boolean;
const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const whole = (min = 0, max = Number.MAX_SAFE_INTEGER): Check => v => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const num = whole();
const bool: Check = v => typeof v === "boolean";
const one = (...values: unknown[]): Check => v => values.includes(v);
const list = (check: Check): Check => v => Array.isArray(v) && Array.from(v).every(check);
const nullable = (check: Check): Check => v => v === null || check(v);
const record = (key: Check, value: Check): Check => v => obj(v) && Object.entries(v).every(([k, x]) => key(k) && value(x));
const fields = (required: Record<string, Check>, optional: Record<string, Check> = {}): Check => v => obj(v) &&
  Object.entries(required).every(([k, check]) => Object.hasOwn(v, k) && check(v[k])) &&
  Object.entries(v).every(([k, x]) => Object.hasOwn(required, k) || (Object.hasOwn(optional, k) && optional[k]!(x)));
const side = one("axis", "allies");
const season: Check = v => SEASONS.includes(v as GameState["season"]);
const turn = fields({ year: whole(1), season });
const turnKey: Check = v => typeof v === "string" && /^\d+-(spring|summer|fall|winter)$/.test(v);
const playerKey: Check = v => typeof v === "string" && /^\d+-(spring|summer|fall|winter)-(axis|allies)$/.test(v);
const front = one("western", "eastern", "mediterranean");
const powers = ["germany", "italy", "ussr", "britain", "france", "usa"];
const power = one(...powers);
const owner = one(...powers, ...MINOR_COUNTRIES, "free-france", "vichy-france");
const colonies = ["albania", "algeria", "egypt", "iraq", "lebanon-syria", "libya", "morocco", "palestine", "transjordan", "tunisia"];
const country = one(...MINOR_COUNTRIES, ...colonies, "eastern-europe");
const fallen = one(...powers, ...MINOR_COUNTRIES, ...colonies, "eastern-europe", "free-france", "vichy-france");
const unitType = one("infantry", "armor", "airborne", "replacement", "air", "fleet", "airbase", "bridgehead");
const entry = fields({ type: unitType, strength: num, count: num }, {
  movement: num, nationality: owner, returned: one(true), from: fields({ year: whole(1) }, { season }),
});

/** Spec 11 Parts A/E, AER55: checks unknown snapshot data without changing it or
 * requiring today's action history to be replayable. Messages name the damaged field.
 */
export function validateSnapshotInvariants(snapshot: unknown, ctx: GameContext): SnapshotValidation {
  const problems: string[] = [];
  if (!obj(snapshot)) return { ok: false, problems: ["The saved position is not an object."] };
  const s = snapshot;
  const check = (path: string, test: Check, value: unknown = s[path]): void => {
    if (!test(value)) problems.push(`The saved ${path} is missing or contains an impossible value.`);
  };
  // Spec 11 A/AER55: ids are allocated monotonically; dead units remain in turn records.
  const id: Check = v => typeof v === "string" && /^u[1-9]\d*$/.test(v) &&
    Number.isSafeInteger(Number(v.slice(1))) && typeof s.nextUnitId === "number" && Number(v.slice(1)) < s.nextUnitId;
  const hex: Check = v => typeof v === "string" && Object.hasOwn(ctx.map.hexes, v);
  const place: Check = v => hex(v) || v === "us-box" || v === "murmansk-box";
  const idFor = (...types: string[]): Check => v => {
    if (!id(v) || !obj(s.units)) return false;
    const u = s.units[v as string];
    return u === undefined || (obj(u) && types.includes(u.type as string));
  };
  const fleets = list(idFor("fleet")), airIds = list(idFor("air"));
  const ids = list(id), hexes = list(hex);
  const control = record(hex, nullable(owner));
  const advance = fields({ to: hex, units: ids }, { armor: one(true), from: hexes, exploit: hex });
  const nation = fields({ id: power, status: one("axis", "allied", "neutral", "vichy", "out", "conquered"),
    brpBase: num, brpTotal: whole(Number.MIN_SAFE_INTEGER), growthRate: num, spendLimit: num, spent: num }, { grantedThisYear: num });
  const unit = fields({ id, owner, type: unitType, strength: num, at: place }, { nationality: owner, movement: num });
  const steps = PLAYER_TURN_STEPS.flatMap(step => [step.id, ...(step.steps?.map(x => x.id) ?? [])]);
  // Spec 11 A/E; Ops 5.0: only representable turn positions and complete major records.
  const required: Record<string, Check> = {
    scenarioId: one(ctx.scenario.id), year: whole(ctx.scenario.start.year, ctx.scenario.end.year), season,
    lastTurn: fields({ year: one(ctx.scenario.end.year), season: one(ctx.scenario.end.season) }),
    firstSide: side, activeSide: side, phase: one("setup", "player-turn", "game-over"),
    position: nullable(v => fields({ part: one("year-start", "russian-winter", "turn-order") })(v) ||
      fields({ part: one("player-turn"), turn: one(1, 2), step: one(...steps) })(v)),
    nations: fields(Object.fromEntries(powers.map(p => [p, nation]))),
    pools: record(owner, fields({ forcePool: list(entry), allowableBuilds: list(entry) })),
    wars: list(v => Array.isArray(v) && v.length === 2 && v.every(owner)),
    strategicWarfare: fields(Object.fromEntries(powers.map(p => [p, fields({ submarines: num, asw: num, sac: num })]))),
    minorAllies: list(fields({ owner, of: power, active: bool })),
    setup: nullable(fields({ order: list(owner), index: num })), units: record(id, unit), nextUnitId: whole(1),
    grants: list(fields({ from: power, to: power, amount: num })),
    noGrants: list(v => Array.isArray(v) && v.length === 2 && v.every(power)),
    frontOptions: record(front, fields({ option: one("offensive", "attrition", "defensive") }, { paidBy: power })),
    fortresses: record(hex, bool), control, rngState: whole(0, 0xffffffff),
  };
  // Spec 11 A/E: additive play records have explicit schemas; no fresh-game exemplars
  // exist for these. Spec 15 R3/R10/R13 and spec 14 R7c retain country/occupation references.
  const optional: Record<string, Check> = {
    unsuppliedAtStart: list(idFor("infantry", "armor", "airborne", "replacement")), airbasesPlaced: record(power, whole(0, 3)),
    countries: record(country, fields({ status: one("neutral", "attacked", "allied") }, {
      attacker: power, toPlace: side, duty: fields({ by: power, declared: turn }), helpers: list(power), closedTo: list(power), opened: one(true),
    })),
    air: fields({ turn: playerKey, placed: list(idFor("airbase")), staged: airIds, controlAtStart: control, groundSupport: record(hex, airIds) }),
    airFlown: fields({ turn: turnKey, units: record(idFor("air"), one("ground-support", "new")) }),
    naval: fields({ gameTurn: turnKey, used: record(idFor("fleet"), one("supply", "intercept", "mission", "escort", "new")),
      turn: playerKey, triedIntercept: fleets, moved: fleets,
      supply: list(fields({ fleets, from: hex, to: hex, units: ids })) }),
    grayFleets: record(idFor("fleet"), turn), moves: fields({ turn: playerKey, moved: ids }),
    sr: fields({ turn: playerKey, used: record(power, num), moved: ids, escorted: record(id, idFor("fleet")) }),
    exploited: record(id, num),
    exploit: fields({ turn: playerKey, groups: list(fields({ hex, from: hexes, placeable: ids, placed: ids, moved: record(id, hexes), attacked: ids })) }),
    combat: fields({ turn: playerKey, attacked: ids, targets: hexes, advances: list(advance),
      pending: nullable(fields({ chooser: side, target: hex, candidates: ids, values: record(id, num), required: num, attackers: ids })) }),
    attrition: fields({ turn: playerKey, done: list(front), used: ids,
      run: nullable(fields({ front, factors: num, column: one(...ATTRITION_COLUMNS), roll: whole(1, 6),
        mustLose: num, hexesLeft: num, participants: ids, against: list(owner), stage: one("losses", "hex", "retreat", "occupy"), chooser: side, taken: hexes },
      { target: hex, retreating: ids, occupiers: ids })) }),
    conquests: list(fields({ country: fallen, by: owner, side, how: one("capital", "all-cities", "surrender", "last-unit", "italian-surrender"), at: turn }, { startingBrps: num })),
    keptHexes: record(hex, fields({ country: fallen, side, to: nullable(owner), was: nullable(owner) })),
    winter: fields({ stage: one("ahead", "postponed", "over"), asking: bool }, {
      inForce: turnKey, postponedFrom: turn, roll: fields({ dice: list(whole(1, 6)), total: num, axisUnits: num, mayPostpone: bool }),
    }),
    siberian: fields({ used: bool, taken: record(turnKey, num) }, { armor: record(turnKey, num) }),
    soviet: fields({ citiesTaken: fields({}, { moscow: bool, leningrad: bool }) }, {
      offer: one("none", "asking", "accepted", "refused"), credited: hexes, shortfallTurn: turnKey, conceding: bool,
    }),
    victory: fields({ checkpoints: record(turnKey, num) }), vitalPaid: fields({}, { gibraltar: bool, suez: bool }),
    result: fields({ winner: nullable(side), level: one(null, "decisive", "tactical", "marginal"),
      basis: one("objectives", "conquest", "powers-conquered", "turn-limit"), objectives: fields({ axis: num, allies: num, nobody: num }),
      at: turn, early: bool, siberian: bool }),
  };
  for (const [key, test] of Object.entries(required)) check(key, test);
  for (const [key, value] of Object.entries(s)) {
    if (Object.hasOwn(optional, key)) check(key, optional[key]!, value);
    else if (!Object.hasOwn(required, key)) problems.push(`The saved position has an unknown field: ${key}.`);
  }
  if (problems.length) return { ok: false, problems };
  // The schemas above establish all nested field types before semantic checks.
  const state = s as unknown as GameState;
  const bad = (message: string): void => { problems.push(message); };
  if (turnIndex(state) < turnIndex(ctx.scenario.start) || turnIndex(state) > turnIndex(ctx.scenario.end)) bad("The saved turn is outside this scenario.");
  if ((state.phase === "setup") !== (state.setup !== null) || (state.phase === "setup") !== (state.position === null)) bad("The saved phase and turn position disagree.");
  if (state.setup && state.setup.index >= state.setup.order.length) bad("The setup owner is outside the deployment order.");
  // Ops 4.1/Ref 5.0: setup placements never store an overstack; movement may.
  if (state.phase === "setup" && overstacks(ctx, state).length) bad("The saved setup has an impossible stack of units.");
  for (const [key, n] of Object.entries(state.nations)) if (n.id !== key) bad(`The nation ${key} has a different name inside its record.`);
  for (const [key, u] of Object.entries(state.units)) if (u.id !== key) bad(`Unit ${key} has a different or duplicate id inside its record.`);
  // Ops 9.0, spec 15 R1/R3, spec 09 R6, spec 17 R1/R3: counts are conserved
  // across live counters and pools; partial air/fleets count factors, not counters.
  // Spec 14 R5/R6: French successor forces share the French counter budget;
  // captured Italian fleets keep their nationality and use the Italian budget.
  const canonical = (o: string): string => o === "free-france" || o === "vichy-france" ? "france" : o;
  const definitions = new Map<string, ForceEntry[]>();
  const add = (o: string, e: ForceEntry): void => { const n = canonical(e.nationality ?? o); definitions.set(n, [...(definitions.get(n) ?? []), e]); };
  for (const [o, f] of Object.entries(ctx.scenario.forces)) for (const e of [...f.forcePool, ...f.allowableBuilds]) add(o, e);
  for (const m of MINOR_COUNTRIES) if (!ctx.scenario.forces[m]) for (const e of minorForceEntries(m)) add(m, e);
  const used = new Map<string, number>();
  const count = (o: ForceOwner, e: Omit<ForceEntry, "count">, quantity: number): void => {
    const n = canonical(e.nationality ?? o);
    const defs = definitions.get(n) ?? [];
    const partial = e.type === "air" || e.type === "fleet";
    const matches = defs.filter(d => d.type === e.type && d.movement === e.movement && (partial || d.strength === e.strength));
    const validStrength = e.type === "air" ? AIR_COMBAT_RULES.counterSizes.includes(e.strength) : e.type === "fleet" ? FLEET_COUNTER_SIZES.includes(e.strength) : matches.length > 0;
    if (!matches.length || !validStrength) bad(`The ${n} ${e.type} counter has no matching unit definition.`);
    const key = `${n}/${e.type}/${e.movement ?? ""}/${partial ? "factors" : e.strength}`;
    const total = (used.get(key) ?? 0) + quantity * (partial ? e.strength : 1);
    used.set(key, total);
    const limit = matches.reduce((sum, d) => sum + d.count * (partial ? d.strength : 1), 0);
    if (total > limit) bad(`There are too many ${n} ${e.type} counters or factors in play and in reserve.`);
  };
  // Ref 20.1: no more than three movable airbase counters per major power.
  for (const p of powers) if (Object.values(state.units).filter(u => u.owner === p && u.type === "airbase").length > 3) bad(`There are too many ${p} airbase counters.`);
  for (const u of Object.values(state.units)) {
    // Ref 20.1: movable bases are created separately, with zero strength and no movement.
    if (u.type === "airbase" && power(u.owner) && u.strength === 0 && u.movement === undefined) continue;
    count(u.owner, u, 1);
  }
  for (const [o, p] of Object.entries(state.pools)) for (const e of [...p.forcePool, ...p.allowableBuilds]) count(o as ForceOwner, e, e.count);
  return problems.length ? { ok: false, problems: [...new Set(problems)] } : { ok: true };
}

/** Spec 11 A/AER55: restore receives a detached validated copy, preserving all data. */
export function createSnapshotValidator(): RestoreOptions["validateSnapshot"] {
  return (snapshot, context) => {
    const result = validateSnapshotInvariants(snapshot, context);
    return result.ok ? JSON.parse(JSON.stringify(snapshot)) as GameState : undefined;
  };
}

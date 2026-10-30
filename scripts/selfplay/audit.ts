import type { GameEvent } from "../../src/engine/actions";
import { controlMap } from "../../src/engine/control";
import type { GameContext } from "../../src/engine/context";
import { objectiveHexes, objectiveStandings, type ObjectiveStandings } from "../../src/engine/objectives";
import { turnKey } from "../../src/engine/victory";
import { surrenderOffer } from "../../src/engine/soviet-record";
import { winterInForce } from "../../src/engine/winter-record";
import { sideOfOwner } from "../../src/engine/setup";
import { srView } from "../../src/engine/sr-region";
import type { GameState, Side } from "../../src/engine/types";
import type { AnomalyKind } from "./types";

/** The checks of spec 14 part E that read a state or the run of states and events: what must never be true after a conquest, a winter, a surrender or the end of a game. */
const GROUND: readonly string[] = ["infantry", "armor", "airborne"];

export interface Finding {
  kind: AnomalyKind;
  detail: string;
}

/** Units and hexes of a conquered nation are gone (spec 14 R4: units and pools removed, home hexes passed, other land nobody's; after a Russian surrender its land stays Russian, R7c; a hex under a ground unit of the conquered nation's own side stays as it is, V12). */
export function auditConquered(ctx: GameContext, state: GameState): Finding[] {
  const out: Finding[] = [];
  for (const c of state.conquests ?? []) {
    const units = Object.values(state.units).filter((u) => u.owner === (c.country as string));
    if (units.length > 0) out.push({ kind: "conquered-unit", detail: `${c.country} was conquered (${turnKey(c.at)}) but ${units.length} of its units are on the map (${units.slice(0, 3).map((u) => `${u.id} at ${u.at}`).join(", ")}${units.length > 3 ? ", ..." : ""})` });
    // A Russian surrender leaves the land Russian-controlled by design (R7c); every other fall passes it on or leaves it nobody's.
    // A hex that holds a ground unit hostile to the conqueror stays as it is (V12, TRAPPED_UNITS_KEEP_ONLY_THEIR_HEX): the conqueror's enemies are the conquered nation's own side.
    const kept = new Set(Object.values(state.units).filter((u) => GROUND.includes(u.type) && sideOfOwner(u.owner) === c.side).map((u) => u.at));
    const hexes = c.how === "surrender" ? [] : [...controlMap(ctx, state)].filter(([hex, owner]) => owner === (c.country as string) && !kept.has(hex)).map(([hex]) => hex);
    if (hexes.length > 0) out.push({ kind: "conquered-hex", detail: `${c.country} was conquered (${turnKey(c.at)}) but still controls ${hexes.length} hexes (${hexes.slice(0, 3).join(", ")}${hexes.length > 3 ? ", ..." : ""})` });
  }
  return out;
}

/** The Objectives count once each and only the hexes the map prints as Objectives (Ref 2.0, 35.0; spec 14 R1): the three lists are disjoint, hold no repeat, and together are the Objective hexes, none of them a capital that is not an Objective. */
export function auditObjectives(ctx: GameContext, state: GameState, s: ObjectiveStandings = objectiveStandings(ctx, state)): Finding[] {
  const out: Finding[] = [];
  const all = [...s.axis, ...s.allies, ...s.nobody];
  const want = new Set(objectiveHexes(ctx));
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const h of all) (seen.has(h) ? twice : seen).add(h);
  if (twice.size > 0) out.push({ kind: "objective-count", detail: `counted more than once: ${[...twice].join(", ")}` });
  const notObjective = all.filter((h) => !want.has(h));
  if (notObjective.length > 0) out.push({ kind: "objective-count", detail: `counted though the map does not print it as an Objective (a capital only?): ${[...new Set(notObjective)].join(", ")}` });
  const missing = [...want].filter((h) => !seen.has(h));
  if (missing.length > 0) out.push({ kind: "objective-count", detail: `not counted for anyone: ${missing.join(", ")}` });
  return out;
}

/** A game that has ended carries its result, and a result belongs to an ended game; the result counts the Objectives as the standings do. */
export function auditEnd(ctx: GameContext, state: GameState): Finding[] {
  const out: Finding[] = [];
  if (state.phase === "game-over" && !state.result) out.push({ kind: "no-result", detail: "the game is over but has no result" });
  if (state.result && state.phase !== "game-over") out.push({ kind: "no-result", detail: "a result is recorded but the game is not over" });
  if (state.result) {
    const s = objectiveStandings(ctx, state);
    const o = state.result.objectives;
    if (o.axis !== s.axis.length || o.allies !== s.allies.length || o.nobody !== s.nobody.length) out.push({ kind: "objective-count", detail: `the result counts Objectives Axis ${o.axis}, Allies ${o.allies}, nobody ${o.nobody}; the standings are ${s.axis.length}, ${s.allies.length}, ${s.nobody.length}` });
  }
  return out;
}

/**
 * Watches a game action by action for the checks that need the sequence: the Russian winter is in force for exactly one Game Turn (Ref 28.0), and the
 * surrender is offered at most once (V18). Feed every action with `step`, then call `finish`.
 */
export class SequenceAudit {
  private winterStarts: string[] = [];
  private forceTurns = new Set<string>();
  private offers = 0;
  private asking = false;
  private found = new Set<string>();

  private flag(out: Finding[], kind: AnomalyKind, detail: string): void {
    if (this.found.has(`${kind}|${detail}`)) return;
    this.found.add(`${kind}|${detail}`);
    out.push({ kind, detail });
  }

  step(events: readonly GameEvent[], after: GameState): Finding[] {
    const out: Finding[] = [];
    const key = turnKey(after);
    for (const e of events) {
      if (e.type === "WINTER_STARTED") {
        this.winterStarts.push(turnKey(e.turn));
        if (this.winterStarts.length > 1) this.flag(out, "winter-length", `the winter started ${this.winterStarts.length} times (${this.winterStarts.join(", ")})`);
      }
      if (e.type === "RUSSIA_OFFERS_SURRENDER") {
        this.offers++;
        if (this.offers > 1) this.flag(out, "surrender-twice", `Russia offered to surrender ${this.offers} times`);
      }
    }
    if (winterInForce(after)) this.forceTurns.add(key);
    // Fewer: once started, the rule holds in every state of that Game Turn. More: it holds in no other Game Turn.
    const started = this.winterStarts[0];
    if (started !== undefined && key === started && !winterInForce(after)) this.flag(out, "winter-length", `the winter started in ${started} but is not in force in a later state of that Game Turn`);
    if (this.forceTurns.size > 1) this.flag(out, "winter-length", `the winter was in force in ${this.forceTurns.size} Game Turns (${[...this.forceTurns].join(", ")})`);
    const asking = surrenderOffer(after) === "asking";
    if (asking && !this.asking && this.offers > 1) this.flag(out, "surrender-twice", "the surrender offer went back to asking");
    this.asking = asking;
    return out;
  }

  /** The checks that need the whole game: a winter that started was seen in force, and one seen in force did start. */
  finish(): Finding[] {
    const out: Finding[] = [];
    const started = this.winterStarts[0];
    if (started !== undefined && !this.forceTurns.has(started)) this.flag(out, "winter-length", `the winter started in ${started} but was never in force in that Game Turn`);
    if (started === undefined && this.forceTurns.size > 0) this.flag(out, "winter-length", `the winter was in force in ${[...this.forceTurns].join(", ")} but never started`);
    return out;
  }
}

/** The conquests of a game in words, in order: "Poland by germany (capital, Fall 1939)". */
export function conquestList(state: GameState): string[] {
  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
  return (state.conquests ?? []).map((c) => `${c.country} by ${c.by} (${c.how}, ${cap(c.at.season)} ${c.at.year})`);
}

/** A game played "to the end" that stopped without a result and without any other anomaly to explain it. */
export const endedWithoutResult = (turns: number | "end", ended: "game-over" | "turn-limit" | "stopped", anomalyCount: number): boolean => turns === "end" && ended !== "game-over" && anomalyCount === 0;

/** A redeployment never ends on, or next to, an enemy unit (Ref 11.72; spec 16 R20): the engine refuses it, so this is a check on the engine and on the computer's choice. */
export function auditRedeployed(ctx: GameContext, events: readonly GameEvent[], after: GameState, side: Side): Finding[] {
  const moved = events.filter((e) => e.type === "UNITS_REDEPLOYED");
  if (moved.length === 0) return [];
  const view = srView(ctx, after, side);
  return moved.filter((e) => view.blocked.has(e.to)).map((e) => ({ kind: "redeploy-near-enemy", detail: `${e.units.join(", ")} of ${e.nation} were redeployed from ${e.from} to ${e.to}, on or next to an enemy unit` }));
}

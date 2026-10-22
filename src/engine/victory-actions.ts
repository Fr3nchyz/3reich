import type { Action, ActionResult } from "./action-types";
import type { GameContext } from "./context";
import { isGone } from "./nations";
import type { UnitSpec } from "./placement";
import { SIBERIAN_QUOTAS, TAKEN_TYPES, siberianCities, siberianLeft, siberianOptions, siberianPlaces, siberianPool, siberianTakenNow } from "./siberian";
import { acceptSurrender, refuseSurrender } from "./soviet-surrender";
import { surrenderAsking } from "./soviet-record";
import type { GameState, Unit } from "./types";
import { turnKey } from "./victory";

/**
 * The actions of the victory rules (spec 14 C3). The Free Siberian Transfer (R11, step 8a) is at the end of the file. The action of the Russian surrender (R7b to R7d): at step 10a the Axis answers Russia's one-time offer. Legal only while the offer waits, and only for the
 * Axis (the Allied Player Turn is the active one, but the Allies are not asked; `sideToAct` says so). The answer leaves the game at step 10a with the offer settled;
 * `actions.ts` moves it on, as it does after `CHOOSE_WINTER`. Refusals name the reason, and bad input never throws.
 */

/** The two answers the Axis may give, accepting first. Empty when no offer waits. */
export function legalSurrenderActions(state: GameState): Action[] {
  return surrenderAsking(state) ? [{ type: "SURRENDER_ANSWER", side: "axis", accept: true }, { type: "SURRENDER_ANSWER", side: "axis", accept: false }] : [];
}

/** The Axis answers. The state returned is still at step 10a with nothing asked, and may have ended the game (a conquest that decides it). */
export function applySurrenderAnswer(ctx: GameContext, state: GameState, action: Extract<Action, { type: "SURRENDER_ANSWER" }>): ActionResult {
  if (!surrenderAsking(state)) return { ok: false, error: "No offer to surrender is waiting for an answer." };
  if (action.side !== "axis") return { ok: false, error: `The Axis answers Russia's offer to surrender, not the ${String(action.side)} side.` };
  if (typeof action.accept !== "boolean") return { ok: false, error: "Russia's offer to surrender is either accepted or refused." };
  const done = action.accept ? acceptSurrender(ctx, state) : refuseSurrender(state);
  return { ok: true, state: done.state, events: done.events };
}

type SiberianAction = Extract<Action, { type: "SIBERIAN_TRANSFER" }>;


/** Every unit the Allies may take now: one action per counter and city; empty when nothing may be taken or no city can hold it. */
export function legalSiberian(ctx: GameContext, state: GameState): SiberianAction[] {
  const { entries } = siberianOptions(state);
  if (entries.length === 0) return [];
  const cities = siberianCities(ctx, state);
  const seen = new Set<string>();
  const out: SiberianAction[] = [];
  for (const e of entries) {
    const key = `${e.type}:${e.strength}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const at of siberianPlaces(ctx, state, cities, e)) out.push({ type: "SIBERIAN_TRANSFER", side: "allies", unit: { type: e.type, strength: e.strength }, at });
  }
  return out;
}

const turnName = (state: GameState): string => `${state.season.charAt(0).toUpperCase()}${state.season.slice(1)} ${state.year}`;

/** One unit is taken from the Russian pool and placed (R11). Refusals name the rule. */
export function applySiberian(ctx: GameContext, state: GameState, action: SiberianAction): ActionResult {
  if (action.side !== "allies") return { ok: false, error: "The Free Siberian Transfer belongs to the Allies." };
  if (state.activeSide !== "allies") return { ok: false, error: "The Free Siberian Transfer is made in the Allied Player Turn." };
  const nation = state.nations.ussr;
  if (!nation || isGone(nation)) return { ok: false, error: "The U.S.S.R. has left the game, so there is nothing to take." };
  const quota = SIBERIAN_QUOTAS[turnKey(state)];
  if (quota === undefined) return { ok: false, error: `There is no Free Siberian Transfer in ${turnName(state)}: it is made from Winter 1941 to Fall 1942.` };
  if (siberianLeft(state) <= 0) return { ok: false, error: `The Allies have taken all ${quota} units the Free Siberian Transfer allows in ${turnName(state)}.` };
  if (typeof action.unit !== "object" || action.unit === null) return { ok: false, error: "A Free Siberian Transfer names the counter to take: its kind and strength." };
  const { type, strength } = action.unit;
  if (type === "airborne") return { ok: false, error: "Airborne units cannot be taken in the Free Siberian Transfer." };
  if (!TAKEN_TYPES.includes(type)) return { ok: false, error: "Only infantry and armor can be taken in the Free Siberian Transfer." };
  const entry = siberianPool(state).find((e) => e.type === type && e.strength === strength);
  if (!entry) return { ok: false, error: `The Russian Force Pool has no ${String(strength)}-factor ${type} to take now (none left, or not yet allowed).` };
  const { infantry, armor } = siberianTakenNow(state);
  if (type === "armor" && armor + 1 > infantry) return { ok: false, error: "Armor taken in the Free Siberian Transfer may not outnumber the infantry taken: take infantry first." };
  const spec: UnitSpec = { type, strength: entry.strength };
  if (!siberianPlaces(ctx, state, siberianCities(ctx, state), spec).includes(action.at)) {
    return { ok: false, error: `A ${entry.strength}-factor ${type} cannot be placed at ${String(action.at)}: it goes in a Russian city held by the U.S.S.R. that has a supply line to the east edge of the map, and fits the stacking limit.` };
  }
  const id = `u${state.nextUnitId}`;
  const unit: Unit = { id, owner: "ussr", type, strength: entry.strength, ...(entry.movement !== undefined ? { movement: entry.movement } : {}), at: action.at };
  const pool = state.pools.ussr!;
  const key = turnKey(state);
  const record = state.siberian ?? { used: false, taken: {} };
  const firstUse = !record.used;
  const siberian = {
    used: true,
    taken: { ...record.taken, [key]: (record.taken[key] ?? 0) + 1 },
    armor: { ...record.armor, [key]: (record.armor?.[key] ?? 0) + (type === "armor" ? 1 : 0) },
  };
  const next: GameState = {
    ...state,
    nextUnitId: state.nextUnitId + 1,
    units: { ...state.units, [id]: unit },
    pools: { ...state.pools, ussr: { ...pool, allowableBuilds: pool.allowableBuilds.map((e) => (e === entry ? { ...e, count: e.count - 1 } : e)).filter((e) => e.count > 0) } },
    siberian,
  };
  return { ok: true, state: next, events: [{ type: "SIBERIAN_TRANSFER_USED", unitId: id, unitType: type, strength: entry.strength, at: action.at, left: siberianLeft(next), firstUse }] };
}

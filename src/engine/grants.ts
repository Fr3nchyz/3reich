import type { Action, ActionResult, GameEvent } from "./action-types";
import { isEnemy, neighborIds } from "./attack-rules";
import { capitalOf } from "./capital";
import { isConquered } from "./conquest-record";
import type { GameContext } from "./context";
import { hex, hexsideId } from "./hex";
import { POWER_NAMES } from "./nations";
import { srOf } from "./sr-record";
import { srAllowanceProblem, srGrantCost } from "./sr-rules";
import { sovietCityAt, sovietCityHexes } from "./soviet";
import { surrenderOffer } from "./soviet-record";
import { spend, spendable } from "./brps";
import { turnIndex } from "./game";
import type { GameState, PowerId } from "./types";
import { atWar, sideOfPower } from "./war";

/**
 * BRP grants (Ref 11.71, step 9a, spec 02): a Major Power gives BRPs to an allied Major Power. The
 * giver pays out of the Player Turn's spending limit (Ref 11.6 counts grants with construction).
 *
 * Rules (from the rulebook text, see docs/RULES.md "Web research"): up to 40 BRPs to one allied Major
 * Power per turn; the Western Allies together up to 40 to the U.S.S.R.; the U.S.S.R. may not grant at
 * all, and may not receive until it is at war with Germany (Ref 11.71, PC Reference Manual: "may not Grant BRPs at all"); France and the U.S.A. cannot grant before Spring
 * 1942; a receiver may not grant back to its giver for the rest of the game.
 *
 * A Major Power may also grant at most half its yearly allotment, counted after Strategic Warfare construction, in a year (Ref 11.71). The allotment
 * is read as the BRP total the Year Start Sequence left it, so half of it is `spendLimit`; `grantedThisYear` counts what it has granted since.
 * TODO(verify): Strategic Warfare construction is not built, so nothing is deducted before `spendLimit` is set (yearstart.ts). The 1939 and
 * Campaign setups, which start with no sequence, count from 0.
 *
 * Spec 16 R21 (Ref 11.72, 11.71; TODO(verify) AER30): every 20 BRPs or part uses one of the giver's redeployments in the shared SrRecord.
 * Enemy counters next to either capital block a grant; the receiving U.S.S.R. ignores the Moscow block until surrender or conquest.
 * "Next to" uses a land hexside, as R20 does, not open water or a Crossing Arrow. All counter types count here: R21 says "enemy unit",
 * whereas R20's ground-only reading is AER23. In Beta, grants across the sea need no escort (AER30); escorts remain Release 1, ticket 16-23.
 */

export const GRANT_LIMIT = 40;

const WEST: readonly PowerId[] = ["britain", "france", "usa"];

type GrantAction = Extract<Action, { type: "GRANT_BRPS" }>;

const granted = (state: GameState, from: PowerId, to: PowerId): number =>
  state.grants.filter((g) => g.from === from && g.to === to).reduce((n, g) => n + g.amount, 0);

/** The most `from` may grant `to` now under the 40-BRP cap and its own spending limit; 0 means no grant is allowed. */
export function grantRoom(state: GameState, from: PowerId, to: PowerId): number {
  const giver = state.nations[from];
  const receiver = state.nations[to];
  if (!giver || !receiver || from === to) return 0;
  const side = sideOfPower(giver);
  if (side === null || side !== state.activeSide || sideOfPower(receiver) !== side) return 0;
  if (state.noGrants.some(([g, r]) => g === from && r === to)) return 0;
  if (from === "ussr" || (to === "ussr" && !atWar(state, "ussr", "germany"))) return 0; // Ref 11.71: the U.S.S.R. never grants
  if ((from === "france" || from === "usa") && turnIndex(state) < turnIndex({ year: 1942, season: "spring" })) return 0;
  const cap = to === "ussr" ? GRANT_LIMIT - WEST.reduce((n, w) => n + granted(state, w, "ussr"), 0) : GRANT_LIMIT - granted(state, from, to);
  const yearRoom = giver.spendLimit - (giver.grantedThisYear ?? 0);
  return Math.max(0, Math.min(cap, spendable(giver), yearRoom));
}

/** Capital-to-capital block (Ref 11.72, 11.71; spec 16 R21; TODO(verify) AER30). The U.S.A. has no capital hex on this map. */
function capitalGrantProblem(ctx: GameContext, state: GameState, from: PowerId, to: PowerId): string | null {
  if (to === "ussr" && (isConquered(state, "ussr") || surrenderOffer(state) === "accepted")) return "The U.S.S.R. cannot receive grants after surrender or conquest.";
  for (const power of [from, to]) {
    const capital = power === "ussr" ? sovietCityHexes(ctx).find((h) => sovietCityAt(ctx, h) === "moscow") : capitalOf(ctx, power);
    if (power === to && power === "ussr") continue; // R21: the receiving Soviet Union alone has the Moscow exception.
    if (!capital) continue;
    const near = new Set(neighborIds(ctx, capital).filter((h) => ctx.map.hexsides[hexsideId(hex(capital), hex(h))]?.land === true));
    if (Object.values(state.units).some((u) => near.has(u.at) && isEnemy(state, power, u.owner))) return `An enemy unit is next to ${POWER_NAMES[power]}'s capital, so this grant cannot travel (Ref 11.72).`;
  }
  return null;
}

/** The grants the side to move may make now, in steps of 10 BRPs (any whole amount up to the room is legal). */
export function legalGrants(ctx: GameContext, state: GameState): GrantAction[] {
  const out: GrantAction[] = [];
  const powers = Object.keys(state.nations) as PowerId[];
  for (const from of powers) {
    for (const to of powers) {
      const room = grantRoom(state, from, to);
      if (room === 0 || capitalGrantProblem(ctx, state, from, to)) continue;
      const fits = (amount: number) => srAllowanceProblem(srOf(state).used, { [from]: srGrantCost(amount) }) === null;
      for (let amount = 10; amount <= room; amount += 10) if (fits(amount)) out.push({ type: "GRANT_BRPS", from, to, amount });
      if (room > 0 && room % 10 !== 0 && fits(room)) out.push({ type: "GRANT_BRPS", from, to, amount: room });
    }
  }
  return out;
}

export function applyGrant(ctx: GameContext, state: GameState, action: GrantAction): ActionResult {
  const { from, to, amount } = action;
  if (!state.nations[from] || !state.nations[to]) return { ok: false, error: "A grant is between two Major Powers in this game." };
  if (!Number.isInteger(amount) || amount < 1) return { ok: false, error: `${amount} BRPs is not a grant.` };
  const room = grantRoom(state, from, to);
  if (room === 0) return { ok: false, error: `${from} may not grant BRPs to ${to} now: it must be an allied Major Power, within the 40-BRP cap, the spending limit and the half-allotment cap for the year, and the rules must allow it.` };
  if (amount > room) return { ok: false, error: `${from} may grant at most ${room} BRPs to ${to} now.` };
  const blocked = capitalGrantProblem(ctx, state, from, to);
  if (blocked) return { ok: false, error: blocked };
  const rec = srOf(state), cost = srGrantCost(amount);
  const allowance = srAllowanceProblem(rec.used, { [from]: cost });
  if (allowance) return { ok: false, error: allowance };
  const paid = spend(state, from, amount, `a grant to ${to}`);
  if (!paid.ok) return paid;
  const receiver = paid.state.nations[to];
  const total = receiver.brpTotal + amount;
  const events: GameEvent[] = [paid.event, { type: "BRPS_CHANGED", nation: to, delta: amount, total, reason: `a grant from ${from}` }, { type: "BRPS_GRANTED", from, to, amount }];
  return {
    ok: true,
    state: {
      ...paid.state,
      sr: { ...rec, used: { ...rec.used, [from]: (rec.used[from] ?? 0) + cost } },
      nations: { ...paid.state.nations, [from]: { ...paid.state.nations[from], grantedThisYear: (paid.state.nations[from].grantedThisYear ?? 0) + amount }, [to]: { ...receiver, brpTotal: total } },
      grants: [...paid.state.grants, { from, to, amount }],
      noGrants: state.noGrants.some(([g, r]) => g === to && r === from) ? paid.state.noGrants : [...paid.state.noGrants, [to, from]],
    },
    events,
  };
}

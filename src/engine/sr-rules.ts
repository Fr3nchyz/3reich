import type { ForceOwner, GameState, PowerId, Unit, UnitType } from "./types";
import { isMajorPower } from "./war";

/**
 * Strategic Redeployment, step 9e (Ref 11.72, 11.71, 17.1, 22.0; Ops 5.48e; spec 16 R18 to R21): the facts and the pure counting rules.
 * Which hexes a unit may reach and whether a redeployment is legal are sr-region.ts. Nothing here changes a state; step 9e is ticket 16-17.
 */

/** Units each Major Power may redeploy per Player Turn (Ref 11.72; spec 16 R18). */
export const SR_ALLOWANCE: Readonly<Record<PowerId, number>> = {
  usa: 10,
  germany: 9,
  britain: 7,
  ussr: 6,
  italy: 5,
  france: 5,
};

/** Each grant of this many BRPs or part uses one redeployment (Ref 11.72, 11.71; spec 16 R21). TODO(verify): AER30. */
export const SR_BRPS_PER_REDEPLOYMENT = 20;

/** The counters redeployed in Beta: ground units and Replacements (Ref 11.72, 22.0; spec 16 R19). Air units, airbases and fleets are Release 1 (R23, AER32). */
export const SR_UNIT_TYPES: readonly UnitType[] = ["infantry", "armor", "airborne", "replacement"];

/** Counters whose allowance is another Major Power's by this table: Free French units use Britain's (spec 16 R18). TODO(verify): AER26. */
export const SR_ALLOWANCE_OF: Readonly<Partial<Record<ForceOwner, PowerId>>> = { "free-france": "britain" };

/**
 * Counters that are not redeployed in Beta: Polish units (spec 16 R18, spec 15 part H) and Vichy units (Vichy takes no side). TODO(verify): AER26.
 * A minor country's own units are spec 15's; they have no owner of their own in this engine (`ForceOwner`).
 */
export const SR_NOT_REDEPLOYED: readonly ForceOwner[] = ["poland", "vichy-france"];

/** Redeployments each Major Power has used this Player Turn (the step 9e record of ticket 16-17 holds it). Absent means none. */
export type SrUsed = Readonly<Partial<Record<PowerId, number>>>;

/**
 * The Major Power whose allowance a unit uses (spec 16 R18), or null when no allowance can move it in Beta. The counter's nationality comes
 * first (an Italian counter Germany holds counts for Italy, AER26); a Major Power's own counter uses its own allowance; a Free French counter
 * uses Britain's (AER26); a Minor-Ally's counter uses its Major Power's (Ref 17.1); Polish and Vichy counters use none (AER26).
 */
export function srNationOf(state: Pick<GameState, "minorAllies">, unit: Pick<Unit, "owner" | "nationality">): PowerId | null {
  const nation = unit.nationality ?? unit.owner;
  if (SR_NOT_REDEPLOYED.includes(nation)) return null;
  if (isMajorPower(nation)) return nation;
  return SR_ALLOWANCE_OF[nation] ?? state.minorAllies.find((m) => m.owner === nation)?.of ?? null;
}

/** Redeployments a Major Power has left this Player Turn: its allowance less what it used; never below 0, never handed on, never saved (Ref 11.72; R18). */
export const srLeft = (used: SrUsed, power: PowerId): number => Math.max(0, SR_ALLOWANCE[power] - (used[power] ?? 0));

/**
 * What redeploying these units costs, per Major Power: one each, whatever its size (Ref 11.72; R18). Units no allowance can move
 * (`srNationOf` null) are left out: `srProblem` refuses them first.
 */
export function srUnitCost(state: Pick<GameState, "minorAllies">, units: readonly Pick<Unit, "owner" | "nationality">[]): Partial<Record<PowerId, number>> {
  const cost: Partial<Record<PowerId, number>> = {};
  for (const u of units) {
    const nation = srNationOf(state, u);
    if (nation) cost[nation] = (cost[nation] ?? 0) + 1;
  }
  return cost;
}

/** Redeployments a grant of this many BRPs uses: one per 20 BRPs or part (Ref 11.72, 11.71; R21, AER30); nothing for no BRPs. */
export const srGrantCost = (brps: number): number => (Number.isFinite(brps) && brps > 0 ? Math.ceil(brps / SR_BRPS_PER_REDEPLOYMENT) : 0);

/** Why this cost does not fit what each Major Power has left (Ref 11.72; R18), or null when it fits. Powers are checked in a fixed order. */
export function srAllowanceProblem(used: SrUsed, cost: Readonly<Partial<Record<PowerId, number>>>): string | null {
  for (const power of Object.keys(SR_ALLOWANCE) as PowerId[]) {
    const need = cost[power] ?? 0;
    const left = srLeft(used, power);
    if (need > left) return `${power} has ${left} of ${SR_ALLOWANCE[power]} redeployments left this Player Turn and this needs ${need}.`;
  }
  return null;
}

import { navalAdvantageDrm, navalNationalityDrm, type NavalNation } from "./tables";

/** Participating naval factors only (spec 12 R12, Ref 21.51). No game state is read or changed. */
export interface NavalForce {
  factors: number;
  /** A mixed force uses its lowest nationality DRM (spec 12 R12.1). */
  nationalities: readonly NavalNation[];
  mayBreakOff: boolean;
}

export interface NavalCombatRules {
  /** TODO(verify) (N27, spec 12 part J.19): round the final difference * factors / 9, not the fleet count. */
  multipliedLossRounding: "floor" | "ceil";
}

/** TODO(verify) (N27): partial factors after multiplication are rounded down by default. */
export const NAVAL_COMBAT_RULES: Readonly<NavalCombatRules> = Object.freeze({ multipliedLossRounding: "floor" });

export interface NavalCombatOptions {
  /** Spec 12 R12.1, N28: location of the battle, not the force's base. False includes row N. */
  battleNorthOfRowN?: boolean;
  /** Spec 12 R12.3: chosen before rolling; only the interceptor may break off. */
  breakOff?: boolean;
  rules?: Readonly<NavalCombatRules>;
}

export interface NavalSideResult {
  factors: number;
  nationalityDrm: number;
  advantageDrm: number;
  modifiedRoll: number;
  loss: number;
}

export interface NavalCombatResult {
  interceptor: NavalSideResult;
  intercepted: NavalSideResult;
  winner: "interceptor" | "intercepted";
  breakOff: boolean;
}

function checkForce(name: string, force: NavalForce): void {
  if (!Number.isInteger(force.factors) || force.factors < 0) throw new RangeError(`${name} factors must be a nonnegative whole number`);
  if (force.factors > 0 && force.nationalities.length === 0) throw new RangeError(`${name} needs a nationality`);
}

function checkDie(name: string, die: number): void {
  if (!Number.isInteger(die) || die < 1 || die > 6) throw new RangeError(`${name} must be a die roll 1-6`);
}

/** Spec 12 R12.1, Ref 21.51: use the existing verified charts, with the lowest nationality modifier. */
function side(own: NavalForce, enemy: NavalForce, die: number, north: boolean): NavalSideResult {
  const nationalityDrm = own.nationalities.length ? Math.min(...own.nationalities.map((nation) => navalNationalityDrm(nation, north))) : 0;
  const advantageDrm = navalAdvantageDrm(own.factors, enemy.factors);
  return { factors: own.factors, nationalityDrm, advantageDrm, modifiedRoll: die + nationalityDrm + advantageDrm, loss: 0 };
}

/**
 * Spec 12 R12, Ref 21.51: resolve caller-supplied dice. Losses are factors owed; the caller later
 * assigns them to fleets and uses breakDownFleet. Returning to port and missions are outside this resolver.
 * Throws RangeError for invalid forces, dice or an ineligible break-off request.
 */
export function resolveNavalCombat(
  interceptor: NavalForce,
  intercepted: NavalForce,
  dice: { interceptor: number; intercepted: number },
  options: NavalCombatOptions = {},
): NavalCombatResult {
  checkForce("interceptor", interceptor);
  checkForce("intercepted", intercepted);
  checkDie("interceptor die", dice.interceptor);
  checkDie("intercepted die", dice.intercepted);
  if (interceptor.factors === 0 && intercepted.factors === 0) throw new RangeError("no naval factors take part");
  if (options.breakOff && !interceptor.mayBreakOff) throw new RangeError("interceptor may not break off");
  const rules = options.rules ?? NAVAL_COMBAT_RULES;
  const a = side(interceptor, intercepted, dice.interceptor, options.battleNorthOfRowN ?? false);
  const b = side(intercepted, interceptor, dice.intercepted, options.battleNorthOfRowN ?? false);
  // Spec 12 R12: ties belong to the interceptor; breaking off automatically loses (R12.3).
  const breakOff = options.breakOff ?? false;
  const winner = breakOff ? "intercepted" : a.modifiedRoll >= b.modifiedRoll ? "interceptor" : "intercepted";
  const result: NavalCombatResult = { interceptor: a, intercepted: b, winner, breakOff };
  // Spec 12 R12.3: a breaker that wins the modified roll causes no losses to either side.
  if (breakOff && a.modifiedRoll > b.modifiedRoll) return result;
  const [won, lost] = winner === "interceptor" ? [a, b] : [b, a];
  let owed = Math.abs(a.modifiedRoll - b.modifiedRoll);
  // Spec 12 R12.2, part J.19 (N27): 18+ participating factors multiply the difference by factors / 9.
  if (lost.factors >= 18) {
    const multiplied = owed * lost.factors / 9;
    owed = rules.multipliedLossRounding === "floor" ? Math.floor(multiplied) : Math.ceil(multiplied);
  }
  // Spec 12 R12.2-.3: normal losses cannot exceed strength; break-off halves both loss and cap.
  lost.loss = breakOff ? Math.min(Math.floor(owed / 2), Math.floor(lost.factors / 2)) : Math.min(owed, lost.factors);
  // Spec 12 R12.2-.3: winner owes half the loser's actual (possibly reduced) loss, rounded down.
  won.loss = Math.floor(lost.loss / 2);
  return result;
}

import { combatOf } from "./combat-record";
import { fightingRecord } from "./minors-intervene";
import { MINOR_COUNTRY_FORCES } from "./tables";
import type { ForceOwner, GameState, Unit } from "./types";

/**
 * Spec 15 R15 (Ref 14.0, 15.0; Ops 5.43): the own turn of an attacked, un-helped minor, played at step 4 of its controller's Player Turn, before the controller's own Movement Phase.
 * One window for all such minors of the active side: a Movement Phase (ground movement, inside the minor's borders, R8), then one combat phase (attack with no advance over the
 * border, R8), or a Pass (END_STEP). The minor's units act ONLY here: they no longer move at 6f nor attack at 7h (they would act twice). Pure functions over the state.
 */

/**
 * TODO(verify) MC26, spec 15 R15: Poland (attacked from the opening setup, played as a Major Power by the Allied side in the recorded games) has no step-4 turn of its own and keeps
 * moving at 6f and attacking at 7h, as `MC26_POLAND_MOVES_FREELY` (15-6) already lets it. On: Poland's units too act only at step 4 (and are held to their country by the home limit).
 */
export const MC26_POLAND_OWN_TURN = false;

/**
 * TODO(verify) MC15, spec 15 R14/R15: the combat phase of a minor's own turn is implicitly Offensive: no Option is chosen for it (step 3 chooses none per minor) and nothing is paid
 * (as R14, MC15: "nothing says a minor pays"). The only choice is to attack or to Pass (END_STEP). Off: not built (would need a per-minor Option map).
 */
export const MC15_MINOR_OPTION_IMPLICIT = true;

const isMinorOwner = (o: ForceOwner): boolean => Object.hasOwn(MINOR_COUNTRY_FORCES, o);

/** Whether the game stands at a position of a Player Turn (an old save or a bare test state without one keeps the old rules: the minor acts at 6f and 7h). */
const inPlayerTurn = (state: GameState): boolean => state.phase === "player-turn" && state.position?.part === "player-turn";

/** Whether the game waits at step 4, the minors' own turn. */
export const atMinorTurn = (state: GameState): boolean => state.phase === "player-turn" && state.position?.part === "player-turn" && state.position.step === "4";

/** Whether this owner is an attacked, un-helped (`attacked`, not `allied`), unconquered minor: one that plays its own turn at step 4. */
export function ownTurnMinor(state: GameState, owner: ForceOwner): boolean {
  if (!isMinorOwner(owner) || (owner === "poland" && !MC26_POLAND_OWN_TURN)) return false;
  return fightingRecord(state, owner)?.status === "attacked";
}

/** Why this unit may not act now because of the split between the minors' turn and the controller's (movement and combat both ask), or null. */
export function minorTurnProblem(state: GameState, u: Pick<Unit, "id" | "owner">): string | null {
  if (!inPlayerTurn(state)) return null;
  const own = ownTurnMinor(state, u.owner);
  if (own && !atMinorTurn(state)) return `${u.id} belongs to an attacked minor: it moves and attacks in its own turn, step 4 (R15).`;
  if (!own && atMinorTurn(state)) return `${u.id} does not act in step 4: only the attacked minors' own units do (R15).`;
  return null;
}

/** Whether a minor has already attacked in this step 4: its Movement Phase is over (movement comes before combat inside the one step). */
export const minorHasAttacked = (state: GameState): boolean => atMinorTurn(state) && combatOf(state).attacked.length > 0;

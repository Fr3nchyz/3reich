/**
 * The computer's policies for the three prompts of spec 14 (part E), in one place. Each is a policy of the computer, not a rule of the game: it only picks one
 * of the answers the engine already lists as legal, so changing a value never makes an action illegal. They are plain constants (no tuning at run time); the
 * choosers in `winter.ts`, `surrender.ts` and `siberian.ts` read them, and those files re-export them for the tests that name them there.
 * The fixed-seed recordings (tests/ai-stability.test.ts) hold the values as they are: changing one changes games, so list it in the pull request.
 */

/** II.A, the Allies: postpone the Russian winter whenever the dice allow it. The dice only allow it when few Axis units stand in Russia (spec 14 R10). TODO(verify) V44: policy only. */
export const WINTER_POSTPONE_WHEN_ALLOWED = true;

/** 10a, the Axis: accept Russia's offer to surrender (spec 14 Q5, recommended yes). It does not weigh the Occupation Force (ticket 14-21, Release 1). TODO(verify) V52: policy only. */
export const ACCEPT_SURRENDER = true;

/** 8a, the Allies: take every unit on offer in the Free Siberian Transfer, infantry first. It does not weigh that the first unit taken raises the Allied target by one Objective. TODO(verify) V61: policy only. */
export const SIBERIAN_TAKE_ALL = true;

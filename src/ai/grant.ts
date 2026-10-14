import type { Action } from "../engine/actions";
import { POWER_NAMES } from "../engine/nations";
import type { GameState } from "../engine/types";
import { best } from "./random";
import type { AiConfig, Decision } from "./types";

/**
 * Step 9a, BRP grants. The computer grants only what the engine lists as legal, and only to an
 * ally that is short: its total is under GRANT_RECEIVER_BELOW and the giver has at least twice as
 * many. It grants GRANT_STEP BRPs at a time, and since a grant raises the receiver's total the
 * step always ends.
 * TODO(verify): both numbers are the computer's own policy, to be tuned by play-testing (spec 05).
 */
export const GRANT_RECEIVER_BELOW = 60;
export const GRANT_STEP = 10;

type Grant = Extract<Action, { type: "GRANT_BRPS" }>;

export function chooseGrant(state: GameState, legal: readonly Action[], cfg: AiConfig): Decision | undefined {
  const grants = legal.filter((a): a is Grant => {
    if (a.type !== "GRANT_BRPS" || a.amount !== GRANT_STEP) return false;
    const [from, to] = [state.nations[a.from], state.nations[a.to]];
    return from.brpTotal >= 2 * to.brpTotal && to.brpTotal < GRANT_RECEIVER_BELOW;
  });
  // The neediest ally first.
  const pick = best(grants, (a) => -state.nations[a.to].brpTotal, cfg.seed, (a) => `${a.from}:${a.to}`);
  if (!pick) return undefined;
  return { action: pick, why: `${POWER_NAMES[pick.from]} helps ${POWER_NAMES[pick.to]}, which is short of BRPs (${state.nations[pick.to].brpTotal}).` };
}

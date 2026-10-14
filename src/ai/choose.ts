import { legalActions, type Action } from "../engine/actions";
import type { GameContext } from "../engine/context";
import { FIRST_STEP, LAST_STEP } from "../engine/sequence";
import type { GameState } from "../engine/types";
import { chooseBuild } from "./build";
import { chooseDeclaration } from "./declare";
import { chooseGrant } from "./grant";
import type { AiConfig, Decision } from "./types";

/**
 * The computer's next action for the side to move, chosen from legalActions only; null when the
 * game waits for nothing (setup, game over). A step the computer has no plan for is ended, and a
 * step is always ended once the chooser has nothing more to do, so it never loops.
 */
export function chooseAction(ctx: GameContext, state: GameState, cfg: AiConfig): Decision | null {
  if (state.phase !== "player-turn" || state.position?.part !== "player-turn") return null;
  const legal = legalActions(ctx, state);
  if (legal.length === 0) return null;
  const step = state.position.step;
  const picked =
    step === FIRST_STEP ? chooseDeclaration(state, legal)
    : step === "8b" ? chooseBuild(ctx, state, legal, cfg)
    : step === "9a" ? chooseGrant(state, legal, cfg)
    : undefined;
  return picked ?? endTheStep(legal, step);
}

const isMoveOn = (a: Action): a is Extract<Action, { type: "END_STEP" | "END_PLAYER_TURN" }> => a.type === "END_STEP" || a.type === "END_PLAYER_TURN";

function endTheStep(legal: readonly Action[], step: string): Decision | null {
  const action = legal.find(isMoveOn);
  if (!action) return null;
  const why: Record<string, string> = {
    [FIRST_STEP]: "No declaration of war is planned for now.",
    "8b": "Nothing more it wants to build within its limit.",
    "9a": "No ally is short of BRPs.",
    [LAST_STEP]: "Nothing else to do this turn.",
  };
  return { action, why: why[step] ?? "Nothing to do in this step." };
}

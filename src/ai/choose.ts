import { legalActions, moveOnAction, type Action } from "../engine/actions";
import type { GameContext } from "../engine/context";
import { FIRST_STEP, LAST_STEP } from "../engine/sequence";
import type { GameState } from "../engine/types";
import { chooseAdvance, chooseAttack } from "./assault";
import { chooseBuild } from "./build";
import { chooseDeclaration } from "./declare";
import { chooseLosses } from "./doomed";
import { chooseAttrition } from "./attrition-play";
import { chooseOptions } from "./options";
import { chooseGrant } from "./grant";
import { chooseSiberian } from "./siberian";
import { chooseSeaSupply } from "./naval";
import { chooseMove } from "./move";
import { chooseOverstack } from "./overstack";
import { chooseSurrender } from "./surrender";
import { chooseWinter } from "./winter";
import type { AiConfig, Decision } from "./types";

/**
 * The computer's next action for the side to move, chosen from legalActions only; null when the
 * game waits for nothing (setup, game over). A step the computer has no plan for is ended, and a
 * step is always ended once the chooser has nothing more to do, so it never loops.
 */
export function chooseAction(ctx: GameContext, state: GameState, cfg: AiConfig): Decision | null {
  if (state.phase === "player-turn" && state.position?.part === "russian-winter") return chooseWinter(legalActions(ctx, state)); // II.A: the Allies are asked about the Russian winter (ticket 14-11)
  if (state.phase !== "player-turn" || state.position?.part !== "player-turn") return null;
  const step = state.position.step;
  // At 6f the move list is the longest the engine builds (15-40 ms, 100+ on a phone), so the mover searches only the stacks it looks at and only the way on is listed.
  // At 7b the computer commits no air yet, so the designations are not worked out either; nor are the redeployments at 9e (its policy is ticket 16-20).
  const legal = step === "6f" || step === "7b" || step === "9e" ? moveOnAction(state) : legalActions(ctx, state);
  if (legal.length === 0) return null;
  const picked =
    step === FIRST_STEP ? chooseDeclaration(state, legal)
    : step === "8a" ? chooseSiberian(ctx, state, legal, cfg) // 8a: the Allies may take units in the Free Siberian Transfer (tickets 14-18 and 14-19; the policy is SIBERIAN_TAKE_ALL in policies.ts)
    : step === "8b" ? chooseBuild(ctx, state, legal, cfg)
    : step === "9a" ? chooseGrant(state, legal, cfg)
    : step === "6e" || step === "9f" ? chooseSeaSupply(ctx, state, legal)
    : step === "3" ? chooseOptions(ctx, state, legal, cfg) // 3: the Front Options, per Front by the policy constants in options.ts (ticket 16-1)
    : step === "6f" ? chooseMove(ctx, state, cfg)
    : step === "10a" ? chooseSurrender(legal) // 10a: the Axis are asked about Russia's offer to surrender, whoever's Player Turn it is (ticket 14-15)
    : step === "6g" || step === "9j" ? chooseOverstack(legal) // 6g, 9j: the computer eliminates what the engine's default choice names (ticket 16-6; 16-8 refines it)
    : step === "7a" || step === "7p" ? chooseAttrition(ctx, state, legal, step) // 7p: resolves every Front with its participants; at either step, answers a run's stages (spec 16 Part E, ticket 16-8)
    : step === "7h" ? chooseLosses(ctx, state, legal, cfg) ?? chooseAdvance(legal, cfg) ?? chooseAttack(ctx, state, legal, cfg)
    : undefined;
  return picked ?? endTheStep(legal, step);
}

const isMoveOn = (a: Action): a is Extract<Action, { type: "END_STEP" | "END_PLAYER_TURN" }> => a.type === "END_STEP" || a.type === "END_PLAYER_TURN";

/**
 * Ending the step is the fallback for every step the computer has no chooser for, including steps
 * that gain rules later (front options, ground combat): it relies only on the engine always listing
 * the move-on action for the step the game waits at, and picks the one that names this step, so a new
 * kind of action at a step never leaves the computer stuck. If the engine ever lists none, the
 * caller gets null and stops (the browser loop does not retry from the same place).
 */
function endTheStep(legal: readonly Action[], step: string): Decision | null {
  const action = legal.find((a) => isMoveOn(a) && (a.type === "END_PLAYER_TURN" || a.step === step));
  if (!action) return null;
  const why: Record<string, string> = {
    [FIRST_STEP]: "No declaration of war is planned for now.",
    "3": "Every Front has its Option.",
    "6f": "No ground move brings a stack closer to an enemy objective, and the computer does not move planes or place airbases yet.",
    "7b": "The computer does not commit air to ground support yet.",
    "7h": "No ground attack is worth making at the odds on offer.",
    "7a": "The computer resolves its Attrition at step 7p.",
    "7p": "No Attrition to resolve.",
    "6g": "Nothing is overstacked.",
    "9j": "Nothing is overstacked.",
    "8a": "Nothing more to take in the Free Siberian Transfer.",
    "8b": "Nothing more it wants to build within its limit and the BRPs it keeps for planned declarations.",
    "9e": "The computer does not redeploy yet.",
    "9a": "No ally is short of BRPs.",
    [LAST_STEP]: "Nothing else to do this turn.",
  };
  return { action, why: why[step] ?? "Nothing to do in this step." };
}

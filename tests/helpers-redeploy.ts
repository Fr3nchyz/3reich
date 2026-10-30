import { chooseAction } from "../src/ai";
import type { AiConfig, Decision } from "../src/ai/types";
import { moveOnAction } from "../src/engine/actions";
import type { GameContext } from "../src/engine/context";
import type { GameState } from "../src/engine/types";

/**
 * The computer as it played before ticket 16-20: it ends step 9e without redeploying. The whole-game tests of other rules (the Russian surrender, the Free Siberian
 * Transfer, the supply snapshots) were written against games the computer played that way, and they reach their rare situations only in those games; the computer's
 * own redeployment is tested in ai-redeploy.test.ts and by every self-play test that takes the computer as it is.
 */
export function chooseWithoutRedeploying(ctx: GameContext, state: GameState, cfg: AiConfig): Decision | null {
  if (state.phase === "player-turn" && state.position?.part === "player-turn" && state.position.step === "9e") {
    const action = moveOnAction(state)[0];
    if (action) return { action, why: "The computer does not redeploy (this test plays the computer as before ticket 16-20)." };
  }
  return chooseAction(ctx, state, cfg);
}

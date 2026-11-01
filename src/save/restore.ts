import { applyAction } from "../engine/actions";
import type { Action } from "../engine/actions";
import type { GameContext } from "../engine/context";
import { newGame } from "../engine/game";
import type { GameState } from "../engine/types";
import { fingerprint } from "./fingerprint";
import type { JsonObject, SaveFile } from "./format";
import { readSave, snapshotHasFreshShape } from "./validate";

// Spec 11 Part H/E7: elapsed-time defaults; callers supply the clock and yielding.
export const RESTORE_SLICE_MS = 40;
export const RESTORE_BUDGET_MS = 20_000;
export interface RestoreOptions {
  now: () => number;
  yield: () => Promise<void>;
  cancelled: () => boolean;
  progress?: (completed: number, total: number) => void;
  /** Spec 11 Part A, AER55: shape screening alone cannot establish engine invariants.
   * Must return a validated copy, or undefined. Exceptions refuse this snapshot.
   */
  validateSnapshot: (snapshot: JsonObject, context: GameContext) => GameState | undefined;
}
export type RestoreResult =
  | { kind: "opened"; message: string; state: GameState; save: SaveFile; via: "replay" | "snapshot" }
  | { kind: "rescue"; message: string; state: GameState; save: SaveFile }
  | { kind: "refused"; message: string; code: string };

/** Spec 11 Parts A/H: source is bounded and checked before any engine action.
 * No storage, scheduling globals, or mutation of the caller's current game.
 */
export async function restore(source: string, context: GameContext, options: RestoreOptions): Promise<RestoreResult> {
  const read = readSave(source, [context.scenario]);
  if (!read.ok) return { kind: "refused", message: read.message, code: read.code };
  const save = read.save;
  const stopped = (): RestoreResult => ({ kind: "refused", code: "cancelled", message: "Opening was cancelled." });
  const selected = (value: JsonObject): GameState | undefined => {
    try {
      if (!snapshotHasFreshShape(value, context.scenario, save.stateVersion)) return undefined;
      // Spec 11 A/H: callbacks receive copies; validated state must preserve the saved position.
      const state = options.validateSnapshot(JSON.parse(JSON.stringify(value)) as JsonObject, context);
      return state && fingerprint(state) === fingerprint(value) ? state : undefined;
    } catch { return undefined; }
  };
  const fallback = (code: string, message: string, budget = false): RestoreResult => {
    if (options.cancelled()) return stopped();
    const state = selected(save.snapshot);
    if (!state) return { kind: "refused", code, message };
    // Spec 11 A/H: only budget exhaustion permits the exact snapshot fast path.
    if (budget && fingerprint(state) === save.fingerprint) return {
      kind: "opened", via: "snapshot", state, save, message: "Game opened from the saved position.",
    };
    // Spec 11 A/B: a rescue is an offer, not an automatic continuation; its record restarts here.
    const rescued: SaveFile = { ...save, start: { kind: "snapshot", state: save.snapshot },
      actions: [], setupActions: 0, fingerprint: fingerprint(state) };
    return { kind: "rescue", state, save: rescued,
      message: "This game no longer replays the same. Continue from where it stood, with the rules as they are now?" };
  };
  if (options.cancelled()) return stopped();
  const started = options.now();
  let slice = started;
  let state = save.start.kind === "new" ? newGame(context.scenario, save.seed) : selected(save.start.state);
  if (!state) return fallback("start", "This saved game's starting position cannot be opened.");
  options.progress?.(0, save.actions.length);
  for (let index = 0; index < save.actions.length; index++) {
    if (options.cancelled()) return stopped();
    let now = options.now();
    if (now - started >= RESTORE_BUDGET_MS) return fallback("budget", "Opening took too long and was stopped.", true);
    if (now - slice >= RESTORE_SLICE_MS) {
      await options.yield();
      if (options.cancelled()) return stopped();
      now = options.now();
      if (now - started >= RESTORE_BUDGET_MS) return fallback("budget", "Opening took too long and was stopped.", true);
      slice = now;
    }
    // Spec 11 H: engine refusal and exceptions are data, with one-based action numbers.
    try {
      const result = applyAction(context, state, save.actions[index] as unknown as Action);
      if (!result.ok) return fallback("action", `This game cannot be replayed (action ${index + 1} was refused: ${result.error}).`);
      state = result.state;
    } catch {
      return fallback("damaged", `This saved game is damaged (action ${index + 1} could not be read).`);
    }
    options.progress?.(index + 1, save.actions.length);
  }
  if (options.cancelled()) return stopped();
  // Spec 11 H: account for the last (potentially slow) action, including empty records.
  if (options.now() - started >= RESTORE_BUDGET_MS) return fallback("budget", "Opening took too long and was stopped.", true);
  if (fingerprint(state) !== save.fingerprint) return fallback("fingerprint", "This saved position no longer matches and cannot be opened by this version.");
  return { kind: "opened", via: "replay", state, save, message: "Game opened." };
}

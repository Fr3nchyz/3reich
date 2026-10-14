import type { Action } from "../engine/actions";

/**
 * The saved record of a watched game, in the format the self-play runner writes (docs/SELFPLAY.md): the actions from the
 * first setup action on, with the scenario and seed that replay() needs: `replay(ctx, newGame(scenario, seed), actions)`.
 */

export interface GameRecord {
  format: 1;
  scenario: string;
  seed: number;
  turns: number | "end";
  ended: "game-over" | "turn-limit" | "stopped";
  setupActions: number;
  anomalies: { kind: string; at: string; detail: string }[];
  actions: Action[];
}

export interface RecordParts {
  scenarioId: string;
  seed: number;
  turns: number | "end";
  ended: GameRecord["ended"];
  setupActions: number;
  anomalies: GameRecord["anomalies"];
  actions: readonly Action[];
}

export const recordOf = (p: RecordParts): GameRecord => ({ format: 1, scenario: p.scenarioId, seed: p.seed, turns: p.turns, ended: p.ended, setupActions: p.setupActions, anomalies: p.anomalies, actions: [...p.actions] });

export const recordName = (r: Pick<GameRecord, "scenario" | "seed">): string => `${r.scenario}-seed${r.seed}.json`;

/** Hands the record to the browser as a file download. */
export function downloadRecord(r: GameRecord): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(r)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = recordName(r);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

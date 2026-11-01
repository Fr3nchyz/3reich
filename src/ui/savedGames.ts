import type { Scenario } from "../engine/types";
import type { Action } from "../engine/actions";
import type { SaveFile } from "../save/format";
import type { StoredSave, SaveStore } from "../save/store";
import { readSave } from "../save/validate";
import { restore, type RestoreOptions, type RestoreResult } from "../save/restore";
import { createSnapshotValidator } from "../save/snapshotInvariants";
import { newSession, type Session } from "./session";

export interface SavedGameRow {
  id: string;
  title: string;
  detail: string;
  save?: SaveFile;
  problem?: string;
}
const labels: Record<string, string> = { autosave: "Autosave", "turn-backup": "Turn backup", "earlier-game": "Earlier game" };

/** Spec 11 Parts E/H: check each entry independently; damaged entries remain deletable. */
export function savedGameRow(entry: StoredSave, scenarios: Scenario[]): SavedGameRow {
  let source: string;
  try { source = JSON.stringify(entry.value); }
  catch { return { id: entry.id, title: labels[entry.id] ?? entry.id, detail: "Cannot be opened" }; }
  const read = readSave(source, scenarios);
  if (!read.ok) return { id: entry.id, title: labels[entry.id] ?? entry.id, detail: "Cannot be opened", problem: read.message };
  const save = read.save;
  const s = save.snapshot;
  const scalar = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value) : "";
  const position = s.position;
  const step = position && typeof position === "object" && !Array.isArray(position) ? position.step : undefined;
  return { id: entry.id, title: labels[entry.id] ?? save.title, save,
    detail: `${scenarios.find(x => x.id === save.scenario)!.name}, ${save.humanSide === "axis" ? "Axis" : "Allies"}. ${scalar(s.season)} ${scalar(s.year)}, ${scalar(s.activeSide)}${typeof step === "string" ? `, step ${step}` : ""}. Saved ${save.savedAt}` };
}

/** Spec 11 E sketch 3: reserved entries first, then named games, retaining every entry. */
export function savedGameRows(entries: StoredSave[], scenarios: Scenario[]): SavedGameRow[] {
  const order = ["autosave", "turn-backup", "earlier-game"];
  const rank = (id: string): number => order.includes(id) ? order.indexOf(id) : order.length;
  return entries.map(e => savedGameRow(e, scenarios)).sort((a, b) => rank(a.id) - rank(b.id));
}

/** Spec 11 A/B: adopt only a successful restore or an explicitly accepted rescue.
 * A budget snapshot also restarts the record: its preceding replay was incomplete.
 */
export function restoredSession(result: Exclude<RestoreResult, { kind: "refused" }>, scenario: Scenario): { session: Session; start: SaveFile["start"] } {
  const { save, state } = result;
  const session = newSession(scenario, save.humanSide, save.seed);
  session.state = state;
  session.log = [...(save.logTail ?? [])];
  const restart = result.kind === "opened" && result.via === "snapshot";
  session.record = restart ? [] : save.actions as unknown as Action[];
  return { session, start: restart ? { kind: "snapshot", state: save.snapshot } : save.start };
}

export interface SavedGamesOptions {
  store: Promise<SaveStore>;
  scenarios: Scenario[];
  timing: Pick<RestoreOptions, "now" | "yield">;
  loading: (value: boolean) => void;
  adopt: (session: Session, start: SaveFile["start"]) => void;
}

/** Spec 11 A/E/H: storage and restore orchestration, independent of the DOM. */
export function createSavedGames(options: SavedGamesOptions) {
  let generation = 0;
  let pending: Exclude<RestoreResult, { kind: "refused" | "opened" }> | undefined;
  let pendingId: string | undefined;
  const older = new Set<string>();
  const cancel = (): void => { generation++; pending = undefined; options.loading(false); };
  const adopt = (result: Exclude<RestoreResult, { kind: "refused" }>): void => {
    const scenario = options.scenarios.find(x => x.id === result.save.scenario)!;
    const next = restoredSession(result, scenario);
    options.adopt(next.session, next.start);
  };
  return {
    cancel,
    list: async (): Promise<SavedGameRow[]> => {
      const result = await (await options.store).list();
      if (!result.ok) throw new Error("Saved games could not be read. Play can continue.");
      return savedGameRows(result.value, options.scenarios).map(row => older.has(row.id) ? { ...row, detail: `${row.detail}. Needs an older version` } : row);
    },
    open: async (id: string, progress: NonNullable<RestoreOptions["progress"]>): Promise<RestoreResult> => {
      const token = ++generation;
      pending = undefined;
      options.loading(true);
      try {
        const entry = await (await options.store).get(id);
        if (token !== generation) return { kind: "refused", code: "cancelled", message: "Opening was cancelled." };
        if (!entry.ok || entry.value === undefined) return { kind: "refused", code: "storage", message: "This saved game could not be read." };
        const row = savedGameRow({ id, value: entry.value }, options.scenarios);
        if (!row.save) return { kind: "refused", code: "invalid", message: row.problem ?? "This saved game is damaged." };
        const scenario = options.scenarios.find(x => x.id === row.save!.scenario)!;
        const result = await restore(JSON.stringify(row.save), { map: newSession(scenario, row.save.humanSide, row.save.seed).ctx.map, scenario }, {
          ...options.timing, progress, cancelled: () => token !== generation, validateSnapshot: createSnapshotValidator(),
        });
        if (token === generation) {
          if (result.kind === "opened") adopt(result);
          if (result.kind === "rescue") { pending = result; pendingId = id; }
        }
        return result;
      } catch { return { kind: "refused", code: "damaged", message: "This saved game could not be opened." }; }
      finally { if (token === generation) options.loading(false); }
    },
    acceptRescue: (): boolean => {
      if (!pending) return false;
      adopt(pending); pending = undefined; options.loading(false); return true;
    },
    keep: (): void => { if (pending && pendingId) older.add(pendingId); pending = undefined; options.loading(false); },
    // Spec 11 E touch flow 7: deletion requires the page's explicit confirmation.
    delete: async (id: string, confirmed: boolean): Promise<boolean> => confirmed && (await (await options.store).delete(id)).ok,
  };
}

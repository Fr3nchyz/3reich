import type { Session } from "./session";
import { actorSide } from "./logSide";
import { fingerprint } from "../save/fingerprint";
import { MAX_STRING_LENGTH, SAVE_FORMAT, STATE_VERSION, type JsonObject, type SaveFile } from "../save/format";
import type { SaveStore, StoreError } from "../save/store";

// Spec 11 Part D: quiet-period debounce bounded during continuous play.
export const AUTOSAVE_DELAY_MS = 1000;
export const AUTOSAVE_MAX_WAIT_MS = 5000;
export const AUTOSAVE_SLOT = "autosave";
export const TURN_BACKUP_SLOT = "turn-backup";
export const EARLIER_GAME_SLOT = "earlier-game";

export interface AutosaveOptions {
  store: Promise<SaveStore> | SaveStore;
  gameVersion: string;
  onError: (error: StoreError) => void;
  now?: () => Date;
  timers?: {
    setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
  };
}

const stepOf = (s: Session): string => JSON.stringify([s.state.phase, s.state.year,
  s.state.season, s.state.activeSide, s.state.position]);
const atBackup = (s: Session): boolean => s.state.position?.part === "player-turn" &&
  s.state.position.step === "10b";

/** Spec 11 Parts B/D: copy at the safe point, before asynchronous storage can yield. */
function saveOf(s: Session, options: AutosaveOptions, start: SaveFile["start"]): SaveFile {
  const snapshot = JSON.parse(JSON.stringify(s.state)) as JsonObject;
  return {
    format: SAVE_FORMAT, app: "3reich", title: "Autosave",
    savedAt: (options.now?.() ?? new Date()).toISOString(), gameVersion: options.gameVersion,
    stateVersion: STATE_VERSION, scenario: s.ctx.scenario.id, seed: s.seed,
    humanSide: s.humanSide, start: JSON.parse(JSON.stringify(start)) as SaveFile["start"],
    actions: JSON.parse(JSON.stringify(s.record)) as JsonObject[],
    setupActions: s.record.filter(a => a.type.startsWith("SETUP_")).length,
    fingerprint: fingerprint(snapshot), snapshot, logTail: s.log.slice(-60).map(line => line.slice(0, MAX_STRING_LENGTH)),
  };
}

/** Spec 11 D/G: observe after action batches and before scheduling the next computer slice.
 * Loading callers must suspend before changing the session; a failed load never arms it.
 * Part B permits absent computer memory; its private browser cache is not exposed here.
 */
export function createAutosave(options: AutosaveOptions) {
  const timers = options.timers ?? { setTimeout, clearTimeout };
  let session: Session | undefined;
  let count = 0;
  let step = "";
  let watching = false;
  let armed = false;
  let loading = false;
  let dirty = false;
  const rotated = new WeakSet<Session>();
  const starts = new WeakMap<Session, SaveFile["start"]>();
  let persistenceRequested = false;
  let delay: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();
  const clearTimers = (): void => {
    if (delay !== undefined) timers.clearTimeout(delay);
    if (deadline !== undefined) timers.clearTimeout(deadline);
    delay = deadline = undefined;
  };

  // Spec 11 D: serialize writes, including rotation, so an older write cannot win a race.
  const flush = (backup = false): Promise<void> => {
    if (!session || !armed || loading || session.watch || !dirty) return queue;
    clearTimers();
    const current = session;
    const save = saveOf(current, options, starts.get(current) ?? { kind: "new" });
    dirty = false;
    queue = queue.then(async () => {
      const store = await options.store;
      // Spec 11 C: the volatile fallback cannot provide autosave protection.
      if (!store.persistent) return;
      const check = <T>(result: { ok: true; value: T } | StoreError): result is { ok: true; value: T } => {
        if (!result.ok) options.onError(result);
        return result.ok;
      };
      if (!rotated.has(current)) {
        const old = await store.get(AUTOSAVE_SLOT);
        if (!check(old)) return;
        // Spec 11 D/H: preserve an existing entry before replacing it, including unreadable data.
        // SaveStore only accepts SaveFile; refuse to overwrite unreadable entries rather than delete them.
        if (old.value !== undefined) {
          const prior = old.value as SaveFile;
          if (!prior || prior.format !== SAVE_FORMAT || !Array.isArray(prior.actions)) {
            options.onError({ ok: false, code: "unavailable" });
            return;
          }
          if (prior.actions.length && !check(await store.put(EARLIER_GAME_SLOT, prior))) return;
        }
        rotated.add(current);
      }
      if (!check(await store.put(AUTOSAVE_SLOT, save))) return;
      // Spec 11 D: copy the exact completed-turn position, even if play has already advanced.
      if (backup && !check(await store.put(TURN_BACKUP_SLOT, { ...save, title: "Turn backup" }))) return;
      // Spec 11 C: request once, after a successful first autosave; denial never blocks saves.
      if (!persistenceRequested) {
        persistenceRequested = true;
        check(await store.requestPersistence());
      }
    }).catch(() => { options.onError({ ok: false, code: "unavailable" }); });
    return queue;
  };

  const observe = (next: Session): void => {
    if (next !== session) {
      // Spec 11 D: finish the previous game's pending save before switching games.
      void flush();
      clearTimers();
      session = next;
      count = next.record.length;
      step = stepOf(next);
      watching = !!next.watch;
      armed = dirty = false;
      return;
    }
    const changed = next.record.length !== count;
    const nextStep = stepOf(next);
    const takeover = watching && !next.watch;
    // Spec 11 D/G: computer setup/watch actions do not arm a fresh single-player game.
    if (!loading && !next.watch && (takeover || next.record.slice(count).some(a => actorSide(a) === next.humanSide))) armed = true;
    if (!loading && !next.watch && armed && (changed || takeover)) {
      dirty = true;
      if (nextStep !== step || atBackup(next)) void flush(atBackup(next));
      else {
        if (delay !== undefined) timers.clearTimeout(delay);
        delay = timers.setTimeout(() => { void flush(); }, AUTOSAVE_DELAY_MS);
        deadline ??= timers.setTimeout(() => { void flush(); }, AUTOSAVE_MAX_WAIT_MS);
      }
    }
    count = next.record.length;
    step = nextStep;
    watching = !!next.watch;
  };

  return {
    observe, flush,
    // Spec 11 A/B: keep the original snapshot start of a shortened restored record.
    setStart: (s: Session, start: SaveFile["start"]): void => { starts.set(s, JSON.parse(JSON.stringify(start)) as SaveFile["start"]); },
    // Spec 11 D: explicit new-game confirmation can arm without a placement.
    arm: (): void => { if (session && !loading && !session.watch) armed = true; },
    // Spec 11 D/H: a restore must not flush partially loaded data, including on page hide.
    setLoading: (value: boolean): void => { loading = value; if (value) { clearTimers(); dirty = false; } },
    dispose: (): void => { clearTimers(); },
  };
}

/** Spec 11 D: hidden/leaving starts a write; listener cleanup is available for tests/teardown. */
export function bindAutosaveLifecycle(autosave: Pick<ReturnType<typeof createAutosave>, "flush">,
  doc: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState"> = document,
  win: Pick<Window, "addEventListener" | "removeEventListener"> = window): () => void {
  const hidden = (): void => { if (doc.visibilityState === "hidden") void autosave.flush(); };
  const leaving = (): void => { void autosave.flush(); };
  doc.addEventListener("visibilitychange", hidden);
  win.addEventListener("pagehide", leaving);
  return () => { doc.removeEventListener("visibilitychange", hidden); win.removeEventListener("pagehide", leaving); };
}

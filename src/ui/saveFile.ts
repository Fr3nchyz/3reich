import type { Scenario } from "../engine/types";
import { fingerprint } from "../save/fingerprint";
import { MAX_FILE_BYTES, MAX_STRING_LENGTH, SAVE_FORMAT, STATE_VERSION, type JsonObject, type SaveFile } from "../save/format";
import { readSave } from "../save/validate";
import { openingText } from "./continueCard";
import type { createSavedGames } from "./savedGames";
import type { Session } from "./session";

// Spec 11 F, TODO(verify) spec 11 E8: use the existing record download's one-second cleanup; verify on the tablet.
export const FILE_URL_LIFETIME_MS = 1000;
// TODO(verify) spec 11 E8: conservatively respect share cancellation without downloading.
export const DOWNLOAD_AFTER_SHARE_CANCEL = false;

/** Spec 11 F: metadata only, never the player's title or a path from the file. */
export function saveFileName(save: SaveFile): string {
  const safe = (value: unknown): string => (typeof value === "string" || typeof value === "number" ? String(value) : "").replace(/[^a-z0-9-]/gi, "");
  return `3reich-${safe(save.scenario)}-${safe(save.humanSide)}-${safe(save.snapshot.season)}${safe(save.snapshot.year)}.json`;
}

/** Spec 11 B/G: single-player state and complete record; restored snapshot starts survive export. */
export function sessionSave(session: Session, gameVersion: string, start: SaveFile["start"], now = new Date()): SaveFile {
  if (session.watch) throw new Error("Use Save game record for a watched game.");
  const snapshot = JSON.parse(JSON.stringify(session.state)) as JsonObject;
  return { format: SAVE_FORMAT, app: "3reich", title: "Saved game", savedAt: now.toISOString(), gameVersion,
    stateVersion: STATE_VERSION, scenario: session.ctx.scenario.id, seed: session.seed, humanSide: session.humanSide,
    start: JSON.parse(JSON.stringify(start)) as SaveFile["start"],
    actions: JSON.parse(JSON.stringify(session.record)) as JsonObject[],
    setupActions: session.record.filter(a => a.type.startsWith("SETUP_")).length,
    snapshot, fingerprint: fingerprint(snapshot), logTail: session.log.slice(-60).map(line => line.slice(0, MAX_STRING_LENGTH)) };
}

export interface FilePlatform {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
  download: (file: File) => void;
}

/** Spec 11 F: generated URL only; retain it briefly after the anchor click. */
export function downloadSave(file: File): void {
  const url = URL.createObjectURL(file);
  try {
    const link = document.createElement("a"); link.href = url; link.download = file.name;
    document.body.append(link);
    try { link.click(); } finally { link.remove(); }
  } finally { setTimeout(() => URL.revokeObjectURL(url), FILE_URL_LIFETIME_MS); }
}

/** Spec 11 F/H: share only validated JSON, invoked synchronously from the tap. */
export async function exportSave(save: SaveFile, scenarios: Scenario[], platform: FilePlatform = {
  canShare: data => typeof navigator.canShare === "function" && navigator.canShare(data),
  share: data => navigator.share(data), download: downloadSave,
}): Promise<string> {
  const read = readSave(JSON.stringify(save), scenarios);
  if (!read.ok) throw new Error(read.message);
  const file = new File([JSON.stringify(read.save)], saveFileName(read.save), { type: "application/json" });
  let shareable = false;
  try { shareable = !!platform.share && !!platform.canShare?.({ files: [file] }); } catch { /* Download remains available. */ }
  if (shareable) {
    try { await platform.share!({ files: [file] }); return "Save file shared."; }
    catch (error) {
      // Spec 11 F: cancelling the offered share sheet must not start a second file operation.
      if (!DOWNLOAD_AFTER_SHARE_CANCEL && error instanceof Error && error.name === "AbortError") return "Save file cancelled.";
    }
  }
  platform.download(file);
  return "Save file downloaded.";
}

/** Spec 11 H: reject by byte size before allocating/reading the file's text. */
export function readSaveFile(file: Pick<File, "size" | "text">): Promise<string> {
  if (file.size > MAX_FILE_BYTES) return Promise.reject(new Error("This file is too large to open."));
  return file.text();
}

/** Spec 11 E/F/H: additive sheet actions, picker and page drop; file text only enters textContent. */
export function bindSaveFiles(options: {
  games: ReturnType<typeof createSavedGames>;
  scenarios: Scenario[];
  current: () => SaveFile;
  watching: () => boolean;
  doc?: Document;
}) {
  const doc = options.doc ?? document;
  const sheet = doc.getElementById("saved-sheet") as HTMLDialogElement;
  const content = doc.getElementById("saved-content")!;
  const live = doc.getElementById("a11y-live")!;
  const controls = doc.createElement("div"); controls.className = "save-file-controls";
  const status = doc.createElement("p"); status.setAttribute("role", "status");
  const picker = doc.createElement("input"); picker.type = "file"; picker.accept = ".json,application/json"; picker.hidden = true;
  const button = (parent: HTMLElement, label: string, action: () => void): HTMLButtonElement => {
    const el = doc.createElement("button"); el.type = "button"; el.textContent = label;
    el.addEventListener("click", action); parent.append(el); return el;
  };
  const say = (message: string): void => { status.textContent = message; live.textContent = message; };
  const save = button(controls, "Save to a file", () => {
    try { void exportSave(options.current(), options.scenarios).then(say).catch(() => say("This game could not be saved to a file.")); }
    catch { say("This game could not be saved to a file."); }
  });
  button(controls, "Open a save file", () => { picker.value = ""; picker.click(); });
  controls.append(picker, status); content.before(controls);
  let serial = 0;
  let returnTo: HTMLElement | null = null;
  const cancel = (): void => { serial++; options.games.cancel(); };
  const finish = (): void => {
    sheet.close(); doc.getElementById("continue-game")!.hidden = true;
    const heading = doc.querySelector<HTMLElement>("#status h2, #status h3, #status")!;
    heading.tabIndex = -1; heading.focus();
  };
  const open = async (file: File): Promise<void> => {
    // Invalidate any in-flight list or stored-game view through its existing Close handler.
    doc.getElementById("saved-close")!.click();
    cancel(); const token = serial;
    if (!sheet.open) { returnTo = doc.activeElement as HTMLElement; sheet.showModal(); }
    content.replaceChildren(); say("Opening your game...");
    button(content, "Cancel", () => { cancel(); content.replaceChildren(); say("Opening was cancelled."); doc.getElementById("saved-close")!.focus(); }).focus();
    const result = await options.games.openFile(() => readSaveFile(file), (done, total) => {
      if (token === serial) say(openingText(done, total));
    });
    if (token !== serial) return;
    content.replaceChildren(); say(result.message);
    if (result.kind === "refused") { doc.getElementById("saved-close")!.focus(); return; }
    if (result.kind === "rescue") {
      const warning = doc.createElement("p"); warning.textContent = "Later turns may go differently from what you expected."; content.append(warning);
    }
    button(content, result.kind === "rescue" ? "Continue from here" : "Continue", () => {
      // Adoption happens before the optional storage write; leaving this sheet cancels pending offers.
      const accepted = options.games.acceptFile(); serial++; finish();
      void accepted.then(say);
    }).focus();
    button(content, "Keep the file", () => { cancel(); sheet.close(); returnTo?.focus(); say("The original file is unchanged."); });
  };
  const choose = (): void => { const file = picker.files?.[0]; if (file) void open(file); };
  picker.addEventListener("change", choose);
  const drag = (event: DragEvent): void => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); };
  const drop = (event: DragEvent): void => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault(); const files = event.dataTransfer.files;
    if (files.length !== 1) { say("Choose one save file at a time."); return; }
    void open(files[0]!);
  };
  doc.addEventListener("dragover", drag); doc.addEventListener("drop", drop);
  const refresh = (): void => { save.disabled = options.watching(); };
  doc.getElementById("savedgames")!.addEventListener("click", refresh);
  doc.getElementById("saved-close")!.addEventListener("click", cancel);
  doc.getElementById("newgame")!.addEventListener("click", cancel);
  sheet.addEventListener("cancel", cancel);
  return { open, refresh };
}

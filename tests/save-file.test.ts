import { describe, expect, it, vi, afterEach } from "vitest";
import { newGame } from "../src/engine/game";
import { legalActions, applyAction } from "../src/engine/actions";
import { MAX_FILE_BYTES, type SaveFile } from "../src/save/format";
import { createMemoryStore } from "../src/save/memoryStore";
import { createSavedGames } from "../src/ui/savedGames";
import { newSession } from "../src/ui/session";
import { bindSaveFiles, downloadSave, exportSave, FILE_URL_LIFETIME_MS, readSaveFile, saveFileName, sessionSave } from "../src/ui/saveFile";
import { CTX } from "./helpers";

const scenarios = [CTX.scenario];
const fixture = (): SaveFile => sessionSave(newSession(CTX.scenario, "axis", 1, false), "test", { kind: "new" }, new Date("2026-11-01T00:00:00.000Z"));
function harness() {
  const store = createMemoryStore(), adopt = vi.fn(), loading = vi.fn();
  const games = createSavedGames({ store: Promise.resolve(store), scenarios, adopt, loading,
    timing: { now: () => 0, yield: () => Promise.resolve() } });
  return { store, adopt, loading, games };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("spec 11 file export", () => {
  it("Part F: filename uses sanitized scenario, side and position, never title", () => {
    const save = fixture(); save.title = "../../private title";
    expect(saveFileName(save)).toBe("3reich-1939-axis-fall1939.json");
    save.scenario = "../1939 /<>"; save.snapshot.season = "../fall<>";
    expect(saveFileName(save)).toBe("3reich-1939-axis-fall1939.json");
  });
  it("Parts B/G: exports detached state, seed, side, complete setup record, snapshot start and bounded log", () => {
    const session = newSession(CTX.scenario, "allies", 12);
    const action = legalActions(CTX, session.state)[0]!;
    const applied = applyAction(CTX, session.state, action); expect(applied.ok).toBe(true); if (!applied.ok) return;
    session.state = applied.state; session.record.push(action); session.log = Array.from({ length: 70 }, () => "a".repeat(210));
    const start: SaveFile["start"] = { kind: "snapshot", state: fixture().snapshot };
    const save = sessionSave(session, "test", start);
    expect(save).toMatchObject({ humanSide: "allies", seed: 12, actions: [action], setupActions: 1, start });
    expect(save.snapshot).toEqual(JSON.parse(JSON.stringify(session.state)));
    expect(save.snapshot).not.toBe(session.state); expect(save.start).not.toBe(start);
    expect(save.logTail).toHaveLength(60); expect(save.logTail![0]).toHaveLength(200);
    session.watch = { } as NonNullable<typeof session.watch>;
    expect(() => sessionSave(session, "test", start)).toThrow("Save game record");
  });
  it("Part F/H: validated file reaches share synchronously on tap with JSON MIME and cleaned fields", async () => {
    const share = vi.fn().mockResolvedValue(undefined), download = vi.fn(), save = fixture();
    Object.assign(save, { ignored: "discard" });
    const result = exportSave(save, scenarios, { share, canShare: () => true, download });
    expect(share).toHaveBeenCalledTimes(1); expect(download).not.toHaveBeenCalled();
    const file = (share.mock.calls[0]![0] as ShareData).files![0]!;
    expect(file.name).toBe(saveFileName(save)); expect(file.type).toBe("application/json");
    expect(JSON.parse(await file.text())).toEqual(fixture()); expect(await result).toBe("Save file shared.");
  });
  it("Part F: downloads when sharing is absent, unsupported, throws or fails", async () => {
    for (const mode of ["absent", "unsupported", "throws", "fails"]) {
      const download = vi.fn(), share = mode === "absent" ? undefined : vi.fn().mockRejectedValue(new Error("failed"));
      await exportSave(fixture(), scenarios, { download, share, canShare: () => {
        if (mode === "throws") throw new Error("unsupported"); return mode === "fails";
      } });
      expect(download).toHaveBeenCalledTimes(1);
      const file = download.mock.calls[0]![0] as File;
      expect(JSON.parse(await file.text())).toEqual(fixture());
    }
  });
  it("Part F/E8: cancellation of sharing does not trigger a download", async () => {
    const download = vi.fn();
    const result = await exportSave(fixture(), scenarios, { download, canShare: () => true,
      share: () => Promise.reject(new DOMException("cancelled", "AbortError")) });
    expect(result).toContain("cancelled"); expect(download).not.toHaveBeenCalled();
  });
  it("Part H: invalid export never reaches sharing or downloading", async () => {
    const share = vi.fn(), download = vi.fn(); const save = fixture(); save.seed = -1;
    await expect(exportSave(save, scenarios, { share, canShare: () => true, download })).rejects.toThrow("seed");
    expect(share).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled();
  });
  it("Part F/E8: generated download link is removed and URL revoked after one second", () => {
    vi.useFakeTimers();
    const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("document", { createElement: vi.fn(() => link), body: { append: vi.fn() } });
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:generated");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const file = new File(["{}"], "safe.json"); downloadSave(file);
    expect(create).toHaveBeenCalledWith(file); expect(link).toMatchObject({ href: "blob:generated", download: "safe.json" });
    expect(link.click).toHaveBeenCalledOnce(); expect(link.remove).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(FILE_URL_LIFETIME_MS - 1); expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(revoke).toHaveBeenCalledWith("blob:generated");
  });
});

describe("spec 11 file import", () => {
  it("Part H: byte cap precedes reading; exact cap still reads", async () => {
    const text = vi.fn().mockResolvedValue("{}");
    await expect(readSaveFile({ size: MAX_FILE_BYTES + 1, text })).rejects.toThrow("too large"); expect(text).not.toHaveBeenCalled();
    await expect(readSaveFile({ size: MAX_FILE_BYTES, text })).resolves.toBe("{}");
  });
  it("Parts A/E/F: exact restore offers Continue before adoption or storage; acceptance adds a named row", async () => {
    const { games, store, adopt, loading } = harness(); const put = vi.spyOn(store, "put"), progress = vi.fn();
    expect(await games.openFile(() => Promise.resolve(JSON.stringify(fixture())), progress)).toMatchObject({ kind: "opened", via: "replay" });
    expect(progress).toHaveBeenCalledWith(0, 0); expect(loading).toHaveBeenLastCalledWith(true);
    expect(adopt).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
    expect(await games.acceptFile()).toContain("added"); expect(adopt).toHaveBeenCalledOnce();
    expect(loading).toHaveBeenLastCalledWith(false); expect(await games.list()).toHaveLength(1);
    expect(await games.open((await games.list())[0]!.id, () => {})).toMatchObject({ kind: "opened" });
  });
  it("Part A/H: rescue uses invariant validation, requires consent and resets the record", async () => {
    const { games, store, adopt } = harness(); const save = fixture(); save.fingerprint = "00000000";
    expect(await games.openFile(() => Promise.resolve(JSON.stringify(save)), () => {})).toMatchObject({ kind: "rescue" });
    expect(adopt).not.toHaveBeenCalled(); expect(await store.list()).toEqual({ ok: true, value: [] });
    await games.acceptFile(); expect(adopt).toHaveBeenCalledWith(expect.objectContaining({ state: newGame(CTX.scenario, 1), record: [] }), { kind: "snapshot", state: save.snapshot });
    const invalid = fixture(); invalid.fingerprint = "00000000"; invalid.snapshot.rngState = -1;
    expect(await games.openFile(() => Promise.resolve(JSON.stringify(invalid)), () => {})).toMatchObject({ kind: "refused" });
    expect(adopt).toHaveBeenCalledTimes(1);
  });
  it("Part H/G: malformed, hostile, future, legacy, unknown scenario and read failures leave game and storage untouched", async () => {
    for (const raw of ["{", '{"__proto__":{}}', JSON.stringify({ ...fixture(), format: 3 }),
      JSON.stringify({ format: 1 }), JSON.stringify({ ...fixture(), scenario: "unknown" })]) {
      const { games, store, adopt, loading } = harness();
      expect(await games.openFile(() => Promise.resolve(raw), () => {})).toMatchObject({ kind: "refused" });
      expect(adopt).not.toHaveBeenCalled(); expect(await store.list()).toEqual({ ok: true, value: [] });
      expect(loading).toHaveBeenLastCalledWith(false);
    }
    const { games } = harness(); expect(await games.openFile(() => Promise.reject(new Error("Cannot read file")), () => {})).toMatchObject({ kind: "refused", message: "Cannot read file" });
  });
  it("Part A/F/H: Cancel during reading or after an offer prevents adoption and storage", async () => {
    const { games, adopt, store } = harness(); let resolve!: (value: string) => void;
    const opening = games.openFile(() => new Promise<string>(r => { resolve = r; }), () => {});
    games.cancel(); resolve(JSON.stringify(fixture())); expect(await opening).toMatchObject({ code: "cancelled" });
    await games.openFile(() => Promise.resolve(JSON.stringify(fixture())), () => {}); games.cancel();
    expect(await games.acceptFile()).toContain("cancelled"); expect(adopt).not.toHaveBeenCalled(); expect(await store.list()).toEqual({ ok: true, value: [] });
  });
  it("Parts E/F/H: storage failures or 12 full slots retain the opened game and every existing entry", async () => {
    for (const mode of ["full", "list", "put", "throw"]) {
      const { games, store, adopt } = harness();
      for (let i = 1; i <= (mode === "full" ? 12 : 1); i++) await store.put(`named-${i}`, fixture());
      await games.openFile(() => Promise.resolve(JSON.stringify(fixture())), () => {});
      if (mode === "list") vi.spyOn(store, "list").mockResolvedValue({ ok: false, code: "unavailable" });
      if (mode === "put") vi.spyOn(store, "put").mockResolvedValue({ ok: false, code: "quota" });
      if (mode === "throw") vi.spyOn(store, "list").mockRejectedValue(new Error("storage"));
      expect(await games.acceptFile()).toContain(mode === "full" ? "12" : "could not be kept");
      expect(adopt).toHaveBeenCalledOnce(); expect(await store.get("named-1")).toEqual({ ok: true, value: fixture() });
    }
  });
});

// Minimal event/element double: exercise the real binding without installing a browser or DOM package.
class Element extends EventTarget {
  children: Element[] = [];
  textContent = ""; className = ""; type = ""; accept = ""; value = "";
  hidden = false; disabled = false; open = false; tabIndex = 0;
  files: File[] = []; focused = false;
  append(...nodes: Element[]): void { this.children.push(...nodes); }
  before(node: Element): void { this.children.unshift(node); }
  replaceChildren(): void { this.children = []; }
  setAttribute(): void { /* The binding uses role=status. */ }
  click(): void { if (!this.disabled) this.dispatchEvent(new Event("click")); }
  focus(): void { this.focused = true; }
  showModal(): void { this.open = true; }
  close(): void { this.open = false; }
  find(label: string): Element {
    const found = this.all().find(e => e.textContent === label);
    if (!found) throw new Error(`Missing button ${label}`); return found;
  }
  all(): Element[] { return this.children.flatMap(e => [e, ...e.all()]); }
}
function binding() {
  const h = harness(), doc = new EventTarget();
  const nodes = Object.fromEntries(["saved-sheet", "saved-content", "a11y-live", "savedgames", "saved-close", "newgame", "continue-game", "status"].map(id => [id, new Element()]));
  nodes["saved-close"]!.addEventListener("click", () => nodes["saved-sheet"]!.close());
  Object.assign(doc, { getElementById: (id: string) => nodes[id], createElement: () => new Element(),
    querySelector: () => nodes.status, activeElement: nodes.savedgames });
  let watching = false;
  const files = bindSaveFiles({ games: h.games, scenarios, current: fixture, watching: () => watching, doc: doc as unknown as Document });
  const content = nodes["saved-content"]!, controls = content.children[0]!;
  const picker = controls.all().find(e => e.type === "file")!;
  return { ...h, files, nodes, doc, content, controls, picker, watch: () => { watching = true; files.refresh(); } };
}
const tick = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)); };

describe("spec 11 file browser bindings", () => {
  it("Parts E/F: picker accepts JSON, resets for reselection, shows Continue, and restores focus on opening", async () => {
    const { controls, picker, content, nodes, adopt, store } = binding();
    expect(picker.accept).toBe(".json,application/json"); expect(picker.hidden).toBe(true);
    picker.value = "previous.json"; controls.find("Open a save file").click(); expect(picker.value).toBe("");
    picker.files = [new File([JSON.stringify(fixture())], "game.json")]; picker.dispatchEvent(new Event("change"));
    await tick(); expect(content.find("Continue").focused).toBe(true); expect(adopt).not.toHaveBeenCalled();
    content.find("Continue").click(); await tick();
    expect(adopt).toHaveBeenCalledOnce(); expect(nodes["saved-sheet"]!.open).toBe(false); expect(nodes.status!.focused).toBe(true);
    expect(await store.list()).toMatchObject({ ok: true, value: [expect.objectContaining({ id: "named-1" })] });
  });
  it("Parts F/H: page drop opens one file, ignores text drags and refuses multiple files", async () => {
    const { doc, content, adopt, controls } = binding(); const file = new File([JSON.stringify(fixture())], "game.json");
    const event = (type: string, types: string[], files: File[]): Event => Object.assign(new Event(type, { cancelable: true }), { dataTransfer: { types, files } });
    const textDrag = event("dragover", ["text/plain"], []); doc.dispatchEvent(textDrag); expect(textDrag.defaultPrevented).toBe(false);
    const drag = event("dragover", ["Files"], []); doc.dispatchEvent(drag); expect(drag.defaultPrevented).toBe(true);
    doc.dispatchEvent(event("drop", ["Files"], [file, file])); expect(controls.all().some(e => e.textContent.includes("one save file"))).toBe(true);
    const drop = event("drop", ["Files"], [file]); doc.dispatchEvent(drop); expect(drop.defaultPrevented).toBe(true);
    await tick(); expect(content.find("Continue")).toBeDefined(); expect(adopt).not.toHaveBeenCalled();
  });
  it("Parts A/E/F/G: rescue and Keep retain the game; Close, Escape and New game cancel; watch export disabled", async () => {
    for (const action of ["Keep the file", "Cancel", "saved-close", "newgame", "escape"]) {
      const { files, content, nodes, adopt, store } = binding(); const save = fixture(); save.fingerprint = "00000000";
      await files.open(new File([JSON.stringify(save)], "old.json"));
      expect(content.find("Continue from here").focused).toBe(true);
      if (action === "escape") nodes["saved-sheet"]!.dispatchEvent(new Event("cancel"));
      else if (action === "Keep the file") content.find(action).click();
      else if (action === "Cancel") {
        const opening = files.open(new File([JSON.stringify(save)], "old.json")); content.find(action).click(); await opening;
      } else nodes[action]!.click();
      expect(await store.list()).toEqual({ ok: true, value: [] }); expect(adopt).not.toHaveBeenCalled();
      expect(await files.open(new File(["{"], "bad.json"))).toBeUndefined(); expect(nodes["a11y-live"]!.textContent).toContain("incomplete");
    }
    const { watch, controls } = binding(); watch(); expect(controls.find("Save to a file").disabled).toBe(true);
  });
  it("Part F: save button invokes native file sharing from the click", async () => {
    const share = vi.fn().mockResolvedValue(undefined); vi.stubGlobal("navigator", { canShare: () => true, share });
    const { controls } = binding(); controls.find("Save to a file").click();
    expect(share).toHaveBeenCalledOnce(); await tick(); expect(controls.all().some(e => e.textContent === "Save file shared.")).toBe(true);
  });
});

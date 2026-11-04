import { describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../src/save/memoryStore";
import { bindSaveAs, createSavedGames } from "../src/ui/savedGames";
import { newSession } from "../src/ui/session";
import { sessionSave } from "../src/ui/saveFile";
import { statusHtml, turnBackupSaved } from "../src/ui/statusView";
import { CTX, started } from "./helpers";

const fixture = () => sessionSave(newSession(CTX.scenario, "axis", 1), "test", { kind: "new" }, new Date("2026-11-01T00:00:00.000Z"));
function harness() {
  const store = createMemoryStore();
  const games = createSavedGames({ store: Promise.resolve(store), scenarios: [CTX.scenario],
    timing: { now: () => 0, yield: () => Promise.resolve() }, adopt: vi.fn(), loading: vi.fn() });
  return { store, games };
}

describe("spec 11 Save as", () => {
  it("Parts B/E sketch 4: creates an independent named save with the exact plain-text title", async () => {
    const { store, games } = harness(); const save = fixture();
    expect(await games.saveAs(save, "<b>Poland</b>")).toBe("saved");
    save.snapshot.year = 2000;
    expect(await store.get("named-1")).toMatchObject({ value: { title: "<b>Poland</b>", snapshot: { year: 1939 } } });
    expect((await games.list())[0]!.title).toBe("<b>Poland</b>");
  });
  it("Part D/E sketch 4: existing names ask before replacing, and cancelling preserves the original", async () => {
    const { store, games } = harness(); await games.saveAs(fixture(), "Poland");
    const changed = fixture(); changed.seed = 2;
    expect(await games.saveAs(changed, "Poland")).toBe("replace");
    expect(await store.get("named-1")).toMatchObject({ value: { seed: 1 } });
    expect(await games.saveAs(changed, "Poland", true)).toBe("saved");
    expect(await games.list()).toHaveLength(1);
    expect(await store.get("named-1")).toMatchObject({ value: { seed: 2 } });
  });
  it("Part D: 12 named slots exclude reserved entries; full slots still permit confirmed replacement", async () => {
    const { store, games } = harness();
    for (const id of ["autosave", "turn-backup", "earlier-game"]) await store.put(id, { ...fixture(), title: "Reserved" });
    for (let i = 1; i <= 12; i++) expect(await games.saveAs(fixture(), `Game ${i}`)).toBe("saved");
    expect(await games.saveAs(fixture(), "Thirteenth")).toBe("full");
    expect(await games.saveAs(fixture(), "Game 1")).toBe("replace");
    expect(await games.saveAs(fixture(), "Game 1", true)).toBe("saved");
    expect(await store.get("autosave")).toMatchObject({ value: { title: "Reserved" } });
    expect(await games.list()).toHaveLength(15);
  });
  it("Parts B/D/H: reserved names get a named slot; damaged entries count and are never overwritten", async () => {
    const { store, games } = harness(); await store.put("named-1", null as unknown as ReturnType<typeof fixture>);
    await store.put("autosave", fixture());
    expect(await games.saveAs(fixture(), "Autosave")).toBe("saved");
    expect(await store.get("named-1")).toEqual({ ok: true, value: null });
    expect(await store.get("named-2")).toMatchObject({ value: { title: "Autosave" } });
    expect(await store.get("autosave")).toEqual({ ok: true, value: fixture() });
  });
  it("Part B title cap: accepts 40 characters and refuses 41 without writing", async () => {
    const { games } = harness();
    expect(await games.saveAs(fixture(), "x".repeat(40))).toBe("saved");
    expect(await games.saveAs(fixture(), "x".repeat(41))).toBe("invalid");
    expect(await games.list()).toHaveLength(1);
  });
  it("Parts D/H: quota, list and thrown errors leave the old entry and current game intact", async () => {
    for (const mode of ["quota", "list", "throw"] as const) {
      const { games, store } = harness(); await games.saveAs(fixture(), "Old");
      if (mode === "quota") vi.spyOn(store, "put").mockResolvedValue({ ok: false, code: "quota" });
      else if (mode === "list") vi.spyOn(store, "list").mockResolvedValue({ ok: false, code: "unavailable" });
      else vi.spyOn(store, "list").mockRejectedValue(new Error("storage"));
      expect(await games.saveAs(fixture(), "Old", true)).toBe(mode === "quota" ? "quota" : "unavailable");
      expect(await store.get("named-1")).toEqual({ ok: true, value: { ...fixture(), title: "Old" } });
    }
  });
});

// Minimal DOM double exercises event handling without requiring a browser install.
class Element extends EventTarget {
  children: Element[] = [];
  textContent = ""; className = ""; type = ""; value = ""; maxLength = 0;
  hidden = false; disabled = false; focused = false;
  append(...nodes: Element[]): void { this.children.push(...nodes); }
  prepend(node: Element): void { this.children.unshift(node); }
  before(node: Element): void { this.children.unshift(node); }
  setAttribute(): void { /* role=status */ }
  focus(): void { this.focused = true; }
  click(): void { if (!this.disabled) this.dispatchEvent(new Event("click")); }
  all(): Element[] { return this.children.flatMap(e => [e, ...e.all()]); }
  find(label: string): Element {
    const el = this.all().find(e => e.textContent === label);
    if (!el) throw new Error(`Missing ${label}`); return el;
  }
}
function binding() {
  const h = harness();
  const nodes = Object.fromEntries(["saved-content", "a11y-live", "save-notice", "savedgames", "saved-close", "newgame", "saved-sheet"].map(id => [id, new Element()]));
  const doc = { getElementById: (id: string) => nodes[id], createElement: () => new Element() };
  let watching = false;
  const binder = bindSaveAs({ games: h.games, current: fixture, watching: () => watching, doc: doc as unknown as Document });
  const controls = nodes["saved-content"]!.children[0]!;
  const form = controls.children[1]!, input = form.children[0]!.children[0]!;
  const submit = (): void => { form.dispatchEvent(new Event("submit", { cancelable: true })); };
  return { ...h, nodes, controls, form, input, submit, watch: () => { watching = true; binder.refresh(); } };
}
const tick = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)); };

describe("spec 11 E sketch 4 binding", () => {
  it("shows the default title, bounded labelled input and keyboard submit; announces success and refreshes the list", async () => {
    const { nodes, controls, form, input, submit, games } = binding(); const refresh = vi.fn(); nodes.savedgames!.addEventListener("click", refresh);
    controls.find("Save this game as...").click(); expect(form.hidden).toBe(false);
    expect(input.value).toBe("Axis, Fall 1939"); expect(input.maxLength).toBe(40); expect(input.focused).toBe(true);
    input.value = "Poland"; submit(); await tick();
    expect((await games.list())[0]!.title).toBe("Poland"); expect(form.hidden).toBe(true);
    expect(nodes["a11y-live"]!.textContent).toBe("Game saved."); expect(refresh).toHaveBeenCalledOnce();
  });
  it("renders the Replace question as text; cancel keeps the entry and Replace writes to the same slot", async () => {
    const { controls, input, submit, games, store } = binding(); const title = "<img src=x>";
    await games.saveAs(fixture(), title);
    controls.find("Save this game as...").click(); input.value = title; submit(); await tick();
    expect(controls.find(`A saved game called '${title}' exists. Replace it?`)).toBeDefined();
    const question = controls.children[2]!; question.find("Cancel").click();
    expect(await games.list()).toHaveLength(1); expect(question.hidden).toBe(true);
    controls.find("Save this game as...").click(); input.value = title; submit(); await tick();
    const put = vi.spyOn(store, "put"); question.find("Replace").click(); await tick();
    expect(put).toHaveBeenCalledWith("named-1", expect.objectContaining({ title }));
  });
  it("Cancel, Close, Escape and New game discard the form; watch mode disables Save as", async () => {
    const { controls, form, nodes, games, watch } = binding();
    for (const action of ["Cancel", "saved-close", "escape", "newgame"]) {
      controls.find("Save this game as...").click();
      if (action === "Cancel") form.find("Cancel").click();
      else if (action === "escape") nodes["saved-sheet"]!.dispatchEvent(new Event("cancel"));
      else nodes[action]!.click();
      expect(form.hidden).toBe(true); expect(await games.list()).toEqual([]);
    }
    watch(); expect(controls.find("Save this game as...").disabled).toBe(true);
  });
  it("Part D/H: reports storage failure under Saved games and keeps the form available", async () => {
    const { controls, store, submit, nodes, form } = binding();
    vi.spyOn(store, "put").mockResolvedValue({ ok: false, code: "quota" });
    controls.find("Save this game as...").click(); submit(); await tick();
    expect(nodes["save-notice"]!.textContent).toContain("browser is full"); expect(form.hidden).toBe(false);
  });
});

it("spec 11 D / Ops 5.49b: Saved is restricted to the matching committed step 10b backup, outside watch mode", () => {
  const s = newSession(CTX.scenario, "axis", 1); s.state = started(CTX.scenario, 1);
  const backup = sessionSave(s, "test", { kind: "new" });
  expect(turnBackupSaved(s)).toBe(false); expect(turnBackupSaved(s, backup)).toBe(true);
  const html = statusHtml(s, null, [], turnBackupSaved(s, backup), true);
  expect(html).toContain('class="saved-hint" role="status">Saved.'); expect(html).toContain("Save to a file now and then");
  expect(statusHtml(s, null, [], true)).not.toContain("Save to a file now and then");
  backup.fingerprint = "00000000"; expect(turnBackupSaved(s, backup)).toBe(false);
  expect(statusHtml(s, null, [], false)).not.toContain('class="saved-hint"');
  s.state.position = { part: "player-turn", turn: 1, step: "1" };
  expect(turnBackupSaved(s, sessionSave(s, "test", { kind: "new" }))).toBe(false);
  s.state = started(CTX.scenario, 1); const watchedBackup = sessionSave(s, "test", { kind: "new" }); s.watch = { } as NonNullable<typeof s.watch>;
  expect(turnBackupSaved(s, watchedBackup)).toBe(false);
});

import { describe, expect, it, vi } from "vitest";
import { legalActions } from "../src/engine/actions";
import { airSeaHtml, bindAirSea } from "../src/ui/airSeaView";
import { run } from "../src/ui/session";
import { buttonLabels, statusHtml } from "../src/ui/statusView";
import { bindStatus } from "../src/ui/statusBind";
import { CTX } from "./helpers";
import { designation, queued, resolution, seaSession } from "./ui-air-sea-helpers";
vi.mock("../src/ui/reveal", () => ({ revealHeading: vi.fn(), showTop: vi.fn() }));
import { revealHeading } from "../src/ui/reveal";

function harness(s: ReturnType<typeof seaSession>, selector: string, dataset: Record<string, string> = {}, status = false) {
  const listeners = new Map<string, (event?: unknown) => void>();
  const el = { dataset, addEventListener: (event: string, f: () => void) => listeners.set(event, f) };
  const root = { ownerDocument: { querySelector: () => null }, querySelector: () => null, querySelectorAll: (key: string) => key === selector ? [el] : [] } as unknown as HTMLElement;
  if (status) bindStatus(root, s, null, [], () => {}); else bindAirSea(root, s, () => {});
  return { click: () => listeners.get("click")?.(), key: (key: string) => listeners.get("keydown")?.({ key }) };
}
function select(s: ReturnType<typeof seaSession>) {
  harness(s, "[data-sea-air-plane]", { seaAirPlane: "p" }).click();
  harness(s, "[data-sea-air-target]", { seaAirTarget: "move:0" }).click();
  harness(s, "[data-sea-air-point]", { seaAirPoint: "N18" }).click();
}
describe("12-17 sea-air view and binding (spec 12 R15/D5)", () => {
  it("D5: named region, readable names, pressed rows and disabled confirm", () => {
    const s = seaSession(), html = airSeaHtml(s);
    expect(html).toContain('aria-labelledby="sea-air-title"');
    expect(html).toContain('id="sea-air-confirm" disabled');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("German air at");
    expect(html).toContain("British fleet");
    expect(html).not.toMatch(/undefined|NaN|>move:0</);
    select(s);
    expect(airSeaHtml(s)).toContain('aria-pressed="true"');
    expect(airSeaHtml(s)).not.toContain('id="sea-air-confirm" disabled');
  });
  it("AER99: selection is inert; confirm records exactly the selected subset once", () => {
    const s = seaSession(), before = s.state; select(s);
    expect(s.state).toBe(before); expect(s.record).toEqual([]);
    const confirm = harness(s, "#sea-air-confirm"); confirm.click(); confirm.click();
    expect(s.record).toEqual([designation]);
    expect(s.state.rngState).toBe(before.rngState);
    expect(airSeaHtml(s)).toContain("Assigned sea-air attacks");
  });
  it("D5: empty, cancel, Escape and restored state discard selection", () => {
    const s = seaSession(); select(s);
    harness(s, "[data-sea-air-plane]", { seaAirPlane: "p" }).click();
    harness(s, "#sea-air-confirm").click(); expect(s.record).toEqual([]);
    select(s); harness(s, "#sea-air-cancel").click();
    expect(airSeaHtml(s)).toContain('id="sea-air-confirm" disabled');
    select(s); harness(s, ".sea-air-card").key("Escape");
    expect(airSeaHtml(s)).toContain('id="sea-air-confirm" disabled');
    select(s); const stale = harness(s, "#sea-air-confirm"); s.state = { ...s.state }; stale.click();
    expect(s.record).toEqual([]);
    expect(airSeaHtml(s)).toContain('id="sea-air-confirm" disabled');
    const stalePlane = harness(s, "[data-sea-air-plane]", { seaAirPlane: "p" });
    s.state = { ...s.state }; stalePlane.click();
    expect(airSeaHtml(s)).toContain("0 air factors chosen");
  });
  it("AER98: watch, flag-off, wrong-side and forged selections cannot dispatch", () => {
    const s = seaSession(); select(s); s.watch = {} as NonNullable<typeof s.watch>;
    expect(airSeaHtml(s)).toBe(""); harness(s, "#sea-air-confirm").click();
    expect(s.record).toEqual([]); s.watch = undefined;
    s.state = { ...s.state, naval: { ...s.state.naval!, manualSeaAir: false } };
    expect(airSeaHtml(s)).toBe(""); harness(s, "#sea-air-confirm").click();
    const other = seaSession(); other.humanSide = "allies";
    select(other); harness(other, "#sea-air-confirm").click(); expect(other.record).toEqual([]);
    const forged = seaSession();
    harness(forged, "[data-sea-air-plane]", { seaAirPlane: "bad" }).click();
    harness(forged, "[data-sea-air-target]", { seaAirTarget: "bad" }).click();
    harness(forged, "#sea-air-confirm").click(); expect(forged.record).toEqual([]);
  });
  it("AER99/AER103: resolve once, show stored result, close it, expire next turn", () => {
    const s = queued();
    expect(airSeaHtml(s)).toContain('id="sea-air-resolve"');
    const resolve = harness(s, "#sea-air-resolve"); resolve.click(); resolve.click();
    expect(s.record).toEqual([resolution]);
    expect(airSeaHtml(s)).toContain("Sea-air results");
    expect(airSeaHtml(s)).toContain("Factor dice: 1.");
    harness(s, "#sea-air-close").click(); expect(airSeaHtml(s)).not.toContain("Sea-air results");
    const t = queued(); expect(run(t, resolution)).toBe(true);
    t.state = { ...t.state, activeSide: "axis" }; expect(airSeaHtml(t)).toBe("");
  });
  it("AER99: human may still assign while the other side answers interceptions", () => {
    const s = seaSession(); expect(run(s, { type: "PASS_INTERCEPT", side: "axis" })).toBe(true);
    select(s); harness(s, "#sea-air-confirm").click();
    expect(s.record.at(-1)).toEqual(designation);
  });
  it("D5: opening focuses the heading once; selections retain control focus", () => {
    const s = seaSession();
    vi.mocked(revealHeading).mockClear();
    const heading = { id: "sea-air-title" };
    const root = { querySelector: (key: string) => key === "#sea-air-title" ? heading : null, querySelectorAll: () => [] } as unknown as HTMLElement;
    bindAirSea(root, s, () => {});
    select(s); bindAirSea(root, s, () => {});
    expect(revealHeading).toHaveBeenCalledTimes(1);
    expect(revealHeading).toHaveBeenCalledWith(heading, expect.any(Function));
  });
  it("D5: status renders/binds the card and hides both raw action types", () => {
    for (const s of [seaSession(), queued()]) {
      const actions = legalActions(CTX, s.state);
      expect(statusHtml(s, null, actions)).toContain('id="sea-air-title"');
      expect(buttonLabels(actions, CTX, s.state).some(l => l.action.type === "DESIGNATE_SEA_AIR" || l.action.type === "RESOLVE_SEA_AIR")).toBe(false);
    }
    const s = seaSession(); select(s); harness(s, "#sea-air-confirm", {}, true).click();
    expect(s.record).toEqual([designation]);
  });
});

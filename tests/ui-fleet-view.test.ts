import { describe, expect, it } from "vitest";
import { legalActions } from "../src/engine/actions";
import { bindFleet, fleetHtml } from "../src/ui/fleetView";
import { confirmFleet, fleetNow, fleetScreen, tapFleet } from "../src/ui/fleetTap";
import { run } from "../src/ui/session";
import { tapHex } from "../src/ui/sessionActions";
import { statusHtml } from "../src/ui/statusView";
import { mapSyncProbe } from "./air-move-helpers";
import { CTX } from "./helpers";
import { session, at6c, at6d, resolution, passAxis } from "./ui-fleet-helpers";

// Existing UI binding pattern: invoke real handlers without a browser.
function harness(s: ReturnType<typeof session>, selector: string, dataset: Record<string, string> = {}) {
  const listeners = new Map<string, (event?: unknown) => void>();
  const el = { dataset, addEventListener: (event: string, f: () => void) => listeners.set(event, f) };
  const root = { querySelector: () => null, querySelectorAll: (key: string) => key === selector ? [el] : [] } as unknown as HTMLElement;
  bindFleet(root, s, () => {});
  return { click: () => listeners.get("click")?.(), key: (key: string) => listeners.get("keydown")?.({ key }) };
}
function pickMove(s: ReturnType<typeof session>) {
  harness(s, "[data-fleet]", { fleet: "b1" }).click();
  const dest = fleetNow(s)!.destinations.find(d => d.action.to === "N18")!;
  harness(s, "[data-fleetdest]", { fleetdest: dest.key }).click();
  return dest.action;
}

describe("fleet screens and bindings (spec 12 D3/D5, spec 07/10 draft conventions)", () => {
  it("R10 fleet then destination needs confirmation; exactly one legal move is recorded", () => {
    const s = session(), state = s.state;
    expect(fleetHtml(s)).toContain('id="fleet-confirm" disabled');
    const action = pickMove(s);
    expect(s.state).toBe(state);
    expect(s.record).toEqual([]);
    expect(fleetHtml(s)).not.toContain('id="fleet-confirm" disabled');
    const confirm = harness(s, "#fleet-confirm"); confirm.click(); confirm.click();
    expect(s.record).toEqual([action]);
    expect(s.state.units.b1!.at).toBe("N18");
    expect(s.state.units.b2!.at).toBe("K21");
  });
  it("R10/D3 map taps select the same draft and map highlights exactly legal destinations", () => {
    const s = session();
    tapHex(s, CTX.map.hexes.K21!);
    const m = fleetNow(s)!;
    expect(m.selected?.id).toBe("b1");
    expect(mapSyncProbe(s)().yellow).toEqual(m.destinations.map(d => d.action.to));
    tapHex(s, CTX.map.hexes.N18!);
    expect(fleetNow(s)!.action?.to).toBe("N18");
    expect(s.record).toEqual([]);
    confirmFleet(s, "move");
    expect(s.record[0]?.type).toBe("MOVE_FLEET");
  });
  it("spec 07/10 cancel, Escape, replacement and wrong step discard the draft", () => {
    const s = session(); pickMove(s);
    harness(s, "#fleet-cancel").click();
    expect(fleetNow(s)!.action).toBeNull();
    pickMove(s); harness(s, ".fleetcard").key("Escape");
    expect(fleetNow(s)!.selected).toBeUndefined();
    pickMove(s); const stale = harness(s, "#fleet-confirm"); s.state = { ...s.state }; stale.click();
    expect(s.record).toEqual([]);
    expect(fleetNow(s)!.action).toBeNull();
    s.state = { ...s.state, position: { part: "player-turn", turn: 1, step: "6f" } };
    expect(fleetNow(s)).toBeNull();
    expect(tapFleet(s, "K21")).toBe(false);
  });
  it("AER75 controls stay absent in old flag-off games, watched games and computer rounds", () => {
    const s = session(); s.state.naval!.manualFleetMove = false;
    expect(fleetHtml(s)).toBe("");
    expect(tapFleet(s, "K21")).toBe(false);
    s.state.naval!.manualFleetMove = true; s.humanSide = "axis";
    expect(fleetHtml(s)).toBe(""); confirmFleet(s, "end");
    expect(s.record).toEqual([]);
    s.humanSide = "allies"; s.watch = {} as NonNullable<typeof s.watch>;
    expect(fleetHtml(s)).toBe("");
  });
  it("AER84 shows the answering side, targets, reach and Pass during the non-phasing round", () => {
    const s = session(at6c()); s.humanSide = "axis";
    const h = fleetHtml(s);
    expect(h).toContain("Axis answer this interception round");
    expect(h).toContain("British fleet");
    expect(h).toContain("German fleet");
    expect(h).toContain("needs 1 or 2 or 3 or 4");
    harness(s, "#fleet-pass").click();
    expect(s.record).toEqual([passAxis]);
    expect(fleetHtml(s)).toBe("");
  });
  it("R11/AER90 ticks eligible fleets and sends break-off before any dice", () => {
    const s = session(at6c()); s.humanSide = "axis";
    harness(s, "[data-fleetpoint]", { fleetpoint: "N18" }).click();
    harness(s, "[data-interceptfleet]", { interceptfleet: "g1" }).click();
    harness(s, "#fleet-break").click();
    const rng = s.state.rngState;
    harness(s, "#fleet-intercept").click();
    expect(s.record).toEqual([{ type: "DECLARE_INTERCEPT", side: "axis", target: "move:0", meetingPoint: "N18", fleets: ["g2"], breakOff: true }]);
    expect(s.state.rngState).toBe(rng);
  });
  it("R11 empty selection disables Intercept; a stale round control cannot dispatch", () => {
    const s = session(at6c()); s.humanSide = "axis";
    for (const interceptfleet of ["g1", "g2"]) harness(s, "[data-interceptfleet]", { interceptfleet }).click();
    expect(fleetHtml(s)).toContain('id="fleet-intercept" disabled');
    confirmFleet(s, "intercept"); expect(s.record).toEqual([]);
    const stale = harness(s, "#fleet-pass"); s.state = { ...s.state }; stale.click();
    expect(s.record).toEqual([]);
  });
  it("AER88/AER91 Resolve records once and retains event results after leaving 6d", () => {
    const s = session(at6d());
    expect(fleetHtml(s)).toContain('id="fleet-resolve"');
    const resolve = harness(s, "#fleet-resolve"); resolve.click(); resolve.click();
    expect(s.record).toEqual([resolution]);
    const h = fleetHtml(s);
    expect(h).toContain("Naval results");
    expect(h).toContain("Naval combat at");
    expect(h).toContain("nationality +2");
    expect(h).toContain("naval factors");
    expect(s.log.some(l => l.includes("Naval combat at"))).toBe(true);
    harness(s, "#fleet-results-close").click();
    expect(fleetHtml(s)).not.toContain("Naval results");
  });
  it("D3 results expire with their Player Turn and are hidden in watch mode", () => {
    const s = session(at6d()); expect(run(s, resolution)).toBe(true);
    expect(fleetHtml(s)).toContain("Naval results");
    s.state = { ...s.state, activeSide: "axis" };
    expect(fleetHtml(s)).not.toContain("Naval results");
    s.state = { ...s.state, activeSide: "allies" }; s.watch = {} as NonNullable<typeof s.watch>;
    expect(fleetHtml(s)).toBe("");
  });
  it("D5 opening focuses once; ticks and meeting changes preserve the selected control's focus", () => {
    const s = session();
    harness(s, "[data-fleet]", { fleet: "b1" }).click();
    expect(fleetScreen(s).fresh).toBe(true);
    fleetScreen(s).fresh = false;
    harness(s, "[data-fleetdest]", { fleetdest: "western:N18" }).click();
    expect(fleetScreen(s).fresh).toBe(false);
    const c = session(at6c()); c.humanSide = "axis";
    harness(c, "[data-interceptfleet]", { interceptfleet: "g1" }).click();
    expect(fleetScreen(c).fresh).toBe(false);
    harness(c, "[data-fleetpoint]", { fleetpoint: "N18" }).click();
    expect(fleetScreen(c).fresh).toBe(false);
  });
  it("D3 the result card can be closed while the computer is acting", () => {
    const s = session(at6d()); expect(run(s, resolution)).toBe(true);
    s.humanSide = "axis";
    expect(fleetHtml(s)).toContain("Naval results");
    harness(s, "#fleet-results-close").click();
    expect(fleetHtml(s)).not.toContain("Naval results");
  });
  it("D3 status includes the cards and removes raw/duplicate action buttons", () => {
    for (const state of [session().state, at6c(), at6d()]) {
      const s = session(state); if (state.position?.part === "player-turn" && state.position.step === "6c") s.humanSide = "axis";
      const h = statusHtml(s, null, legalActions(CTX, state));
      expect(h.match(/id="fleet-title"/g)).toHaveLength(1);
      expect(h).not.toMatch(/>MOVE_FLEET<|>DECLARE_INTERCEPT<|>PASS_INTERCEPT<|>RESOLVE_INTERCEPTIONS</);
      expect(h).not.toContain('>Done with step 6b<');
    }
  });
});

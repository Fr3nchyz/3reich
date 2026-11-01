import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { legalActions } from "../src/engine/actions";
import { capitalOf } from "../src/engine/minors-rules";
import { newSession } from "../src/ui/session";
import { bindMinor, minorAuto, minorHtml, minorTap } from "../src/ui/minorBind";
import { hexCard } from "../src/ui/hexCard";
import { minorMarksMarkup } from "../src/ui/mapLayers";
import { statusHtml } from "../src/ui/statusView";
import { atStart, CTX } from "./helpers";

function session(placing = false) {
  const s = newSession(SCENARIO_1939, placing ? "allies" : "axis", 1);
  s.state = atStart(SCENARIO_1939, 1);
  if (placing) {
    s.state.position = { part: "player-turn", turn: 1, step: "2" };
    s.state.countries = { belgium: { status: "attacked", attacker: "germany", toPlace: "allies" } };
  }
  return s;
}
// Model-level event harness: binding only needs selectors and click listeners, no browser dependency.
function bind(s: ReturnType<typeof session>, selector: string, dataset: Record<string, string> = {}) {
  let click = () => {};
  const layer = { innerHTML: "" };
  const button = { dataset, addEventListener: (_: string, f: () => void) => { click = f; } };
  const root = { ownerDocument: { querySelector: () => layer },
    querySelectorAll: (key: string) => key === selector ? [button] : [] } as unknown as HTMLElement;
  bindMinor(root, s, legalActions(CTX, s.state), () => {});
  return { click: () => click(), layer };
}
const html = (s: ReturnType<typeof session>) => minorHtml(s, legalActions(CTX, s.state));

describe("minor bindings spec 15 D1/D2/D5", () => {
  it("R1/R2 D1: status adds minor inspection alongside the unchanged declaration fold-out", () => {
    const s = session();
    const h = statusHtml(s, null, legalActions(CTX, s.state));
    expect(h).toContain("Small countries");
    expect(h).toMatch(/<summary>Declare war \(\d+ choices\)<\/summary>/);
    expect(h).toContain('data-minor="belgium"');
    expect(h).toContain("price 10 BRPs");
    expect(h).toContain("5 infantry factors");
    const inspection = h.match(/<details class="declarations"><summary>Small countries<\/summary>(.*?)<\/details>/s)?.[1];
    expect(inspection).toBeDefined();
    expect(inspection).not.toContain("Germany declares war on Belgium");
    expect(h).toContain("Germany declares war on Belgium (10 BRPs)");
  });
  it("R2/R4 D1: inspection and cancellation do not declare; confirmation records the legal action", () => {
    const s = session(), before = s.state;
    bind(s, "[data-minor]", { by: "germany", minor: "belgium" }).click();
    expect(s.state).toBe(before);
    expect(html(s)).toContain("the 10 BRPs are lost");
    bind(s, "#minor-cancel").click();
    expect(html(s)).not.toContain('id="minor-declare"');
    bind(s, "[data-minor]", { by: "germany", minor: "belgium" }).click();
    bind(s, "#minor-declare").click();
    expect(s.record).toEqual([{ type: "DECLARE_WAR", by: "germany", on: "belgium" }]);
    expect(html(s)).toContain("Belgium: enter or attack this turn");
  });
  it("R2 D1: blocked rows explain refusal and confirmation cannot submit", () => {
    const s = session();
    bind(s, "[data-minor]", { by: "germany", minor: "poland" }).click();
    expect(html(s)).toContain('id="minor-declare" disabled');
    bind(s, "#minor-declare").click();
    expect(s.record).toEqual([]);
  });
  it("R3/R16 D2: automatic suggestion is editable and changes no game until Done", () => {
    const s = session(true), before = s.state;
    expect(html(s)).toContain('id="minor-done" disabled');
    bind(s, "#minor-done").click();
    expect(s.state).toBe(before);
    minorAuto(s, legalActions(CTX, s.state));
    expect(s.state).toBe(before);
    expect(html(s)).not.toContain('id="minor-done" disabled');
    expect(html(s).indexOf('id="minor-auto"')).toBeLessThan(html(s).indexOf('data-minor-chip'));
    bind(s, "#minor-done").click();
    expect(s.record[0]?.type).toBe("PLACE_MINOR_FORCES");
    expect(s.state.countries?.belgium?.toPlace).toBeUndefined();
    expect(html(s)).not.toContain('id="minor-place-title"');
  });
  it("R3 D2: selecting a later chip first and tapping a destination keeps an incomplete draft safe", () => {
    const s = session(true);
    bind(s, "[data-minor-chip]", { minorChip: "4" }).click();
    const offered = legalActions(CTX, s.state).find((a) => a.type === "PLACE_MINOR_FORCES")!;
    if (offered.type !== "PLACE_MINOR_FORCES") throw new Error("missing placement");
    expect(minorTap(s, offered.placements[4]!.at)).toBe(true);
    expect(html(s)).toContain(`air: ${offered.placements[4]!.at}`);
    expect(html(s)).toContain('id="minor-done" disabled');
    expect(s.record).toEqual([]);
  });
  it("R3 D2: illegal taps refuse, legal taps fill selected chip and light legal destinations", () => {
    const s = session(true);
    expect(minorTap(s, "M35")).toBe(true);
    expect(s.toast).toContain("yellow hex");
    const cap = capitalOf(CTX, "belgium")!;
    expect(minorTap(s, cap)).toBe(true);
    expect(html(s)).toContain(`infantry: ${cap}`);
    expect(bind(s, "none").layer.innerHTML).toContain("polygon");
    expect(s.record).toEqual([]);
  });
  it("R3/R9 D2/D5: computer and watched placements have no controls or intercepted taps", () => {
    const s = session(true);
    s.humanSide = "axis";
    expect(html(s)).not.toContain('id="minor-auto"');
    expect(minorTap(s, "M35")).toBe(false);
    expect(bind(s, "none").layer.innerHTML).toBe("");
    s.humanSide = "allies";
    s.watch = {} as NonNullable<typeof s.watch>;
    expect(html(s)).not.toContain('id="minor-auto"');
    expect(minorTap(s, "M35")).toBe(false);
  });
  it("R3 D2: replacing the position drops an old placement draft", () => {
    const s = session(true);
    minorAuto(s, legalActions(CTX, s.state));
    s.state = { ...s.state };
    expect(html(s)).toContain('id="minor-done" disabled');
  });
  it("R2/R9/R10 D3/D5: visible hex status and sleeping marks refresh when allies wake", () => {
    const s = session();
    const cap = capitalOf(CTX, "hungary")!;
    expect(hexCard(CTX, s.state, cap).holder).toContain("Hungary sleeps.");
    expect(minorMarksMarkup(CTX, s.state).match(/>asleep</g)).toHaveLength(4);
    s.state.minorAllies = s.state.minorAllies.map((m) => ({ ...m, active: true }));
    expect(hexCard(CTX, s.state, cap).holder).not.toContain("sleeps");
    expect(minorMarksMarkup(CTX, s.state)).toBe("");
    s.state.countries = { belgium: { status: "attacked", attacker: "germany" } };
    expect(hexCard(CTX, s.state, capitalOf(CTX, "belgium")!).holder).toContain("Belgium is at war with Germany.");
  });
  it("R7/R9 D5: conquest suppresses sleeping marks", () => {
    const s = session();
    s.state.conquests = s.state.minorAllies.map((m) => ({ country: m.owner, by: "britain", side: "allies", how: "capital", at: { year: 1940, season: "spring" } }));
    expect(minorMarksMarkup(CTX, s.state)).toBe("");
  });
});

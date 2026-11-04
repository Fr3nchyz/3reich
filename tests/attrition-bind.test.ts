import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { neighborIds } from "../src/engine/attack-rules";
import { legalActions } from "../src/engine/actions";
import { turnKey } from "../src/engine/combat-record";
import type { AttritionRun } from "../src/engine/attrition-record";
import { attritionHtml, attritionMarks, attritionTap, bindAttrition } from "../src/ui/attritionBind";
import { attritionModel } from "../src/ui/attritionView";
import { hexCard } from "../src/ui/hexCard";
import { newSession, run } from "../src/ui/session";
import { statusHtml } from "../src/ui/statusView";
import { buildHexLayers, svgMarkup } from "../src/ui/mapLayers";
import { board, counter } from "./board";
import { CTX } from "./helpers";

function session(stage?: AttritionRun["stage"]) {
  const s = newSession(SCENARIO_1939, stage === "losses" || stage === "retreat" ? "allies" : "axis", 1);
  s.state = board([
    counter("g", "germany", "infantry", 15, "M32"), counter("g2", "germany", "armor", 4, "L33"),
    counter("f", "france", "infantry", 2, "M33"), counter("r", "france", "replacement", 1, "M34"),
  ], undefined, { activeSide: "axis", control: { M33: "france", M34: "france" },
    frontOptions: { eastern: { option: "attrition" } }, position: { part: "player-turn", turn: 1, step: "7a" } });
  if (stage) s.state.attrition = { turn: turnKey(s.state), done: ["eastern"], used: ["g"], run: {
    front: "eastern", factors: 15, column: "11-20", roll: 1, mustLose: 1, hexesLeft: 1,
    participants: ["g", "g2"], against: ["france"], stage, chooser: s.humanSide,
    target: "M33", retreating: ["f"], taken: [],
  } };
  if (stage === "occupy") delete s.state.units.f;
  return s;
}
// Same selector/listener harness as minor-bind: exercise actual handlers without a browser.
function bind(s: ReturnType<typeof session>, selector = "none", dataset: Record<string, string> = {}) {
  let click = () => {}, redraws = 0, focuses = 0;
  const layer = { innerHTML: "" };
  const heading = { focus: () => { focuses++; }, scrollIntoView: () => {} };
  const root = { ownerDocument: { querySelector: () => layer }, querySelector: () => heading,
    querySelectorAll: (key: string) => key === selector ? [{ dataset, addEventListener: (_: string, f: () => void) => { click = f; } }] : [],
  } as unknown as HTMLElement;
  bindAttrition(root, s, () => { redraws++; });
  return { click: () => click(), layer, focuses: () => focuses, redraws: () => redraws };
}
const action = (s: ReturnType<typeof session>, key: string) => bind(s, "[data-attrition-action]", { attritionAction: key }).click();
const chip = (s: ReturnType<typeof session>, id: string, front?: string) => bind(s, "[data-attrition-chip]", { attritionChip: id, ...(front ? { front } : {}) }).click();

describe("Attrition bindings (spec 16 D2/D6)", () => {
  it("R2/R3/R8: status renders six results, selected factors, timing and keyboard fallback", () => {
    const s = session();
    const html = statusHtml(s, null, legalActions(CTX, s.state));
    expect(html).toContain('class="attrition-card"');
    expect(html.match(/<li>Roll /g)).toHaveLength(6);
    expect(html).toContain("19 factors");
    expect(html).toContain("After the battles");
    expect(html).toContain("Attrition choices as a list");
    expect(attritionMarks(s)).toContain("attrition-participant");
    chip(s, "g", "eastern");
    expect(attritionHtml(s)).toContain("4 factors. Column: 1-10");
    expect(attritionHtml(s)).toContain("Left out");
    chip(s, "g2", "eastern");
    expect(attritionHtml(s)).toContain('data-attrition-action="eastern" disabled');
    action(s, "eastern");
    expect(s.record).toEqual([]);
  });
  it("R2/R8: resolves only the selected subset and resets a draft on state replacement", () => {
    const s = session();
    chip(s, "g", "eastern");
    action(s, "eastern");
    expect(s.record[0]).toMatchObject({ type: "RESOLVE_ATTRITION", units: ["g2"] });
    const fresh = session();
    chip(fresh, "g", "eastern");
    fresh.state = { ...fresh.state };
    expect(attritionHtml(fresh)).toContain("19 factors");
  });
  it("R8: 7p has Resolve and Skip; timing button dispatches END_STEP", () => {
    const s = session();
    s.state.position = { part: "player-turn", turn: 1, step: "7p" };
    expect(attritionHtml(s)).toContain("you did not resolve it earlier");
    expect(attritionHtml(s)).toContain('>Skip</button>');
    action(s, "next");
    expect(s.record[0]).toMatchObject({ type: "END_STEP", step: "7p" });
  });
  it("R4/Q4: losses toggle without writing state, validate empty sets and dispatch defaults", () => {
    const s = session("losses"), before = s.state;
    expect(attritionHtml(s)).toContain("Replacements are cheapest");
    chip(s, "r");
    expect(s.state).toBe(before);
    expect(attritionHtml(s)).toContain('data-attrition-action="confirm" disabled');
    action(s, "confirm");
    expect(s.record).toEqual([]);
    action(s, "auto");
    expect(s.record[0]).toMatchObject({ type: "CHOOSE_ATTRITION_LOSSES", units: ["r"] });
    const manual = session("losses");
    chip(manual, "r"); chip(manual, "f"); action(manual, "confirm");
    expect(manual.record[0]).toMatchObject({ units: ["f"] });
  });
  it("R5: tap inspects defenders and occupiers; confirmation dispatches the target", () => {
    const s = session("hex");
    expect(attritionTap(s, "M33")).toBe(true);
    expect(s.record).toEqual([]);
    expect(s.lookedAt).toBe("M33");
    expect(attritionHtml(s)).toContain("1 defenders");
    expect(attritionHtml(s)).toContain("Your units next to it");
    expect(attritionMarks(s)).toContain("attrition-target-mark");
    action(s, "take");
    expect(s.record[0]).toMatchObject({ type: "SELECT_ATTRITION_HEX", hex: "M33" });
    const stop = session("hex"); action(stop, "confirm");
    expect(stop.record[0]?.type).toBe("END_ATTRITION");
  });
  it("R5: invalid hex shows the engine reason in both cards and cannot confirm", () => {
    const s = session("hex");
    s.state.fortresses.M33 = true;
    attritionTap(s, "M33");
    expect(attritionHtml(s)).toContain("fortress");
    expect(hexCard(CTX, s.state, "M33").holder).toContain("fortress");
    expect(attritionHtml(s)).toContain('data-attrition-action="take" disabled');
    action(s, "take");
    expect(s.record).toEqual([]);
  });
  it("R6/Q4: selected retreat lights legal hexes, rejects other taps and submits a legal choice", () => {
    const s = session("retreat");
    chip(s, "f");
    expect(attritionMarks(s)).toContain("attrition-retreat");
    attritionTap(s, "M32"); action(s, "confirm");
    expect(s.record).toEqual([]);
    expect(s.toast).toContain("yellow hex");
    const to = attritionModel(CTX, s.state, "allies")!.chips[0]!.destinations[0]!;
    bind(s, "[data-attrition-hex]", { attritionHex: to }).click();
    action(s, "confirm");
    expect(s.record[0]).toMatchObject({ type: "RETREAT_UNIT", unit: "f", to });
    const automatic = session("retreat"); action(automatic, "auto");
    expect(automatic.record[0]?.type).toBe("RETREAT_UNIT");
  });
  it("R7: move-in defaults strongest, requires a selection, and clears map marks on leaving", () => {
    const s = session("occupy");
    expect(attritionMarks(s)).toContain("attrition-move-in");
    chip(s, "g"); action(s, "confirm");
    expect(s.record).toEqual([]);
    chip(s, "g2"); action(s, "confirm");
    expect(s.record[0]).toMatchObject({ type: "OCCUPY_ATTRITION_HEX", units: ["g2"] });
    s.state.position = { part: "player-turn", turn: 1, step: "7h" };
    expect(bind(s).layer.innerHTML).toBe("");
  });
  it("R4/R6/D2: computer and watch cards disable every control and ignore taps/handlers", () => {
    for (const watching of [false, true]) {
      const s = session("losses");
      if (watching) s.watch = {} as NonNullable<typeof s.watch>;
      else s.humanSide = "axis";
      expect(attritionHtml(s)).toContain('data-attrition-action="auto" disabled');
      expect(attritionHtml(s)).toContain("computer is choosing its losses");
      expect(attritionMarks(s)).toBe("");
      chip(s, "r"); action(s, "auto");
      expect(s.record).toEqual([]);
      expect(attritionTap(s, "M33")).toBe(false);
    }
  });
  it("R3/D2/C4: retains completed event results between redraws and clears them next Player Turn", () => {
    const s = session(); attritionHtml(s);
    run(s, { type: "RESOLVE_ATTRITION", side: "axis", front: "eastern", units: ["g", "g2"] });
    const line = s.log.find((l) => l.startsWith("Attrition on the "))!;
    expect(line).toBeDefined();
    s.state = { ...s.state, attrition: { ...s.state.attrition!, run: null }, position: { part: "player-turn", turn: 1, step: "7h" } };
    const result = attritionHtml(s);
    expect(result).toMatch(/Die: [1-6]\. The Allies lose \d+ units? and must give up \d+ hex/);
    expect(attritionHtml(s)).toBe(result);
    s.state = { ...s.state, activeSide: "allies" };
    expect(attritionHtml(s)).toBe("");
  });
  it("R6/D2: renders trapped-unit notes and deferred overstack warnings", () => {
    const s = session("retreat");
    for (const [i, h] of neighborIds(CTX, "M33").entries()) s.state.units[`block${i}`] = counter(`block${i}`, "germany", "infantry", 1, h);
    expect(attritionHtml(s)).toContain("eliminated: nowhere to go");
    expect(attritionHtml(s)).toContain('data-attrition-action="auto" disabled');
    for (let i = 0; i < 2; i++) s.state.units[`extra${i}`] = counter(`extra${i}`, "france", "infantry", 1, "M33");
    expect(attritionHtml(s)).toContain("fix before the end of your Movement Phase");
  });
  it("D6/R2: stage gets focus once, chips redraw without stealing focus, SVG has inert mark layer", () => {
    const s = session();
    expect(bind(s).focuses()).toBe(1);
    expect(bind(s).focuses()).toBe(0);
    chip(s, "g", "eastern");
    expect(bind(s).focuses()).toBe(0);
    const layers = buildHexLayers(CTX.map);
    expect(svgMarkup(CTX.map, layers.bounds, false, layers)).toContain('<g class="attrition-marks" aria-hidden="true" pointer-events="none">');
  });
});

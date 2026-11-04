import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { legalActions } from "../src/engine/actions";
import { adjacentHexes } from "../src/engine/zoc";
import { newSession, run } from "../src/ui/session";
import { minorHtml, bindMinor } from "../src/ui/minorBind";
import { bindMinorCards, minorCardsHtml, nextYearHtml, observeMinorCards, previewMinorMove, takeMinorAction } from "../src/ui/minorCardsBind";
import { statusHtml } from "../src/ui/statusView";
import { bindStatus } from "../src/ui/statusBind";
import { chooseStack } from "../src/ui/moveTap";
import { atStart, CTX } from "./helpers";

const end = { type: "END_STEP", step: "7h", side: "axis" } as const;
function session(step = "7h") {
  const s = newSession(SCENARIO_1939, "axis", 1);
  s.state = { ...atStart(SCENARIO_1939, 1), position: { part: "player-turn", turn: 1, step },
    countries: { belgium: { status: "attacked", attacker: "germany", duty: { by: "germany", declared: { year: 1939, season: "fall" } } } } };
  return s;
}
type S = ReturnType<typeof session>;
const html = (s: S) => minorCardsHtml(s, legalActions(CTX, s.state));
// Same selector/listener harness as minor-bind: execute the real event handlers, with no browser dependency.
function harness(s: S, selector: string, status = false) {
  const listeners = new Map<string, () => void>();
  let focused = 0;
  const el = { dataset: { action: "0" }, addEventListener: (event: string, f: () => void) => listeners.set(event, f),
    focus: () => { focused++; }, scrollIntoView: () => {} };
  const root = { ownerDocument: { querySelector: () => null },
    querySelector: (key: string) => key === selector ? el : null,
    querySelectorAll: (key: string) => key === selector ? [el] : [] } as unknown as HTMLElement;
  if (status) bindStatus(root, s, null, [end], () => {});
  else bindMinorCards(root, s, () => {});
  return { root, click: () => listeners.get("click")?.(), focused: () => focused };
}
function wake(s = session("1")) {
  s.state = { ...s.state, year: 1941, season: "summer", countries: {} };
  observeMinorCards(s);
  expect(run(s, { type: "END_STEP", side: "axis", step: "1" })).toBe(true);
  return s;
}
function intervening() {
  const s = session("6f");
  const to = Object.keys(CTX.map.hexes).find((id) => CTX.map.hexes[id]!.country === "belgium" && CTX.map.hexes[id]!.land)!;
  const from = adjacentHexes(CTX, to).find((id) => CTX.map.hexes[id]?.land && CTX.map.hexes[id]?.country === "france")!;
  s.humanSide = "allies";
  s.state = { ...s.state, activeSide: "allies", countries: { belgium: { status: "attacked", attacker: "germany" } },
    wars: [...s.state.wars, ["germany", "belgium"]], units: { b: { id: "b", owner: "britain", type: "infantry", strength: 3, movement: 4, at: from } } };
  const action = legalActions(CTX, s.state).find((a) => a.type === "MOVE" && a.path.at(-1) === to)!;
  expect(action).toBeDefined();
  return { s, action, from, to };
}

describe("minor card bindings spec 15 D3–D6", () => {
  it("R4/D3 shows one red duty chip and removes it when cleared", () => {
    const s = session();
    expect(statusHtml(s, null, [end]).match(/Belgium: enter or attack this turn/g)).toHaveLength(1);
    s.state = { ...s.state, countries: {} };
    expect(minorHtml(s, [])).not.toContain("minor-duty");
    s.humanSide = "allies";
    expect(minorHtml(session(), [])).toContain("minor-duty");
    expect(minorHtml(s, [])).not.toContain("minor-duty");
  });
  it("R4/D3 intercepts the normal status action, lists all duties and Go back changes no game", () => {
    const s = session(), before = s.state;
    s.state.countries!.denmark = s.state.countries!.belgium;
    harness(s, "button[data-action]", true).click();
    expect(s.state).toBe(before);
    expect(s.record).toEqual([]);
    expect(html(s)).toContain("not entered or attacked Belgium");
    expect(html(s)).toContain("not entered or attacked Denmark");
    expect(html(s)).toContain("lose the 10 BRPs");
    harness(s, "#minor-back").click();
    expect(html(s)).not.toContain("minor-warning-title");
    expect(s.state).toBe(before);
  });
  it("R4/D3 confirmation dispatches the exact offered action once", () => {
    const s = session();
    takeMinorAction(s, end);
    const button = harness(s, "#minor-end-combat");
    button.click(); button.click();
    expect(s.record).toEqual([end]);
    expect(s.record[0]).toBe(end);
    expect(html(s)).not.toContain("minor-warning-title");
  });
  it("R4/D3 replacement state drops confirmation; cleared duties end directly", () => {
    const s = session();
    takeMinorAction(s, end);
    const stale = harness(s, "#minor-end-combat");
    s.state = { ...s.state, countries: {} };
    stale.click();
    expect(s.record).toEqual([]);
    takeMinorAction(s, end);
    expect(s.record).toEqual([end]);
  });
  it("R4/D3 other steps pass through; computer and watched turns cannot open/confirm", () => {
    const s = session("1");
    takeMinorAction(s, { ...end, step: "1" });
    expect(s.record).toHaveLength(1);
    const c = session();
    takeMinorAction(c, end);
    c.humanSide = "allies";
    harness(c, "#minor-end-combat").click();
    expect(c.record).toEqual([]);
    expect(html(c)).not.toContain("minor-warning-title");
    c.watch = {} as NonNullable<S["watch"]>;
    takeMinorAction(c, end);
    expect(c.record).toEqual([]);
  });
  it("R4/D7 focuses the confirmation heading once", () => {
    const s = session();
    takeMinorAction(s, end);
    const h = harness(s, "#minor-warning-title, .minor-event h2");
    expect(h.focused()).toBe(1);
    expect(harness(s, "#minor-warning-title, .minor-event h2").focused()).toBe(0);
  });
  it("R9/D5 renders actual wake totals and fills the existing editable draft without dispatch", () => {
    const s = wake();
    expect(html(s)).toContain("Germany gains 45 BRPs. Place their armies.");
    expect(html(s)).toContain('id="minor-wake-auto"');
    const before = s.state, count = s.record.length;
    expect(minorHtml(s, legalActions(CTX, s.state))).toContain('id="minor-done" disabled');
    harness(s, "#minor-wake-auto").click();
    expect(s.state).toBe(before);
    expect(s.record).toHaveLength(count);
    expect(minorHtml(s, legalActions(CTX, s.state))).not.toContain('id="minor-done" disabled');
    // R3/R9: submit through the ordinary placement binding.
    const listeners: (() => void)[] = [];
    const root = { ownerDocument: { querySelector: () => null }, querySelectorAll: (key: string) => key === "#minor-done" ? [{ addEventListener: (_: string, f: () => void) => listeners.push(f) }] : [] } as unknown as HTMLElement;
    bindMinor(root, s, legalActions(CTX, s.state), () => {});
    listeners[0]!();
    expect(s.record.at(-1)?.type).toBe("PLACE_MINOR_FORCES");
  });
  it("R9/D5 partial wakes show their own value; computer/watched cards have no placement control", () => {
    const s = session("1");
    s.state.minorAllies = s.state.minorAllies.map((m) => ({ ...m, active: m.owner !== "finland" }));
    wake(s);
    expect(html(s)).toContain("Finland join Germany. Germany gains 10 BRPs.");
    expect(html(s)).not.toContain("45 BRPs");
    s.humanSide = "allies";
    expect(html(s)).not.toContain('id="minor-wake-auto"');
    harness(s, "#minor-wake-auto").click();
    expect(s.record).toHaveLength(1);
    s.watch = {} as NonNullable<S["watch"]>;
    expect(html(s)).not.toContain('id="minor-wake-auto"');
  });
  it("R6/D3 previews an actual legal move, clears preview and never changes the game", () => {
    const { s, to, from } = intervening();
    expect(chooseStack(s, from)).toBe(true);
    expect(html(s)).toContain('id="minor-intervention-preview"');
    const target = { textContent: "" };
    const root = { querySelector: () => target } as unknown as HTMLElement;
    const before = s.state;
    previewMinorMove(root, s, to);
    expect(target.textContent).toContain("Moving here helps Belgium.");
    expect(s.state).toBe(before);
    expect(s.record).toEqual([]);
    previewMinorMove(root, s, "M35");
    expect(target.textContent).toBe("");
  });
  it("R6/D3 completed entry uses engine events, retains normal log, and redraws do not repeat it", () => {
    const { s, action } = intervening();
    observeMinorCards(s);
    expect(run(s, action)).toBe(true);
    const before = structuredClone(s.state), count = s.record.length, log = [...s.log];
    expect(html(s)).toContain("Moving here helps Belgium.");
    expect(html(s)).toContain("Intervention");
    expect(s.log.some((l) => l.includes("intervenes in Belgium"))).toBe(true);
    expect(s.state).toEqual(before);
    expect(s.record).toHaveLength(count);
    expect(s.log).toEqual(log);
    expect(html(s).match(/<h2 tabindex="-1">Intervention/g)).toHaveLength(1);
  });
  it("R7/R13/D4 adds the recurring minor value to existing conquest wording", () => {
    const s = session("7p");
    s.state = { ...s.state, countries: { belgium: { status: "attacked", attacker: "germany" } }, control: { M25: "germany" }, units: { g: { id: "g", owner: "germany", at: "M25", type: "infantry", strength: 3, movement: 3 } } };
    observeMinorCards(s);
    expect(run(s, { ...end, step: "7p" })).toBe(true);
    expect(html(s)).toContain("Belgium has been conquered by Germany");
    expect(html(s)).toContain("Germany gains 15 BRPs at each year start while it keeps Brussels.");
  });
  it("D3/D5 observes batches, drops cards on undo/load, and never replays a loaded game's history", () => {
    const s = wake();
    const place = legalActions(CTX, s.state).find((a) => a.type === "PLACE_MINOR_FORCES")!;
    expect(run(s, place)).toBe(true);
    expect(html(s)).toContain("45 BRPs"); // both actions since the last observation
    s.state = { ...s.state };
    expect(html(s)).not.toContain("Minor allies wake");
    const fresh = wake();
    expect(html(fresh)).toContain("Minor allies wake");
    fresh.record.pop(); fresh.state = { ...fresh.state };
    expect(html(fresh)).not.toContain("Minor allies wake");
    const loaded = session(); loaded.record = [end];
    expect(html(loaded)).not.toContain("Conquest");
  });
  it("R13/D6 renders every projected power, exact lines and Why foldouts under the table", () => {
    const s = session();
    s.state.control = { M25: "germany" };
    s.state.conquests = [{ country: "belgium", by: "germany", side: "axis", how: "capital", at: { year: 1939, season: "fall" } }];
    const before = structuredClone(s.state);
    const h = statusHtml(s, null, [end]);
    expect(h.indexOf("Next year start")).toBeGreaterThan(h.indexOf("</table>"));
    expect(h).toContain("Germany: Base 150 + territory 15 = 165 BRPs — Why?");
    expect(h).toContain("belgium: 15 BRPs (conquered)");
    expect(h).toContain("Base includes growth of 0 BRPs");
    expect(h).toContain("Estimate from current cash and holdings");
    expect(h).toContain("Great Britain: Base");
    expect(s.state).toEqual(before);
    s.state.phase = "setup";
    expect(nextYearHtml(s)).toBe("");
    s.state.phase = "game-over";
    expect(nextYearHtml(s)).toBe("");
  });
});

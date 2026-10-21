import { describe, expect, it } from "vitest";
import type { Action } from "../src/engine/actions";
import type { GameState, Unit } from "../src/engine/types";
import { attackPreview } from "../src/ui/attackPreview";
import { nonDefendersLine, rowLines } from "../src/ui/attackText";
import { resultRows } from "../src/ui/attackResults";
import { resultCardHtml } from "../src/ui/resultView";
import { run, type Session } from "../src/ui/session";
import { eventSide } from "../src/ui/logSide";
import { atMovement } from "./helpers-move-session";
import { counter } from "./board";

// Spec 12 ticket 12-4: the attack card, the result card and the log say that a fleet is driven out to a friendly port instead of destroyed.
// Allied infantry at K27 attack the German fleet alone in Wilhelmshaven (K28); the fleet goes to Kiel (J30).
const at7h = (units: Unit[]): Session => {
  const s = atMovement();
  s.humanSide = "allies";
  const state: GameState = { ...s.state, activeSide: "allies", position: { part: "player-turn", turn: 1, step: "7h" }, units: Object.fromEntries(units.map((u) => [u.id, u])), combat: undefined, unsuppliedAtStart: undefined };
  s.state = state;
  s.log = [];
  s.battle = null;
  return s;
};
const UNITS = (): Unit[] => [counter("b1", "britain", "infantry", 3, "K27", 3), counter("f1", "germany", "fleet", 9, "K28"), counter("a1", "germany", "air", 3, "K28", 4)];
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

describe("the attack card on a port with a fleet in it", () => {
  it("says the fleet is driven out, not destroyed, and the air alone is destroyed", () => {
    const s = at7h(UNITS());
    const p = attackPreview(s.ctx, s.state, "K28", ["b1"]);
    expect(p.sweep?.text).toBe("No roll. This counter is destroyed: 3-4 German air. This fleet must leave and move to the nearest friendly port with room, or is lost if there is none: 9 German fleet.");
    expect(p.button.text).toBe("Destroy 3-4 German air in Wilhelmshaven (K28) and drive 9 German fleet out");
  });

  it("a hex with only a fleet: the button drives it out, and nothing is said to be destroyed", () => {
    const s = at7h(UNITS().slice(0, 2));
    const p = attackPreview(s.ctx, s.state, "K28", ["b1"]);
    expect(p.button.text).toBe("Drive 9 German fleet out of Wilhelmshaven (K28)");
    expect(p.sweep?.text).toBe("No roll. This fleet must leave and move to the nearest friendly port with room, or is lost if there is none: 9 German fleet.");
    expect(p.sweep?.text).not.toMatch(/destroyed/);
  });

  it("when the defenders go in a battle, the fleet is listed as moving, not as also destroyed", () => {
    const s = at7h([counter("b1", "britain", "infantry", 9, "K27", 3), counter("g1", "germany", "infantry", 1, "K28", 3), counter("f1", "germany", "fleet", 9, "K28")]);
    const p = attackPreview(s.ctx, s.state, "K28", ["b1"]);
    expect(p.alsoDestroyed).toEqual([]);
    expect(p.alsoMoved).toEqual(["9 German fleet"]);
    expect(p.results.some((r) => /This enemy fleet moves to a friendly port \(or is lost if none has room\): 9 German fleet\./.test(r.text))).toBe(true);
    expect(p.results.every((r) => !/go too, with no roll: 9 German fleet/.test(r.text))).toBe(true);
  });
});

describe("the row of the list of attacks, and the lines of the card", () => {
  it("a hex with only a fleet reads as driven out, a mix reads as both, and air alone reads as before", () => {
    const row = (units: Unit[]) => {
      const s = at7h(units);
      return rowLines(attackPreview(s.ctx, s.state, "K28", ["b1"])).defence;
    };
    expect(row(UNITS().slice(0, 2))).toBe("9 German fleet: no ground defender, driven out to a friendly port with no roll");
    expect(row(UNITS())).toBe("3-4 German air: no ground defender, destroyed with no roll; 9 German fleet: driven out to a friendly port");
    expect(row([UNITS()[0]!, UNITS()[2]!])).toBe("3-4 German air: no ground defender, destroyed with no roll");
  });

  it("the fleet is not listed again as a counter that does not defend", () => {
    const s = at7h(UNITS());
    expect(nonDefendersLine(attackPreview(s.ctx, s.state, "K28", ["b1"]))).toBeNull();
  });

  it("the sentence about fleets that go is singular for one and plural for two", () => {
    const rows = (names: string[]) => resultRows({ column: "1-1", attackers: [], defenders: [], multiplier: 2, alsoDestroyed: [], alsoMoved: names, emptyAfterWin: false }).map((r) => r.text).join(" ");
    expect(rows(["9 German fleet"])).toContain("This enemy fleet moves to a friendly port (or is lost if none has room): 9 German fleet.");
    expect(rows(["9 German fleet", "6 German fleet"])).toContain("These enemy fleets move to a friendly port (or are lost if none has room): 9 German fleet, 6 German fleet.");
  });
});

describe("the result card and the log", () => {
  it("name the port the fleet moved to, and the log line says why", () => {
    const s = at7h(UNITS().slice(0, 2));
    const attack: Action = { type: "ATTACK", side: "allies", units: ["b1"], target: "K28" };
    expect(run(s, attack)).toBe(true);
    expect(s.log.some((l) => l === "9 German fleet moved from Wilhelmshaven (K28) to Kiel (J30): Wilhelmshaven (K28) was taken.")).toBe(true);
    const card = text(resultCardHtml(s));
    expect(card).toContain("Fleets driven out: 9 German fleet moved to Kiel (J30).");
    expect(resultCardHtml(s)).toContain("<p>No roll.</p>"); // no trailing space
    expect(card).not.toContain("Nothing was left to destroy");
    expect(card).not.toContain("Destroyed");
  });

  it("a fleet with nowhere to go is lost, and both say so", () => {
    const s = at7h(UNITS().slice(0, 2));
    s.state = { ...s.state, control: Object.fromEntries(["J30", "K29", "J32", "K32", "J35", "J36", "E38", "D44", "F40", "L25"].map((h) => [h, "britain" as const])) };
    expect(run(s, { type: "ATTACK", side: "allies", units: ["b1"], target: "K28" })).toBe(true);
    expect(s.log.some((l) => /was eliminated: Wilhelmshaven \(K28\) was taken and no friendly port on its Front has room\./.test(l))).toBe(true);
    expect(text(resultCardHtml(s))).toContain("was lost: no friendly port had room");
  });

  it("the line of a displaced fleet takes the colour of its owner", () => {
    const s = at7h(UNITS().slice(0, 2));
    expect(eventSide({ type: "FLEET_DISPLACED", unitId: "f1", owner: "germany", from: "K28", to: "J30" }, "allies", s.state)).toBe("axis");
  });
});

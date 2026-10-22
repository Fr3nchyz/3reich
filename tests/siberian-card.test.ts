import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { legalActions } from "../src/engine/actions";
import type { GameState, Side } from "../src/engine/types";
import { computerToMove } from "../src/ui/computerPlay";
import { siberianLeftLine, siberianLogLine, SIBERIAN_TEXT } from "../src/ui/endText";
import { eventSide } from "../src/ui/logSide";
import { createSession, type Session } from "../src/ui/session";
import { normaliseMode, pickSiberian, siberianOffers, takeAction, takeSiberian, tapHex } from "../src/ui/sessionActions";
import { siberianEndLabel, siberianModel, siberianShown } from "../src/ui/siberianCard";
import { buttonLabels, statusHtml } from "../src/ui/statusView";
import { newWatchSession } from "../src/ui/watchPlay";
import { MAP } from "../src/data/map";
import { at8a, KAZAN, MOSCOW, PLAIN, SPRING_42, takeAll, withPool } from "./helpers-siberian";

// Spec 14 ticket 14-18 (part D6): the Free Siberian Transfer on the screen. The units and the cities are the engine's own actions; the sentences are ui/endText.ts.

const sessionAt = (state: GameState, human: Side = "allies"): Session => Object.assign(createSession(SCENARIO_1939, human, 1), { state });
/** What the page draws: no buttons while the computer is the one to move, as main.ts does. */
const actionsOf = (s: Session) => (s.state.phase === "player-turn" && !computerToMove(s) ? legalActions(s.ctx, s.state) : []);
const html = (s: Session) => statusHtml(s, null, actionsOf(s));
const card = (s: Session) => /<section class="siberiancard"[\s\S]*?<\/section>/.exec(html(s))?.[0] ?? "";
const text = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/&middot;/g, "·").replace(/\s+/g, " ").trim();

describe("the words", () => {
  it("say how many may be taken, with what was taken so far", () => {
    expect(siberianLeftLine(4, 4, { year: 1941, season: "winter" })).toBe("You may take 4 units this turn (Winter 1941).");
    expect(siberianLeftLine(3, 4, { year: 1941, season: "winter" })).toBe("You may take 3 more units this turn (4 in Winter 1941; 1 taken).");
    expect(siberianLeftLine(1, 3, { year: 1942, season: "spring" })).toBe("You may take 1 more unit this turn (3 in Spring 1942; 2 taken).");
    expect(siberianLeftLine(1, 1, { year: 1942, season: "fall" })).toBe("You may take 1 unit this turn (Fall 1942).");
  });
  it("the log line names the counter and the city, how many more may be taken, and the switch of the tables once", () => {
    expect(siberianLogLine(3, "infantry", "Moscow (H47)", 3, true)).toBe("Free Siberian Transfer: a 3-factor infantry appears in Moscow (H47). 3 more may be taken this turn. The Allied targets are now one objective higher.");
    expect(siberianLogLine(3, "armor", "Kazan (E54)", 0, false)).toBe("Free Siberian Transfer: a 3-factor armor appears in Kazan (E54).");
  });
  it("the log line is the Allies' (blue)", () => {
    const e = { type: "SIBERIAN_TRANSFER_USED", unitId: "u1", unitType: "infantry", strength: 3, at: MOSCOW, left: 3, firstUse: true } as const;
    expect(eventSide(e, "allies")).toBe("allies");
    expect(eventSide(e, "axis")).toBe("allies");
  });
});

describe("when the card is drawn", () => {
  it("for a human Allied player at step 8a of a Game Turn with a Transfer, once and with its words", () => {
    const s = sessionAt(at8a());
    expect(siberianShown(s)).toBe(true);
    const c = text(card(s));
    expect(c).toContain(SIBERIAN_TEXT.title);
    expect(c).toContain("You may take 4 units this turn (Winter 1941).");
    expect(c).toContain(SIBERIAN_TEXT.intro);
    expect(c).toContain(SIBERIAN_TEXT.armorNote);
    expect(c).toContain("Using this raises the Allied targets by one objective.");
    expect(c).toContain(SIBERIAN_TEXT.pick);
    expect((html(s).match(/id="siberian-card"/g) ?? []).length).toBe(1);
  });

  it("is not drawn for the Axis, for a watcher, outside step 8a, or in a Game Turn with no Transfer", () => {
    expect(siberianShown(sessionAt(at8a(), "axis"))).toBe(false);
    expect(card(sessionAt(at8a(), "axis"))).toBe("");
    const watcher = newWatchSession(SCENARIO_1939, 1, "turbo", null);
    watcher.state = at8a();
    watcher.humanSide = "allies"; // a watched game has no human side; the side it names changes nothing
    expect(siberianShown(watcher)).toBe(false);
    expect(html(watcher)).not.toContain("siberiancard");
    expect(siberianShown(sessionAt(at8a([], { position: { part: "player-turn", turn: 2, step: "8b" } })))).toBe(false);
    expect(siberianShown(sessionAt(at8a([], {}, SCENARIO_1939, { year: 1941, season: "fall" })))).toBe(false);
    expect(siberianShown(sessionAt(at8a([], { activeSide: "axis" })))).toBe(false);
  });

  it("when the computer plays the Allies, nothing is asked on the screen", () => {
    const s = sessionAt(at8a(), "axis");
    expect(computerToMove(s)).toBe(true);
    expect(html(s)).not.toContain("siberiancard");
  });

  it("the card's one closing button is the engine's END_STEP, said in words, and it is not repeated among the other buttons", () => {
    const s = sessionAt(at8a());
    const end = (buttonLabels(actionsOf(s), s.ctx, s.state).find((l) => l.action.type === "END_STEP")!);
    expect(end.text).toBe(SIBERIAN_TEXT.none);
    expect(siberianEndLabel(s.state)).toBe("Do not take any");
    const h = html(s);
    expect((h.match(/Do not take any/g) ?? []).length).toBe(1);
    expect(card(s)).toContain("Do not take any");
    expect(h).not.toContain("Done with step 8a");
    expect(h).not.toContain("SIBERIAN_TRANSFER");
  });
});

describe("the counters and the cities", () => {
  it("one chip for each kind in the pool, with the numbers on the counter and how many are left", () => {
    const m = siberianModel(sessionAt(at8a()), actionsOf(sessionAt(at8a())))!;
    const keys = m.chips.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(["infantry:1", "infantry:2", "infantry:3", "armor:3"]));
    expect(m.chips.find((c) => c.key === "infantry:3")).toMatchObject({ numbers: "3-3", inPool: 5, allowed: true, chosen: false });
    expect(m.chips.find((c) => c.key === "armor:3")).toMatchObject({ numbers: "3-5", inPool: 3, allowed: false });
    expect(m.picked).toBeNull();
  });

  it("armor is shown but cannot be picked until infantry has been taken, and says why", () => {
    const s = sessionAt(at8a());
    expect(card(s)).toMatch(/<button[^>]*data-siberian="armor:3"[^>]*disabled/);
    expect(text(card(s))).toContain("infantry first");
    expect(card(s)).not.toMatch(/<button[^>]*data-siberian="infantry:3"[^>]*disabled/);
    const t = sessionAt(takeAll(at8a(), [["infantry", 3, MOSCOW]]));
    expect(card(t)).not.toMatch(/<button[^>]*data-siberian="armor:3"[^>]*disabled/);
  });

  it("picking a chip lists the cities it may go in, by name, as touch buttons", () => {
    const s = sessionAt(at8a());
    pickSiberian(s, "infantry:3");
    const c = card(s);
    expect(c).toMatch(/data-siberian="infantry:3" aria-pressed="true"/);
    expect(text(c)).toContain("Cities for the 3-3 infantry:");
    expect(c).toContain(`data-siberian-city="${MOSCOW}"`);
    expect(text(c)).toContain("Moscow (H47)");
    const cities = [...c.matchAll(/data-siberian-city="([A-Z]\d+)"/g)].map((m) => m[1]);
    expect(cities.length).toBe(siberianOffers(s).filter((a) => a.unit.type === "infantry" && a.unit.strength === 3).length);
    expect(cities).toEqual([...cities].sort());
  });

  it("a city button takes the unit: it is on the map, in the log, the count goes down and the chosen counter stays", () => {
    const s = sessionAt(at8a());
    pickSiberian(s, "infantry:3");
    takeSiberian(s, MOSCOW);
    expect(s.toast).toBe("");
    expect(Object.values(s.state.units).filter((u) => u.at === MOSCOW && u.owner === "ussr")).toHaveLength(1);
    expect(s.log.at(-1)).toBe("Free Siberian Transfer: a 3-factor infantry appears in Moscow (H47). 3 more may be taken this turn. The Allied targets are now one objective higher.");
    expect(s.logSides?.get(s.log.length - 1)).toBe("allies");
    expect(s.siberian).toEqual({ type: "infantry", strength: 3 });
    const c = text(card(s));
    expect(c).toContain("You may take 3 more units this turn (4 in Winter 1941; 1 taken).");
    expect(c).toContain(SIBERIAN_TEXT.raised);
    expect(c).not.toContain(SIBERIAN_TEXT.raises);
    expect(c).toContain(SIBERIAN_TEXT.done);
    expect(c).not.toContain(SIBERIAN_TEXT.none);
  });

  it("a city that cannot take the counter is refused with a toast, and nothing changes", () => {
    const s = sessionAt(at8a());
    pickSiberian(s, "infantry:3");
    takeSiberian(s, PLAIN);
    expect(s.toast).toMatch(/cannot be put there.*cities it can go in/);
    expect(s.state.siberian).toBeUndefined();
    const t = sessionAt(at8a());
    takeSiberian(t, MOSCOW); // no counter chosen: nothing happens
    expect(t.state.siberian).toBeUndefined();
  });

  it("a tap on a Russian city of the map takes the chosen counter there; a tap elsewhere says so", () => {
    const s = sessionAt(at8a());
    pickSiberian(s, "infantry:2");
    tapHex(s, MAP.hexes[KAZAN]!);
    expect(Object.values(s.state.units).some((u) => u.at === KAZAN && u.strength === 2)).toBe(true);
    tapHex(s, MAP.hexes[PLAIN]!);
    expect(s.toast).toMatch(/cannot be put there/);
    expect(s.lookedAt).toBe(PLAIN);
  });

  it("with no counter chosen a tap on the map only looks at the hex", () => {
    const s = sessionAt(at8a());
    tapHex(s, MAP.hexes[KAZAN]!);
    expect(s.state.siberian).toBeUndefined();
    expect(s.lookedAt).toBe(KAZAN);
  });

  it("a chosen counter is dropped once the engine no longer offers it, and when the step is left", () => {
    const s = sessionAt(withPool(at8a(), [{ type: "infantry", strength: 2, movement: 3, count: 1 }, { type: "armor", strength: 3, movement: 5, count: 2 }]));
    pickSiberian(s, "infantry:2");
    takeSiberian(s, MOSCOW); // the last infantry
    normaliseMode(s);
    expect(s.siberian).toBeNull();
    pickSiberian(s, "armor:3");
    normaliseMode(s);
    expect(s.siberian).toEqual({ type: "armor", strength: 3 });
    takeAction(s, { type: "END_STEP", side: "allies", step: "8a" });
    expect(s.siberian).toBeNull();
    expect(s.state.position).toMatchObject({ step: "8b" });
  });

  it("when everything allowed has been taken the card says so and offers only the way on", () => {
    const s = sessionAt(takeAll(at8a(), [["infantry", 3, MOSCOW], ["infantry", 3, KAZAN], ["infantry", 2, "J46"], ["infantry", 2, "O39"]]));
    const c = card(s);
    expect(text(c)).toContain(SIBERIAN_TEXT.allTaken);
    expect(c).not.toContain("data-siberian-city");
    expect(c).toContain("Done taking units");
    const m = siberianModel(s, actionsOf(s))!;
    expect(m.finished).toBe(true);
    expect(m.chips.every((c) => !c.allowed)).toBe(true);
  });

  it("in Spring 1942 the line says three", () => {
    const s = sessionAt(at8a([], {}, SCENARIO_1939, SPRING_42));
    expect(text(card(s))).toContain("You may take 3 units this turn (Spring 1942).");
  });
});

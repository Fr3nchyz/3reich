import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { legalActions, type Action, type GameEvent } from "../src/engine/actions";
import { OWNER_NAMES } from "../src/engine/nations";
import { sideOfOwner } from "../src/engine/setup";
import type { ForceOwner, Side } from "../src/engine/types";
import { computerTick, computerToMove } from "../src/ui/computerPlay";
import { sessionFromRecord } from "../src/ui/e2eLoad";
import { LOG_LIMIT, logHtml } from "../src/ui/logView";
import { actorSide, eventSide, logLine, resetLog } from "../src/ui/logSide";
import { createSession, run, setupView, type Session } from "../src/ui/session";
import { fillRest, finishOwner } from "../src/ui/sessionActions";
import { newWatchSession, takeOver, watchSlice } from "../src/ui/watchPlay";

/** The side of each activity log line, for its colour (logSide.ts): the side whose action produced the line; plain when there is none. */

const sideOfLine = (s: Session, i: number): Side | null => s.logSides?.get(i) ?? null;
const marked = (s: Session, from = 0) => s.log.map((text, i) => ({ text, side: sideOfLine(s, i) })).slice(from);

function inPlay(human: Side): Session {
  const s = createSession(SCENARIO_1939, human, 3);
  for (let i = 0; i < 20 && s.state.phase === "setup"; i++) {
    fillRest(s);
    const v = setupView(s);
    if (v) finishOwner(s, v.owner);
  }
  expect(s.state.phase).toBe("player-turn");
  return s;
}

describe("the side of an action and of an event", () => {
  it("an action's side is the one it names, or the side of the nation it names", () => {
    const acts: [Action, Side][] = [
      [{ type: "MOVE", side: "allies", units: [], path: [] }, "allies"],
      [{ type: "ATTACK", side: "axis", units: [], target: "M35" }, "axis"],
      [{ type: "ADVANCE", side: "axis", units: [], to: "M35" }, "axis"],
      [{ type: "ALLOCATE_LOSSES", side: "allies", units: [] }, "allies"],
      [{ type: "END_STEP", side: "allies", step: "1" }, "allies"],
      [{ type: "END_PLAYER_TURN", side: "axis" }, "axis"],
      [{ type: "SELECT_FRONT_OPTION", side: "allies", front: "western", option: "defensive" }, "allies"],
      [{ type: "DECLARE_WAR", by: "germany", on: "poland" }, "axis"],
      [{ type: "DECLARE_WAR", by: "france", on: "germany" }, "allies"],
      [{ type: "GRANT_BRPS", from: "britain", to: "france", amount: 1 }, "allies"],
      [{ type: "BUILD", owner: "italy", unit: { type: "infantry", strength: 3 }, at: "A1" }, "axis"],
      [{ type: "SETUP_PLACE", owner: "usa", unit: { type: "infantry", strength: 3 }, at: "A1" }, "allies"],
      [{ type: "SETUP_REMOVE", owner: "germany", unitId: "x" }, "axis"],
      [{ type: "SETUP_DONE", owner: "ussr" }, "allies"],
    ];
    for (const [a, side] of acts) expect(actorSide(a), JSON.stringify(a)).toBe(side);
  });

  it("an event takes the actor's side, except the ones that name a side or are about both sides", () => {
    const moved: GameEvent = { type: "UNITS_MOVED", units: [], from: "A1", to: "A2", path: [] };
    expect(eventSide(moved, "axis")).toBe("axis");
    expect(eventSide(moved, "allies")).toBe("allies");
    // The defender chooses its losses during the attacker's action: the line is the chooser's.
    expect(eventSide({ type: "LOSSES_CHOSEN", side: "allies", units: [] }, "axis")).toBe("allies");
    expect(eventSide({ type: "PLAYER_TURN_STARTED", year: 1939, season: "summer", side: "allies" }, "axis")).toBe("allies");
    expect(eventSide({ type: "FRONT_OPTION_SELECTED", side: "axis", front: "eastern", option: "offensive", cost: 0 }, "axis")).toBe("axis");
    expect(eventSide({ type: "BRPS_CHANGED", nation: "france", delta: 5, total: 9, reason: "production" }, "axis"), "a treasury line is its nation's").toBe("allies");
    expect(eventSide({ type: "INITIATIVE_DETERMINED", year: 1939, season: "summer", firstSide: "axis", axis: 1, allies: 1 }, "axis")).toBeNull();
    expect(eventSide({ type: "SETUP_COMPLETE" }, "axis")).toBeNull();
    const result = { winner: null, level: null, basis: "objectives", objectives: { axis: 9, allies: 23, nobody: 10 }, at: { year: 1939, season: "summer" }, early: false, siberian: false } as const;
    expect(eventSide({ type: "GAME_OVER", year: 1939, season: "summer", result }, "axis")).toBeNull();
  });

  it("a line takes the side it concerns, not the side whose action set it off", () => {
    // Red = Axis, blue = Allies: whoever's action it was, the unit's or nation's own side owns the line.
    const gone: GameEvent = { type: "UNIT_ELIMINATED", unitId: "u", owner: "poland", at: "M35" };
    expect(eventSide(gone, "axis"), "a Polish unit eliminated by an Axis attack is blue").toBe("allies");
    expect(eventSide({ ...gone, owner: "germany" }, "axis"), "a German unit eliminated by an exchange is red").toBe("axis");
    expect(eventSide({ ...gone, owner: "germany" }, "allies"), "...whoever's action it was").toBe("axis");
    expect(eventSide({ type: "OVERSTACK_ELIMINATED", unitId: "u", owner: "france", at: "M35" }, "axis")).toBe("allies");
    expect(eventSide({ type: "SETUP_OWNER_DONE", owner: "italy" }, "allies")).toBe("axis");
    expect(eventSide({ type: "HEX_CONTROL_CHANGED", hex: "M35", from: "poland", to: "germany", unitId: "u" }, "axis")).toBe("axis");
    expect(eventSide({ type: "HEX_CONTROL_CHANGED", hex: "M35", from: "germany", to: "ussr", unitId: "u" }, "allies")).toBe("allies");
    const sweep = (...owners: ForceOwner[]): GameEvent => ({ type: "UNITS_SWEPT", hex: "M35", units: owners.map((owner, i) => ({ id: `u${i}`, owner, type: "air", strength: 3 })) });
    expect(eventSide(sweep("poland", "france"), "axis"), "air or fleet units alone in a hex swept away: the owners'").toBe("allies");
    expect(eventSide(sweep("poland", "germany"), "axis"), "owners of both sides: the actor's").toBe("axis");
  });

  it("the engine's own declaration of war takes the side of the nation declaring, not the side whose turn ended", () => {
    const us: GameEvent = { type: "WAR_DECLARED", by: "usa", on: "germany", cost: 35 };
    expect(eventSide(us, "axis"), "the U.S. joins when the Allied turn begins, written during the Axis END_PLAYER_TURN").toBe("allies");
    expect(eventSide({ type: "WAR_DECLARED", by: "germany", on: "poland", cost: 0 }, "allies")).toBe("axis");
  });

  it("a building and a grant of BRPs take the side of the nation that builds or gives", () => {
    const built: GameEvent = { type: "UNIT_BUILT", unitId: "u", owner: "britain", unitType: "infantry", strength: 3, at: "A1", cost: 3 };
    expect(eventSide(built, "axis")).toBe("allies");
    expect(eventSide({ ...built, owner: "italy" }, "allies")).toBe("axis");
    const grant: GameEvent = { type: "BRPS_GRANTED", from: "britain", to: "france", amount: 2 };
    expect(eventSide(grant, "axis")).toBe("allies");
    expect(eventSide({ ...grant, from: "germany", to: "italy" }, "allies"), "the giver's side").toBe("axis");
  });

  it("a move or an advance takes the side of the units that make it, found in the position before the action", () => {
    const s = inPlay("axis");
    const of = (side: Side) => Object.values(s.state.units).find((u) => sideOfOwner(u.owner) === side)!.id;
    const moved = (id: string): GameEvent => ({ type: "UNITS_MOVED", units: [id], from: "A1", to: "A2", path: [] });
    expect(eventSide(moved(of("allies")), "axis", s.state)).toBe("allies");
    expect(eventSide(moved(of("axis")), "allies", s.state)).toBe("axis");
    expect(eventSide({ type: "UNITS_ADVANCED", units: [of("allies")], from: ["A1"], to: "A2" }, "axis", s.state)).toBe("allies");
    expect(eventSide(moved("not-a-unit"), "allies", s.state), "an unknown unit keeps the actor's side").toBe("allies");
    expect(eventSide(moved(of("axis")), "allies"), "no position given: the actor's").toBe("allies");
    expect(eventSide({ type: "UNITS_MOVED", units: [of("axis"), of("allies")], from: "A1", to: "A2", path: [] }, "axis", s.state), "mixed units: the actor's").toBe("axis");
    expect(eventSide({ type: "COMBAT_RESOLVED", side: "axis", target: "M35", attackers: [], attackFactors: 1, defenseFactors: 1, multiplier: 1, rounds: [], outcome: "exchange" }, "allies")).toBe("axis");
  });

  it("logLine marks an entry by its index and leaves a plain one unmarked, with the log itself only text", () => {
    const s = { log: ["a"] } as Pick<Session, "log" | "logSides">;
    logLine(s, "plain");
    expect(s.logSides, "nothing is created for a plain line").toBeUndefined();
    logLine(s, "red", "axis");
    logLine(s, "plain again");
    logLine(s, "blue", "allies");
    s.log.push("pushed straight to the log");
    expect([...s.logSides!]).toEqual([[2, "axis"], [4, "allies"]]);
    expect(s.log).toEqual(["a", "plain", "red", "plain again", "blue", "pushed straight to the log"]);
  });
});

describe("the sides stay with their lines", () => {
  it("resetLog replaces the log and clears the sides, so a new line is marked for its own index", () => {
    const s = { log: ["a", "b"] } as Pick<Session, "log" | "logSides">;
    logLine(s, "red", "axis");
    logLine(s, "blue", "allies");
    expect([...s.logSides!.keys()]).toEqual([2, 3]);
    resetLog(s, ["fresh"]);
    expect(s.log).toEqual(["fresh"]);
    expect(s.logSides?.size ?? 0, "no mark is left for an entry that is gone").toBe(0);
    logLine(s, "new", "allies");
    expect([...s.logSides!]).toEqual([[1, "allies"]]);
    expect(marked(s as Session).map((l) => l.side)).toEqual([null, "allies"]);
  });

  it("a watched game starts with its first line plain, whatever the session held before", () => {
    const s = newWatchSession(SCENARIO_1939, 2, "turbo", null);
    expect(sideOfLine(s, 0)).toBeNull();
    for (const key of s.logSides?.keys() ?? []) expect(key, "every mark is on an entry of the log").toBeLessThan(s.log.length);
  });
});

describe("the log of a game in the browser", () => {
  it("a real game: the U.S. joining the war in Spring 1942 is an Allied line, Germany's declarations are Axis lines", () => {
    const s = newWatchSession(SCENARIO_1939, 1, "turbo", null);
    const found = () => s.log.findIndex((l) => l === "United States declares war on Germany (35 BRPs).");
    for (let i = 0; i < 20000 && found() < 0 && s.state.phase !== "game-over"; i++) watchSlice(s);
    expect(found(), "the game reaches Spring 1942 with two computers (seed 1)").toBeGreaterThan(0);
    expect(sideOfLine(s, found())).toBe("allies");
    const declared = marked(s).filter((l) => / declares war on /.test(l.text));
    expect(declared.length).toBeGreaterThanOrEqual(2);
    for (const l of declared) expect(l.side, l.text).toBe(l.text.startsWith("Germany") || l.text.startsWith("Italy") ? "axis" : "allies");
  });

  it("the first line, the setup notes of the computer and of the player, and the turn beginning each belong to the right side", () => {
    const s = createSession(SCENARIO_1939, "axis", 3);
    expect(sideOfLine(s, 0), "the game started note is plain").toBeNull();
    const computerSetup = marked(s, 1).filter((l) => l.text.endsWith("has set up."));
    expect(computerSetup.length).toBeGreaterThan(0);
    for (const l of computerSetup) expect(l.side, l.text).toBe("allies");
    const before = s.log.length;
    while (s.state.phase === "setup") {
      fillRest(s);
      const v = setupView(s);
      if (!v) break;
      finishOwner(s, v.owner);
    }
    const done = marked(s, before).filter((l) => l.text.endsWith("has set up."));
    expect(done.length).toBeGreaterThan(0);
    const owners = Object.entries(OWNER_NAMES) as [ForceOwner, string][];
    for (const l of done) expect(l.side, l.text).toBe(sideOfOwner(owners.find(([, name]) => l.text === `${name} has set up.`)![0]));
    expect(done.some((l) => l.side === "axis"), "the player's own nations are Axis").toBe(true);
    const lines = marked(s);
    expect(lines.find((l) => l.text === "Setup is complete.")?.side).toBeNull();
    const began = lines.find((l) => l.text.endsWith("player turn begins."))!;
    expect(began.side).toBe(began.text.startsWith("Axis") ? "axis" : "allies");
  });

  for (const human of ["axis", "allies"] as const) {
    it(`${human} player: every line of the computer's turn, its own and the engine's, is the computer's side`, () => {
      const s = inPlay(human);
      for (let i = 0; i < 20 && !computerToMove(s); i++) {
        const a = legalActions(s.ctx, s.state).at(-1)!;
        expect(["END_STEP", "END_PLAYER_TURN"]).toContain(a.type);
        expect(run(s, a)).toBe(true);
      }
      expect(computerToMove(s)).toBe(true);
      const computer: Side = human === "axis" ? "allies" : "axis";
      const from = s.log.length;
      for (let i = 0; computerToMove(s) && i < 20; i++) computerTick(s, 1e9);
      const lines = marked(s, from);
      const own = lines.filter((l) => l.text.startsWith("Computer ("));
      expect(own.length).toBeGreaterThan(0);
      for (const l of own) expect(l.side, l.text).toBe(computer);
      expect(own.some((l) => l.text.includes("moved ")), "the written-up moves are marked too").toBe(true);
      for (const l of lines.filter((x) => / move from /.test(x.text))) expect(l.side, l.text).toBe(computer);
    });
  }

  it("a human attack and its aftermath belong to the attacker, in a game loaded from a record", () => {
    const fixture = JSON.parse(readFileSync("tests/e2e/fixtures/axis-at-7h.json", "utf8")) as { seed: number; actions: Action[] };
    const s = sessionFromRecord(SCENARIO_1939, "axis", fixture.seed, fixture.actions);
    const last = s.log.length - 1;
    expect(s.log[last]).toContain("Loaded from a recorded game");
    expect(sideOfLine(s, last), "a system note stays plain").toBeNull();
    const moves = marked(s).filter((l) => / move from /.test(l.text));
    expect(moves.length).toBeGreaterThan(0);
    for (const l of moves) expect(l.side, l.text).toBe("axis");
    const from = s.log.length;
    const attack = legalActions(s.ctx, s.state).find((a) => a.type === "ATTACK")!;
    expect(run(s, attack)).toBe(true);
    const fresh = marked(s, from);
    expect(fresh.some((l) => l.text.startsWith("Attack on "))).toBe(true);
    for (const l of fresh) expect(l.side, l.text).toBe("axis");
  });

  it("watching: each computer's lines are its own side's, and taking over adds a plain line", () => {
    const s = newWatchSession(SCENARIO_1939, 7, "turbo", null);
    expect(sideOfLine(s, 0), "the start note is plain").toBeNull();
    for (let i = 0; i < 30; i++) watchSlice(s);
    const computer = marked(s).filter((l) => l.text.startsWith("Computer ("));
    expect(computer.length).toBeGreaterThan(5);
    for (const l of computer) expect(l.side, l.text).toBe(l.text.startsWith("Computer (Axis)") ? "axis" : "allies");
    expect(new Set(computer.map((l) => l.side))).toEqual(new Set(["axis", "allies"]));
    takeOver(s, "axis");
    expect(s.log.at(-1)).toContain("You take over");
    expect(sideOfLine(s, s.log.length - 1)).toBeNull();
  });
});

describe("the log panel's colours", () => {
  const sides = new Map<number, Side>([[0, "axis"], [1, "allies"]]);

  it("gives each entry the class of its side, and a plain entry none", () => {
    const html = logHtml(["red", "blue", "plain"], sides);
    expect(html).toContain('<li class="log-axis">red</li>');
    expect(html).toContain('<li class="log-allies">blue</li>');
    expect(html).toContain("<li>plain</li>");
  });

  it("without sides every entry is plain, as before", () => {
    expect(logHtml(["a", "b"])).not.toContain("log-");
  });

  it("still escapes the text of a marked entry", () => {
    const html = logHtml(['<b onclick="x()">&</b>'], new Map([[0, "allies"]]));
    expect(html).toContain('<li class="log-allies">&lt;b onclick=&quot;x()&quot;&gt;&amp;&lt;/b&gt;</li>');
    expect(html).not.toContain("<b ");
  });

  it("keeps each mark on its own entry when the list is cut to the latest LOG_LIMIT and shown newest first", () => {
    const log = Array.from({ length: LOG_LIMIT + 5 }, (_, i) => `entry ${i}`);
    const marks = new Map<number, Side>([[2, "axis"], [5, "axis"], [LOG_LIMIT + 4, "allies"]]);
    const html = logHtml(log, marks);
    expect(html).toContain(`<li class="log-allies">entry ${LOG_LIMIT + 4}</li>`);
    expect(html).toContain('<li class="log-axis">entry 5</li>');
    expect(html, "entry 2 is not shown").not.toContain("entry 2<");
    expect(html.match(/class="log-axis"/g)).toHaveLength(1);
    expect(html).toContain(`<li>entry ${LOG_LIMIT + 3}</li>`);
  });
});

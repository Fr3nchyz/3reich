import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { legalActions } from "../src/engine/actions";
import { airbasePlacements } from "../src/engine/air-actions";
import { airOf } from "../src/engine/air-record";
import type { GameState, Unit } from "../src/engine/types";
import { airMoveCard, planeBases } from "../src/ui/airMove";
import { airMoveHtml } from "../src/ui/airMoveView";
import { airMoveNow, cancelAirMove, chooseBase, joinPlanes, openPlacement, placeAt, splitPlane, stageTo, tapToAirMove, tickNoPlanes, togglePlane, toggleRange } from "../src/ui/airMoveTap";
import { hexCard } from "../src/ui/hexCard";
import { nextText } from "../src/ui/nextBar";
import { mapSyncProbe } from "./air-move-helpers";
import { takeBack } from "../src/ui/moveUndo";
import type { Session } from "../src/ui/session";
import { normaliseMode, tapHex } from "../src/ui/sessionActions";
import { statusHtml } from "../src/ui/statusView";
import { atMovement } from "./helpers-move-session";
import { at6f, inf } from "./helpers-move";

// Spec 09, ticket 09-13: planes and airbases at step 6f on the screen. German bases on the real 1939 map: J30, J32, K28, K29, K32, K33, L31 (J32 to K33
// is 2 hexes, J32 to J36 is 4). The planes start at J32 (Rostock): a 3-4 and a 2-4; K32 holds a 5-4 so it is full.

const air = (id: string, at: string, strength: number, owner: Unit["owner"] = "germany"): Unit => inf(id, owner, at, strength, 4, "air");
const UNITS = (): Unit[] => [air("a1", "J32", 3), air("a2", "J32", 2), air("a3", "K32", 5), inf("g1", "germany", "L33", 3, 3)];
const board = (units: Unit[], tweak: Partial<GameState> = {}): GameState => at6f(units, "axis", SCENARIO_1939, { nextUnitId: 100, ...tweak });
const session = (units: Unit[] = UNITS(), tweak: Partial<GameState> = {}): Session => {
  const s = atMovement();
  s.state = board(units, tweak);
  s.moveChosen = null;
  s.airMove = null;
  s.airbase = null;
  s.undo = null;
  s.toast = "";
  s.log = [];
  return s;
};
const words = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/&mdash;/g, "-").replace(/\s+/g, " ");
const page = (s: Session) => statusHtml(s, null, legalActions(s.ctx, s.state));
const hex = (s: Session, id: string) => s.ctx.map.hexes[id]!;

describe("the list of bases with planes and the airbases (step 6f)", () => {
  it("lists a row per base with the number of planes, and the airbases each Power may still place, in words", () => {
    const s = session();
    expect(planeBases(s.ctx, s.state)).toEqual([{ hex: "J32", planes: 2, free: 2 }, { hex: "K32", planes: 1, free: 1 }]);
    const h = words(page(s));
    expect(h).toContain("Planes at 2 bases");
    expect(h).toMatch(/Rostock \(J32\) 2 planes/);
    expect(h).toContain("Airbases");
    expect(h).toContain("Germany: 3 airbases left to place");
    expect(h).not.toMatch(/\bu\d+\b|\ba\d\b/);
    expect(page(s)).toContain("Ground movement (step 6f)"); // the ground list is still there
  });

  it("is not shown at another step or on the computer's turn", () => {
    const s = session();
    s.state = { ...s.state, position: { part: "player-turn", turn: 1, step: "7h" } };
    expect(airMoveHtml(s)).toBe("");
  });

  it("the bar says what to do when only planes and airbases are left", () => {
    const s = session([air("a1", "J32", 3)]);
    expect(nextText(s, legalActions(s.ctx, s.state))).toBe("Next: tap a base with planes to change their base, place an airbase, or finish step 6f.");
  });
});

describe("the planes card", () => {
  it("opens from a tap on a base with planes and no movable ground stack, with the planes that can change base ticked", () => {
    const s = session();
    tapHex(s, hex(s, "J32"));
    expect(s.airMove).toMatchObject({ hex: "J32", ticked: ["a1", "a2"], fresh: true, range: false });
    const h = words(page(s));
    expect(h).toContain("Planes at Rostock (J32)");
    expect(h).toContain("This base holds 5 of 5 air factors.");
    expect(h).toContain("2 of 2 ticked.");
    expect(h).toMatch(/Ticked 3-4 German air ready/);
    expect(h).toMatch(/Change base \(up to 8 hexes\): \d+ bases?/);
    expect(h).toMatch(/Kolberg|Danzig|Stettin|Konigsberg|\([JKL]\d\d\) \d+ hexes?, room for \d+ air factors/);
    expect(h).not.toMatch(/\bu\d+\b|\ba\d\b/);
    expect(s.moveChosen ?? null).toBeNull();
  });

  it("the bases are the engine's: nearest first, with distance and room, the full base K32 left out and given with its reason", () => {
    const s = session();
    chooseBase(s, "J32");
    const card = airMoveNow(s)!;
    expect(card.bases[0]!.distance).toBeGreaterThan(0);
    expect(card.bases.map((b) => b.hex)).toContain("K33");
    expect(card.bases.map((b) => b.hex)).not.toContain("K32");
    expect(card.bases.map((b) => b.distance)).toEqual([...card.bases.map((b) => b.distance)].sort((a, b) => a - b));
    expect(card.blocked.find((b) => b.hex === "K32")?.reason).toMatch(/limit|room|stack/i);
    expect(words(page(s))).toContain("Bases they cannot use");
  });

  it("a tap on a yellow base changes the base of the ticked planes through STAGE_AIR, says so in words and closes the card", () => {
    const s = session();
    chooseBase(s, "J32");
    tapHex(s, hex(s, "K33"));
    expect(s.state.units.a1!.at).toBe("K33");
    expect(s.state.units.a2!.at).toBe("K33");
    expect(airOf(s.state).staged).toEqual(["a1", "a2"]);
    expect(s.airMove).toBeNull();
    expect(s.log.join("\n")).toMatch(/3-4 German air, 2-4 German air change|3-4 German air.*changed base from Rostock \(J32\) to .*\(K33\)/);
    expect(s.toast).toMatch(/changed base from Rostock \(J32\) to .*\(K33\)\./);
  });

  it("only the ticked planes move; a plane that has changed base says so and cannot change base again", () => {
    const s = session();
    chooseBase(s, "J32");
    togglePlane(s, "a2");
    expect(s.airMove!.ticked).toEqual(["a1"]);
    stageTo(s, "K33");
    expect(s.state.units.a1!.at).toBe("K33");
    expect(s.state.units.a2!.at).toBe("J32");
    chooseBase(s, "K33");
    expect(s.airMove!.ticked).toEqual(["a1"]); // every plane there has changed base: all are ticked so that they can be split or joined
    const card = airMoveNow(s)!;
    expect(card.lines[0]!.note).toBe("changed base this turn");
    expect(card.bases).toEqual([]);
    expect(card.why).toMatch(/already changed base this turn/);
  });

  it("with nothing ticked there is no base and the card says to tick a plane; a refused tap says why", () => {
    const s = session();
    chooseBase(s, "J32");
    tickNoPlanes(s);
    const card = airMoveNow(s)!;
    expect(card.bases).toEqual([]);
    expect(card.why).toBe("Tick at least one plane.");
    tapToAirMove(s, hex(s, "K33"));
    expect(s.toast).toBe("Tick at least one plane.");
    expect(s.state.units.a1!.at).toBe("J32");
  });

  it("a tap on a base the planes may not use gives the engine's reason, and a tap on a hex that is no base says so", () => {
    const s = session();
    chooseBase(s, "J32");
    stageTo(s, "K32"); // the base is full (the list and the tap on the map both go through here)
    expect(s.toast).toMatch(/limit|room|stack/i);
    expect(s.state.units.a1!.at).toBe("J32");
    tapHex(s, hex(s, "K31"));
    expect(s.toast).toMatch(/is not a base/);
    expect(s.airMove?.hex).toBe("J32");
  });

  it("a tap on another base with planes chooses those, the same base again lets them go", () => {
    const s = session();
    chooseBase(s, "J32");
    tapHex(s, hex(s, "K32")); // full: not a yellow hex, it holds planes of ours: chosen
    expect(s.airMove?.hex).toBe("K32");
    tapHex(s, hex(s, "K32"));
    expect(s.airMove).toBeNull();
  });

  it("the 4-hex range shows as the pale hexes without the yellow ones, and goes with the toggle", () => {
    const s = session();
    chooseBase(s, "J32");
    const probe = mapSyncProbe(s);
    expect(probe().pale).toEqual([]);
    toggleRange(s);
    const shown = probe();
    expect(shown.pale.length).toBeGreaterThan(10);
    expect(shown.pale.every((h) => !shown.yellow.includes(h))).toBe(true);
    expect(shown.yellow).toContain("K33");
    expect(words(page(s))).toContain("Hide 4-hex range");
    toggleRange(s);
    expect(probe().pale).toEqual([]);
  });

  it("the map marks the base and the ticked planes", () => {
    const s = session();
    chooseBase(s, "J32");
    togglePlane(s, "a2");
    const marks = mapSyncProbe(s)().marks;
    expect(marks).toEqual({ from: "J32", ticked: ["a1"], left: ["a2"] });
  });

  it("Escape and Cancel throw the choice away; the choice goes with the step", () => {
    const s = session();
    chooseBase(s, "J32");
    cancelAirMove(s);
    expect(s.airMove).toBeNull();
    chooseBase(s, "J32");
    s.state = { ...s.state, position: { part: "player-turn", turn: 1, step: "7h" } };
    normaliseMode(s);
    expect(s.airMove).toBeNull();
  });

  it("a plane that leaves (staged away by an action) drops out of the choice", () => {
    const s = session();
    chooseBase(s, "J32");
    s.state = { ...s.state, units: Object.fromEntries(Object.entries(s.state.units).filter(([id]) => id !== "a2")) };
    normaliseMode(s);
    expect(s.airMove!.ticked).toEqual(["a1"]);
    s.state = { ...s.state, units: Object.fromEntries(Object.entries(s.state.units).filter(([id]) => id !== "a1")) };
    normaliseMode(s);
    expect(s.airMove).toBeNull();
  });
});

describe("the ground flow keeps its taps", () => {
  it("a stack that can move is chosen by a tap even where planes stand, and an open planes card gives way to it", () => {
    const s = session([...UNITS(), inf("g2", "germany", "J32", 3, 3)]);
    tapHex(s, hex(s, "J32"));
    expect(s.moveChosen?.hex).toBe("J32");
    expect(s.airMove ?? null).toBeNull();
    chooseBase(s, "K32"); // the planes card is open (and the ground choice is dropped)
    expect(s.airMove?.hex).toBe("K32");
    expect(s.moveChosen ?? null).toBeNull();
    tapHex(s, hex(s, "J32")); // ground stack and planes: the ground stack wins, the planes card goes
    expect(s.moveChosen?.hex).toBe("J32");
    expect(s.airMove ?? null).toBeNull();
  });

  it("a ground stack chosen to move keeps the taps: a base with planes is not opened by a tap meant for a destination", () => {
    const s = session();
    tapHex(s, hex(s, "L33"));
    expect(s.moveChosen?.hex).toBe("L33");
    tapHex(s, hex(s, "J32"));
    expect(s.airMove ?? null).toBeNull();
  });

  it("choosing planes from the list drops a chosen ground stack", () => {
    const s = session();
    tapHex(s, hex(s, "L33"));
    chooseBase(s, "J32", true);
    expect(s.moveChosen ?? null).toBeNull();
    expect(s.airMove?.hex).toBe("J32");
  });
});

describe("what a base starts with, and what goes with the turn", () => {
  it("the planes that have not changed base are ticked; when all have, all are", () => {
    const s = session(UNITS(), {});
    s.state = { ...s.state, air: { ...airOf(s.state), staged: ["a1"] } };
    chooseBase(s, "J32");
    expect(s.airMove!.ticked).toEqual(["a2"]);
    s.state = { ...s.state, air: { ...airOf(s.state), staged: ["a1", "a2"] } };
    chooseBase(s, "J32");
    expect(s.airMove!.ticked).toEqual(["a1", "a2"]);
  });

  it("a choice made in an earlier Player Turn is dropped", () => {
    const s = session();
    chooseBase(s, "J32");
    s.airMove = { ...s.airMove!, turn: "an earlier Player Turn" };
    normaliseMode(s);
    expect(s.airMove).toBeNull();
    openPlacement(s, "germany");
    s.airbase = { ...s.airbase!, turn: "an earlier Player Turn" };
    normaliseMode(s);
    expect(s.airbase).toBeNull();
  });

  it("air that is not a Major Power's is not split (the engine says no, so the card lists no split)", () => {
    const s = session([air("p1", "M35", 3, "poland"), air("a1", "J32", 3)]);
    s.state = { ...s.state, activeSide: "allies" };
    s.humanSide = "allies";
    chooseBase(s, "M35");
    expect(airMoveNow(s)!.lines).toHaveLength(1);
    expect(airMoveNow(s)!.splits).toEqual([]);
  });
});

describe("split and join", () => {
  it("one ticked plane offers the splits the engine accepts, and a press splits it and keeps the card on the parts", () => {
    const s = session([air("a1", "J32", 5)]);
    chooseBase(s, "J32");
    const card = airMoveNow(s)!;
    expect(card.splits.map((x) => x.parts)).toEqual([[3, 2], [3, 1, 1], [2, 2, 1], [2, 1, 1, 1], [1, 1, 1, 1, 1]]);
    expect(words(page(s))).toContain("Split the 5-4 German air (5 ways)");
    splitPlane(s, [3, 2]);
    expect(Object.values(s.state.units).filter((u) => u.type === "air").map((u) => u.strength).sort()).toEqual([2, 3]);
    expect(s.airMove!.ticked).toHaveLength(2);
    expect(s.toast).toMatch(/split into 3 \+ 2 air factors/);
    expect(s.log.join("\n")).toMatch(/5 became 3 \+ 2 air factors/);
  });

  it("two ticked planes of one kind join when the total is a counter size, and not otherwise", () => {
    const s = session([air("a1", "J32", 3), air("a2", "J32", 2)]);
    chooseBase(s, "J32");
    expect(airMoveNow(s)!.join).toMatchObject({ total: 5 });
    expect(words(page(s))).toContain("Join the ticked planes into one 5");
    joinPlanes(s);
    expect(Object.values(s.state.units).filter((u) => u.type === "air").map((u) => u.strength)).toEqual([5]);
    expect(s.airMove!.ticked).toHaveLength(1);
    const t = session([air("a1", "J32", 3), air("a2", "J32", 3)]); // 6 is not a counter size
    chooseBase(t, "J32");
    expect(airMoveNow(t)!.join).toBeNull();
    expect(words(page(t))).toContain("cannot be joined");
    expect(words(page(t))).not.toMatch(/\bu\d+\b|\ba\d\b/);
  });

  it("planes of another nation or movement factor do not join", () => {
    const s = session([air("a1", "J32", 3), { ...air("a2", "J32", 2), movement: 6 }]);
    chooseBase(s, "J32");
    expect(airMoveNow(s)!.join).toBeNull();
  });

  it("a change of base, a split and a join are all taken back by 'Take back last move'", () => {
    const s = session([air("a1", "J32", 3), air("a2", "J32", 2)]);
    const start = s.state;
    chooseBase(s, "J32");
    joinPlanes(s);
    stageTo(s, "K33");
    expect(Object.values(s.state.units).map((u) => u.at)).toEqual(["K33"]);
    expect(takeBack(s)).toBe(true);
    expect(Object.values(s.state.units).map((u) => `${u.at}:${u.strength}`)).toEqual(["J32:5"]);
    expect(takeBack(s)).toBe(true);
    expect(s.state.units).toEqual(start.units);
    expect(s.toast).toMatch(/^Took back: /);
  });
});

describe("placing an airbase", () => {
  it("a row per Power with an airbase left; a press outlines the places; a tap on one places it through PLACE_AIRBASE", () => {
    const s = session();
    const places = airbasePlacements(s.ctx, s.state, "germany");
    expect(places.length).toBeGreaterThan(5);
    expect(openPlacement(s, "germany")).toBe(true);
    const probe = mapSyncProbe(s)();
    expect(probe.yellow).toEqual(places.filter((h) => s.ctx.map.hexes[h]));
    expect(words(page(s))).toContain("Place a Germany airbase");
    expect(nextText(s, legalActions(s.ctx, s.state))).toBe("Next: tap a yellow hex to place the airbase, or cancel.");
    const target = places[0]!;
    tapHex(s, hex(s, target));
    expect(Object.values(s.state.units).some((u) => u.type === "airbase" && u.at === target)).toBe(true);
    expect(s.state.airbasesPlaced).toMatchObject({ germany: 1 });
    expect(s.airbase).toBeNull();
    expect(s.toast).toMatch(/^Placed a Germany airbase at /);
    expect(s.log.join("\n")).toMatch(/Germany places an airbase at/);
  });

  it("a tap elsewhere says the airbase cannot go there and keeps the choice; Cancel lets it go; a Power with none left has no row", () => {
    const s = session();
    openPlacement(s, "germany");
    const bad = Object.keys(s.ctx.map.hexes).find((h) => !airbasePlacements(s.ctx, s.state, "germany").includes(h))!;
    placeAt(s, bad);
    expect(s.toast).toBe("An airbase cannot go there. The yellow hexes are the places it can.");
    expect(s.airbase).not.toBeNull();
    cancelAirMove(s);
    expect(s.airbase).toBeNull();
    const spent = session(UNITS(), { airbasesPlaced: { germany: 3 } });
    expect(openPlacement(spent, "germany")).toBe(false);
    expect(words(page(spent))).not.toContain("Germany: 3 airbases left");
  });

  it("a placement can be taken back", () => {
    const s = session();
    openPlacement(s, "germany");
    placeAt(s, airbasePlacements(s.ctx, s.state, "germany")[0]!);
    expect(takeBack(s)).toBe(true);
    expect(Object.values(s.state.units).some((u) => u.type === "airbase")).toBe(false);
    expect(s.state.airbasesPlaced?.germany ?? 0).toBe(0);
  });
});

describe("the card is read from the engine", () => {
  it("airMoveCard ignores ids that are not planes of the side at the base", () => {
    const s = session([...UNITS(), air("b1", "J32", 3, "britain")]);
    const card = airMoveCard(s.ctx, s.state, "J32", ["a1", "b1", "g1"]);
    expect(card.ticked).toEqual(["a1"]);
    expect(card.lines.map((l) => l.key)).toEqual(["a1", "a2"]);
  });
});

describe("the hex card", () => {
  it("says that a plane changed base this turn", () => {
    const s = session([air("a1", "J32", 3)]);
    chooseBase(s, "J32");
    stageTo(s, "K33");
    expect(hexCard(s.ctx, s.state, "K33").counters[0]!.notes).toContain("changed base this turn");
    expect(hexCard(s.ctx, session([air("a1", "J32", 3)]).state, "J32").counters[0]!.notes).not.toContain("changed base this turn");
  });
});

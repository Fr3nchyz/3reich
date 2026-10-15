import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { turnKey } from "../src/engine/combat-record";
import { controllerOf } from "../src/engine/control";
import type { GameState, Unit, UnitType } from "../src/engine/types";
import { hexCard } from "../src/ui/hexCard";
import { board, counter } from "./board";
import { CTX } from "./helpers";

/** The hex card model (spec 07, part A): each counter of a hex in words, the place, who holds it. Pure data in, card out; it decides no rule. */

const WARSAW = "M35";
const names = (c: ReturnType<typeof hexCard>) => c.counters.map((x) => x.name);
const flat = (c: ReturnType<typeof hexCard>) => JSON.stringify(c);

describe("a hex with counters in it", () => {
  it("lists the four Polish counters of Warsaw at the start of 1939, each with kind, nation and factors", () => {
    const s = board([counter("u1", "poland", "infantry", 2, WARSAW, 3), counter("u2", "poland", "infantry", 2, WARSAW, 3), counter("u11", "poland", "air", 1, WARSAW, 4), counter("u12", "poland", "air", 1, WARSAW, 4)]);
    const c = hexCard(CTX, s, WARSAW);
    expect(c.title).toBe("Warsaw (M35)");
    expect(c.count).toBe("4 counters");
    expect(names(c)).toEqual(["2-3 Polish infantry", "2-3 Polish infantry", "1-4 Polish air", "1-4 Polish air"]);
    expect(c.counters.map((x) => x.notes)).toEqual([["defends"], ["defends"], ["does not defend"], ["does not defend"]]);
    expect(c.holder).toBe("Held by Poland.");
    expect(c.terrain).toContain("Poland");
    expect(c.terrain).toContain("Eastern Front");
  });

  it("names every counter type, with the factors printed as the counter prints them (spec 07, part A: two numbers for ground and air counters, one for a fleet)", () => {
    const kinds: [UnitType, number, number | undefined][] = [["infantry", 3, 3], ["armor", 3, 4], ["airborne", 1, 3], ["replacement", 1, undefined], ["air", 4, 6], ["fleet", 9, undefined], ["airbase", 1, undefined], ["bridgehead", 1, undefined]];
    const s = board(kinds.map(([t, str, mv], i) => counter(`u${i + 1}`, "germany", t, str, WARSAW, mv)));
    const c = hexCard(CTX, s, WARSAW);
    expect(names(c)).toEqual(["3-3 German infantry", "3-4 German armor", "1-3 German airborne", "1 German replacement", "4-6 German air", "9 German fleet", "1 German airbase", "1 German bridgehead"]);
    const notes = Object.fromEntries(c.counters.map((x) => [x.kind, x.notes[0]]));
    expect(notes).toMatchObject({ "German infantry": "defends", "German armor": "defends", "German airborne": "defends", "German replacement": "defends", "German air": "does not defend", "German fleet": "does not defend", "German airbase": "does not defend", "German bridgehead": "does not defend" });
  });

  it("keeps a stack of mixed nations apart, and says who holds a counter whose nation is not its owner", () => {
    const italianFleet: Unit = { ...counter("u3", "germany", "fleet", 5, WARSAW), nationality: "italy" };
    const s = board([counter("u1", "britain", "infantry", 2, WARSAW, 3), counter("u2", "france", "armor", 3, WARSAW, 4), italianFleet]);
    const c = hexCard(CTX, s, WARSAW);
    expect(names(c)).toEqual(["2-3 British infantry", "3-4 French armor", "5 Italian fleet"]);
    expect(c.counters.map((x) => x.heldBy)).toEqual([null, null, "held by Germany"]);
  });

  it("lists identical counters one line each, in the order of the position, with no raw unit id anywhere", () => {
    const s = board([1, 2, 3].map((n) => counter(`u${90 + n}`, "germany", "infantry", 3, WARSAW, 3)));
    const c = hexCard(CTX, s, WARSAW);
    expect(c.counters).toHaveLength(3);
    expect(new Set(c.counters.map((x) => x.key)).size).toBe(3);
    expect(flat({ ...c, counters: c.counters.map(({ key: _key, ...rest }) => rest) } as never)).not.toMatch(/\bu\d+\b/);
  });

  it("only lists the counters of that hex", () => {
    const s = board([counter("u1", "germany", "infantry", 3, WARSAW, 3), counter("u2", "germany", "infantry", 3, "N33", 3)]);
    expect(hexCard(CTX, s, WARSAW).counters).toHaveLength(1);
    expect(hexCard(CTX, s, "N33").title).toBe("Lodz (N33)");
  });
});

describe("the notes the engine knows", () => {
  const turn = (s: GameState) => turnKey(s);
  it("says a counter has moved or attacked this Player Turn, and where it may advance", () => {
    const base = board([counter("u1", "germany", "armor", 3, "N33", 4), counter("u2", "germany", "infantry", 3, "N33", 3)], SCENARIO_1939, { activeSide: "axis", position: { part: "player-turn", turn: 1, step: "7h" } });
    const s: GameState = {
      ...base,
      moves: { turn: turn(base), moved: ["u1"] },
      combat: { turn: turn(base), attacked: ["u1", "u2"], targets: [WARSAW], pending: null, advances: [{ to: WARSAW, units: ["u2"] }] },
    };
    const [armor, inf] = hexCard(CTX, s, "N33").counters;
    expect(armor!.notes).toEqual(["defends", "moved", "has attacked"]);
    expect(inf!.notes).toEqual(["defends", "has attacked", "can advance into Warsaw (M35)"]);
  });

  it("forgets the notes of an earlier Player Turn (the records are keyed by turn)", () => {
    const base = board([counter("u1", "germany", "armor", 3, "N33", 4)]);
    const s: GameState = { ...base, moves: { turn: "1900-spring-allies", moved: ["u1"] }, combat: { turn: "1900-spring-allies", attacked: ["u1"], targets: [], pending: null, advances: [] } };
    expect(hexCard(CTX, s, "N33").counters[0]!.notes).toEqual(["defends"]);
  });
});

describe("a hex without counters", () => {
  it("says so, and still gives the place, terrain and holder", () => {
    const c = hexCard(CTX, board([]), WARSAW);
    expect(c.counters).toEqual([]);
    expect(c.count).toBe("No counters here.");
    expect(c.title).toBe("Warsaw (M35)");
    expect(c.holder).toBe("Held by Poland.");
  });

  it("names a hex that has no printed name by its terrain and country, with the coordinate in brackets", () => {
    expect(MAP.hexes["M34"]?.name).toBeUndefined();
    expect(hexCard(CTX, board([]), "M34").title).toBe("Plain hex in Poland (M34)");
  });

  it("calls a sea hex a sea hex and has no holder", () => {
    const sea = Object.values(MAP.hexes).find((h) => !h.land)!;
    const c = hexCard(CTX, board([counter("u1", "britain", "fleet", 9, sea.id)]), sea.id);
    expect(c.title).toBe(`Sea hex (${sea.id})`);
    expect(c.holder).toBe("");
    expect(c.terrain).toMatch(/^Sea,/);
    expect(names(c)).toEqual(["9 British fleet"]);
  });
});

describe("whose hex it is", () => {
  it("shows an enemy-held hex with the enemy's counters, and the holder it has after a change of control", () => {
    const s = { ...board([counter("u1", "poland", "infantry", 2, WARSAW, 3)]), control: { [WARSAW]: "germany" as const } };
    const c = hexCard(CTX, s, WARSAW);
    expect(c.holder).toBe("Held by Germany.");
    expect(names(c)).toEqual(["2-3 Polish infantry"]);
  });

  it("says a neutral country's hex is held by no nation", () => {
    const spain = Object.values(MAP.hexes).find((h) => h.country === "spain" && h.land && controllerOf(CTX, board([]), h.id) === null)!;
    expect(spain).toBeDefined();
    const c = hexCard(CTX, board([]), spain.id);
    expect(c.holder).toBe("Held by no nation.");
    expect(c.terrain).toContain("Spain");
  });

  it("writes a country named with a hyphen in words", () => {
    const baltic = Object.values(MAP.hexes).find((h) => h.country === "baltic-states" && !h.name)!;
    expect(hexCard(CTX, board([]), baltic.id).title).toContain("Baltic states");
  });

  it("announces a fortress only when the position says it has the status (the way the defence multiplier reads it)", () => {
    const withFortress = { ...board([]), fortresses: { [WARSAW]: true } };
    expect(hexCard(CTX, withFortress, WARSAW).terrain).toContain("fortress");
    expect(hexCard(CTX, board([]), WARSAW).terrain).not.toContain("fortress");
  });
});

describe("the card is only a reading", () => {
  it("never throws on any hex of the map, never prints a unit id, and leaves the position as it was", () => {
    const hexes = Object.keys(MAP.hexes);
    const units = hexes.filter((_, i) => i % 7 === 0).map((id, i) => counter(`u${i + 1}`, i % 2 ? "germany" : "ussr", i % 3 ? "infantry" : "air", 2, id, 3));
    const s = board(units);
    const before = JSON.stringify(s);
    for (let i = 0; i < hexes.length; i += 3) {
      const c = hexCard(CTX, s, hexes[i]!);
      expect(flat({ ...c, counters: c.counters.map(({ key: _key, ...rest }) => rest) } as never)).not.toMatch(/\bu\d+\b/);
      expect(c.title).toContain(hexes[i]!);
    }
    expect(JSON.stringify(s)).toBe(before);
  });

  it("gives an empty card, not an error, for an id that is not a hex", () => {
    expect(hexCard(CTX, board([]), "ZZ99").counters).toEqual([]);
  });

  it("does not depend on the dice generator", () => {
    const a = board([counter("u1", "poland", "infantry", 2, WARSAW, 3)]);
    expect(hexCard(CTX, { ...a, rngState: 12345 }, WARSAW)).toEqual(hexCard(CTX, a, WARSAW));
  });
});

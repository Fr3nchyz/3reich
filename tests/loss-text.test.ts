import { describe, expect, it } from "vitest";
import { MAP } from "../src/data/map";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import type { GameEvent, LostReason } from "../src/engine/action-types";
import { legalActions } from "../src/engine/actions";
import type { ForceEntry } from "../src/engine/types";
import { placeName } from "../src/ui/names";
import { buildOptions, buildPanel } from "../src/ui/buildView";
import { builtLine, LOST_REASON_WORDS, lossLine } from "../src/ui/lossText";
import { createSession, describeEvent, setupView, type Session } from "../src/ui/session";
import { fillRest, takeAction } from "../src/ui/sessionActions";

/** Spec 17, ticket 17-4: the log lines for a lost unit and its fate, and the "rebuild" mark in the Construction panel. */

const ctx = { map: MAP, scenario: SCENARIO_1939 };
const s0 = createSession(SCENARIO_1939, "axis", 1);
const hex = (name: string) => Object.entries(MAP.hexes).find(([, h]) => h.name === name)![0];
const warsaw = hex("Warsaw");
const lost = (reason: LostReason, extra: Partial<Extract<GameEvent, { type: "UNIT_LOST_FOR_GOOD" }>> = {}): Extract<GameEvent, { type: "UNIT_LOST_FOR_GOOD" }> =>
  ({ type: "UNIT_LOST_FOR_GOOD", unitId: "nope", owner: "poland", unitType: "infantry", strength: 1, at: warsaw, reason, ...extra });

describe("the log line of a lost unit", () => {
  it("says where it went, naming nation, factors and place (spec 17 R1)", () => {
    const s = at8b();
    const unitId = Object.keys(s.state.units).find((id) => s.state.units[id]!.owner === "germany" && s.state.units[id]!.type === "armor")!;
    const u = s.state.units[unitId]!;
    const e: GameEvent = { type: "UNIT_RETURNED_TO_POOL", unitId, owner: "germany", unitType: "armor", strength: u.strength, at: u.at, pool: "germany" };
    expect(lossLine(ctx, s.state, e)).toBe(`German ${u.strength}-${u.movement} armor destroyed at ${placeName(MAP, u.at)}, back in the pool.`);
  });

  it("falls back on the event when the counter is not in the position, with no unit id shown", () => {
    const line = lossLine(ctx, s0.state, lost("minor-country"));
    expect(line).toBe(`Poland 1-factor infantry destroyed at Warsaw (${warsaw}), lost for good (minor country).`);
    expect(line).not.toMatch(/\bu\d+\b|nope/);
  });

  it("has a readable phrase for every reason a unit is lost for good (R4)", () => {
    const reasons: LostReason[] = ["out-of-game", "minor-country", "not-in-pool", "fleet-never-rebuilt", "partial-fleet"];
    expect(Object.keys(LOST_REASON_WORDS).sort()).toEqual([...reasons].sort());
    for (const r of reasons) expect(lossLine(ctx, s0.state, lost(r))).toContain(`lost for good (${LOST_REASON_WORDS[r]}).`);
    expect(lossLine(ctx, s0.state, lost("out-of-game"))).toContain("its nation is out of the game");
    expect(lossLine(ctx, s0.state, lost("partial-fleet"))).toContain("whole 9-factor fleet");
    expect(lossLine(ctx, s0.state, lost("fleet-never-rebuilt"))).toContain("fleets are never rebuilt");
    expect(lossLine(ctx, s0.state, lost("not-in-pool"))).toContain("cannot be rebuilt");
  });

  it("says the Free French pool when that is where it went (RB10), and lack of supply when that was the cause", () => {
    const e: GameEvent = { type: "UNIT_RETURNED_TO_POOL", unitId: "x", owner: "free-france", unitType: "infantry", strength: 2, at: warsaw, pool: "free-france" };
    expect(lossLine(ctx, s0.state, e)).toBe(`Free France 2-factor infantry destroyed at Warsaw (${warsaw}), back in the Free French pool.`);
    expect(lossLine(ctx, s0.state, e, true)).toContain("eliminated for lack of supply at");
  });
});

describe("the log line of a counter built", () => {
  const built: Extract<GameEvent, { type: "UNIT_BUILT" }> = { type: "UNIT_BUILT", unitId: "u1", owner: "germany", unitType: "armor", strength: 4, at: "L33", cost: 12 };
  it("keeps the plain wording for a new counter", () => expect(builtLine(built, "Germany")).toBe("Germany builds a 4-factor armor at L33 (12 BRPs)."));
  it("says rebuilds for a counter bought back from the pool (R2)", () => expect(builtLine({ ...built, returned: true }, "Germany")).toBe("Germany rebuilds a 4-factor armor at L33 (12 BRPs)."));
  it("names the Free French counter Britain rebuilds (RB10)", () =>
    expect(builtLine({ ...built, owner: "britain", unitType: "infantry", strength: 2, cost: 2, returned: true, pool: "free-france" }, "Britain")).toBe("Britain rebuilds a 2-factor Free French infantry at L33 (2 BRPs)."));
});

function at8b(): Session {
  const s = createSession(SCENARIO_1939, "axis", 1);
  for (let i = 0; i < 20 && s.state.phase === "setup"; i++) {
    fillRest(s);
    const v = setupView(s);
    if (v) takeAction(s, { type: "SETUP_DONE", owner: v.owner });
  }
  for (let i = 0; i < 12 && !(s.state.position?.part === "player-turn" && s.state.position.step === "8b"); i++) takeAction(s, legalActions(s.ctx, s.state).at(-1)!);
  return s;
}
const withReturned = (s: Session, owner: "germany" | "britain" | "free-france", entries: ForceEntry[]) => {
  const p = s.state.pools[owner]!;
  s.state = { ...s.state, pools: { ...s.state.pools, [owner]: { ...p, allowableBuilds: [...p.allowableBuilds, ...entries] } } };
};

describe("the Construction panel marks a returned counter (R2)", () => {
  it("shows a rebuild mark on a returned counter's chip only, apart from the scenario's counter of the same kind", () => {
    const s = at8b();
    withReturned(s, "germany", [{ type: "infantry", strength: 3, movement: 4, count: 1, returned: true }]);
    const html = buildPanel(s, legalActions(s.ctx, s.state));
    expect(html).toContain('data-build="germany:infantry:3"');
    expect(html).toContain('data-build="germany:infantry:3:returned"');
    expect(html.match(/class="rebuild"/g)).toHaveLength(1);
    const chip = html.match(/<button data-build="germany:infantry:3:returned".*?<\/button>/)![0];
    expect(chip).toContain("rebuild");
    expect(chip).toContain("3-4");
    expect(html.match(/<button data-build="germany:infantry:3"[^>]*>.*?<\/button>/)![0]).not.toContain("rebuild");
  });

  it("shows one chip, each place once, for two returned counters that differ only in movement", () => {
    const s = at8b();
    withReturned(s, "germany", [{ type: "armor", strength: 4, movement: 6, count: 1, returned: true }, { type: "armor", strength: 4, movement: 5, count: 1, returned: true }]);
    const actions = legalActions(s.ctx, s.state);
    const options = buildOptions(actions).filter((o) => o.returned && o.type === "armor");
    expect(options).toHaveLength(1);
    expect(new Set(options[0]!.places).size).toBe(options[0]!.places.length);
    expect(buildPanel(s, actions).match(/data-build="germany:armor:4:returned"/g)).toHaveLength(1);
  });

  it("reads sensibly for a Free French counter Britain builds (RB10)", () => {
    const s = at8b();
    s.state = { ...s.state, pools: { ...s.state.pools, "free-france": { forcePool: [], allowableBuilds: [] } } };
    withReturned(s, "free-france", [{ type: "infantry", strength: 2, movement: 3, count: 1, returned: true }]);
    // Britain builds on the Allied turn: the panel is given the BUILD action Britain would have, as the Allies' step 8b offers it
    const html = buildPanel(s, [{ type: "BUILD", owner: "britain", pool: "free-france", unit: { type: "infantry", strength: 2, returned: true }, at: "us-box" }]);
    expect(html).toContain('data-build="britain:infantry:2:returned:pool=free-france"');
    expect(html).toContain("Free France, built by Great Britain");
    expect(html).toContain("rebuild");
    expect(html).toContain("2-3");
  });
});

describe("one line for one loss", () => {
  const back: GameEvent = { type: "UNIT_RETURNED_TO_POOL", unitId: "x", owner: "germany", unitType: "armor", strength: 4, at: warsaw, pool: "germany" };
  const gone: GameEvent = { type: "UNIT_ELIMINATED", unitId: "x", owner: "germany", at: warsaw };
  it("tells the fate, not the elimination, when both come (spec 17 R1)", () => {
    expect(describeEvent(back, ctx, new Set(), new Map([["x", false]]), s0.state)).toContain("back in the pool");
    expect(describeEvent(gone, ctx, new Set(), new Map([["x", false]]), s0.state)).toBeNull();
    expect(describeEvent(gone, ctx, new Set(), new Map(), s0.state)).toMatch(/^Eliminated: /); // a game saved before spec 17 has no fate event
  });
  it("tells nothing for a unit the sweep line already names", () => {
    expect(describeEvent(back, ctx, new Set(["x"]), new Map([["x", false]]), s0.state)).toBeNull();
    expect(describeEvent(lost("minor-country", { unitId: "x" }), ctx, new Set(["x"]), new Map(), s0.state)).toBeNull();
  });
});

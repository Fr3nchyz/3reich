import { describe, expect, it } from "vitest";
import type { GameEvent } from "../src/engine/actions";
import { controlMap } from "../src/engine/control";
import { objectiveHexes, objectiveStandings } from "../src/engine/objectives";
import { MAP } from "../src/data/map";
import type { GameState } from "../src/engine/types";
import { auditConquered, auditEnd, auditObjectives, conquestList, SequenceAudit } from "../scripts/selfplay/audit";
import { gameReport } from "../scripts/selfplay/report";
import { runGame } from "../scripts/selfplay/runner";
import { CTX } from "./helpers";
import { at6f, inf } from "./helpers-move";

// The self-play anomaly checks of spec 14 part E (ticket 14-20): each is fed a bad state and must fire (the mutation), and must stay quiet on real games.

const kinds = (xs: { kind: string }[]) => xs.map((x) => x.kind);
const base = (): GameState => at6f([inf("a", "germany", "L32")]);
const conquered = (s: GameState, country: string): GameState => ({ ...s, conquests: [{ country: country as "poland", by: "germany", side: "allies", how: "capital", at: { year: 1939, season: "fall" } }] });

describe("conquered nations leave nothing behind", () => {
  it("is quiet on a state with no conquest, and with a conquest that left nothing", () => {
    expect(auditConquered(CTX, base())).toEqual([]);
    const b = base();
    const cleared = { ...b.control, ...Object.fromEntries([...controlMap(CTX, b)].filter(([, o]) => o === "poland").map(([h]) => [h, null])) };
    expect(auditConquered(CTX, conquered({ ...b, control: cleared }, "poland"))).toEqual([]);
  });
  it("leaves a hex alone that holds a ground unit of the conquered nation's side (V12), and fires once that unit is gone", () => {
    const b = at6f([inf("w", "britain", "L32")]);
    const cleared = { ...b.control, ...Object.fromEntries([...controlMap(CTX, b)].filter(([, o]) => o === "poland").map(([h]) => [h, null])), L32: "poland" as const };
    const s = conquered({ ...b, control: cleared }, "poland");
    expect(auditConquered(CTX, s)).toEqual([]);
    expect(kinds(auditConquered(CTX, { ...s, units: {} }))).toEqual(["conquered-hex"]);
  });
  it("leaves the land of a surrendered Russia alone (R7c) but not its units", () => {
    const s = at6f([inf("r1", "ussr", "L32")]);
    const surrendered = { ...s, conquests: [{ country: "ussr" as const, by: "germany" as const, side: "allies" as const, how: "surrender" as const, at: { year: 1942, season: "summer" as const } }] };
    expect(kinds(auditConquered(CTX, surrendered))).toEqual(["conquered-unit"]);
  });
  it("fires on a unit of a conquered nation still on the map", () => {
    const s = conquered(at6f([inf("p1", "poland", "L32")]), "poland");
    expect(kinds(auditConquered(CTX, s))).toContain("conquered-unit");
  });
  it("fires on a hex still controlled by a conquered nation", () => {
    const s = conquered({ ...base(), control: { ...base().control, L32: "poland" } }, "poland");
    expect(auditConquered(CTX, s).map((f) => f.kind)).toEqual(["conquered-hex"]);
  });
});

describe("the Objectives count once, as Objectives", () => {
  const real = objectiveStandings(CTX, base());
  it("is quiet on the real standings: 42 Objectives, each once", () => {
    expect(objectiveHexes(CTX)).toHaveLength(42);
    expect(auditObjectives(CTX, base())).toEqual([]);
  });
  it("fires when one Objective is on two lists", () => {
    const bad = { ...real, axis: [...real.axis, real.nobody[0] ?? real.allies[0]!] };
    expect(auditObjectives(CTX, base(), bad).some((f) => /more than once/.test(f.detail))).toBe(true);
  });
  it("fires when a capital that is no Objective is counted", () => {
    const capitalOnly = Object.values(MAP.hexes).find((h) => h.features.includes("capital") && !h.features.includes("objective"));
    expect(capitalOnly, "the map has a capital that is not an Objective").toBeDefined();
    const bad = { ...real, nobody: [...real.nobody, capitalOnly!.id] };
    expect(auditObjectives(CTX, base(), bad).some((f) => /capital only/.test(f.detail))).toBe(true);
  });
  it("fires when an Objective is counted for nobody at all", () => {
    const bad = { axis: real.axis.slice(1), allies: real.allies.filter((h) => h !== real.axis[0]), nobody: real.nobody.filter((h) => h !== real.axis[0]) };
    expect(auditObjectives(CTX, base(), bad).some((f) => /not counted/.test(f.detail))).toBe(true);
  });
});

describe("a game ends with a result", () => {
  it("fires on game-over without a result, and on a result without game-over; quiet otherwise", () => {
    expect(auditEnd(CTX, base())).toEqual([]);
    expect(kinds(auditEnd(CTX, { ...base(), phase: "game-over" }))).toEqual(["no-result"]);
    const result = { winner: null, level: null, basis: "turn-limit" as const, objectives: { axis: 0, allies: 0, nobody: 42 }, at: { year: 1941, season: "fall" as const }, early: false, siberian: false };
    expect(kinds(auditEnd(CTX, { ...base(), result }))).toContain("no-result");
  });
  it("fires when the result's Objective counts differ from the standings", () => {
    const s = objectiveStandings(CTX, base());
    const result = { winner: null, level: null, basis: "turn-limit" as const, objectives: { axis: s.axis.length + 1, allies: s.allies.length, nobody: s.nobody.length }, at: { year: 1941, season: "fall" as const }, early: false, siberian: false };
    expect(kinds(auditEnd(CTX, { ...base(), phase: "game-over", result }))).toEqual(["objective-count"]);
    expect(auditEnd(CTX, { ...base(), phase: "game-over", result: { ...result, objectives: { axis: s.axis.length, allies: s.allies.length, nobody: s.nobody.length } } })).toEqual([]);
  });
});

describe("the winter lasts one Game Turn and the surrender is offered once", () => {
  const at = (year: number, season: GameState["season"], winter?: GameState["winter"], soviet?: GameState["soviet"]): GameState => ({ ...base(), year, season, ...(winter ? { winter } : {}), ...(soviet ? { soviet } : {}) });
  const on = (key: string): GameState["winter"] => ({ stage: "over", inForce: key, asking: false });
  const started = (year: number, season: "winter"): GameEvent => ({ type: "WINTER_STARTED", turn: { year, season } });

  it("is quiet on one winter in force for its one Game Turn", () => {
    const a = new SequenceAudit();
    expect(a.step([started(1941, "winter")], at(1941, "winter", on("1941-winter")))).toEqual([]);
    expect(a.step([], at(1941, "winter", on("1941-winter")))).toEqual([]);
    expect(a.step([], at(1942, "spring", on("1941-winter")))).toEqual([]);
    expect(a.finish()).toEqual([]);
  });
  it("fires on a winter that starts twice", () => {
    const a = new SequenceAudit();
    a.step([started(1941, "winter")], at(1941, "winter", on("1941-winter")));
    expect(kinds(a.step([started(1942, "winter")], at(1942, "winter", on("1942-winter"))))).toContain("winter-length");
  });
  it("fires on a winter that starts twice in the same Game Turn", () => {
    const a = new SequenceAudit();
    expect(kinds(a.step([started(1941, "winter"), started(1941, "winter")], at(1941, "winter", on("1941-winter"))))).toEqual(["winter-length"]);
  });
  it("fires on a winter in force for more than one Game Turn", () => {
    const a = new SequenceAudit();
    a.step([started(1941, "winter")], at(1941, "winter", on("1941-winter")));
    // The record's turn moved on without a new start: in force in 1942 as well.
    expect(a.step([], at(1942, "winter", on("1942-winter"))).some((f) => /2 Game Turns/.test(f.detail))).toBe(true);
  });
  it("fires on a winter that stops before its Game Turn is over, and on one that started but was never in force", () => {
    const a = new SequenceAudit();
    a.step([started(1941, "winter")], at(1941, "winter", on("1941-winter")));
    expect(a.step([], at(1941, "winter", { stage: "over", asking: false })).some((f) => /not in force/.test(f.detail))).toBe(true);
    const b = new SequenceAudit();
    b.step([started(1941, "winter")], at(1942, "spring"));
    expect(kinds(b.finish())).toEqual(["winter-length"]);
  });
  it("fires on a winter in force that never started", () => {
    const a = new SequenceAudit();
    a.step([], at(1941, "winter", on("1941-winter")));
    expect(kinds(a.finish())).toEqual(["winter-length"]);
  });
  it("fires on a second surrender offer, and not on the first", () => {
    const a = new SequenceAudit();
    const offer: GameEvent = { type: "RUSSIA_OFFERS_SURRENDER", russian: 40, axis: 60 };
    expect(a.step([offer], at(1942, "summer", undefined, { citiesTaken: {}, offer: "asking" }))).toEqual([]);
    expect(kinds(a.step([offer], at(1942, "fall", undefined, { citiesTaken: {}, offer: "asking" })))).toEqual(["surrender-twice"]);
  });
});

describe("on real games the checks stay quiet, and the report names the conquests", () => {
  for (const [scenario, seed] of [["1939", 1], ["1939", 4], ["1944", 1]] as const) {
    it(`${scenario} seed ${seed} to the end: no anomaly, a result`, () => {
      const r = runGame({ scenario, seed, turns: "end" }, {});
      expect(r.anomalies).toEqual([]);
      expect(r.final.result).toBeDefined();
      const md = gameReport(r);
      expect(md).toContain(`- Conquests (${r.final.conquests?.length ?? 0}): `);
      for (const c of conquestList(r.final)) expect(md).toContain(c);
    }, 120_000);
  }
  it("a planted unit of a conquered nation is reported by a run", () => {
    const plant = (s: GameState): GameState => ({ ...conquered(s, "poland"), units: { ...s.units, ghost: inf("ghost", "poland", "L32") } });
    const r = runGame({ scenario: "1939", seed: 1, turns: 1 }, { prepare: plant });
    expect(kinds(r.anomalies)).toContain("conquered-unit");
  });
});

import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { chooseAction } from "../src/ai";
import { createMemory } from "../src/ai/memory";
import { applyAction, legalActions, type Action, type GameEvent } from "../src/engine/actions";
import { lonersAt } from "../src/engine/attack-rules";
import { autoSetup } from "../src/engine/autosetup";
import { combatOf } from "../src/engine/combat-record";
import { newGame } from "../src/engine/game";
import type { GameState, Unit } from "../src/engine/types";
import { attackPreview, defaultAttackers, type AttackPreview } from "../src/ui/attackPreview";
import { CTX } from "./helpers";
import { GER, POL, at7h, unit } from "./preview-helpers";

/**
 * Spec 07 ticket 07-4, part F: what the preview shows is what the battle then uses. Every comparison goes through the real
 * applyAction path with the game's own seeded dice (Ref 12.1, 12.2, 4.5). Also open builder question B1: the card builds any
 * subset of attackers while legalActions lists only whole groups.
 */

type Resolved = Extract<GameEvent, { type: "COMBAT_RESOLVED" }>;
const attackOf = (units: string[], target: string): Action => ({ type: "ATTACK", side: "axis", units, target });
const resolvedOf = (events: GameEvent[]): Resolved => events.find((e): e is Resolved => e.type === "COMBAT_RESOLVED")!;
const subsets = <T>(xs: readonly T[]): T[][] => Array.from({ length: (1 << xs.length) - 1 }, (_, i) => xs.filter((_x, j) => (i + 1) & (1 << j)));
const freeIds = (p: AttackPreview): string[] => p.attackers.filter((c) => c.state !== "greyed").map((c) => c.id);

const POSITIONS: { name: string; units: Unit[]; target: string; extra?: Partial<GameState> }[] = [
  { name: "plain, two hexes", units: [GER("g1", "M32", 3), GER("g2", "M32", 2), GER("g3", "N32", 2), POL("p1", "M33"), POL("p2", "M33")], target: "M33" },
  { name: "plain, defenders larger", units: [GER("g1", "M32", 2), GER("g2", "M32", 2), POL("p1", "M33", 2), POL("p2", "M33", 2)], target: "M33" },
  { name: "mountains", units: [GER("g1", "Q33", 6), GER("g2", "Q33", 1), POL("p1", "Q34", 2), POL("p2", "Q34", 1)], target: "Q34" },
  { name: "swamp", units: [GER("g1", "M36", 6), GER("g2", "M36", 2), POL("p1", "M37", 2)], target: "M37" },
  { name: "river, with a unit that is not across it", units: [GER("g1", "K35", 5), GER("g2", "K35", 2), GER("g3", "L33", 3), POL("p1", "K34", 2), POL("p2", "K34", 1)], target: "K34" },
  { name: "fortress", units: [GER("g1", "M32", 6), GER("g2", "M32", 3), POL("p1", "M33", 2), POL("p2", "M33", 1)], target: "M33", extra: { fortresses: { M33: true } } },
  { name: "Warsaw with air units that do not defend", units: [GER("g1", "M34", 3), GER("g2", "N34", 2), POL("p1", "M35", 2), POL("a1", "M35", 1, "air"), POL("a2", "M35", 2, "air")], target: "M35" },
];

describe("the numbers equal what the battle then uses (Ref 12.1, 4.5)", () => {
  for (const p of POSITIONS) {
    it(`${p.name}: every subset of attackers, over 25 seeds`, () => {
      const base = at7h(p.units, 1, p.extra);
      const ids = freeIds(attackPreview(CTX, base, p.target, []));
      expect(ids.length).toBeGreaterThan(1);
      for (const chosen of subsets(ids)) {
        for (let seed = 1; seed <= 25; seed++) {
          const s = { ...base, rngState: seed };
          const shown = attackPreview(CTX, s, p.target, chosen);
          expect(shown.problems).toEqual([]);
          const r = applyAction(CTX, s, attackOf(chosen, p.target));
          if (!r.ok) throw new Error(`${chosen.join()}: ${r.error}`);
          const e = resolvedOf(r.events);
          if (shown.sweep) {
            expect(e).toMatchObject({ sweep: true });
            continue;
          }
          expect(e).toMatchObject({ attackFactors: shown.numbers!.attackFactors, defenseFactors: shown.numbers!.defenseFactors, multiplier: shown.numbers!.multiplier });
          expect(e.rounds[0]!.column).toBe(shown.numbers!.column);
          // The first roll's result is one of the rows shown.
          expect(shown.results.some((row) => row.result === e.rounds[0]!.result)).toBe(shown.numbers!.column !== null);
        }
      }
    });
  }
});

describe("open question B1: the card builds any subset, applyAttack accepts it", () => {
  it("every non-empty subset of the units the preview calls free is accepted by applyAction, in every position", () => {
    let tried = 0;
    for (const p of POSITIONS) {
      const s = at7h(p.units, 7, p.extra);
      for (const chosen of subsets(freeIds(attackPreview(CTX, s, p.target, [])))) {
        const r = applyAction(CTX, s, attackOf(chosen, p.target));
        expect(r.ok, `${p.name} ${chosen.join()}: ${r.ok ? "" : r.error}`).toBe(true);
        tried++;
      }
    }
    expect(tried).toBeGreaterThan(25);
  });

  it("the units the preview calls free are exactly the units of the largest ATTACK that legalActions lists for the hex", () => {
    for (const p of POSITIONS) {
      const s = at7h(p.units, 1, p.extra);
      const listed = legalActions(CTX, s).filter((a): a is Extract<Action, { type: "ATTACK" }> => a.type === "ATTACK" && a.target === p.target);
      const largest = [...listed].sort((a, b) => b.units.length - a.units.length)[0]!;
      expect(freeIds(attackPreview(CTX, s, p.target, [])).sort(), p.name).toEqual([...largest.units].sort());
    }
  });

  it("a unit outside that group is refused when it is not next to the hex, has attacked, or is not a ground unit", () => {
    const s = at7h([GER("g1", "M32"), GER("far", "A5"), GER("air", "N32", 4, "air"), POL("p1", "M33")]);
    for (const id of ["far", "air"]) expect(applyAction(CTX, s, attackOf(["g1", id], "M33")).ok).toBe(false);
    expect(freeIds(attackPreview(CTX, s, "M33", []))).toEqual(["g1"]);
  });

  it("FINDING: applyAttack also accepts a unit at war with nobody in the hex, and counts its factors; the preview greys such a unit so the card never builds it", () => {
    const base = at7h([unit("po", "poland", "infantry", 2, "M32"), unit("br", "britain", "infantry", 3, "N32"), GER("g1", "M33")], 1, { activeSide: "allies" });
    const s = { ...base, wars: base.wars.filter((w) => !w.includes("britain")) };
    const group = legalActions(CTX, s).filter((a) => a.type === "ATTACK" && a.target === "M33").map((a) => (a.type === "ATTACK" ? a.units : []));
    expect(group.every((u) => !u.includes("br"))).toBe(true); // legalActions never lists the unit
    const r = applyAction(CTX, s, { type: "ATTACK", side: "allies", units: ["po", "br"], target: "M33" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(resolvedOf(r.events).attackFactors).toBe(5);
    const p = attackPreview(CTX, s, "M33", ["po", "br"]);
    expect(p.numbers!.attackFactors).toBe(2);
    expect(p.attackers.find((c) => c.id === "br")!.state).toBe("greyed");
  });
});

describe("who defends depends on who attacks (Ref 12.1; isEnemy)", () => {
  // Allies to move; Poland fights Germany, Britain (here) fights Italy; a hex holds one German and one Italian counter.
  const base = at7h([unit("po", "poland", "infantry", 2, "M32"), unit("br", "britain", "infantry", 3, "N32"), GER("g1", "M33", 2), unit("it", "italy", "infantry", 4, "M33")], 1, { activeSide: "allies" });
  const s: GameState = { ...base, wars: [...base.wars.filter((w) => !w.includes("britain")), ["britain", "italy"]] };
  it("each chosen set meets its own enemies, as the battle does", () => {
    const names: Record<string, string[]> = { po: ["g1"], br: ["it"], "po,br": ["g1", "it"] };
    for (const chosen of [["po"], ["br"], ["po", "br"]]) {
      const p = attackPreview(CTX, s, "M33", chosen);
      expect(p.defenders.map((d) => d.id), chosen.join()).toEqual(names[chosen.join()]);
      const r = applyAction(CTX, s, { type: "ATTACK", side: "allies", units: chosen, target: "M33" });
      if (!r.ok) throw new Error(r.error);
      expect(resolvedOf(r.events)).toMatchObject({ attackFactors: p.numbers!.attackFactors, defenseFactors: p.numbers!.defenseFactors });
    }
  });
  it("before anything is chosen the card shows everyone who could attack", () => {
    expect(attackPreview(CTX, s, "M33", []).defenders.map((d) => d.id)).toEqual(["g1", "it"]);
  });
});

describe("Exchange cost shown equals what a real battle requires (Ref 12.2)", () => {
  const cases: [string, Unit[], string[]][] = [
    ["attackers smaller than the multiplied defence", [GER("g1", "M32", 2), GER("g2", "M32", 2), POL("p1", "M33", 2), POL("p2", "M33", 2)], ["g1", "g2"]],
    ["attackers larger", [GER("g1", "M32", 3), GER("g2", "M32", 2), GER("g3", "M32", 1), POL("p1", "M33", 1), POL("p2", "M33", 1)], ["g1", "g2", "g3"]],
  ];
  for (const [name, units, chosen] of cases) {
    it(`${name}: required, values and who chooses equal PendingLosses in real battles found by scanning seeds`, () => {
      let seen = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const s = at7h(units, seed);
        const row = attackPreview(CTX, s, "M33", chosen).results.find((r) => r.result === "Ex")!;
        const r = applyAction(CTX, s, attackOf(chosen, "M33"));
        if (!r.ok) throw new Error(r.error);
        const e = resolvedOf(r.events);
        const pending = combatOf(r.state).pending;
        if (e.outcome !== "exchange" || e.rounds.at(-1)!.by !== "attacker" || !pending) continue;
        seen++;
        expect(pending.required).toBe(row.exchange!.required);
        expect(pending.values).toEqual(row.exchange!.values);
        expect(pending.chooser).toBe(row.exchange!.chooser === "attackers" ? "axis" : "allies");
      }
      expect(seen).toBeGreaterThan(0);
    });
  }
});

describe("after a win", () => {
  it("the counters that also go equal lonersAt on the position without the defenders, and are the ones a real win destroys", () => {
    const units = [GER("g1", "M34", 6), POL("p1", "M35", 1), POL("a1", "M35", 1, "air"), unit("f1", "poland", "fleet", 2, "M35")];
    let wins = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const s = at7h(units, seed);
      const p = attackPreview(CTX, s, "M35", ["g1"]);
      const without = { ...s, units: Object.fromEntries(Object.entries(s.units).filter(([id]) => id !== "p1")) };
      expect(p.alsoDestroyed.length + p.alsoMoved.length).toBe(lonersAt(without, [s.units.g1!], "M35").length);
      expect(p.alsoDestroyed).toHaveLength(1); // the air unit
      expect(p.alsoMoved).toEqual(["2 Polish fleet"]); // the fleet is driven out, not destroyed
      const r = applyAction(CTX, s, attackOf(["g1"], "M35"));
      if (!r.ok) throw new Error(r.error);
      const swept = r.events.find((e) => e.type === "UNITS_SWEPT");
      if (resolvedOf(r.events).outcome === "defender-eliminated") {
        wins++;
        expect(swept && swept.type === "UNITS_SWEPT" ? swept.units.map((u) => u.id).sort() : []).toEqual(["a1"]);
        expect(r.events.filter((e) => e.type === "FLEET_DISPLACED").map((e) => (e.type === "FLEET_DISPLACED" ? e.unitId : ""))).toEqual(["f1"]);
      }
    }
    expect(wins).toBeGreaterThan(0);
  });

  it("the sweep of an air-only Warsaw destroys what the preview lists, with no roll", () => {
    const s = at7h([GER("g1", "M34", 3), GER("g2", "N34", 2), POL("a1", "M35", 1, "air"), POL("a2", "M35", 2, "air")], 99);
    const chosen = defaultAttackers(CTX, s, "M35");
    const p = attackPreview(CTX, s, "M35", chosen);
    const r = applyAction(CTX, s, attackOf(chosen, "M35"));
    if (!r.ok) throw new Error(r.error);
    const swept = r.events.find((e) => e.type === "UNITS_SWEPT");
    expect(swept && swept.type === "UNITS_SWEPT" ? swept.units : []).toHaveLength(p.sweep!.destroyed.length);
    expect(r.state.rngState).toBe(99);
    expect(combatOf(r.state).advances).toEqual([{ to: "M35", units: chosen }]);
  });
});

describe("purity and names", () => {
  const s = at7h(POSITIONS[0]!.units, 5);
  it("leaves the state untouched and gives the same preview whatever the dice are", () => {
    const frozen = JSON.stringify(s);
    const a = attackPreview(CTX, s, "M33", ["g1", "g2"]);
    expect(JSON.stringify(s)).toBe(frozen);
    expect(attackPreview(CTX, { ...s, rngState: 123456 }, "M33", ["g1", "g2"])).toEqual(a);
  });
  it("no text carries a raw unit id", () => {
    const named = at7h([unit("u94", "germany", "armor", 3, "N34"), unit("u95", "germany", "infantry", 2, "N34"), unit("u96", "germany", "infantry", 2, "M34"), unit("u12", "poland", "infantry", 2, "M35"), unit("u13", "poland", "air", 1, "M35")]);
    for (const chosen of [["u94", "u95"], ["u94", "u95", "u96"], ["u96"], []]) {
      const p = attackPreview(CTX, named, "M35", chosen);
      const text = JSON.stringify({ ...p, results: p.results.map(({ exchange: _x, ...r }) => r), attackers: p.attackers.map(({ id: _id, ...c }) => c), defenders: p.defenders.map(({ id: _id, ...d }) => d), nonDefenders: p.nonDefenders.map(({ id: _id, ...d }) => d) });
      expect(p.attackers.length).toBe(3);
      expect(text).not.toMatch(/\bu\d+\b/);
    }
  });
  it("a hex with a printed name leads with it, and the modifiers list is empty today", () => {
    const p = attackPreview(CTX, at7h([GER("g1", "M34"), POL("p1", "M35")]), "M35", ["g1"]);
    expect(p.targetName).toBe("Warsaw (M35)");
    expect(p.modifiers).toEqual([]);
  });
});

describe("a real game: the numbers and every subset hold at every step 7h the computer plays through", () => {
  it("plays both sides with the computer and checks each attackable hex at 7h", () => {
    const ctx = { ...CTX, scenario: SCENARIO_1939 };
    let state = newGame(SCENARIO_1939, 3);
    for (const a of autoSetup(ctx, state)) {
      const r = applyAction(ctx, state, a);
      if (!r.ok) throw new Error(r.error);
      state = r.state;
    }
    const memory = createMemory();
    let checked = 0;
    let lastKey = "";
    for (let n = 0; n < 6000 && state.phase === "player-turn" && checked < 12; n++) {
      const at7 = state.position?.part === "player-turn" && state.position.step === "7h";
      const key = `${state.year}-${state.season}-${state.activeSide}`;
      if (at7 && key !== lastKey && !combatOf(state).pending) {
        const targets = [...new Set(legalActions(ctx, state).flatMap((a) => (a.type === "ATTACK" ? [a.target] : [])))];
        if (targets.length > 0) lastKey = key;
        for (const target of targets) {
          const free = freeIds(attackPreview(ctx, state, target, []));
          const side = state.activeSide;
          for (const chosen of subsets(free.slice(0, 5))) {
            const shown = attackPreview(ctx, state, target, chosen);
            expect(shown.problems).toEqual([]);
            const r = applyAction(ctx, state, { type: "ATTACK", side, units: chosen, target });
            expect(r.ok, `${target} ${chosen.join()}: ${r.ok ? "" : r.error}`).toBe(true);
            if (!r.ok) continue;
            const e = resolvedOf(r.events);
            if (!shown.sweep) expect(e).toMatchObject({ attackFactors: shown.numbers!.attackFactors, defenseFactors: shown.numbers!.defenseFactors, multiplier: shown.numbers!.multiplier });
          }
          checked++;
        }
      }
      const choice = chooseAction(ctx, state, { seed: 3, memory });
      if (!choice) break;
      const r = applyAction(ctx, state, choice.action);
      if (!r.ok) throw new Error(r.error);
      state = r.state;
    }
    expect(checked).toBeGreaterThan(0);
  }, 120_000);
});

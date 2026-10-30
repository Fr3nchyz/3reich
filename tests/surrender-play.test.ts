import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { chooseAction } from "../src/ai";
import { chooseWithoutRedeploying } from "./helpers-redeploy";
import { ACCEPT_SURRENDER, chooseSurrender } from "../src/ai/surrender";
import { createMemory } from "../src/ai/memory";
import { applyAction, legalActions, replay, type Action } from "../src/engine/actions";
import type { GameEvent } from "../src/engine/action-types";
import { sideToAct } from "../src/engine/actor";
import { OPEN_SET_ACTIONS } from "../src/engine/attrition-step";
import { autoSetup } from "../src/engine/autosetup";
import type { GameContext } from "../src/engine/context";
import { newGame } from "../src/engine/game";
import { objectiveStandings } from "../src/engine/objectives";
import { surrenderAsking } from "../src/engine/soviet-record";
import { SUPPLY_EFFECTS_ENABLED } from "../src/engine/supply-effects";
import type { GameState } from "../src/engine/types";
import { evaluateVictory } from "../src/engine/victory";
import { winterAsking } from "../src/engine/winter-record";
import { MAP } from "../src/data/map";
import { runGame, type Hooks } from "../scripts/selfplay/runner";
import { SCENARIOS, type ScenarioKey } from "../scripts/selfplay/scenarios";
import { computerSide, computerTick, computerToMove } from "../src/ui/computerPlay";
import { conquestLine } from "../src/ui/conquestText";
import { SURRENDER_TEXT } from "../src/ui/endText";
import { eventSide } from "../src/ui/logSide";
import { createSession, type Session } from "../src/ui/session";
import { buttonLabels, statusHtml } from "../src/ui/statusView";
import { statusLine } from "../src/ui/watchBar";
import { createWatchInfo } from "../src/ui/watchController";
import { whereText } from "../src/ui/watchPlay";
import { asked, withoutRussianRebuilds } from "./helpers-surrender";
import { CTX } from "./helpers";

// Spec 14 ticket 14-15 (hazards 1 and 3 of the brief): whole computer games that reach Russia's offer to surrender and accept or refuse it. At every state of each game the legal
// list is not empty and exactly the right side acts; the computer never stalls at the new prompt; the recorded actions replay to the same state.
// Since spec 17 (ticket 17-1) the computer here never uses a Russian loss again, neither rebuilding it nor taking it in the Free Siberian Transfer (`withoutRussianRebuilds`, legal choices): with Russia rebuilding, no game reaches the offer.
// Spec 09 R9 keeps displaced planes alive: seeds 3 and 5 no longer offered surrender; with Attrition live (ticket 16-4 wiring) seeds 1 and 8 stopped offering, 5 and 15 started: the games below use 5, 10, 13 and 15, and 3 and 4 for no offer. Ticket 15-5 (conquered income) moved the games again: 10, 11, 15 and 26 offered (5 and 13 no longer did). Ticket 16-13 (the computer exploits) moved them once more: 8, 9, 10 and 20 offer now (11, 15 and 26 no longer do). Acceptance/refusal coverage uses other surrendering games; those two seeds are checked separately below.

type Choose = NonNullable<Hooks["choose"]>;

/** Looks at every state before the computer chooses (the runner calls the chooser once for every action it takes), then lets `policy` choose. */
function probing(policy: "accept" | "refuse", seen: { states: number; asked: number; sides: Set<string> }): Choose {
  return (ctx, state, cfg) => {
    seen.states++;
    const legal = legalActions(ctx, state);
    expect(legal.length, "legalActions is never empty in play").toBeGreaterThan(0);
    const asking = surrenderAsking(state);
    if (asking) {
      seen.asked++;
      expect(sideToAct(state)).toBe("axis");
      expect(legal.every((a) => a.type === "SURRENDER_ANSWER" && a.side === "axis")).toBe(true);
      expect(legal).toHaveLength(2);
      expect(state.activeSide).toBe("allies");
      expect(state.position).toMatchObject({ part: "player-turn", step: "10a" });
      const action = legal.find((a) => a.type === "SURRENDER_ANSWER" && a.accept === (policy === "accept"))!;
      return { action, why: policy };
    }
    expect(winterAsking(state) ? sideToAct(state) === "allies" : legal.some((a) => a.type === "SURRENDER_ANSWER")).toBe(winterAsking(state));
    seen.sides.add(sideToAct(state));
    return chooseWithoutRedeploying(ctx, withoutRussianRebuilds(state), cfg);
  };
}

const ctxOf = (scenario: ScenarioKey): GameContext => ({ map: MAP, scenario: SCENARIOS[scenario], supplyEffects: SUPPLY_EFFECTS_ENABLED });

const cache = new Map<string, ReturnType<typeof playNow>>();
const play = (scenario: ScenarioKey, seed: number, policy: "accept" | "refuse") => {
  const key = `${scenario}-${seed}-${policy}`;
  if (!cache.has(key)) cache.set(key, playNow(scenario, seed, policy));
  return cache.get(key)!;
};

function playNow(scenario: ScenarioKey, seed: number, policy: "accept" | "refuse") {
  const seen = { states: 0, asked: 0, sides: new Set<string>() };
  const run = runGame({ scenario, seed, turns: "end", verify: true }, { choose: probing(policy, seen) });
  const ctx = ctxOf(scenario);
  const events: GameEvent[] = [];
  let state = newGame(SCENARIOS[scenario], seed);
  const at: { offer?: number; answer?: number } = {};
  run.actions.forEach((a, i) => {
    const r = applyAction(ctx, state, a);
    if (!r.ok) throw new Error(`action ${i}: ${r.error}`);
    if (r.events.some((e) => e.type === "RUSSIA_OFFERS_SURRENDER")) at.offer = i;
    if (a.type === "SURRENDER_ANSWER") at.answer = i;
    events.push(...r.events);
    state = r.state;
  });
  return { run, ctx, events, state, seen, at };
}

describe.each([8, 9, 10, 20])("a whole computer game, 1939 seed %i, in which Russia offers to surrender", (seed) => {
  const accepted = play("1939", seed, "accept");
  it("ends normally with no anomaly, and the replay equals the final state", () => {
    expect(accepted.run.ended).toBe("game-over");
    expect(accepted.run.anomalies).toEqual([]);
    expect(accepted.state).toEqual(accepted.run.final);
    expect(replay(accepted.ctx, accepted.run.initial, accepted.run.actions).state).toEqual(accepted.run.final);
  });
  it("Russia offers exactly once; the very next action is the Axis answer, and the computer's constant policy accepts", () => {
    expect(accepted.events.filter((e) => e.type === "RUSSIA_OFFERS_SURRENDER")).toHaveLength(1);
    expect(accepted.seen.asked).toBe(1);
    expect(accepted.at.answer).toBe(accepted.at.offer! + 1);
    expect(accepted.run.actions[accepted.at.answer!]).toEqual({ type: "SURRENDER_ANSWER", side: "axis", accept: ACCEPT_SURRENDER });
    expect(ACCEPT_SURRENDER).toBe(true);
  });
  it("afterwards Russia is out: conquered by Germany by surrender, no Russian unit, no second offer, the 15s stopped", () => {
    const f = accepted.state;
    expect(f.nations.ussr.status).toBe("conquered");
    expect(f.conquests?.filter((c) => c.country === "ussr")).toEqual([expect.objectContaining({ by: "germany", how: "surrender" })]);
    expect(Object.values(f.units).filter((u) => u.owner === "ussr")).toEqual([]);
    expect(f.soviet?.offer).toBe("accepted");
    expect(accepted.events.filter((e) => e.type === "RUSSIA_BRPS_MOVED" && accepted.events.indexOf(e) > accepted.events.findIndex((x) => x.type === "RUSSIA_SURRENDERED"))).toEqual([]);
  });
  it("the result is consistent with the standings: the credited Objectives count for the Allies, and the counts add up to 42", () => {
    const f = accepted.state;
    const s = objectiveStandings(accepted.ctx, f);
    expect(s.axis.length + s.allies.length + s.nobody.length).toBe(42);
    for (const h of f.soviet!.credited!) expect(s.allies).toContain(h);
    expect(f.result!.objectives).toEqual({ axis: s.axis.length, allies: s.allies.length, nobody: s.nobody.length });
    expect(f.result).toEqual(evaluateVictory(accepted.ctx, { ...f, phase: "player-turn" }, "end-of-play"));
  });
  it("the right side acted at every state: only the Axis answered, at the one state that asked", () => {
    expect(accepted.seen.states).toBeGreaterThan(400);
    expect(accepted.seen.sides.has("axis") && accepted.seen.sides.has("allies")).toBe(true);
  });
});

describe("displaced planes change whole-game surrender outcomes (spec 09 R9)", () => {
  for (const seed of [3, 4]) {
    it(`1939 seed ${seed}: survives without a surrender offer, ends normally and replays`, () => {
      const g = play("1939", seed, "accept");
      expect(g.run.ended).toBe("game-over");
      expect(g.run.anomalies).toEqual([]);
      expect(g.events.filter((e) => e.type === "RUSSIA_OFFERS_SURRENDER")).toEqual([]);
      expect(g.state.nations.ussr.status).toBe("allied");
      expect(g.events.some((e) => e.type === "AIR_DISPLACED" && e.to !== null)).toBe(true);
      expect(replay(g.ctx, g.run.initial, g.run.actions).state).toEqual(g.run.final);
    });
  }
});

describe("the same games with the Axis refusing", () => {
  for (const seed of [10, 9]) {
    it(`1939 seed ${seed}: the offer is refused once, nothing is removed, no second offer, the game ends with no anomaly and replays`, () => {
      const g = play("1939", seed, "refuse");
      expect(g.run.anomalies).toEqual([]);
      expect(g.state).toEqual(g.run.final);
      expect(g.events.filter((e) => e.type === "RUSSIA_OFFERS_SURRENDER")).toHaveLength(1);
      expect(g.events.filter((e) => e.type === "SURRENDER_REFUSED")).toHaveLength(1);
      expect(g.state.soviet?.offer).toBe("refused");
      expect(g.state.nations.ussr.status).toBe("allied");
      expect(Object.values(g.state.units).some((u) => u.owner === "ussr")).toBe(true);
    });
  }
  it("the refused game differs from the accepted one at the answer and not before", () => {
    const a = play("1939", 10, "accept");
    const r = play("1939", 10, "refuse");
    const i = a.run.actions.findIndex((x, k) => JSON.stringify(x) !== JSON.stringify(r.run.actions[k]));
    expect(i).toBe(a.at.answer);
  });
});

describe("a refused game in which Russia is then wiped out (hazard 1, R7d)", () => {
  it("the computer plays on to the end of the game with nothing stuck; Russia is conquered by its last unit at the end of a Combat Phase", () => {
    const ctx = ctxOf("1939");
    const memory = createMemory();
    const seen: Action[] = [];
    let state = newGame(SCENARIOS["1939"], 10);
    for (const a of autoSetup(ctx, state)) state = (applyAction(ctx, state, a) as { state: GameState }).state;
    let wiped = false;
    let conquered: GameEvent | undefined;
    for (let i = 0; i < 3000 && state.phase === "player-turn"; i++) {
      const legal = legalActions(ctx, state);
      expect(legal.length).toBeGreaterThan(0);
      const decision = chooseWithoutRedeploying(ctx, withoutRussianRebuilds(state), { seed: 10, memory });
      expect(decision).not.toBeNull();
      const refuse = surrenderAsking(state) ? legal.find((x) => x.type === "SURRENDER_ANSWER" && !x.accept)! : null;
      const action = refuse ?? decision!.action;
      expect(OPEN_SET_ACTIONS.includes(action.type) || legal.some((x) => JSON.stringify(x) === JSON.stringify(action))).toBe(true); // the Attrition losses and occupation take any valid set (spec 16 C3)
      const r = applyAction(ctx, state, action);
      if (!r.ok) throw new Error(r.error);
      seen.push(action);
      conquered ??= r.events.find((e) => e.type === "COUNTRY_CONQUERED" && e.country === "ussr");
      state = r.state;
      if (!wiped && state.soviet?.offer === "refused") {
        // The Russian army inside Russia is wiped out (what a long war would do); one unit outside Russia is left.
        const keep = Object.values(state.units).find((u) => u.owner === "ussr" && MAP.hexes[u.at]?.country !== "ussr");
        state = { ...state, units: Object.fromEntries(Object.entries(state.units).filter(([, u]) => u.owner !== "ussr" || u.id === keep?.id)) };
        wiped = true;
      }
    }
    expect(wiped).toBe(true);
    expect(state.phase).toBe("game-over");
    expect(conquered).toMatchObject({ type: "COUNTRY_CONQUERED", country: "ussr", by: "germany", how: "last-unit" });
    expect(state.nations.ussr.status).toBe("conquered");
    expect(Object.values(state.units).some((u) => u.owner === "ussr")).toBe(false);
    expect(state.conquests?.filter((c) => c.country === "ussr")).toHaveLength(1);
    expect(state.result).toBeDefined();
  });
});

describe("another scenario (hazard 1)", () => {
  it("1942, where Russia is at war from the start: a whole game with the probe, no anomaly, and an offer (if any) is answered at the next action", () => {
    const g = play("1942", 1, "accept");
    expect(g.run.anomalies).toEqual([]);
    expect(g.at.offer === undefined ? 0 : g.at.answer! - g.at.offer).toBe(g.at.offer === undefined ? 0 : 1);
  });
});

describe("the computer's answer (src/ai/surrender.ts)", () => {
  const both: Action[] = [{ type: "SURRENDER_ANSWER", side: "axis", accept: false }, { type: "SURRENDER_ANSWER", side: "axis", accept: true }];
  it("takes the answer the constant says, whatever the order of the list, and says why", () => {
    const d = chooseSurrender(both)!;
    expect(d.action).toEqual({ type: "SURRENDER_ANSWER", side: "axis", accept: ACCEPT_SURRENDER });
    expect(d.why).toContain("accept");
  });
  it("takes the one answer that is there; nothing when no answer is asked", () => {
    expect(chooseSurrender([both[0]!])!.action).toEqual(both[0]);
    expect(chooseSurrender([{ type: "END_PLAYER_TURN", side: "axis" }])).toBeNull();
    expect(chooseSurrender([])).toBeNull();
  });
  it("chooseAction at the question answers it for either side's call, and the answer is on the legal list", () => {
    const s = asked();
    const d = chooseAction(CTX, s, { seed: 1, memory: createMemory() })!;
    expect(legalActions(CTX, s)).toContainEqual(d.action);
    expect(d.action.type).toBe("SURRENDER_ANSWER");
  });
});

describe("the browser (src/ui): the right side is asked and the words are plain", () => {
  const sessionAt = (state: GameState, human: "axis" | "allies"): Session => Object.assign(createSession(SCENARIO_1939, human, 1), { state });
  const q = asked();
  it("the human Axis are asked: the computer does not move, the two answers are buttons in words, the line says what is asked", () => {
    const s = sessionAt(q, "axis");
    expect(computerToMove(s)).toBe(false);
    const labels = buttonLabels(legalActions(s.ctx, s.state), s.ctx, s.state).map((b) => b.text);
    expect(labels).toEqual([SURRENDER_TEXT.accept, SURRENDER_TEXT.refuse]);
    const html = statusHtml(s, null, legalActions(s.ctx, s.state));
    expect(html).toContain(SURRENDER_TEXT.askLine);
    expect(html).not.toContain("SURRENDER_ANSWER");
    expect(html).not.toContain("Computer is playing");
    expect(html).not.toContain("player turn");
  });
  it("the human Allies, whose turn it is: the computer, playing the Axis, answers (it is not the human's move)", () => {
    const s = sessionAt(q, "allies");
    expect(computerToMove(s)).toBe(true);
    expect(computerSide(s)).toBe("axis");
    expect(statusHtml(s, null, [])).toContain(SURRENDER_TEXT.askLineComputer);
  });
  it("a computer tick answers at once, logs the reason, and the step moves on (no stall)", () => {
    const s = sessionAt(q, "allies");
    const before = s.log.length;
    expect(computerTick(s, 1e9)).not.toBe("stuck");
    expect(surrenderAsking(s.state)).toBe(false);
    expect(s.state.position).toMatchObject({ step: "10b" });
    expect(s.log.slice(before).some((l) => l.startsWith("Computer (Axis)") && l.includes("Russia"))).toBe(true);
  });
  it("two computers watching: the Axis are the side acting, and the watch text says so", () => {
    const s = sessionAt(q, "axis");
    s.watch = createWatchInfo(s.state, 0, "turbo", null);
    expect(computerToMove(s)).toBe(true);
    expect(computerSide(s)).toBe("axis");
    expect(statusLine(s)).toContain("Axis to move");
    expect(whereText(s)).toContain("Russian surrender");
  });
});

describe("the log lines", () => {
  const ctx = CTX;
  it("say the offer with its two sums, the answers, and the credited Objectives, in words", () => {
    expect(conquestLine(ctx, { type: "RUSSIA_OFFERS_SURRENDER", russian: 38, axis: 71 })).toBe("Russia offers to surrender: it has 38 ground and air factors on the map, and the Axis has 71 inside Russia. The Axis must accept or refuse.");
    expect(conquestLine(ctx, { type: "RUSSIA_SURRENDERED" })).toBe("The Axis accept Russia's surrender: Russia leaves the war.");
    expect(conquestLine(ctx, { type: "SURRENDER_REFUSED" })).toContain("refuse Russia's surrender");
    expect(conquestLine(ctx, { type: "OBJECTIVES_CREDITED", hexes: ["H47", "D44"] })).toBe("2 objectives now count for the Allies for good: Moscow (H47), Leningrad (D44).");
    expect(conquestLine(ctx, { type: "OBJECTIVES_CREDITED", hexes: ["H47"] })).toBe("1 objective now counts for the Allies for good: Moscow (H47).");
    expect(conquestLine(ctx, { type: "COUNTRY_CONQUERED", country: "ussr", by: "germany", how: "surrender", unitsRemoved: 1, hexesPassed: 0 })).toContain("land stays as it is");
  });
  it("go to the right side of the log", () => {
    expect(eventSide({ type: "RUSSIA_OFFERS_SURRENDER", russian: 1, axis: 2 }, "allies")).toBe("allies");
    expect(eventSide({ type: "SURRENDER_REFUSED" }, "allies")).toBe("axis");
  });
});

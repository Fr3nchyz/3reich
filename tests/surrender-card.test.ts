import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCENARIO_1939 } from "../src/data/scenario-1939";
import { SCENARIO_1942 } from "../src/data/scenario-1942";
import { SCENARIO_CAMPAIGN } from "../src/data/scenario-campaign";
import { applyAction, legalActions, type Action } from "../src/engine/actions";
import { conquestHalf, conquestIncome } from "../src/engine/conquest-income";
import { objectiveStandings } from "../src/engine/objectives";
import { surrenderAsking } from "../src/engine/soviet-record";
import { avoidOfferAt, offerSurrender, sovietOffer, SURRENDER_FACTOR_LIMIT, SURRENDER_RATIO, surrenderShortfall } from "../src/engine/soviet-surrender";
import type { GameState, Scenario, Side } from "../src/engine/types";
import { computerTick, computerToMove } from "../src/ui/computerPlay";
import { SURRENDER_TEXT, surrenderCreditedLine, surrenderEndsGameLine, surrenderIncomeLine, surrenderWarning } from "../src/ui/endText";
import { objectivesCard } from "../src/ui/objectivesCard";
import { sessionFromRecord } from "../src/ui/e2eLoad";
import { createSession, type Session } from "../src/ui/session";
import { takeAction } from "../src/ui/sessionActions";
import { statusHtml } from "../src/ui/statusView";
import { surrenderCard, surrenderCardHtml, surrenderWarningText } from "../src/ui/surrenderCard";
import { newWatchSession } from "../src/ui/watchPlay";
import { CTX, ctxFor } from "./helpers";
import { answer, asked, at9k, eventsOf, ger, IN, rus, sides } from "./helpers-surrender";

// Spec 14 ticket 14-16 (part D5): Russia's offer to surrender on the screen. The card of the Axis at step 10a (the engine's numbers, the two answers) and the
// construction warning of the Allies at step 8b ("N more factors", the shortfall of the very test that makes the offer). TODO(verify) V53.

/** The Allied Player Turn at step 8b with `r` Russian and `a` Axis factors (strength-4 counters, as `sides`), Russia at war with Germany. */
const at8b = (r: number, a: number, tweak: Partial<GameState> = {}): GameState => {
  const s = sides(r, a, tweak);
  return { ...s, position: { part: "player-turn", turn: 2, step: "8b" } };
};
const sessionAt = (state: GameState, human: Side): Session => Object.assign(createSession(SCENARIO_1939, human, 1), { state });
/** What the page draws: no buttons while the computer is the one to move, as main.ts does. */
const html = (s: Session) => statusHtml(s, null, s.state.phase === "player-turn" && !computerToMove(s) ? legalActions(s.ctx, s.state) : []);

describe("the shortfall: one formula for the offer and the warning", () => {
  it("the test is the old test: fewer than 50, and 3 to 2 (russian * 3 <= axis * 2), for every pair of sums", () => {
    for (let russian = 0; russian <= 130; russian++) {
      for (let axis = 0; axis <= 260; axis++) {
        expect(russian < avoidOfferAt(axis), `${russian} against ${axis}`).toBe(russian < SURRENDER_FACTOR_LIMIT && axis * 2 >= russian * 3);
      }
    }
  });
  it("avoidOfferAt is the smaller of the limit and one more than the ratio allows", () => {
    expect(SURRENDER_RATIO).toEqual({ axis: 3, russian: 2 });
    expect(avoidOfferAt(60)).toBe(41); // 60 Axis allow 40 Russian: 41 end the offer
    expect(avoidOfferAt(61)).toBe(41); // 40.67 -> 40
    expect(avoidOfferAt(63)).toBe(43);
    expect(avoidOfferAt(0)).toBe(1); // V51: 0 against 0 meets the test, 1 factor ends it
    expect(avoidOfferAt(75)).toBe(50); // the ratio would allow 50: the limit stops it at 49
    expect(avoidOfferAt(400)).toBe(50);
  });
  it("names the shortfall: 40 Russian against 60 Axis need 1 more; 20 against 80 need 30 (to reach 50)", () => {
    expect(surrenderShortfall(CTX, at8b(40, 60))).toBe(1);
    expect(surrenderShortfall(CTX, at8b(20, 80))).toBe(30);
    expect(surrenderShortfall(CTX, at8b(36, 60))).toBe(5);
  });
  it("with the number of factors added the offer is not made, with one fewer it is: for a whole table of positions", () => {
    for (const [r, a] of [[40, 60], [36, 60], [20, 80], [8, 12], [44, 68], [48, 100], [0, 4]] as const) {
      const state = at8b(r, a);
      const n = surrenderShortfall(CTX, state)!;
      expect(n, `${r} against ${a}`).toBeGreaterThanOrEqual(1);
      const grow = (k: number): GameState => {
        const units = { ...state.units };
        for (let i = 0; i < k; i++) units[`x${i}`] = rus(`x${i}`, IN[i % IN.length]!, 1);
        return { ...state, units };
      };
      expect(sovietOffer(CTX, grow(n)).offered, `+${n}`).toBe(false);
      expect(sovietOffer(CTX, grow(n - 1)).offered, `+${n - 1}`).toBe(true);
      expect(surrenderShortfall(CTX, grow(n))).toBeNull();
    }
  });
  it("the warning and the offer agree on every position of a grid: the offer follows exactly when there is a shortfall", () => {
    for (let r = 0; r <= 64; r += 4) {
      for (let a = 0; a <= 100; a += 4) {
        const state = at8b(r, a);
        const n = surrenderShortfall(CTX, state);
        const offer = offerSurrender(CTX, { ...state, position: { part: "player-turn", turn: 2, step: "10a" } });
        expect(n !== null, `${r} against ${a}`).toBe(offer.events.length === 1);
      }
    }
  });
  it("is null when the offer would not follow: the Axis turn, an offer made, the war off, a context without step 10a, sums that do not meet the test", () => {
    const state = at8b(40, 60);
    expect(surrenderShortfall(CTX, state)).toBe(1);
    expect(surrenderShortfall(CTX, { ...state, activeSide: "axis" })).toBeNull();
    for (const offer of ["asking", "accepted", "refused"] as const) expect(surrenderShortfall(CTX, { ...state, soviet: { citiesTaken: {}, offer } })).toBeNull();
    expect(surrenderShortfall(CTX, { ...state, wars: state.wars.filter(([x, y]) => !(x === "ussr" || y === "ussr")) })).toBeNull();
    expect(surrenderShortfall({ ...CTX, implementedSteps: new Set(["8b"]) }, state)).toBeNull();
    expect(surrenderShortfall(CTX, at8b(60, 60))).toBeNull(); // 60 Russian are not fewer than 50
    expect(surrenderShortfall(CTX, at8b(44, 60))).toBeNull(); // 60 is not 3 to 2 of 44
  });
});

describe("the construction warning on the screen", () => {
  it("says the shortfall at step 8b to a human Allied player, in the build panel", () => {
    const s = sessionAt(at8b(40, 60), "allies");
    expect(surrenderWarningText(s)).toBe("Russia will offer to surrender at the end of this turn unless it has 1 more ground or air factor on the map. Build Russian ground or air units to stop it.");
    const page = html(s);
    expect(page).toContain('class="surrender-warning"');
    expect(page).toContain("unless it has 1 more ground or air factor on the map");
    expect(page.indexOf("<h2>Construction</h2>")).toBeLessThan(page.indexOf("surrender-warning"));
    expect(page.lastIndexOf('<button data-build="')).toBeLessThan(page.indexOf("surrender-warning")); // under the build list: after every counter chip
    expect(surrenderWarning(12)).toContain("unless it has 12 more ground or air factors on the map");
  });
  it("appears only when it should: the Axis human, a watcher, another step, the Axis' turn, no war, an offer made, a test not met", () => {
    const state = at8b(40, 60);
    expect(surrenderWarningText(sessionAt(state, "allies"))).not.toBeNull();
    expect(surrenderWarningText(sessionAt(state, "axis"))).toBeNull(); // the computer builds for the Allies: nothing to read
    const watch = newWatchSession(SCENARIO_1939, 1, "turbo", 1);
    watch.state = state;
    expect(surrenderWarningText(watch)).toBeNull();
    for (const step of ["8a", "9a", "7h", "10a", "10b"]) expect(surrenderWarningText(sessionAt({ ...state, position: { part: "player-turn", turn: 2, step } }, "allies")), step).toBeNull();
    expect(surrenderWarningText(sessionAt({ ...state, activeSide: "axis" }, "allies"))).toBeNull();
    expect(surrenderWarningText(sessionAt({ ...state, wars: state.wars.filter(([x, y]) => !(x === "ussr" || y === "ussr")) }, "allies"))).toBeNull();
    expect(surrenderWarningText(sessionAt({ ...state, soviet: { citiesTaken: {}, offer: "refused" } }, "allies"))).toBeNull();
    expect(surrenderWarningText(sessionAt(at8b(60, 60), "allies"))).toBeNull();
    expect(surrenderWarningText(sessionAt({ ...state, phase: "game-over" }, "allies"))).toBeNull();
    expect(html(sessionAt(at8b(60, 60), "allies"))).not.toContain("surrender-warning");
  });
  it("falls as Russia builds and goes when the offer would not follow: a real BUILD of a Russian unit", () => {
    const base = at8b(40, 60);
    const state: GameState = { ...base, nations: { ...base.nations, ussr: { ...base.nations.ussr, brpTotal: 100, spendLimit: 60, spent: 0 } }, units: Object.fromEntries(Object.entries(base.units).filter(([, u]) => u.owner !== "ussr" || u.strength !== 4 || u.id > "r5")) };
    const s = sessionAt(state, "allies");
    const before = surrenderShortfall(s.ctx, s.state)!;
    const russianBuilds = legalActions(s.ctx, s.state).filter((a): a is Extract<Action, { type: "BUILD" }> => a.type === "BUILD" && a.owner === "ussr");
    expect(russianBuilds.length).toBeGreaterThan(0);
    const one = russianBuilds[0]!;
    takeAction(s, one);
    expect(s.toast).toBe("");
    const after = surrenderShortfall(s.ctx, s.state);
    expect(after === null ? 0 : after).toBe(Math.max(0, before - one.unit.strength));
    expect(surrenderWarningText(s) === null).toBe(after === null);
    if (after !== null) expect(surrenderWarningText(s)).toBe(surrenderWarning(after));
  });
  it("is not drawn at 8b of a game with no offer in sight (the opening of the 1939 scenario)", () => {
    const s = createSession(SCENARIO_1939, "allies", 1);
    expect(surrenderWarningText(s)).toBeNull();
  });
});

describe("the offer card (the model)", () => {
  it("gives the two sums of the test, the credited Objectives and the yearly BRPs, each from the engine", () => {
    const state = asked();
    const c = surrenderCard(CTX, state)!;
    const test = sovietOffer(CTX, state);
    expect(c.title).toBe("Russia offers to surrender");
    expect(c.facts[0]).toBe(`Russia has ${test.russian} ground and air factors on the map.`);
    expect(c.facts[1]).toBe(`The Axis has ${test.axis} inside Russia.`);
    expect(c.facts[2]).toBe("Russia offers because it has fewer than 50 and the Axis has at least 3 for every 2 of its own.");
    expect(c.accept.title).toBe("If you accept");
    expect(c.refuse.title).toBe("If you refuse");
    // The numbers are the ones acceptance then uses.
    const taken = answer(state, true);
    const credited = eventsOf(taken.events, "OBJECTIVES_CREDITED");
    expect(c.accept.lines).toEqual([
      SURRENDER_TEXT.leavesWar,
      surrenderCreditedLine(credited[0]?.hexes.length ?? 0),
      surrenderIncomeLine(conquestIncome(CTX, taken.state, "germany"), SCENARIO_1939.nations.ussr.brpTotal),
    ]);
    expect(conquestIncome(CTX, taken.state, "germany")).toBe(conquestHalf(SCENARIO_1939.nations.ussr.brpTotal));
    expect(c.refuse.lines).toEqual([SURRENDER_TEXT.refuseGoesOn, SURRENDER_TEXT.refuseOnce]);
  });
  it("the words: a singular and a plural, an empty list, BRP spelled out once", () => {
    expect(surrenderCreditedLine(1)).toBe("1 Objective counts for the Allies for good, whoever holds it later.");
    expect(surrenderCreditedLine(5)).toBe("5 Objectives count for the Allies for good, whoever holds them later.");
    expect(surrenderCreditedLine(0)).toBe("No Objective is credited to the Allies.");
    expect(surrenderIncomeLine(45, 90)).toBe("Germany receives 45 Base Resource Points (BRPs) a year from Russia, from the next Year Start Sequence. That is half of the 90 BRPs Russia began the scenario with.");
  });
  it("is only for a position where the Axis is asked", () => {
    expect(surrenderCard(CTX, at8b(40, 60))).toBeNull();
    expect(surrenderCard(CTX, answer(asked(), false).state)).toBeNull();
  });
  it("does not promise the Occupation Force, which the game does not apply yet", () => {
    const c = surrenderCard(CTX, asked())!;
    expect(JSON.stringify(c)).not.toMatch(/Occupation|45 factors|keep 45/);
  });
  it("the half is rounded down, as in the Year Start Sequence", () => {
    expect(conquestHalf(91)).toBe(45);
    const c = surrenderCard(ctxFor(), asked())!;
    expect(c.accept.lines[2]).toContain(`${Math.floor(SCENARIO_1939.nations.ussr.brpTotal / 2)} Base Resource Points`);
  });
});

describe("the sentence that accepting can end the Campaign at once", () => {
  const fell = (country: "britain" | "france") => ({ country, by: "germany", side: "allies", how: "capital", at: { year: 1940, season: "spring" } }) as const;
  const lines = (scenario: Scenario, tweak: Partial<GameState> = {}) => surrenderCard(ctxFor(scenario), asked(tweak, scenario))!.accept.lines;
  it("Campaign, Britain and France conquered: says the game ends at once, and the engine does end it, Axis Decisive", () => {
    const tweak = { conquests: [fell("britain"), fell("france")] };
    expect(lines(SCENARIO_CAMPAIGN, tweak)).toContain(surrenderEndsGameLine(true));
    expect(answer(asked(tweak, SCENARIO_CAMPAIGN), true, ctxFor(SCENARIO_CAMPAIGN)).state.result).toMatchObject({ winner: "axis", level: "decisive" });
    expect(surrenderEndsGameLine(true)).toBe("This ends the game at once: Britain and France are already conquered, so Russia is the third Allied Major Power to fall, and the Axis win a Decisive Victory.");
  });
  it("Campaign, fewer conquered: says it only happens with both, and the engine goes on", () => {
    for (const tweak of [{}, { conquests: [fell("france")] }]) {
      expect(lines(SCENARIO_CAMPAIGN, tweak)).toContain(surrenderEndsGameLine(false));
      expect(answer(asked(tweak, SCENARIO_CAMPAIGN), true, ctxFor(SCENARIO_CAMPAIGN)).state.phase).toBe("player-turn");
    }
    expect(surrenderEndsGameLine(false)).toBe("In the Campaign, accepting ends the game at once only if Britain and France are both already conquered. They are not, so the game would go on.");
  });
  it("no sentence in the other scenarios, where no conquest ends the game early", () => {
    for (const scenario of [SCENARIO_1939, SCENARIO_1942]) {
      const all = lines(scenario, { conquests: [fell("britain"), fell("france")] }).join(" ");
      expect(all).not.toContain("ends the game at once");
    }
  });
});

describe("the offer card on the screen", () => {
  it("a human Axis player is asked: the card, with the sums, the two consequences and the engine's two answers as buttons", () => {
    const s = sessionAt(asked(), "axis");
    expect(surrenderAsking(s.state)).toBe(true);
    expect(computerToMove(s)).toBe(false);
    const page = html(s);
    const card = page.slice(page.indexOf('<section class="surrendercard"'), page.indexOf("</section>", page.indexOf('<section class="surrendercard"')));
    expect(card).toContain('aria-labelledby="surrender-title"');
    expect(card).toContain('<h2 id="surrender-title" tabindex="-1">Russia offers to surrender</h2>');
    expect(card).toContain("If you accept");
    expect(card).toContain("If you refuse");
    const labels = [...card.matchAll(/<button data-action="(\d+)">([^<]*)<\/button>/g)].map((m) => [Number(m[1]), m[2]] as const);
    expect(labels.map((l) => l[1])).toEqual(["Accept Russia's surrender", "Refuse Russia's surrender"]);
    const actions = legalActions(s.ctx, s.state);
    expect(labels.map(([i]) => actions[i])).toEqual([
      { type: "SURRENDER_ANSWER", side: "axis", accept: true },
      { type: "SURRENDER_ANSWER", side: "axis", accept: false },
    ]);
    expect(page).toContain("Russia offers to surrender: the Axis accept or refuse"); // the turn line
    expect(page.match(/Accept Russia's surrender/g)).toHaveLength(1); // not repeated in the generic list
    expect(card).not.toMatch(/SURRENDER_ANSWER|ussr|\b[A-Z]\d{2}\b/); // names, no ids
    expect(page).not.toContain("surrender-warning");
  });
  it("a human Allied player is not asked: no card, the turn line says the computer answers, and the computer's answer moves the game on", () => {
    const s = sessionAt(asked(), "allies");
    expect(computerToMove(s)).toBe(true);
    const page = html(s);
    expect(page).not.toContain("surrendercard");
    expect(page).not.toContain("Accept Russia's surrender");
    expect(page).toContain("Russia offers to surrender: the computer, playing the Axis, answers");
    expect(surrenderCardHtml(s, "")).toBe("");
    for (let i = 0; i < 20 && surrenderAsking(s.state); i++) computerTick(s, 10_000);
    expect(surrenderAsking(s.state)).toBe(false);
    expect(s.state.soviet?.offer).toBe("accepted");
    expect(s.state.position).toMatchObject({ step: "10b" });
    expect(s.log.some((l) => l.startsWith("Computer (Axis)"))).toBe(true);
    expect(html(s)).not.toContain("surrendercard");
  });
  it("a watched game has no card either: two computers play", () => {
    const watch = newWatchSession(SCENARIO_1939, 1, "turbo", 1);
    watch.state = asked();
    expect(html(watch)).not.toContain("surrendercard");
    expect(html(watch)).toContain("the computer, playing the Axis, answers");
  });
  it("pressing an answer answers: Accept accepts and the card goes; Refuse refuses and the card goes", () => {
    for (const accept of [true, false]) {
      const s = sessionAt(asked(), "axis");
      const buttons = legalActions(s.ctx, s.state);
      takeAction(s, buttons.find((a) => a.type === "SURRENDER_ANSWER" && a.accept === accept)!);
      expect(s.state.soviet?.offer).toBe(accept ? "accepted" : "refused");
      expect(html(s)).not.toContain("surrendercard");
      expect(s.state.position).toMatchObject({ step: "10b" });
    }
  });
  it("the card is drawn only with its buttons, and is not drawn after the answer even with buttons", () => {
    const s = sessionAt(asked(), "axis");
    expect(surrenderCardHtml(s, "")).toBe("");
    expect(surrenderCardHtml(s, "<button>x</button>")).toContain("surrender-buttons");
    s.state = answer(s.state, true).state;
    expect(surrenderCardHtml(s, "<button>x</button>")).toBe("");
  });
});

describe("'Credited to the Allies for good' on the Objectives card", () => {
  it("marks exactly the credited Objectives after an acceptance, all counted for the Allies", () => {
    const taken = answer(asked(), true).state;
    const credited = taken.soviet!.credited!;
    expect(credited.length).toBeGreaterThan(0);
    const rows = objectivesCard(CTX, taken).fronts.flatMap((f) => f.rows);
    expect(rows.filter((r) => r.credited).map((r) => r.hex).sort()).toEqual([...credited].sort());
    for (const r of rows.filter((x) => x.credited)) expect(r.holder).toBe("Allies");
    const standings = objectiveStandings(CTX, taken);
    for (const hex of credited) expect(standings.allies).toContain(hex);
    const s = sessionAt(taken, "axis");
    s.objectivesOpen = true;
    const page = html(s);
    expect(page.match(/class="obj-credited">Credited to the Allies for good</g)).toHaveLength(credited.length);
    expect(page).toContain("Credited to the Allies for good. Show on the map."); // what a screen reader says
  });
  it("marks nothing before an acceptance or after a refusal", () => {
    for (const state of [asked(), answer(asked(), false).state, at9k([rus("r", IN[0]), ger("g", IN[5])])]) {
      expect(objectivesCard(CTX, state).fronts.flatMap((f) => f.rows).filter((r) => r.credited)).toEqual([]);
      const s = sessionAt(state, "axis");
      s.objectivesOpen = true;
      expect(html(s)).not.toContain("Credited to the Allies for good");
    }
  });
});

describe("both sides of a person in the same positions", () => {
  it("the card is for the Axis person at 10a and the warning for the Allied person at 8b, never the other way round", () => {
    for (const human of ["axis", "allies"] as const) {
      const page = html(sessionAt(asked(), human));
      expect(page.includes("surrendercard"), `10a, ${human}`).toBe(human === "axis");
      expect(page.includes("surrender-warning"), `10a, ${human}`).toBe(false);
      const eight = html(sessionAt(at8b(40, 60), human));
      expect(eight.includes("surrender-warning"), `8b, ${human}`).toBe(human === "allies");
      expect(eight.includes("surrendercard"), `8b, ${human}`).toBe(false);
    }
  });
  it("the Allied person can leave step 8b with the warning shown: nothing is stuck", () => {
    const state = at8b(40, 60);
    const left = applyAction(CTX, state, { type: "END_STEP", side: "allies", step: "8b" });
    expect(left.ok).toBe(true);
  });
});

describe("the recorded games for the browser tests (made by scripts/make-e2e-fixture.ts)", () => {
  type Fixture = { seed: number; actions: Action[]; shortfall?: number };
  const read = (name: string) => JSON.parse(readFileSync(`tests/e2e/fixtures/${name}.json`, "utf8")) as Fixture;
  it("surrender-question.json replays to step 10a with the Axis asked, and the card is drawn for a human Axis player", () => {
    const f = read("surrender-question");
    const s = sessionFromRecord(SCENARIO_1939, "axis", f.seed, f.actions);
    expect(surrenderAsking(s.state)).toBe(true);
    expect(html(s)).toContain("surrendercard");
  });
  it("surrender-build.json replays to step 8b of an Allied Player Turn with the warning's number as recorded", () => {
    const f = read("surrender-build");
    const s = sessionFromRecord(SCENARIO_1939, "allies", f.seed, f.actions);
    expect(s.state.position).toMatchObject({ part: "player-turn", step: "8b" });
    expect(s.state.activeSide).toBe("allies");
    expect(f.shortfall).toBeGreaterThan(1);
    expect(surrenderShortfall(s.ctx, s.state)).toBe(f.shortfall);
    expect(surrenderWarningText(s)).toBe(surrenderWarning(f.shortfall!));
    expect(legalActions(s.ctx, s.state).some((a) => a.type === "BUILD" && a.owner === "ussr")).toBe(true); // Russia can build, so the chip is there
  });
});

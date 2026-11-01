import { describe, expect, it } from "vitest";
import { capitalOf } from "../src/engine/capital";
import { newGame } from "../src/engine/game";
import type { GameEvent } from "../src/engine/action-types";
import type { GameState } from "../src/engine/types";
import { dutyChips, dutyWarning, interventionCards, wakeCards, minorConquestLine, nextYearStartCards } from "../src/ui/minorCards";
import { runYearStartSequence } from "../src/engine/yearstart";
import { sovietCityHexes } from "../src/engine/soviet";
import { CTX } from "./helpers";

const base = (): GameState => ({ ...newGame(CTX.scenario, 1), phase: "player-turn", activeSide: "axis", year: 1939,
  position: { part: "player-turn", turn: 1, step: "7h" }, countries: { belgium: { status: "attacked", attacker: "germany", duty: { by: "germany", declared: { year: 1939, season: "fall" } } } } });
const end = { type: "END_STEP", side: "axis", step: "7h" } as const;
const fall = { type: "COUNTRY_CONQUERED", country: "belgium", by: "germany", how: "capital", unitsRemoved: 0, hexesPassed: 1 } as const;
const wake = (minor: "finland" | "rumania", value: number, toPlace = true): GameEvent => ({ type: "MINOR_ALLY_WOKE", minor, value, toPlace, of: "germany", cause: "summer-1941" });

describe("minor card data (spec 15 D3–D6)", () => {
  it("R4/D3 keeps a red duty chip only for the declarer's side", () => {
    expect(dutyChips(base(), "axis")).toEqual([{ country: "belgium", by: "germany", text: "Belgium: enter or attack this turn", tone: "danger" }]);
    expect(dutyChips(base(), "allies")).toEqual([]);
    expect(dutyChips({ ...base(), countries: undefined }, "axis")).toEqual([]);
    expect(dutyChips({ ...base(), countries: { belgium: { status: "attacked" } } }, "axis")).toEqual([]);
  });
  it("R4/D3 warns at 7h and returns the unchanged confirmation action", () => {
    const m = dutyWarning(base(), end)!;
    expect(m.lines).toEqual(["You have not entered or attacked Belgium. If you end combat now the declaration is cancelled and you lose the 10 BRPs."]);
    expect(m.back.text).toBe("Go back");
    expect(m.confirm).toEqual({ text: "End combat", action: end });
    expect(m.countries).toEqual(["belgium"]);
  });
  it("R4/D3 never warns for another step, side, phase or cleared duty", () => {
    expect(dutyWarning(base(), { ...end, step: "7p" })).toBeNull();
    expect(dutyWarning(base(), { ...end, side: "allies" })).toBeNull();
    expect(dutyWarning({ ...base(), position: { part: "player-turn", turn: 1, step: "7p" } }, end)).toBeNull();
    expect(dutyWarning({ ...base(), phase: "setup" }, end)).toBeNull();
    expect(dutyWarning({ ...base(), countries: {} }, end)).toBeNull();
  });
  it("R4/D3 lists every unmet country in stable order", () => {
    const s = base();
    s.countries = { denmark: s.countries!.belgium, belgium: s.countries!.belgium };
    expect(dutyWarning(s, end)!.countries).toEqual(["belgium", "denmark"]);
  });
  it("R6/D3 presents only engine-confirmed Intervention", () => {
    expect(interventionCards([fall, { type: "MINOR_INTERVENED", minor: "belgium", by: "britain" }])).toEqual([{
      country: "belgium", by: "britain", text: "Moving here helps Belgium. Great Britain will fight beside it (Intervention).", log: "Great Britain intervenes in Belgium",
    }]);
    expect(interventionCards([])).toEqual([]);
  });
  it("R9/D5 totals actual partial wakes and asks only for unplaced armies", () => {
    const m = wakeCards([fall, wake("finland", 10), wake("rumania", 15, false)])[0]!;
    expect(m.value).toBe(25);
    expect(m.countries).toEqual(["finland", "rumania"]);
    expect(m.toPlace).toEqual(["finland"]);
    expect(m.text).toBe("Finland, Rumania join Germany. Germany gains 25 BRPs. Place their armies.");
    expect(m.buttons).toEqual([{ text: "Place automatically" }]);
    expect(wakeCards([])).toEqual([]);
  });
  it("R9/D5 Intervention wake with an existing army requests no duplicate placement", () => {
    const m = wakeCards([{ ...wake("finland", 10, false), cause: "intervention" } as GameEvent])[0]!;
    expect(m.buttons).toEqual([]);
    expect(m.text).not.toContain("Place their armies");
  });
  it("R7/R13/D4 names the minor capital and its recurring value", () => {
    expect(minorConquestLine(CTX, base(), fall)).toMatchObject({ by: "germany", value: 15, capital: "M25", text: "Germany gains 15 BRPs at each year start while it keeps Brussels." });
    expect(minorConquestLine(CTX, base(), { ...fall, by: "hungary" })!.by).toBe("germany");
    expect(minorConquestLine(CTX, base(), { ...fall, country: "france" })).toBeNull();
    expect(minorConquestLine(CTX, base(), { ...fall, country: "persia" })).toBeNull();
    expect(minorConquestLine(CTX, base(), wake("finland", 10))).toBeNull();
  });
  it("R13/D6 previews next year's YSS including a conquest completed this year", () => {
    const s: GameState = { ...base(), control: { M25: "germany" }, conquests: [{ country: "belgium", by: "germany", side: "allies", how: "capital", at: { year: 1939, season: "fall" } }] };
    const m = nextYearStartCards(CTX, s).find((c) => c.nation === "germany")!;
    expect(m.title).toBe("Next year start");
    expect(m.why).toBe("Why?");
    expect(m.lines).toContainEqual({ name: "belgium", value: 15, reason: "conquered" });
    expect(m.growth).toBe(0); // R13/D6 reuses the scenario's no-growth 1940 YSS.
    expect(m.total).toBe(m.base + 15);
  });
  it("R13/D6 agrees with engine lines and totals without mutating state", () => {
    const s = base();
    const before = structuredClone(s);
    const expected = runYearStartSequence(CTX, { ...s, year: 1940 });
    for (const card of nextYearStartCards(CTX, s)) {
      expect(card.total).toBe(expected.state.nations[card.nation].brpTotal);
      expect(card.base).toBe(expected.state.nations[card.nation].brpBase);
    }
    expect(nextYearStartCards(CTX, s)).toEqual(nextYearStartCards(CTX, s));
    expect(s).toEqual(before);
  });
  it("R13/D6 includes individual allies, Major Powers and Soviet cities in the fold-out", () => {
    const s: GameState = { ...base(), minorAllies: [{ owner: "rumania", of: "germany", active: true }],
      conquests: [{ country: "france", by: "germany", side: "allies", how: "capital", startingBrps: 85, at: { year: 1939, season: "fall" } }],
      control: { [capitalOf(CTX, "france")!]: "germany", ...Object.fromEntries(sovietCityHexes(CTX).map((h) => [h, "germany" as const])) } };
    const cards = nextYearStartCards(CTX, s);
    const m = cards.find((c) => c.nation === "germany")!;
    expect(m.lines).toContainEqual({ name: "rumania", value: 15, reason: "minor-ally" });
    expect(m.lines).toContainEqual({ name: "conquered Major Powers", value: 42, reason: "half their starting BRPs" });
    expect(m.lines).toContainEqual({ name: "Moscow and Leningrad", value: 30, reason: "held by the Axis" });
    expect(m.total).toBe(m.base + 87);
    expect(cards.find((c) => c.nation === "ussr")!.lines).toContainEqual({ name: "Moscow and Leningrad", value: -30, reason: "held by the Axis" });
  });

});

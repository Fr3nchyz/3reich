import type { ConquestWindow, LevelNeeds, ObjectiveTable, VictoryRules } from "../engine/victory-record";
import type { GameTurn } from "../engine/types";

/**
 * How each scenario is won (Ref 2.1 to 2.4; spec 14 R2). The numbers are facts from the game's own victory
 * list, written out here and checked by tests/victory-data.test.ts against a second copy of the table.
 * Objective counts are "at least this many"; the Stalemate of a table is whatever reaches no level.
 */

const needs = (marginal: number, tactical: number, decisive: number): LevelNeeds => ({ marginal, tactical, decisive });
const turn = (year: number, season: GameTurn["season"]): GameTurn => ({ year, season });

/** Ref 2.1: Allies 15, 16 or 17 Objectives; Axis 25, 26 or 27. */
const OBJECTIVES_1939: ObjectiveTable = { allies: needs(15, 16, 17), axis: needs(25, 26, 27) };
/** Ref 2.1 with the Free Siberian Transfer (Ref 11.63): the Allies need one more at each level. */
const OBJECTIVES_1939_SIBERIAN: ObjectiveTable = { allies: needs(16, 17, 18), axis: needs(25, 26, 27) };
/** Ref 2.2: Allies 26, 27 or 28; Axis 14, 15 or 16. */
const OBJECTIVES_1942: ObjectiveTable = { allies: needs(26, 27, 28), axis: needs(14, 15, 16) };
const OBJECTIVES_1942_SIBERIAN: ObjectiveTable = { allies: needs(27, 28, 29), axis: needs(14, 15, 16) };

export const VICTORY_1939: VictoryRules = { kind: "objectives", plain: OBJECTIVES_1939, siberian: OBJECTIVES_1939_SIBERIAN };
export const VICTORY_1942: VictoryRules = { kind: "objectives", plain: OBJECTIVES_1942, siberian: OBJECTIVES_1942_SIBERIAN };

/** Ref 2.3: the Game Turn in which Germany is conquered decides. There is no Stalemate. */
export const VICTORY_1944: VictoryRules = {
  kind: "germany-falls",
  windows: [
    { winner: "allies", level: "decisive", to: turn(1944, "winter") },
    { winner: "allies", level: "tactical", from: turn(1945, "spring"), to: turn(1945, "spring") },
    { winner: "allies", level: "marginal", from: turn(1945, "summer"), to: turn(1945, "summer") },
    { winner: "axis", level: "marginal", from: turn(1945, "fall"), to: turn(1945, "fall") },
    { winner: "axis", level: "tactical", from: turn(1945, "winter"), to: turn(1945, "winter") },
    { winner: "axis", level: "decisive", from: turn(1946, "spring"), to: turn(1946, "spring") },
  ],
};

const campaignWindows = (decisive: GameTurn, tactical: [GameTurn, GameTurn], marginal: [GameTurn, GameTurn]): ConquestWindow[] => [
  { winner: "allies", level: "decisive", to: decisive },
  { winner: "allies", level: "tactical", from: tactical[0], to: tactical[1] },
  { winner: "allies", level: "marginal", from: marginal[0], to: marginal[1] },
];

/** Ref 2.4: the Allies conquer the Axis by a date; if not, the Axis wins by conquering Allied Major Powers or by holding 28 Objectives when Winter 1943 ends. */
export const VICTORY_CAMPAIGN: VictoryRules = {
  kind: "campaign",
  plain: campaignWindows(turn(1944, "summer"), [turn(1944, "fall"), turn(1944, "winter")], [turn(1945, "spring"), turn(1945, "summer")]),
  siberian: campaignWindows(turn(1944, "spring"), [turn(1944, "summer"), turn(1944, "fall")], [turn(1944, "winter"), turn(1945, "spring")]),
  axis: { marginal: { objectives: 28, at: turn(1943, "winter") }, tacticalPowers: 2, decisivePowers: 3 },
};

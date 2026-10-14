import { SCENARIO_1939 } from "../../src/data/scenario-1939";
import { SCENARIO_1942 } from "../../src/data/scenario-1942";
import { SCENARIO_1944 } from "../../src/data/scenario-1944";
import { SCENARIO_CAMPAIGN } from "../../src/data/scenario-campaign";
import type { Scenario } from "../../src/engine/types";

/** The four scenarios by the name used on the command line. */
export const SCENARIOS = { "1939": SCENARIO_1939, campaign: SCENARIO_CAMPAIGN, "1942": SCENARIO_1942, "1944": SCENARIO_1944 } as const satisfies Record<string, Scenario>;
export type ScenarioKey = keyof typeof SCENARIOS;
export const SCENARIO_KEYS = Object.keys(SCENARIOS) as ScenarioKey[];

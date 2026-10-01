import type { Nation, NationStatus, PowerId, Scenario } from "../engine/types";

const nation = (id: PowerId, status: NationStatus, brp: number, growthRate: number): Nation => ({
  id,
  status,
  brpBase: brp,
  brpTotal: brp,
  growthRate,
});

/**
 * 1939 scenario. Source: Ops 9.0 ("1939 SCENARIO"); BRPs, growth rates and statuses
 * match the in-game status screen. Duration Fall '39 - Summer '42; the Axis moves
 * first; Italy, the USSR and the USA start neutral.
 */
export const SCENARIO_1939: Scenario = {
  id: "1939",
  name: "1939 Scenario",
  start: { year: 1939, season: "fall" },
  end: { year: 1942, season: "summer" },
  firstSide: "axis",
  nations: {
    france: nation("france", "allied", 85, 30),
    britain: nation("britain", "allied", 125, 40),
    usa: nation("usa", "neutral", 270, 60),
    ussr: nation("ussr", "neutral", 90, 30),
    germany: nation("germany", "axis", 150, 50),
    italy: nation("italy", "neutral", 75, 20),
  },
};

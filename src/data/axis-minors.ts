import type { NationSetup } from "../engine/types";
import { air, inf, nationSetup } from "./counters";

/**
 * The four Axis Minor-Allies that start active in the 1942 and 1944 scenarios. Pools are printed
 * on each scenario page and match the Minor Country Forces chart; none may build "other than
 * losses". Setup areas come from Ref 17.3.
 */
export function axisMinorSetups(scenario: "1942" | "1944") {
  return {
    finland: nationSetup({
      controlledAtStart: ["finland"],
      // "Finnish units may start the 1942 scenario only in Finland and/or hexes A47 and B46. In the 1944 scenario they may start only in Finland."
      mayAlsoSetUpIn: scenario === "1942" ? [{ areas: [{ kind: "hex", id: "A47" }, { kind: "hex", id: "B46" }], axisControlled: true }] : [],
      forcePool: [inf(2, 3, 5), air(1, 4, 1)],
      allowableBuilds: [],
    }),
    rumania: nationSetup({
      controlledAtStart: ["rumania"],
      mayAlsoSetUpIn: [{ areas: [{ kind: "country", id: "yugoslavia" }, { kind: "zone", id: "eastern-europe" }, { kind: "country", id: "ussr" }], axisControlled: true }],
      forcePool: [inf(2, 3, 2), inf(1, 3, 6), air(1, 4, 1)],
      allowableBuilds: [],
    }),
    bulgaria: nationSetup({
      controlledAtStart: ["bulgaria"],
      mayAlsoSetUpIn: [{ areas: [{ kind: "country", id: "yugoslavia" }, { kind: "country", id: "greece" }, { kind: "zone", id: "european-turkey" }], axisControlled: true }],
      forcePool: [inf(1, 3, 4), air(1, 4, 1)],
      allowableBuilds: [],
    }),
    hungary: nationSetup({
      controlledAtStart: ["hungary"],
      mayAlsoSetUpIn: [
        { areas: [{ kind: "country", id: "yugoslavia" }, { kind: "zone", id: "eastern-europe" }, { kind: "country", id: "poland" }, { kind: "country", id: "ussr" }], axisControlled: true },
      ],
      forcePool: [inf(2, 3, 1), inf(1, 3, 6), air(1, 4, 1)],
      allowableBuilds: [],
    }),
  } satisfies Record<string, NationSetup>;
}

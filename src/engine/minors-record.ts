import type { ColonyId, Conquest } from "./conquest-record";
import { MINOR_COUNTRIES, AXIS_MINOR_ALLIES } from "./minors-ids";
import type { GameTurn, MinorAlly, MinorCountry, PowerId, Side } from "./types";

/** Spec 15 C1: local types until the later state-integration ticket. */
export type CountryId = MinorCountry | ColonyId | "eastern-europe";

/** Spec 15 C1; conquest is recorded separately by spec 14, never as a status here. */
export interface CountryRecord {
  status: "neutral" | "attacked" | "allied";
  /** R3/R6: declarer; the defending army fights on the other side. */
  attacker?: PowerId;
  /** R3: side still required to place the army at step 2. */
  toPlace?: Side;
  /** R4: entry or attack still owed on the declaration's Game Turn. */
  duty?: { by: PowerId; declared: GameTurn };
  /** R6/R13: helping powers in order of Intervention (MC19). */
  helpers?: PowerId[];
  /** R10: powers barred after a Garrison revokes their declaration. */
  closedTo?: PowerId[];
  /** R11: Persia's Lend-Lease route is open. */
  opened?: true;
}

/** Spec 15 C1: optional so a saved state predating minor records remains readable. */
export interface MinorCountryState {
  countries?: Partial<Record<CountryId, CountryRecord>>;
  conquests?: readonly Conquest[];
}

/** Spec 15 R9/C1, Ops 9.0: fresh data only; no scenario or game is changed here. */
export function initialMinorRecords(scenarioId: "1939" | "campaign"): {
  countries: Partial<Record<CountryId, CountryRecord>>;
  minorAllies: MinorAlly[];
} {
  // Both opening scenarios have identical minor-country conditions (spec 15 C1).
  void scenarioId;
  return {
    // Poland's army was placed in setup: no placement or declaration duty is pending (C1).
    countries: { poland: { status: "attacked", attacker: "germany" } },
    minorAllies: AXIS_MINOR_ALLIES.map((owner) => ({ owner, of: "germany", active: false })),
  };
}

/**
 * Spec 15 C1: fallback ONLY after explicit control and scenario start control have been checked.
 * A fighting minor controls its own land, unless spec 14 records its conquest. Sleeping allies,
 * colonies and Eastern Europe do not gain control from this function (R9/R10/R12).
 */
export function derivedMinorControl(state: MinorCountryState, country: string | undefined): MinorCountry | null {
  if (!MINOR_COUNTRIES.includes(country as MinorCountry)) return null;
  const minor = country as MinorCountry;
  const record = state.countries?.[minor];
  if (record?.status !== "attacked" && record?.status !== "allied") return null;
  if (state.conquests?.some((c) => c.country === minor)) return null;
  return minor;
}

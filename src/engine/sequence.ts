/**
 * The Sequence of Play, as printed on the reference map card and in Ops 5.0. This is the spine
 * the phase machine hangs rules on: a step is only played by the engine once its rules are
 * implemented (see docs/RULES.md "Sequence of play"), but the order and names are fixed here.
 */

export interface SequenceStep {
  /** Card numbering: "1".."10" for a Player Turn step, "6a" for a sub-step. */
  id: string;
  title: string;
  /** Section of the Operations Manual that describes it (5.41 ... 5.49, with the card's letter). */
  ops: string;
  steps?: readonly SequenceStep[];
}

/** "Conduct Year Start Sequence (YSS) between each Winter and Spring Game Turn" (Ops 6.0). */
export const YEAR_START_SEQUENCE: readonly { id: string; title: string; exceptAtScenarioStart: boolean }[] = [
  { id: "A", title: "Resolution of Strategic Warfare", exceptAtScenarioStart: true },
  { id: "B", title: "Calculation of initial BRP Totals", exceptAtScenarioStart: true },
  { id: "C", title: "Construct Strategic Warfare factors", exceptAtScenarioStart: false },
];

/** Steps of a Game Turn before and after the two Player Turns (card II.A, II.B). */
export const GAME_TURN_STEPS: readonly { id: string; title: string; ops: string }[] = [
  { id: "II.A", title: "Possible Russian-Winter Die Roll", ops: "5.2" },
  { id: "II.B", title: "Determination of Player-Turn Order", ops: "5.3" },
];

/**
 * One Player Turn, steps 1-10 (card II.C; the second Player Turn, II.D, repeats them). The
 * Operations Manual numbers them 5.41-5.49 (step 2 is 5.41a, 5.44 is voluntary destruction).
 */
export const PLAYER_TURN_STEPS: readonly SequenceStep[] = [
  { id: "1", title: "Make Declarations of War (DoW)", ops: "5.41" },
  {
    id: "2",
    title: "Set up forces of newly attacked minor countries; activate Minor-Allies; set up forces of newly activated Minor-Allies",
    ops: "5.41a",
  },
  { id: "3", title: "Select Front Options", ops: "5.42" },
  { id: "4", title: "Movement and Combat Phases of minor countries that have been attacked but not yet conquered", ops: "5.43" },
  { id: "5", title: "Voluntary destruction of units", ops: "5.44" },
  {
    id: "6",
    title: "Movement Phase",
    ops: "5.45",
    steps: [
      { id: "6a", title: "Possible movement of German air/naval units between Norway and the Murmansk-Convoy Box", ops: "5.45a" },
      { id: "6b", title: "Conduct normal fleet-movement", ops: "5.45b" },
      { id: "6c", title: "Designate air/naval Interceptions and Counter-Interceptions", ops: "5.45c" },
      { id: "6d", title: "Resolve (Counter-) Interceptions", ops: "5.45d" },
      { id: "6e", title: "Check supply, and designate supply fleets", ops: "5.45e" },
      { id: "6f", title: "Conduct normal ground/air movement", ops: "5.45f" },
      { id: "6g", title: "Elimination of overstacked units", ops: "5.45g" },
      { id: "6h", title: "Possible Eastern-Front factor check", ops: "5.45h" },
    ],
  },
  {
    id: "7",
    title: "Combat Phase",
    ops: "5.46",
    steps: [
      { id: "7a", title: "Resolve any/all Attrition Combat (the Phasing Player may opt to perform it before or after Offensive-Option Combat)", ops: "5.46a" },
      { id: "7b", title: "Designate Offensive Naval/Air Missions", ops: "5.46b" },
      { id: "7c", title: "Resolve Counter-Air attacks", ops: "5.46c" },
      { id: "7d", title: "Designate Defensive Air Support (DAS) and air/naval Interceptions of Offensive Naval Missions", ops: "5.46d" },
      {
        id: "7e",
        title: "Designate DAS Interceptions and air/naval Counter-Interceptions; all (Counter-) Interceptions are then resolved",
        ops: "5.46e",
      },
      { id: "7f", title: "Landing of Sea-Transported units", ops: "5.46f" },
      { id: "7g", title: "Conduct normal Airdrops", ops: "5.46g" },
      { id: "7h", title: "Resolve normal ground combat", ops: "5.46h" },
      { id: "7i", title: "Resolve air attacks on naval bases", ops: "5.46i" },
      { id: "7j", title: "Conduct Exploitation movement", ops: "5.46j" },
      { id: "7k", title: "Designate Exploitation Ground-Support", ops: "5.46k" },
      { id: "7l", title: "Designate Exploitation Defensive-Air-Support (DAS)", ops: "5.46l" },
      { id: "7m", title: "Conduct Exploitation DAS-Interceptions", ops: "5.46m" },
      { id: "7n", title: "Conduct Exploitation Airdrops", ops: "5.46n" },
      { id: "7o", title: "Resolve Exploitation combat", ops: "5.46o" },
      { id: "7p", title: 'Resolve all Attrition Combat not resolved in step "7a" above', ops: "5.46p" },
    ],
  },
  {
    id: "8",
    title: "Unit-Construction Phase",
    ops: "5.47",
    steps: [
      { id: "8a", title: "Possible Free Siberian Transfer", ops: "5.47a" },
      { id: "8b", title: "Construct units", ops: "5.47b" },
      { id: "8c", title: "Possible Vichy Activation/Deactivation attempt", ops: "5.47c" },
    ],
  },
  {
    id: "9",
    title: "Strategic Redeployment Phase",
    ops: "5.48",
    steps: [
      { id: "9a", title: "Designate BRP Grants", ops: "5.48a" },
      { id: "9b", title: "Make Lend-Lease Grants", ops: "5.48b" },
      { id: "9c", title: "Make Murmansk-Convoy Grants, and designate escorting-fleets/ASW", ops: "5.48c" },
      { id: "9d", title: "Move Allied ASW from Murmansk Box (Spring turns)", ops: "5.48d" },
      { id: "9e", title: "SR units", ops: "5.48e" },
      { id: "9f", title: "Check supply, and designate supply fleets", ops: "5.48f" },
      { id: "9g", title: "Elimination of unsupplied units", ops: "5.48g" },
      { id: "9h", title: "Relocation/elimination of unsupplied airbases", ops: "5.48h" },
      { id: "9i", title: "Elimination of certain bridgeheads", ops: "5.48i" },
      { id: "9j", title: "Elimination of overstacked units", ops: "5.48j" },
      { id: "9k", title: "Possible Eastern-Front factor check", ops: "5.48k" },
    ],
  },
  {
    id: "10",
    title: "End-of-Player-Turn Phase",
    ops: "5.49",
    steps: [
      { id: "10a", title: "Possible Russian surrender", ops: "5.49a" },
      { id: "10b", title: "Save-Game prompt", ops: "5.49b" },
    ],
  },
];

/** Every step id of a Player Turn in play order, sub-steps in place of the phases that have them. */
export function playerTurnStepIds(): string[] {
  return PLAYER_TURN_STEPS.flatMap((s) => (s.steps ? s.steps.map((x) => x.id) : [s.id]));
}

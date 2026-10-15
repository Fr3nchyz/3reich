# Play-test feedback log

What real players said, what we make of it, and what we do. Newest first. Feedback is input to check, never a rules source: a rule question raised here goes to `docs/RULES.md` as a `TODO(verify)` until the PC manual or the original game settles it.

## 2 (2026-10-14): the player (Frank), on iPad, then clarified

**Who and how.** Prefers to communicate in French, but the English game is fine for now. Prefers the **iPad** (he plays Panzer Corps there); has not played our version on a tablet yet. Favourite scenario: **the Campaign**. Plays the original DOS game, so he knows the BRP sequence and recognised it. Overall: "très bon début", impressive.

**What he tried and what went wrong.**

| He said | What it means | Planned fix |
|---|---|---|
| Cannot enlarge the map and make the hexagons bigger for a better view of the countries. | Pinch and wheel zoom exist but are not discoverable, and may not behave on iPad; the hexes stay small. | Visible zoom buttons (+, -, fit), double-tap, higher maximum zoom, labels that stay readable; test with iPad-sized touch emulation. |
| Took Poland: first attack worked, but **in later turns could no longer attack Warsaw** (clarified: not about two attacks in one turn). | Unknown cause. The engine has no rule that blocks it; likely a UI or step-flow problem, or the attackers were no longer next to Warsaw. | Reproduce with a scripted human-like game over several turns (move next to Warsaw, attack, end turn, repeat), find the cause, fix, add a regression test. |
| For an attack you must know the coordinates of the unit you attack. | Attacks are buttons labelled with unit ids. | Tap-to-attack: tap your stack, enemy hexes it can attack are highlighted, tap one, see the odds, confirm. |
| Cannot see the detail of the 4 Polish units defending Warsaw. | No unit inspector. | Tap any hex to list its units (type, factors, nationality, moved/attacked), and show attackers and defenders in the attack panel. |
| Two units on a hex stay grouped when moving. | The tap flow moves the whole stack. | Pick which units of a stack move before choosing the destination. |
| Could not use air factors. | Air units are not built yet (movement, air support, bases). | Spec, then build (roadmap 6.4). |
| Built and placed units fine. | Works. | None. |

**Diagnosis: why Warsaw could no longer be attacked (found with `tests/warsaw-playtest.test.ts`, fixed in this branch).**
- Warsaw (M35) starts with **4 Polish counters: 2 infantry and 2 air units**. A ground attack only fights ground units. The first attack killed the 2 infantry; the 2 air units stayed.
- From then on the engine had no way to touch the hex: `defendersAt` counts only ground units, so no ATTACK was listed (and with nothing to attack the 7h step was skipped, so the player saw nothing); a move cannot enter an enemy-occupied hex; and the advance after combat is offered only when the hex is empty. German stacks stood next to Warsaw for turns with no button, which is exactly "I can no longer attack Warsaw". The 4 units he could not inspect were these.
- Ruled out by the scripted game (human Axis through `legalActions`/`applyAction`, computer Allies, 1939 and Campaign, 6+ Game Turns, two seeds): the combat record resets every Player Turn (key `year-season-side`); Poland stays at war; hexsides around Warsaw are crossable (rivers); the 7h step is reached whenever an attack exists; attack buttons are not truncated or grouped away (one button per legal action, 4 for Warsaw: all attackers, and each source hex alone).
- Fix: `ALONE_NONGROUND_DESTROYED` (attack-rules.ts; **confirmed by Amaury (product owner), not yet checked against the PC manual**): air units, fleets and airbases with no enemy ground unit in the hex are destroyed when a battle removes the last ground defenders, and an attack on a hex holding only such counters is listed and destroys them with no die roll; attackers may then advance. The computer takes that free attack. Set the constant false to go back to "they stay and block the hex". Side effect still to settle (TODO(verify)): one infantry can wipe an ungarrisoned port's air units and fleets with no roll (the computer can do it to the human's), so a rule on rebasing or capture is probably needed. The log says it in one line ("Warsaw (M35): 2 air units alone in the hex are destroyed (...)"); the event is `UNITS_SWEPT` and the roll-free attack is `COMBAT_RESOLVED` with `sweep: true`.
- UI, still open (tap-to-attack and unit inspector are planned): attack buttons say only "Attack M35 with u94, u95", with no place name and no defenders.

**Amaury's own notes.** Has not played the game much, so hard to test and to ask for improvements. Online rule and set-up information is thin; the set-ups are about 80% from the DOS game and partly from the board game. Wants honest feedback.

**How we will keep learning from Frank**
- A "Send feedback" button that saves the game record (the action list) with a note, so a reported problem can be replayed exactly.
- A short play-test card: five things to try in ten minutes and what to report. Frank prefers to communicate in French, so the card can be written in French; the game itself stays English for now (a French interface is not a priority).
- Questions for him (rules): do friendly units cancel enemy Zones of Control, and does every ground unit exert one or only armor; can an unsupplied unit still attack; what happens to unused BRPs at each Year Start; can a hex be attacked more than once per turn; who holds Greek hex EE27 in 1942; six factors at Leningrad and Moscow each or in total; Libya's setup limit.

## 1 (2026-10-14): Amaury, desktop (MacBook), two full games

- Turns can be taken end to end.
- The map should stay in view while using the panels. Done (#42, #44).
- The log should show the newest action first and keep its place. Done (#42, #44).
- Hexes look confusing where land hexes are separated by water (for example Italy and Albania). Water edges drawn (#45).
- Still not as clear as the board photo or the DOS screen. Open: stronger country borders and colours, clearer coasts; wait for Frank's view.

## 2 (2026-10-15): Amaury, desktop, a short try-out

- The zoom buttons work. The target button did nothing visible. Fixed (#63): it now centres on a tapped hex, or shows a message when nothing is selected.
- The log should be colour coded: red for Axis, blue for Allies. Done (#63), with a solid or dashed bar as a second cue.

## Follow-ups found by independent reviews (open, small)

- The advance card is cramped on a phone-width screen (Stay wraps under Advance; the sticky footer covers the second loss option until you scroll).
- `lossOptions` accepts only the loss sets the engine lists (at most 100); a very large stack with many equivalent sets could hide a legal one. Add a fallback or a note.
- The "nothing selected" note also shows on the computer's turn and at step 3, where nothing can be chosen; on the smallest landscape phone screen it hides the refused-move line for 4 seconds.
- A test is missing for "the computer attacks and the human chooses the losses" (the case works in a trial).
- A stack cannot be moved onto one of your own stacks that has not moved yet, because tapping it re-chooses it (seen in 1942, Buerat armor to Tripoli).
- "These units cannot get there together" is plural for a one-unit stack and misleading on an enemy hex (spec 10, ticket 10-7).
- The engine has no "decline the advance" action; Stay only hides the card.
- A manual pass of the loss-choice cards and the move card on a real iPad is still to do.

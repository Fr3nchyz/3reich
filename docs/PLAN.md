# Plan: what is left, ticket by ticket

Written 2026-10-17 from the specs (09, 11, 12), `docs/ROADMAP.md` and `docs/PROGRESS.md`. This is the page to track progress on. The tickets themselves live in the specs; this page lists them with a size and a status. When a ticket merges, its row here moves to "Done".

## How to read it

**Size** is the spec's own scale: **S** under half a day of work, **M** about a day, **L** more than a day. It measures effort, not calendar time. What the calendar does depends mostly on review rounds, the 13-minute CI wait on every push, and usage limits.

**Rough pace, measured this session:** about 11 pull requests merged in about 13 hours of wall time, including the CI waits and one usage-limit pause. That is about one M ticket per 1 to 2 hours when nothing blocks. The tickets that have a spec add up to 47 (12 air, 22 fleets, 13 save and load); at that pace expect somewhere between 50 and 90 hours. Treat that as plus or minus half. Rules that have no spec yet (section D) are not in that number.

**Status:** Done (merged), Next (can start now), Waits (needs another ticket, or an answer from you).

## Where we are

The ground war is playable on the iPad: set up, declare war, build, grants, move (choosing units of a stack), attack with an odds preview, losses, advance. Air support in attacks works. The computer plays either side and can play itself. A game now ends with a result (an Objectives count at the last turn, shown in watch mode and in self-play, not yet on the player's screen, ticket 14-4), but a country cannot be conquered yet, nothing is saved, and fleets, supply penalties, minor countries, strategic warfare and surrender are not built. Roughly 40 percent of a complete game exists (a judgement, not a measurement).

**Fleets so far (updated 2026-10-21).** Tickets 12-0 to 12-4 are built: port facts and sea routes, the naval record, the rules of sea supply, the designation action at steps 6e and 9f, and now a fleet in a captured port moves to the nearest friendly port with room (and Malta, Suda Bay and Famagusta hold 9). Supply penalties are still off, so only the last is visible in play: a fleet is no longer destroyed when its port is taken, and the automatic setups of 1942 and 1944 no longer put 18 and 36 naval factors in Malta. Next: 12-5, 12-6, 12-8, then the gate 12-7. Save and load stays blocked until the playtest. **Is it playable?** Yes: the guide `docs/PLAYTEST-FR.md` describes what to try.

## Two milestones

**Beta** (the next goal): the 1939 scenario against the computer, start to finish, on the iPad, with saves. It has the ground war, air support in attacks, supply by sea (fleets Release I) with supply penalties switched on, the rules in section D (victory and surrender, minor countries, attrition, and so on), save and load, and a computer that defends its capital and does not stall. No naval combat and no air missions beyond ground support.

**Release 1** (the full specified game) is Beta plus: the air missions (counter-air 09-9, defensive air support 09-8, its interception 09-10, airdrops 09-11, the computer's air 09-12 and the cards 09-15), fleet movement and interception (fleets Releases II to IV), and a stronger and weaker computer. The French interface and the map clarity pass come after.

In the tables below, everything is Beta except those Release 1 items. Decided by the owner on 2026-10-17.

---

## A. Air units (spec 09)

| Ticket | What it gives you | Size | Status |
|---|---|---|---|
| 09-1 Bases and range queries | where planes may base and reach | M | Done |
| 09-2 Air record and airbases | three movable airbases per Major Power | M | Done |
| 09-3 Staging | planes change base at step 6f | M | Done |
| 09-4 Partial units | split and combine air counters | S | Done |
| 09-6 Air combat resolver | the pure dice and losses logic | S | Done |
| 09-7 Ground support | planes add to an attack's odds and share its losses | M | Done |
| 09-14 first slice | step 7b on the screen, air counted in the attack card | L | Done |
| 09-14 rest | choose individual planes at 7b, the attack card lists them | M | Done |
| 09-13 UI 1: planes on the map | select a plane, see range and bases, rebase, place an airbase, split and join from the screen | M | Done |
| 09-16 Layout and browser pass | phone and iPad sizes, an air browser test | M | Done |
| 09-0 Check constants against the game | ranges, caps, sizes, Malta | S | Waits: needs your game folder |
| 09-5 Capture of a base | planes in a captured hex fly to the nearest friendly base within 8 hexes, and are lost only if there is none; airbases go to their Capital (decision D1, taken 2026-10-15) | M | Next |
| 09-9 Counter-air | planes fight planes before the ground attack | M | Next |
| 09-8 Defensive air support | the defender's planes help at step 7d | M | Waits for 09-9 |
| 09-10 DAS interception | the attacker's planes meet them (step 7e) | M | Waits for 09-8 |
| 09-11 Airdrops | paratroops at step 7g | M | Next |
| 09-12 Computer: air | the computer stages and supports with planes | M | Waits for 09-8 |
| 09-15 UI 3 | cards for counter-air, interception, airdrop, loss choice | M | Waits for 09-9 to 09-11 |
| 09-17 Docs | "As built" and the open questions | S | Last |

12 tickets left: 2 S, 10 M.

## B. Fleets and naval warfare (spec 12)

Release I is the only one needed to switch supply penalties on. Releases II to IV are the rest of naval play.

| Ticket | What it gives you | Size | Status |
|---|---|---|---|
| **Release I: supply by sea, and a fleet in a captured port** | | | |
| 12-0 Port facts and sea distance | port sizes, fronts, shortest sea route | M | Done |
| 12-1 Naval record | what each fleet did this turn | S | Done |
| 12-2 Sea supply rules (pure) | which units a fleet can supply | M | Done |
| 12-3 Designate sea supply (steps 6e, 9f) | the player picks what the fleet supplies | M | Done |
| 12-4 Fleets displaced on capture | the fleet in a captured port moves away; Malta holds 9 | M | Done |
| 12-5 Computer: sea supply | the computer answers the prompts | S | Next |
| 12-6 UI 1 | the cut-off card, map marks, port capacity on the hex card | M | Next |
| 12-8 Supply chains | Gibraltar, Kiel, Istanbul | S | Next |
| 12-7 Gate and switch | 30 seeds each scenario; if the numbers are inside the agreed bounds, supply penalties go on | S | Waits: the computer must keep its supply lines (done in part by the supply-aware computer) and Berlin must be defended |
| **Release II: fleets move and fight** | | | |
| 12-9 Naval combat resolver (pure) | every branch of the naval table | S | Next |
| 12-10 Base-change rules (pure) | straits, Suez, which side of Italy | M | Waits for 12-0 |
| 12-11 Move a fleet (step 6b) | once a turn, to another port | M | Waits for 12-1, 12-10 |
| 12-12 Interception (6c, 6d) | the other side's fleets try to catch yours | L | Waits for 12-9, 12-11 |
| 12-13 Computer: base change and interception | | M | Waits for 12-12 |
| 12-14 UI 2 | move a fleet, the interception prompt, results, losses | L | Waits for 12-12 |
| **Release III: air against ships** | | | |
| 12-15 Air attacks on ports (7i) | | M | Waits for 09-9 |
| 12-16 Air against fleets at sea | | M | Waits for 12-12 |
| 12-17 UI 3 | | M | Waits for 12-15, 12-16 |
| **Release IV: amphibious** (outline only) | | | |
| 12-18 Shore bombardment | | M | Later |
| 12-19 Sea transport and step 7f | | L | Later |
| 12-20 Seaborne invasion and bridgeheads | | L | Later |
| 12-21 Docs, once per release | | S | After each release |

Release I: 9 tickets (5 M, 4 S). Release II: 6 (3 M, 2 L, 1 S). Release III: 3 M. Release IV: 3 (1 M, 2 L).

## C. Save and load (spec 11): not started on purpose, until you have played

| Ticket | What it gives you | Size | Status |
|---|---|---|---|
| 11-1 Format, validation, fingerprint | | M | Waits for your playtest |
| 11-2 Restore | replay a game to where it stood | M | Waits |
| 11-3 Record every game | | S | Waits |
| 11-4 Save store (IndexedDB) | | M | Waits |
| 11-5 Autosave | the game saves itself as you play | M | Waits |
| 11-6 Continue card and Saved games | "Continue" on opening, a list of saves | M | Waits |
| 11-7 Save as, and the step 10b hint | | S | Waits |
| 11-8 Save file and open file | share sheet, Files app | M | Waits |
| 11-9 Open a recording | optional | S | Waits |
| 11-10 Test pack | all four scenarios, damaged and old saves | M | Waits |
| 11-11 Browser tests | | M | Waits |
| 11-12 iPad check | by hand, on a real iPad | S | Waits |
| 11-13 Docs | | S | Last |

13 tickets: 8 M, 5 S.

## D. Rules that have no spec yet

Each of these needs a short spec first (docs only, size S to M, reviewed), then tickets. The sizes below are guesses for the whole job after the spec, except the victory rows, the minor-country row and the attrition, exploitation, redeployment and fortress rows, whose specs (14, 15 and 16) are written and give their own ticket sizes. These are the largest unknowns on the way to Beta.

| Rule | Roadmap item | Guess |
|---|---|---|
| **Victory, surrender, Russian winter: spec written** ([14](specs/14-victory-surrender-winter.md), draft for review, 24 tickets; sizes below are the spec's, not guesses; who owns what between specs 14 and 15 is in part H of spec 14) | 6.7 | 17 Beta tickets (6 S, 8 M, 3 L), 7 Release 1 tickets (1 S, 6 M); not in the 47 counted above |
| 14-1 to 14-3 The game ends and has a result: objective count, results for all four scenarios, the result at the last turn (the early end after a conquest comes with 14-5) | | S, M, M: **Done** (2026-10-21). Watch mode and self-play show the result |
| 14-4 The score line, the Objectives list and the end card on the screen | | M (Beta): Next |
| 14-5 to 14-7 Countries fall: a Major Power by its capital (14-5), the conquest mechanics for every other country, Poland first, which spec 15 reuses (14-6), France with Vichy France (14-7; spec 14 owns Vichy) | | L, M, L (Beta) |
| 14-11 to 14-13 The Russian winter: roll and choice at II.A, no doubling and no Axis Offensive in the East, the screens | | M, M, S (Beta) |
| 14-14 to 14-16 Russia: Moscow and Leningrad BRPs (spec 14 owns them), the surrender offer, its screens | | S, L, M (Beta) |
| 14-18 Free Siberian Transfer | | M (Beta if the owner says yes to Q3) |
| 14-19, 14-20, 14-24 Computer answers, self-play gate, docs | | S, S, S (Beta) |
| 14-8, 14-9, 14-10, 14-17, 14-21, 14-22, 14-23 Italy's surrender, limits on French attacks while Paris is held, Vichy waking up, the 45-factor Occupation Force, the computer's matching play, the 25-BRP losses at Gibraltar and Suez, the supply-line exception for trapped enemy units (spec 14 owns it; Beta uses the simplified rule) | | M, M, M, M, M, S, M (Release 1) |
| Minor countries: forces of a newly attacked minor, Minor-Ally activation, BRPs from conquest (spec 15, draft: 17 Beta tickets, 5 S and 12 M; 5 more for Release 1, 4 M and 1 L; the conquest of every country, Vichy, Moscow and Leningrad and the trapped-units exception are spec 14's) | 4.3 rest | Beta: 5 S + 12 M. Release 1: 4 M + 1 L |
| **Attrition, Exploitation, Strategic Redeployment, Fortress changes: spec written** ([16](specs/16-attrition-exploitation-redeployment.md), draft for review, 28 tickets; sizes below are the spec's, not guesses; who owns what is in part H of spec 16) | 6.2, 6.3, 5.6, 5.7 | 24 Beta tickets (5 S, 13 M, 6 L), of which 12 are Beta-critical (1 S, 8 M, 3 L); 4 Release 1 tickets (3 M, 1 L); not in the 47 counted above |
| 16-0, 16-1, 16-3 to 16-8 Attrition and what it needs: the facts, the computer's Front Options, the rules, the roll and the losses, the hexes with retreat and occupation, overstack at steps 6g and 9j, the screens, the computer | 6.2 | S, M, M, M, L, M, L, M (all Beta-critical) |
| 16-2 Attacks need the Offensive Option (spec 16, owner's Q1) | | M (Beta) |
| 16-9 to 16-13 Exploitation (owner's Q2): Breakthrough, movement, combat, screens, computer | 6.3 | M, L, M, L, M (Beta) |
| 16-14, 16-15 The vacant-hex attack, air support in Exploitation | | M, M (Release 1) |
| 16-16 to 16-20 Strategic Redeployment on land: rules, step 9e, grants as redeployments, screens, computer | 5.6 | L, M, S, M, M (16-16, 16-17 and 16-19 Beta-critical; 16-18 and 16-20 Beta) |
| 16-21 Sea Escort for ground units (owner's Q3) | | L (Beta) |
| 16-22, 16-23 Air units and airbases, fleets and escort chains, by redeployment | | M, L (Release 1) |
| 16-24 to 16-26 Fortresses: Sevastopol's two conditions, status news and map outlines, the Anglo-French stop ban | 5.7 | S, S, S (Beta) |
| 16-27 Gate and docs | | M (Beta-critical) |
| Strategic warfare, Murmansk and U.S. boxes | 6.6 | L (a guess; the last section of spec 16 recommends Release 1 and a separate spec 17, owner's Q6) |
| Small items from the PC manual audit: Germany garrisoning an inactive Axis minor (15-7, M), Persia costing the Axis nothing (15-12, S), a Front Option changed within the step (15-13, S), Minor-Ally BRPs while inactive (15-9, M); all counted in the row above. The Option per country (audit item 12) stays open: ask Frank | audit, spec 15 | in spec 15 |

## E. The computer

| Item | What it gives you | Size | Status |
|---|---|---|---|
| Supply-aware computer | stops walking into cut-off positions while supply penalties are on | M | In review (PR 93) |
| Defend Berlin | its capital is the main supply source; it falls in 13 of 30 1939 games with penalties on | M | Next (a spec 05 note first) |
| Stall breaker | the computer no longer stands still in front of fortified hexes | M | Next |
| Front Options and Italy declaring | the computer makes the choices it skips today (the Front Options half is ticket 16-1 of spec 16) | M | Next |
| Computer air (09-12), naval (12-5, 12-13) | listed above | | |
| Evaluator and strength levels | a stronger and a weaker computer | L | Later |
| Watch mode reads the supply setting | a watched game replays with the penalties on once they are on | S | Later |

## F. Checks and polish

| Item | Size | Status |
|---|---|---|
| Real iPad pass (never done on real Safari) | S | You and Frank, now. Guide: `docs/PLAYTEST-FR.md` |
| Map clarity pass | M | After Frank has seen it |
| French interface | L | After Release 1 |
| CI: parallel browser tests, docs-only skip | S | PR 95 |

## G. Decisions (all taken)

- **Planes and fleets in a captured city are displaced:** they move to the nearest friendly base or port, and are lost only if none is in reach. Owner, 2026-10-15 (spec 09, decision D1). Tickets 09-5 and 12-4, ready to build. What Frank remembers of the DOS game would only confirm it.
- **Two milestones, Beta then Release 1**, as above. Owner, 2026-10-17.
- **Order of work:** the owner follows the project manager's lead. Your playtest now; meanwhile finish the air screens (09-14 rest, 09-13, 09-16) and write the specs in section D; then fleets Release I and the supply switch; then save and load.
- **Fleets spec (DF-1, DF-2, DF-3), the gate bound and Malta:** the owner had no view, so the project manager takes the recommended answers, which can be changed at any time:
  - DF-1: build fleets in the order I supply by sea, II fleet movement, III air against ships, IV naval missions. Only Release I is in Beta.
  - DF-2: supply penalties go on only after a measured test, never by editing the switch alone. The bound: no scenario may lose more than about 10 percent of the objectives held with the penalties off.
  - DF-3: a player whose units are cut off gets one button that proposes the fleet and the port, and can still pick another.
  - Malta: the automatic setup puts too many ships at Malta at the start of 1942 and 1944 (18 and 36, against a limit of 9). Cap it at the limit when fleets Release I is built. Only those two starts change.

## Open questions for Frank

These are in `docs/TODO-VERIFY.md`. The ones that matter most: whether supply and Berlin work as in the PC game (19.4 against 11.74), how the DOS game words the supply-by-sea prompt (spec 12, P1 to P7), and whether Germany gets another supply source after Berlin falls. What happens to planes and fleets in a captured city is decided (displace); Frank's answer would only confirm it.

# Play-test feedback log

What real players said, what we make of it, and what we do. Newest first. Feedback is input to check, never a rules source: a rule question raised here goes to `docs/RULES.md` as a `TODO(verify)` until the PC manual or the original game settles it.

## 2 (2026-10-14): the player (Frank), on iPad, then clarified

**Who and how.** French speaker. Prefers the **iPad** (he plays Panzer Corps there); has not played our version on a tablet yet. Favourite scenario: **the Campaign**. Plays the original DOS game, so he knows the BRP sequence and recognised it. Overall: "très bon début", impressive.

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

**Amaury's own notes.** Has not played the game much, so hard to test and to ask for improvements. Online rule and set-up information is thin; the set-ups are about 80% from the DOS game and partly from the board game. Wants honest feedback.

**How we will keep learning from Frank**
- A "Send feedback" button that saves the game record (the action list) with a note, so a reported problem can be replayed exactly.
- A short French play-test card: five things to try in ten minutes and what to report.
- Questions for him (rules): do friendly units cancel enemy Zones of Control, and does every ground unit exert one or only armor; can an unsupplied unit still attack; what happens to unused BRPs at each Year Start; can a hex be attacked more than once per turn; who holds Greek hex EE27 in 1942; six factors at Leningrad and Moscow each or in total; Libya's setup limit.

## 1 (2026-10-14): Amaury, desktop (MacBook), two full games

- Turns can be taken end to end.
- The map should stay in view while using the panels. Done (#42, #44).
- The log should show the newest action first and keep its place. Done (#42, #44).
- Hexes look confusing where land hexes are separated by water (for example Italy and Albania). Water edges drawn (#45).
- Still not as clear as the board photo or the DOS screen. Open: stronger country borders and colours, clearer coasts; wait for Frank's view.

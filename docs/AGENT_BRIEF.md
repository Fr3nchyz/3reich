# Agent brief

## Context

3Reich is a browser recreation of Avalon Hill's **Third Reich PC** (1996), built so a non-technical relative can play it. Faithfulness to the original rules matters more than features. Stack: TypeScript, Vite, Vitest, no UI framework. Commands: `npm install`, `npm run dev | test | typecheck | build`.

Read first, in full: `docs/RULES.md` (what is encoded, map coordinates, discrepancies, open questions), `docs/SOURCES.md` (where the original manuals and map are), `src/engine/*`, `tests/*`.

## Current state

Encoded and tested: seeded dice; two-sided turn flow; 1939 nation economy; terrain defence multipliers; offensive CRT with the full counterattack loop; attrition table; BRP costs; stacking limits; interception, naval and air DRM tables; minor-country forces. UI is a bare status page.

Not done: map data and rendering, units on the map, movement/ZOC/supply, phases, most procedures (exploitation, DoW, minors, air/naval, strategic warfare, YSS), scenarios, save/load, AI.

## Hard rules

1. **Get the sources yourself.** Download the manuals and map card listed in `docs/SOURCES.md` into a folder **outside the repo**. Use `pdftotext` (no `-layout`) for the Reference Manual text; `pdfimages -j` to extract the 300 dpi map scan.
2. **Never commit copyrighted material**: no scans, screenshots, extracted game files, manual text beyond short quotes, or traced art. Encode mechanics as data and code in your own words. Draw original art.
3. **Do not invent rules.** Every rule cites its source in a comment (e.g. `// Ref 12.4`, `// Ops 5.46`, `// Peele errata`). Source priority is in `docs/RULES.md`. If no source covers it, add a named constant or hook marked `TODO(verify)` and list it under "Open questions" in your PR.
4. Engine code is pure TypeScript, no DOM, deterministic (seeded RNG passed in and out; no `Math.random`).
5. Every engine change has unit tests. Worked examples in the manuals make good tests (e.g. Ref 9.2 BRP calculation example: test the arithmetic, its numbers are illustrative).
6. Run `npm run typecheck && npm test && npm run build` before every push. Work on a branch; open a **draft PR against `main`**; one task per PR.
7. Git author email: `37098628+Fr3nchyz@users.noreply.github.com` (the account rejects pushes that expose a real email).

## Tasks

Independent tasks can run in parallel: 1, 2, 3 and 4 do not depend on each other.

### 1. Map data from the reference map scan
- Extract page 1 of `Third-Reich_Map_DOS_EN.pdf` (4458x3458 px). Write `scripts/map/` tooling that registers the hex grid using the printed edge coordinates (rows `A`-`NN`, diagonal columns; see RULES.md "Map"), then samples each hex to classify base terrain (ocean, lake, plain, mountains, swamp, Qattara).
- Hand-curate what colour sampling cannot get: cities, ports, capitals, capital-ports, objectives, beaches, fortresses, minor-country BRP labels, country ownership per hex, and hexside features (rivers, crossing arrows, all-water, coastline-only, national and front boundaries, Qattara).
- Output `src/data/map.json` keyed by hex id (`"K21"`), plus `src/engine/hex.ts` (parse/format ids, axial neighbours, distance, line) with tests.
- Verify with spot checks from Ref 4.3-4.9 (listed in RULES.md) and a debug overlay image kept **outside** the repo. Report any hexes you were unsure about.

### 2. Scenario data
- From Ops 9.0, transcribe all four scenarios (1939, 1942, 1944, Campaign) into `src/data/scenarios/`: BRPs, growth rate, territory controlled at start, setup requirements, force pools and allowable builds (these are counter pictures: read them visually), duration, situation at start, order of deployment, special rules. Apply Peele's errata (1939 setup changes).
- Tests: 1939 numbers match RULES.md; each scenario totals are consistent.

### 3. Phase state machine
- Encode the full sequence of play (Ops 5.0 and the printed card: Year Start Sequence; Russian-winter roll; player-turn order; per player turn steps 1-10 with their sub-steps) as an explicit phase list with `advancePhase`. Unimplemented steps are no-op hooks with `TODO` and a manual reference. Use Peele's corrected cross-references.

### 4. Economy procedures
- Ref 9.0-9.2 and 11: Year Start Sequence BRP calculation (growth from unused BRPs, conquests, minor allies, 1940 exception, Leningrad/Moscow), spending limits, BRP grants, Offensive-option cost, unit construction against the force pool. Tests from the manual's worked examples.

### 5. Movement, ZOC, stacking, supply (after 1)
- Ref 4.0-7.0, 10.0. Armor ZOC costs, crossing arrows, all-water hexsides, stacking exceptions, supply sources and lines.

### 6. Combat procedures (after 1 and 5)
- Wire `combat.ts` into the map: choosing attackers/defenders, advance after combat, exploitation and breakthrough (Ref 12.3), attrition hex selection (Ref 12.4 with Peele's changes), air and naval combat (Ref 20-21).

### 7. UI (after 1)
- SVG/canvas map with pan/zoom, original-style two-number counters in our own art, unit tray, status and tables menus and the bottom button bar modelled on Ops 3.0. Large, readable, mouse-only friendly.

### 8. Save/load and hot-seat; 9. AI (see The GENERAL Vol. 31 No. 2 in SOURCES.md); 10. offline install and GitHub Pages deploy.

## Prompt template for a new agent session

```
You are working on the private GitHub repo Fr3nchyz/3reich, a TypeScript/Vite browser recreation of Avalon Hill's 1996 PC game "Third Reich". Start by reading README.md, docs/AGENT_BRIEF.md, docs/RULES.md and docs/SOURCES.md in full; they define the hard rules you must follow. Download the original manuals and map scan listed in docs/SOURCES.md into a folder outside the repo and use them as your source of truth. Your task: <TASK NUMBER AND NAME FROM docs/AGENT_BRIEF.md>. Cite manual sections in code comments, never invent rules (mark gaps TODO(verify) and list them as Open questions in the PR), never commit scans/screenshots/game files, run `npm run typecheck && npm test && npm run build` before pushing, and open a draft PR against main. Git author email: 37098628+Fr3nchyz@users.noreply.github.com.
```

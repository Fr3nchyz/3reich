# 3Reich

A playable recreation of the classic WWII grand-strategy wargame *Third Reich*, built to run in any modern web browser. It is meant to be easy for anyone to pick up: open a link, no install, no CD-ROM. The main mode is one player against the computer, choosing either side.

> **Status: early.** The real combat results, attrition, terrain, cost and modifier tables from the original game are encoded and tested. The full map is digitised and shown in the browser. Units on the map and most procedures are not built yet. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Run it

```sh
npm install
npm run dev      # play locally at http://localhost:5173
npm test         # unit tests
npm run build    # static build in dist/ — works from any folder or web host
```

Checks that CI also runs:

```sh
npm run lint       # ESLint (flat config); src/ files stay at or under 300 lines of code
npm run typecheck  # app, engine (no DOM, no Node) and e2e configs
npm run coverage   # unit tests plus the coverage floor for src/engine
npm run e2e        # builds, then a Playwright smoke test against `vite preview` (mouse and touch)
```

`npm run e2e` needs a Chromium: run `npx playwright install chromium` once, or set `PW_CHROMIUM_PATH` to an installed one.

Requires Node `^20.19 || ^22.13 || >=24` (set in `engines`; CI uses Node 22).

## Approach

- Rules engine is plain TypeScript with no UI dependencies, deterministic (seeded dice), so games can be saved, replayed and tested.
- UI is a thin layer over the engine.
- Game data (map, units, tables) lives in data files, separate from logic.

## Working rules

- The original 1996 PC manuals and reference map are the source of truth (links in `docs/SOURCES.md`; keep the files outside the repo). Cite the section in code comments, e.g. `// Ref 12.4`.
- Never invent a rule. If no source covers it, use a named constant marked `TODO(verify)` and list it in `docs/RULES.md` under Open questions.
- Never commit scans, screenshots, game files or manual text. Draw original art.
- The engine stays pure and deterministic (seeded dice, no DOM, no clock), and every rule has a test. This is enforced by `tsconfig.engine.json` and `tests/engine-purity.test.ts`. Files under `src/` stay at or under 300 lines of code, enforced by ESLint `max-lines`. The UI and the computer opponent change the game only through `legalActions` and `applyAction`.
- Run `npm run lint && npm run typecheck && npm test && npm run build` before pushing; CI also enforces the engine coverage floor and the browser smoke test (`npm run e2e`). Commit as `37098628+Fr3nchyz@users.noreply.github.com`.

## Legal

**Unofficial fan project, not affiliated with or endorsed by Avalon Hill or Hasbro.** *Third Reich* and *Avalon Hill* are trademarks of their respective owners. This is a private, non-commercial tribute to the 1996 PC game.

- The code is written from scratch, and the rules are written in our own words from the game's manuals. No scans, screenshots, game files, artwork or manual text are in this repository.
- The map data (`src/data/map.json`) was measured from the original printed reference map: terrain, borders, city names and positions. It is the one part derived from the original publisher's artwork, so it is the first thing to replace if this project ever goes public.
- Art is our own. National markers use plain colours and names, with no Nazi symbols.
- The repository is private and the site is not listed in search engines. If it were ever made public, it should be renamed and the map replaced first.

This is a note about intent, not legal advice.

## Docs

- [docs/RULES.md](docs/RULES.md): what is encoded, sources, coordinates, open questions
- [docs/SOURCES.md](docs/SOURCES.md): where to download the original manuals and map
- [docs/ROADMAP.md](docs/ROADMAP.md): milestones and the plan
- [docs/PROGRESS.md](docs/PROGRESS.md): where the project stands, measured against the plan (2026-10-13)
- [docs/PRODUCT_OWNER.md](docs/PRODUCT_OWNER.md): how a non-technical product owner can help and decide
- [docs/AUDIT_REPORT.md](docs/AUDIT_REPORT.md): technical audit of the code (2026-10-13)
- [docs/GAME_DATA.md](docs/GAME_DATA.md): what the original game files contain and what has been decoded
- [docs/MAP_COMPARISON.md](docs/MAP_COMPARISON.md): our map against the original game's map data

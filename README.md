# 3Reich

A playable recreation of the classic WWII grand-strategy wargame *Third Reich*, built to run in any modern web browser. It is meant to be easy for anyone to pick up: open a link, no install, no CD-ROM.

> **Status: early scaffold.** The turn sequence, a seeded dice engine and a placeholder combat table exist. The map, units and real rules do not yet. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Run it

```sh
npm install
npm run dev      # play locally at http://localhost:5173
npm test         # engine unit tests
npm run build    # static build in dist/ — works from any folder or web host
```

Requires Node 20+.

## Approach

- Rules engine is plain TypeScript with no UI dependencies, deterministic (seeded dice), so games can be saved, replayed and tested.
- UI is a thin layer over the engine.
- Game data (map, units, tables) lives in data files, separate from logic.

## Legal

This is an independent, from-scratch implementation. It contains no code, artwork, map scans or rulebook text from the original Avalon Hill / Atomic Games products. *Third Reich* and *Avalon Hill* are trademarks of their respective owners; this project is not affiliated with or endorsed by them.

## Docs

- [docs/RULES.md](docs/RULES.md): rules we need to transcribe and verify against the original manual
- [docs/ROADMAP.md](docs/ROADMAP.md): milestones

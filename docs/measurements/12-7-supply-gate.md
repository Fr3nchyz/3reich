# 12-7 supply penalty gate measurement

Issue #313. Measurement only; the shipped supply switch is unchanged.

Matched seeds 1–30, 30 games per scenario and setting, computer on both sides,
played to the scenario end with action verification disabled. Commands:

```sh
npm run selfplay -- --scenario <s> --turns end --seed 1 --games 30 --no-verify --supply-effects on --out selfplay-out/gate-on-<s>
npm run selfplay -- --scenario <s> --turns end --seed 1 --games 30 --no-verify --supply-effects off --out selfplay-out/gate-off-<s>
```

For each game, take the victory level and final Objective counts from the report's
`Result` line (printed Objectives, excluding capital-only hexes). Means are over
30 games; percentage change is `100 × (on − off) / off`, calculated before
rounding. Negative values mean fewer Objectives with penalties on.

| Scenario | Penalties | Axis victories D / T / M | Allied victories D / T / M | Stalemates | Mean Axis Objectives | Mean Allied Objectives |
| --- | --- | --- | --- | --- | --- | --- |
| 1939 | on | pending | pending | pending | pending | pending |
| 1939 | off | pending | pending | pending | pending | pending |
| 1942 | on | pending | pending | pending | pending | pending |
| 1942 | off | pending | pending | pending | pending | pending |
| 1944 | on | pending | pending | pending | pending | pending |
| 1944 | off | pending | pending | pending | pending | pending |

| Scenario | Axis Objective change | Allied Objective change | Within about 10% loss for both sides? |
| --- | --- | --- | --- |
| 1939 | pending | pending | pending |
| 1942 | pending | pending | pending |
| 1944 | pending | pending | pending |

Gate decision: pending completed measurements; no switch proposal yet.

Reports and recordings: `selfplay-out/gate-{on,off}-<s>/` (git-ignored).
Logs: `/tmp/claude-0/gate-<s>-<on|off>.log`.

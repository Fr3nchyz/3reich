# 12-7 supply penalty gate measurement

Issue #313. Measurement only; the shipped supply switch is unchanged.

The existing reports in `selfplay-out/gate-{on,off}-{1939,1942,1944}/`
and `selfplay-out/gate-{on,off}-1942b/` cover computer play on both sides,
with `--turns end --no-verify --supply-effects on|off`. No new games were run
for this note; the `gate-*-round3-*` folders were excluded as requested.

Contrary to the round 4 inventory, the available 1939 on folder contains only
seeds 1–10, and 1942 on contains seeds 1–27 after de-duplication. The table uses
all available completed reports, with the actual games and seed ranges shown
per cell. For 1942, repeated seeds 14–26 on and 14–28 off in the `1942b`
folders count only once; their victory levels and Objective counts agree.
All included reports end in `game-over` and list no anomalies.

Take victory levels and final printed Objective counts from each report's
`Result` line, excluding capital-only hexes. D / T / M means decisive / tactical /
marginal. Means use the game count in each row; percentage change is
`100 × (mean on − mean off) / mean off`, calculated before rounding.
Negative values mean fewer Objectives with penalties on.

| Scenario | Penalties | Games (seeds) | Axis victories D / T / M | Allied victories D / T / M | Stalemates | Mean Axis Objectives | Mean Allied Objectives |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1939 | on | 10 (1–10) | 0 / 0 / 0 | 9 / 1 / 0 | 0 | 13.60 | 20.10 |
| 1939 | off | 30 (1–30) | 0 / 0 / 0 | 18 / 5 / 2 | 5 | 16.53 | 17.77 |
| 1942 | on | 27 (1–27) | 27 / 0 / 0 | 0 / 0 / 0 | 0 | 24.11 | 14.89 |
| 1942 | off | 30 (1–30) | 28 / 0 / 0 | 0 / 0 / 0 | 2 | 25.57 | 12.67 |
| 1944 | on | 30 (1–30) | 30 / 0 / 0 | 0 / 0 / 0 | 0 | 23.47 | 15.50 |
| 1944 | off | 30 (1–30) | 30 / 0 / 0 | 0 / 0 / 0 | 0 | 24.77 | 14.23 |

| Scenario | Axis Objective change | Allied Objective change | Within about 10% loss for both sides? |
| --- | --- | --- | --- |
| 1939 | −17.74% | +13.13% | No |
| 1942 | −5.69% | +17.54% | Yes |
| 1944 | −5.25% | +8.90% | Yes |

The unequal seed coverage in 1939 and 1942 limits those comparisons. Restricting
both settings to their shared seeds gives Axis / Allied changes of −22.73% /
+21.08% for 1939 (10 per setting), and −5.10% / +16.86% for 1942 (27 per
setting); the bound verdicts are unchanged. The 1944 comparison already uses
30 matched seeds. This is a policy measurement, not a general measure of play
strength (see [the runner's limitations](../SELFPLAY.md#what-it-is-for)).

Gate verdict: outside the agreed approximately 10% loss bound because 1939 Axis
Objectives fall by 17.74% (22.73% on matched seeds); do not enable the switch.

The requested 30 games per cell are incomplete in the supplied non-round3
reports for 1939 on and 1942 on; this note records the available evidence and
does not certify a completed 30-per-cell gate.

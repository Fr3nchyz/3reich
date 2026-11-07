# 12-7 supply penalty gate measurement

Issue #313. Measurement only; the shipped supply switch is unchanged.

The existing reports in `selfplay-out/gate-{on,off}-{1939,1942,1944}/`
and `selfplay-out/gate-{on,off}-1942b/` cover computer play on both sides,
with `--turns end --no-verify --supply-effects on|off`. For 1939 on, use the
complete `selfplay-out/gate-on-1939-round3-20261107T015051Z-195/` run
instead of the original 10-game `gate-on-1939/` folder. Other
`gate-*-round3-*` folders are excluded. No new games were run for this note.

Every cell has 30 completed reports, seeds 1–30, in the available folders.
For 1942, repeated seeds 14–30 in the `1942b` folders count only once;
their victory levels and Objective counts agree. All included reports end
in `game-over` and list no anomalies.

Take victory levels and final printed Objective counts from each report's
`Result` line, excluding capital-only hexes. D / T / M means decisive / tactical /
marginal. Means use the game count in each row; percentage change is
`100 × (mean on − mean off) / mean off`, calculated before rounding.
Negative values mean fewer Objectives with penalties on.

| Scenario | Penalties | Games (seeds) | Axis victories D / T / M | Allied victories D / T / M | Stalemates | Mean Axis Objectives | Mean Allied Objectives |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1939 | on | 30 (1–30) | 0 / 0 / 0 | 25 / 3 / 1 | 1 | 14.13 | 19.50 |
| 1939 | off | 30 (1–30) | 0 / 0 / 0 | 18 / 5 / 2 | 5 | 16.53 | 17.77 |
| 1942 | on | 30 (1–30) | 30 / 0 / 0 | 0 / 0 / 0 | 0 | 24.27 | 14.73 |
| 1942 | off | 30 (1–30) | 28 / 0 / 0 | 0 / 0 / 0 | 2 | 25.57 | 12.67 |
| 1944 | on | 30 (1–30) | 30 / 0 / 0 | 0 / 0 / 0 | 0 | 23.47 | 15.50 |
| 1944 | off | 30 (1–30) | 30 / 0 / 0 | 0 / 0 / 0 | 0 | 24.77 | 14.23 |

| Scenario | Axis Objective change | Allied Objective change | Within about 10% loss for both sides? |
| --- | --- | --- | --- |
| 1939 | −14.52% | +9.76% | No |
| 1942 | −5.08% | +16.32% | Yes |
| 1944 | −5.25% | +8.90% | Yes |

All three scenarios use 30 matched seeds per setting, so restricting the
comparisons to shared seeds leaves every percentage and bound verdict unchanged.
This is a policy measurement, not a general measure of play strength
(see [the runner's limitations](../SELFPLAY.md#what-it-is-for)).

Gate verdict: outside the agreed approximately 10% loss bound because 1939 Axis
Objectives fall by 14.52% across 30 matched seeds; do not enable the switch.

The supplied reports now cover the requested 30 games per cell, including
1939 on and all available 1942 on seeds (1–30). This completes the requested
sample, but does not establish general play strength beyond these seeds and
this computer policy.

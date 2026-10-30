---
name: update-plan-tables
description: After a 3reich PR merges, update the PLAN and TODO tables. Mechanical docs-table work, suitable for the grunt agent.
---

After a merge:

1. In `docs/PLAN.md`, move the ticket's row to Done with the PR number. Update the group count only if the table shows one.
2. In `docs/CODEX.md` "Issues so far", set the issue's status to Done with the PR.
3. For each new `TODO(verify)` id in the PR, check it is listed in both `docs/RULES.md` (Open questions) and `docs/TODO-VERIFY.md`; add any missing row.
4. Run `npm test` (some tests read the docs). A docs-table-only change needs no reviewer round: the gates are the check.

---
name: file-codex-task
description: File a bounded 3reich ticket for Codex: write the codex-task issue and open the starter draft PR. Use when handing a ticket to Codex.
disable-model-invocation: true
---

Follow docs/CODEX.md steps 1 and 2.

1. Check the ticket is a fit (docs/CODEX.md "Which tickets go to Codex") and that no open `codex-task` issue already has it.
2. Create the issue from `.github/ISSUE_TEMPLATE/codex-task.yml`, title `[codex] <ticket id>: <short name>`, label `codex-task`. Pick the tier (Light, Standard, Heavy). Name the model only in the issue, never in repo text.
3. Scope wording: allow "minimal wiring in any src/engine or src/ui file, listing each"; keep `src/ai`, `actions.ts`, `sequence.ts`, `types.ts` out. Turn any unsettled rule into a named `TODO(verify)` switch with a default in the issue text, because Codex stops on gaps.
4. Branch `codex/<ticket>` from `main`, one commit marking the PLAN row "In progress (Codex, #N)", draft PR titled `<ticket id>: <short name> (Codex)` whose body starts with `Closes #N` and holds the issue text.
5. Start Codex with `bash scripts/session-worker.sh <worktree> <PR>` (docs/SESSION-WORKER.md), or give the owner the one-line Codex chat prompt from docs/CODEX.md step 2.

# Subscription delegation inside an existing Claude cloud session

This route runs Codex CLI as a normal child process in Claude Code's existing cloud checkout. Claude uses its subscription for orchestration/review; Codex uses ChatGPT sign-in for implementation. It does not call `codex cloud exec`, does not depend on GitHub mentions discovering a Codex environment, and does not need another always-on machine or an OpenAI API key.

## One-time feasibility check in Claude's cloud terminal

1. Install the official Codex CLI using the official installation instructions. A normal npm installation is `npm install -g @openai/codex`; use a user-writable installation prefix if the runtime requires one. Do not change the project's dependency manifest or lockfile.
2. Run `codex login --device-auth`. The owner must approve the login in the browser using the ChatGPT account with the Plus subscription. Never paste tokens into chat or copy an authentication file from another session.
3. Run `bash scripts/session-worker.sh --check`. This verifies the CLI and login method only.
4. Run one small read-only canary before implementation:

   ```sh
   env -u CODEX_API_KEY -u OPENAI_API_KEY codex exec \
     -c 'forced_login_method="chatgpt"' -c 'model_provider="openai"' \
     --sandbox read-only -C /path/to/checkout \
     'Read AGENTS.md and report the current branch. Change nothing.'
   ```

The Claude runtime must allow installing the CLI, browser/device authentication, outbound Codex connections and the CLI sandbox. A failed canary must be diagnosed; this guide does not claim Claude-side access is already working. If a destination is blocked, use that host's supported network settings. Keep TLS verification and sandboxing enabled.

## Each task, dispatched by Claude

Claude selects an open starter PR, uses its existing clean checkout on that PR's branch, and runs:

```sh
bash scripts/session-worker.sh /path/to/checkout 142
```

The launcher reads the PR description through the existing GitHub CLI authentication, passes it to subscription-authenticated Codex, and returns a report file. The worker's full transcript stays in a local log; Claude reads the final report and diff rather than paying context costs for the implementation transcript. It rejects dirty checkouts, the wrong branch, closed PRs and non-ChatGPT login. The implementation remains uncommitted for Claude to review. Claude then runs the relevant review checks, commits/pushes using its existing GitHub connection and posts the report. Review findings can be sent to a subsequent `codex exec` invocation in the same checkout. Do not start a second worker on an occupied checkout.

Set `WORKER_MODEL` to an actually supported CLI model ID and `WORKER_EFFORT` to `low`, `medium` or `high` when the issue specifies a tier. Without these overrides the CLI's configured defaults apply. Model/effort words inside the task description do not change the process's selected model. Keep Fast mode off in the CLI configuration if that is the owner's preference. An unsupported model should be reported, without an automatic fallback to a more expensive choice.

No separate MCP server is necessary: task input and the returned report are the communication channel. Authentication may need repeating if Claude's host discards its CLI state between cloud sessions. This route does not wake a paused Claude session; dispatch happens while Claude is active. Subscription usage limits still apply.

## Verification status

The launcher can be checked in this workspace for installed CLI/authentication and tested with stubbed CLIs for the dispatch contract. An actual authenticated canary inside Claude's cloud runtime is still required before calling this connection operational.

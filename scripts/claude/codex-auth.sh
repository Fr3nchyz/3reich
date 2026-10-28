#!/usr/bin/env bash
# Write the Codex login from the CODEX_AUTH_JSON environment secret to ~/.codex/auth.json. Best effort, never blocks the session.
# The value is never printed. Without the variable (the default environment) this does nothing.
[ -n "${CODEX_AUTH_JSON:-}" ] || exit 0
dir="${CODEX_HOME:-$HOME/.codex}"
umask 077
mkdir -p "$dir" && printf '%s' "$CODEX_AUTH_JSON" > "$dir/auth.json" || echo "codex auth write failed" >&2
exit 0

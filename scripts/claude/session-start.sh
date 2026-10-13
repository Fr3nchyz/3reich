#!/usr/bin/env bash
# Prepare a Claude Code session: install npm deps and git-bug. Best effort, never blocks the session.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
# Install on a fresh checkout, and again whenever package-lock.json changed since the last install.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund >&2 || true
fi
if ! command -v git-bug >/dev/null 2>&1; then
  mkdir -p "$HOME/.local/bin"
  curl -fsSL -m 120 -o "$HOME/.local/bin/git-bug" \
    https://github.com/git-bug/git-bug/releases/latest/download/git-bug_linux_amd64 \
    && chmod +x "$HOME/.local/bin/git-bug" || echo "git-bug install failed" >&2
fi
export PATH="$HOME/.local/bin:$PATH"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then echo "export PATH=\"$HOME/.local/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"; fi
exit 0

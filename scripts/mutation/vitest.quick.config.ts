import { configDefaults, defineConfig } from "vitest/config";

// The unit tests only: whole-game, self-play and UI-label tests are left out so a mutant run stays fast.
// They can kill a mutant by accident, which says little about the rule it changed.
const SLOW = [
  "ai-selfplay", "selfplay", "ai-stability", "watch-play", "action-labels", "autosetup-after-hand", "log-side", "gamedata",
];

export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "tests/e2e/**", ...SLOW.map((s) => `tests/${s}.test.ts`)] },
});

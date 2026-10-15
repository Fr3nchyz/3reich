import { defineConfig } from "@playwright/test";

// The browser tests drive a build made for them (`vite build --mode e2e`, into dist-e2e) served by `vite preview`: it differs from the production build
// only by the test-only game loader (src/ui/e2eLoad.ts), which the production bundle does not contain (scripts/check-no-e2e.mjs checks that).
// PW_CHROMIUM_PATH points at a pre-installed Chromium (sandboxes); CI leaves it unset and uses the one
// `npx playwright install chromium` fetched.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
// An unusual port (PW_PORT overrides it when workers share a machine), and no reuse of a running server: a preview of some other build must never be tested by mistake.
const PORT = Number(process.env.PW_PORT) || 4789;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry in CI only, to absorb a slow runner; a test that needs it is still reported as flaky.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "mouse", use: { browserName: "chromium", viewport: { width: 1400, height: 1000 } } },
    { name: "touch", use: { browserName: "chromium", viewport: { width: 1024, height: 768 }, hasTouch: true } },
  ],
  webServer: {
    command: `npx vite build --mode e2e --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

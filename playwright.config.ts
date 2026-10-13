import { defineConfig } from "@playwright/test";

// The smoke test drives the production build served by `vite preview`.
// PW_CHROMIUM_PATH points at a pre-installed Chromium (sandboxes); CI leaves it unset and uses the one
// `npx playwright install chromium` fetched.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const PORT = 4173;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
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
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

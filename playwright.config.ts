import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results/browser",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000, toHaveScreenshot: { maxDiffPixelRatio: 0.005 } },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:8787",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
      },
    },
  ],
  webServer: [
    {
      command:
        "MYTUNER_E2E_PORT=8791 MYTUNER_E2E_MIXED_FORMATS=1 npx tsx e2e/server.ts",
      url: "http://127.0.0.1:8791/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
    },
    {
      command: "npx tsx e2e/server.ts",
      url: "http://127.0.0.1:8787/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
    },
    {
      command: "MYTUNER_E2E_PORT=8786 npx tsx e2e/server.ts",
      url: "http://127.0.0.1:8786/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
    },
    {
      command:
        "MYTUNER_E2E_PORT=8792 MYTUNER_E2E_LONG_EPISODES=1 npx tsx e2e/server.ts",
      url: "http://127.0.0.1:8792/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
    },
  ],
});

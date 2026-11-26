import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
const browserPort = Number(process.env.MYTUNER_BROWSER_PORT ?? 8787);
const fixtureCwd = fileURLToPath(new URL(".", import.meta.url));
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
    baseURL: `http://127.0.0.1:${browserPort}`,
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
      cwd: fixtureCwd,
      command:
        "MYTUNER_E2E_PORT=8791 MYTUNER_E2E_MIXED_FORMATS=1 node --import tsx e2e/server.ts",
      url: "http://127.0.0.1:8791/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
    },
    {
      cwd: fixtureCwd,
      command: "node --import tsx e2e/server.ts",
      env: { MYTUNER_E2E_PORT: String(browserPort) },
      url: `http://127.0.0.1:${browserPort}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
    },
    {
      cwd: fixtureCwd,
      command: "MYTUNER_E2E_PORT=8786 node --import tsx e2e/server.ts",
      url: "http://127.0.0.1:8786/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
    },
    {
      cwd: fixtureCwd,
      command:
        "MYTUNER_E2E_PORT=8792 MYTUNER_E2E_LONG_EPISODES=1 node --import tsx e2e/server.ts",
      url: "http://127.0.0.1:8792/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
    },
  ],
});

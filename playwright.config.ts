import { defineConfig } from "@playwright/test";

// Local end-to-end run (`npm run test:e2e`): the real server with fixture games and a fake adb.
// Not part of `npm test`/CI, which runs the vitest suite.
export default defineConfig({
  testDir: "test/e2e",
  timeout: 30_000,
  workers: 1, // one TV, one launch at a time: parallel projects would (correctly) get "busy"
  use: {
    baseURL: "http://127.0.0.1:8799",
    timezoneId: "America/New_York",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: { command: "npx tsx test/e2e/fixture-server.ts", url: "http://127.0.0.1:8799/healthz", reuseExistingServer: false, timeout: 30_000 },
  projects: [
    { name: "phone", use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    { name: "tablet", use: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1920, height: 1080 } } },
  ],
});

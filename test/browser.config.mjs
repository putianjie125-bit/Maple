import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["browser.mjs", "browser-policy.mjs", "browser-consensus.mjs"],
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../browser-failure",
  use: {
    browserName: "chromium",
    headless: true,
    launchOptions: process.env.MAPLE_TEST_BROWSER_EXECUTABLE ? {executablePath:process.env.MAPLE_TEST_BROWSER_EXECUTABLE} : {},
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});

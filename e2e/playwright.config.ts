import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a RUNNING stack (API + web + technician app,
 * seeded with demo data and DEMO_LOGINS=true). Locally: `pnpm dev`; in CI the
 * e2e job starts the production builds. Point elsewhere with E2E_BASE_URL /
 * E2E_TECH_URL (e.g. a staging deployment).
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

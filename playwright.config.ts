import { defineConfig, devices } from "@playwright/test";

const port = 3107;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "line",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure"
  },
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${port}`,
    env: {
      NEWSLETTER_EMAIL_ENABLED: "false",
      NEXT_PUBLIC_SITE_URL: baseURL,
      ...(process.env.NEXT_PUBLIC_SUPABASE_URL
        ? { NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL }
        : {}),
      ...(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        ? { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }
        : {}),
      ...(process.env.SUPABASE_SERVICE_ROLE_KEY
        ? { SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY }
        : {})
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: baseURL
  }
});

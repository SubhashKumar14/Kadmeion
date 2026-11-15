import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  timeout: 20_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    headless: true,
    // The latest hosted runner includes Chrome; no unpinned browser binary
    // download or extra paid service is required.
    launchOptions: { executablePath: process.env.KADMEION_CHROME_PATH || '/usr/bin/google-chrome' }
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173/',
    timeout: 40_000,
    reuseExistingServer: !process.env.CI
  }
});

import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests of the web app in demo mode, with the 1Click API and NEAR mainnet RPC
 * mocked (see e2e/mocks.mjs), so they never touch real money or a live service.
 *   npm run e2e           (starts the Vite dev server itself)
 * Set PW_CHROMIUM to a Chromium binary to use a preinstalled browser.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5199',
    trace: 'off',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'npx vite --port 5199 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

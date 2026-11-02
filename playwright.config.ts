import { defineConfig, devices } from '@playwright/test';

// Playwright drives the UI in a browser, not the Tauri app: the Mac WKWebView has no
// WebDriver. WebKit is the closest stand-in for the Mac shell, Chromium for WebView2.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Shared CI runners are several times slower than a laptop, WebKit on Linux most of all.
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: { timeout: process.env.CI ? 10_000 : 5_000 },
  // On CI a missing screenshot baseline fails instead of being written: written on the first attempt, it would let
  // the retry compare the screenshot with itself and pass. Linux baselines come from the CI workflow's
  // update_visual_baselines option.
  updateSnapshots: process.env.CI ? 'none' : 'missing',
  // On CI, list prints each test to the log and github annotates the failing lines.
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    // A cold start on a runner includes Vite pre-bundling the dependencies.
    timeout: 120_000,
  },
});

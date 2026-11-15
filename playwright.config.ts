import { defineConfig, devices, type ReporterDescription } from '@playwright/test';

// When this run began, for its teardown (e2e/cspTeardown.ts) to read only this run's CSP violations. Set once, in the
// runner: the workers, which load this file too, inherit it.
process.env.SB_E2E_RUN_STARTED ??= String(Date.now());

const ciReporters: ReporterDescription[] = [['list'], ['github']];
const localReporters: ReporterDescription[] = [['list']];

// Playwright drives the UI in a browser, not the Tauri app: the Mac WKWebView has no
// WebDriver. WebKit is the closest stand-in for the Mac shell, Chromium for WebView2.
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // At most 8 workers locally (6.10 review), CI keeping its own default. Five tests in Phase 6 each failed once on a
  // refused or never-finished page load, always in a full 12-worker run on a 24-thread Windows computer, never alone,
  // while the server's log showed it neither restarted nor erred. A judgment from that evidence, not a proven cause:
  // twelve pages loading the unbundled dev build at once ask Vite's one thread for thousands of modules in a burst.
  // Vite listens with Node's default backlog (it exposes no option for it) on localhost, which here is ::1 alone, and
  // Chromium's net log shows it asking ::1 alone, so the address family isn't it. Revisit if refusals continue. (Spread,
  // as `workers: undefined` doesn't type with exactOptionalPropertyTypes.)
  ...(process.env.CI ? {} : { workers: 8 }),
  // Shared CI runners are several times slower than a laptop, WebKit on Linux most of all.
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: { timeout: process.env.CI ? 10_000 : 5_000 },
  // On CI a missing screenshot baseline fails instead of being written: written on the first attempt, it would let
  // the retry compare the screenshot with itself and pass. Linux and macOS baselines come from the Checkpoint workflow,
  // on a push to checkpoint/baselines-<name>; Windows ones from the Windows gate.
  updateSnapshots: process.env.CI ? 'none' : 'missing',
  // On CI, list prints each test to the log and github annotates the failing lines. The JSON report keeps every
  // failed and flaky test's name (3.19): `npm run failed-tests` lists them, and CI keeps the file. It sits beside
  // outputDir, not in it: Playwright empties outputDir as a run starts, and Vitest's report lives in test-results too.
  reporter: [...(process.env.CI ? ciReporters : localReporters), ['json', { outputFile: 'test-results/e2e.json' }]],
  outputDir: 'test-results/e2e',
  // Fails the run on any CSP violation a page reported to the test server, from any spec (6.13 review).
  globalTeardown: './e2e/cspTeardown.ts',
  use: {
    baseURL: 'http://localhost:1421',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    // Its own port, with hot reload off: a dev server on 1420 is never reused.
    env: { STORIIBOARD_E2E: '1', STORIIBOARD_PORT: '1421' },
    url: 'http://localhost:1421',
    reuseExistingServer: !process.env.CI,
    // A cold start on a runner includes Vite pre-bundling the dependencies.
    timeout: 120_000,
    // The server's own words go into the run's log ("[WebServer] …"): three tests in Phase 6 each failed once on a
    // refused page load (net::ERR_CONNECTION_REFUSED from port 1421), and a restart or a crash would say so here.
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

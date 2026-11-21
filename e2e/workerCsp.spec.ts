import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { CSP_EXPECTED_WORKER, CSP_VIOLATIONS_FILE, e2eCsp, e2eWorkerCsp, tauriCsp, workerCsp } from '../scripts/e2eCsp';

// Every worker the app starts runs under a policy at least as strict as the page's (Kevin, Nov 19): a worker takes
// its policy from its own script's response, never from the page, so the app sends src-tauri/worker-csp.txt's on
// every .js and .mjs asset (src-tauri/src/worker_csp.rs) and the test server on every JavaScript response
// (vite.config.ts). Before that, both engines let a worker eval, make a Function and fetch. The probe's refusals are
// meant: the run's teardown knows them by the probe's address (scripts/e2eCsp.ts, CSP_EXPECTED_WORKER).

const root = join(import.meta.dirname, '..');

type Outcome = { eval: boolean; function: boolean; fetch: boolean };

/** What the probe worker could do: eval, new Function and a fetch to the app's own origin. */
function probe(page: Page): Promise<Outcome> {
  return page.evaluate(
    (address) =>
      new Promise<Outcome>((resolve, reject) => {
        const worker = new Worker(address, { type: 'module' });
        worker.onmessage = (event: MessageEvent<Outcome>) => {
          worker.terminate();
          resolve(event.data);
        };
        worker.onerror = (event) => {
          worker.terminate();
          reject(new Error(`the probe worker failed: ${event.message}`));
        };
      }),
    CSP_EXPECTED_WORKER,
  );
}

/** The violations the test server kept from the probe worker since `since` (ms since 1970). */
function probeReports(since: number): string[] {
  const file = join(root, CSP_VIOLATIONS_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((row) => row.trim() !== '')
    .map((row) => JSON.parse(row) as { at: number; line: string })
    .filter(({ at, line }) => at >= since && line.endsWith(` on ${CSP_EXPECTED_WORKER}`))
    .map(({ line }) => line);
}

test('a worker the page starts can neither eval, make a Function nor fetch', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  expect(await probe(page)).toEqual({ eval: false, function: false, fetch: false });
});

// WebKit refuses the same three (the test above) but sends no report from a worker (Playwright's WebKit on Windows,
// Nov 19), so there a refusal inside a worker shows only as the worker's own failure; Chromium, WebView2's engine,
// reports each one, and the run fails on any but the probe's.
test('a worker’s refusals reach the test server, so one in any worker fails the run', async ({ page, browserName }) => {
  const since = Date.now();
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  expect(await probe(page)).toEqual({ eval: false, function: false, fetch: false });
  if (browserName !== 'chromium') return;
  // eval and new Function under script-src, the fetch under connect-src, each reported from the probe's own address.
  await expect
    .poll(() => {
      const reports = probeReports(since);
      return {
        script: reports.some((line) => line.startsWith('[csp-violation] script-src refused eval')),
        connect: reports.some((line) => line.startsWith('[csp-violation] connect-src refused ')),
      };
    })
    .toEqual({ script: true, connect: true });
});

test('scripts carry the worker policy and the page keeps its own', async ({ page }) => {
  const response = await page.goto('/');
  // The page's policy is unchanged: the app's with the listed test-only additions (shell.spec.ts checks the same).
  expect(response?.headers()['content-security-policy']).toBe(e2eCsp(tauriCsp(root)));
  const policy = e2eWorkerCsp(workerCsp(root));
  expect(policy).toBe("default-src 'none'; script-src 'self'; worker-src 'self'; base-uri 'none'; report-uri /@storiiboard/csp-violation");
  // The probe, and the two workers the app starts, as the dev server serves them.
  for (const address of [
    CSP_EXPECTED_WORKER,
    '/src/ui/theme/generator/worker.ts?worker_file&type=module',
    '/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  ]) {
    const script = await page.request.get(address);
    expect(script.ok(), address).toBe(true);
    expect(script.headers()['content-type'], address).toMatch(/javascript/);
    expect(script.headers()['content-security-policy'], address).toBe(policy);
  }
});

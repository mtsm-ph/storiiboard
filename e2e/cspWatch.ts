import { expect, type Page } from '@playwright/test';
import { CSP_VIOLATION_PREFIX } from '../scripts/e2eCsp';

const watched = new WeakSet<Page>();

/**
 * Fails the running test on any violation of the page's content security policy (6.13): the installed app's policy,
 * which the test server sends (vite.config.ts), would refuse the same thing for real. The test server's page prints
 * each one to the console and keeps those from before anyone listened; both fail the test, naming the directive and
 * the refused address. Called from skipOnboarding, which most specs use; a violation in any spec also shows in the
 * run's log as "[WebServer] [csp-violation] …".
 */
export async function failOnCspViolation(page: Page): Promise<void> {
  if (watched.has(page)) return;
  watched.add(page);
  page.on('console', (message) => {
    if (message.text().startsWith(CSP_VIOLATION_PREFIX)) report(message.text());
  });
  // A page between documents has nothing to read; the console listener and the server's log still see the next one.
  const earlier = await page
    .evaluate(() => (window as { __cspViolations?: string[] }).__cspViolations?.slice() ?? [])
    .catch(() => []);
  for (const line of earlier) report(line);
}

function report(line: string): void {
  try {
    expect.soft(line, 'The page broke the installed app’s content security policy (src-tauri/tauri.conf.json)').toBe('');
  } catch {
    // The test has ended: the server's log still has it.
  }
}

import type { Page } from '@playwright/test';
import { failOnCspViolation } from './cspWatch';

/** New project opens its onboarding (1.16). Tests about something else skip it, as a person can. */
export async function skipOnboarding(page: Page): Promise<void> {
  // Most specs pass through here, so it is where a test starts failing on a CSP violation (6.13).
  await failOnCspViolation(page);
  await page.getByRole('dialog', { name: /^Set up / }).getByRole('button', { name: 'Skip' }).click();
}

import type { Page } from '@playwright/test';

/** New project opens its onboarding (1.16). Tests about something else skip it, as a person can. */
export async function skipOnboarding(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: /^Set up / }).getByRole('button', { name: 'Skip' }).click();
}

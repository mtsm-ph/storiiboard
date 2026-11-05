import type { Page } from '@playwright/test';

/**
 * Answers the question the app asks in a window of its own (polish B): a confirm for what can't be undone. Gives back
 * what it said. `yes` picks the action, the last button; otherwise Cancel.
 */
export async function answerAsk(page: Page, yes: boolean): Promise<string> {
  // A question is an alertdialog, on top of Settings when it's open there.
  const asked = page.getByRole('alertdialog').last();
  await asked.waitFor();
  const said = (await asked.locator('p').first().textContent()) ?? '';
  if (yes) await asked.getByRole('button').last().click();
  else await asked.getByRole('button', { name: 'Cancel', exact: true }).click();
  await asked.waitFor({ state: 'hidden' });
  return said;
}

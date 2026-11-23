import { expect, type Locator, type Page } from '@playwright/test';

export type SettingsTab = 'Project' | 'App' | 'Theme' | 'Backups' | 'Storage' | 'Online services' | 'AI assistant' | 'Profile';

/** The Settings window (polish B), a window of the app's own. */
export const settingsWindow = (page: Page): Locator => page.getByRole('dialog', { name: 'Settings' });

/** The gear at the sidebar's foot, or in its folded strip (polish C). */
export const gear = (page: Page): Locator => page.getByRole('button', { name: /^Settings \(/ });

/** Opens Settings from the gear at a tab, and gives back that tab's panel. */
export async function openSettings(page: Page, tab: SettingsTab): Promise<Locator> {
  await gear(page).click();
  const window = settingsWindow(page);
  await window.getByRole('tab', { name: tab, exact: true }).click();
  return window.getByRole('tabpanel', { name: tab, exact: true });
}

/** The question closing Settings asks while changes wait for Apply (Kevin, Nov 17), in either language. */
export const closeQuestion = (page: Page): Locator => page.getByRole('alertdialog', { name: /^(Apply your changes\?|¿Aplicar tus cambios\?)$/ });

/** Apply changes in Settings' title bar, in either language: what was changed there applies. */
export async function applySettings(page: Page): Promise<void> {
  const apply = page.locator('[data-settings-apply]');
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(apply).toBeDisabled();
}

/**
 * Closes Settings with Escape, as a person would, back to the workspace. With changes waiting it asks (Kevin, Nov 17),
 * and the question is answered as given; a test that changed something says how, so none applies a change unawares.
 * The question coming with no answer given fails the test.
 */
export async function closeSettings(page: Page, answer?: 'apply' | 'discard'): Promise<void> {
  await page.keyboard.press('Escape');
  const question = closeQuestion(page);
  // Either the window goes (nothing waited) or the question comes: never both, never neither for long.
  await expect.poll(async () => (await question.count()) > 0 || (await page.locator('[data-settings-tab]').count()) === 0).toBe(true);
  if ((await question.count()) > 0) {
    if (answer === undefined) throw new Error('Settings asked to apply or discard changes, and the test gave no answer.');
    const name = answer === 'apply' ? /^(Apply changes|Aplicar cambios)$/ : /^(Discard changes|Descartar cambios)$/;
    await question.getByRole('button', { name }).click();
  }
  await expect(page.locator('[data-settings-tab]')).toHaveCount(0);
}

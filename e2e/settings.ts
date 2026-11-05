import type { Locator, Page } from '@playwright/test';

export type SettingsTab = 'Project' | 'App' | 'Theme' | 'Backups' | 'Storage';

/** The Settings window (polish B), a window of the app's own. */
export const settingsWindow = (page: Page): Locator => page.getByRole('dialog', { name: 'Settings' });

/** Opens Settings from the sidebar at a tab, and gives back that tab's panel. */
export async function openSettings(page: Page, tab: SettingsTab): Promise<Locator> {
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Settings/ }).click();
  const window = settingsWindow(page);
  await window.getByRole('tab', { name: tab, exact: true }).click();
  return window.getByRole('tabpanel', { name: tab, exact: true });
}

/** Closes Settings with Escape, as a person would, back to the workspace. */
export async function closeSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await settingsWindow(page).waitFor({ state: 'hidden' });
}

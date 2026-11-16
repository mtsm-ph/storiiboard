import { expect, test, type Locator, type Page } from '@playwright/test';
import { gear, settingsWindow } from './settings';

// A window of the app's own keeps Tab and Shift+Tab inside itself (6.5.3 round 2), as a modal dialog must: in the
// desktop build, where the page's own Tab wrap is installed, and in a plain browser build, where it isn't (Tab should
// reach the browser's toolbar from the page, never from inside a modal window). Checked after every press, on every tab
// of Settings, so no count of stops can land on the page behind by luck; and in a window opened from inside Settings
// (Licences), which keeps Tab to itself, Settings taking it back once it closes.

const errors: string[] = [];

test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

/** Presses Tab, then Shift+Tab, 40 times each, checking after every press that focus is still inside `window`. */
async function staysInside(page: Page, window: Locator, what: string) {
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press(key);
      expect(await window.evaluate((element) => element.contains(document.activeElement)), `${what}: ${key} press ${String(i + 1)}`).toBe(true);
    }
  }
}

for (const url of ['/', '/?files=memory']) {
  test(`Tab and Shift+Tab never leave Settings, 40 presses each way on every tab (${url})`, async ({ page }) => {
    await page.goto(url);
    await gear(page).click();
    const settings = settingsWindow(page);
    await expect(settings).toBeVisible();
    for (const tab of ['Project', 'App', 'Theme', 'Backups', 'Storage', 'Online services', 'Profile']) {
      await settings.getByRole('tab', { name: tab, exact: true }).click();
      await staysInside(page, settings, tab);
    }
  });
}

// Only where Settings → Storage has its Licences… button: the plain browser build opens no files and shows no Storage
// tools, so no window opens from inside Settings there.
test('a window opened from inside Settings keeps Tab to itself, and Settings does once it closes', async ({ page }) => {
  await page.goto('/?files=memory');
  await gear(page).click();
  const settings = settingsWindow(page);
  await settings.getByRole('tab', { name: 'Storage', exact: true }).click();
  await settings.getByRole('button', { name: 'Licences…' }).click();
  const licences = page.getByRole('dialog', { name: 'Licences' });
  await expect(licences).toBeVisible();
  await staysInside(page, licences, 'Licences');
  await page.keyboard.press('Escape');
  await expect(licences).toHaveCount(0);
  await expect(settings).toBeVisible();
  await staysInside(page, settings, 'Settings after Licences');
});

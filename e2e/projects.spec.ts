import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// Real projects in a browser: `?files=memory` swaps the desktop driver for the memory one (src/app/fileAccess.ts), so
// these tests create, edit, reload and reopen projects through the same storage and ops code the app uses. A
// prompt stands in for the native Save and Open dialogs.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
});

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const scenes = (page: Page) => sidebar(page).getByRole('list', { name: 'Scenes' }).getByRole('button', { name: /^SC/ });

/** The app picks ⌘ or Ctrl from the user agent, and Playwright's Chromium profile reports Windows even on a Mac. */
async function undoKey(page: Page): Promise<string> {
  return (await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta+z' : 'Control+z';
}

async function newProject(page: Page, name: string) {
  page.once('dialog', (dialog) => void dialog.accept(name));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
  await expect(sidebar(page).getByRole('button', { name: `Project: ${name}` })).toBeVisible();
}

test('starts on the Projects screen, and New project opens the new project’s workspace', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Projects', exact: true })).toBeVisible();
  await expect(page.getByText('No recent projects yet.')).toBeVisible();
  await newProject(page, 'Bey County');
  await expect(page.getByRole('region', { name: 'Storyboard workspace' })).toBeVisible();
  await expect(page.getByRole('banner').getByText('Bey County')).toBeVisible();
});

test('keeps scenes across a reload, and undo still works after reopening from Recent', async ({ page }) => {
  await newProject(page, 'Bey County');
  const add = sidebar(page).getByRole('button', { name: '+ Add Scene' });
  await add.click();
  await add.click();
  await expect(scenes(page)).toHaveText([/SC 01/, /SC 02/]);

  // The page reloading is the app restarting: nothing is open, and the project waits in Recent.
  await page.reload();
  const recent = page.getByRole('list', { name: 'Recent projects' });
  await recent.getByRole('button', { name: /^Bey County/ }).click();
  await expect(scenes(page)).toHaveText([/SC 01/, /SC 02/]);

  await page.keyboard.press(await undoKey(page));
  await expect(scenes(page)).toHaveText([/SC 01/]);
});

test('edits the project’s title and notes in Settings → Project, and ⌘Z takes an edit back', async ({ page }) => {
  await newProject(page, 'Bey County');
  const tile = await openSettings(page, 'Project');
  const title = tile.getByLabel('Title');
  await title.fill('Bey County: Pilot');
  await title.press('Enter');
  await expect(page.getByRole('banner').getByText('Bey County: Pilot')).toBeVisible();

  // Out of the field, so ⌘Z is the project's rather than the field's own.
  await closeSettings(page);
  await page.keyboard.press(await undoKey(page));
  await expect(page.getByRole('banner').getByText('Bey County', { exact: true })).toBeVisible();
});

test('archives and unarchives from the project menu, and an archived project moves to Archived', async ({ page }) => {
  await newProject(page, 'Bey County');
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Archive Project' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'This project is archived' })).toBeVisible();

  await sidebar(page).getByRole('button', { name: /^Project:/ }).click();
  await page.getByRole('button', { name: 'All projects…' }).click();
  await expect(page.getByRole('list', { name: 'Recent projects' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Archived' }).click();
  await expect(page.getByRole('list', { name: 'Archived projects' }).getByText('Bey County', { exact: true })).toBeVisible();

  await sidebar(page).getByRole('button', { name: /^Storyboard/ }).click();
  await page.getByRole('button', { name: 'Unarchive' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'This project is archived' })).toHaveCount(0);
});

test('backs up now, and opens a backup as a separate project', async ({ page }) => {
  await newProject(page, 'Bey County');
  await sidebar(page).getByRole('button', { name: '+ Add Scene' }).click();
  const backups = await openSettings(page, 'Backups');
  await backups.getByRole('button', { name: 'Back up now' }).click();
  await expect(backups.getByRole('status')).toContainText('Backed up at');

  await backups.getByRole('list', { name: 'Backups' }).getByRole('button', { name: /^Open the/ }).click();
  // The copy keeps the project's title, so the notice names the file that's open.
  await expect(page.getByRole('status').filter({ hasText: 'Opened a backup as a separate project' })).toContainText(
    /“Bey County \d{4}-\d{2}-\d{2} \d{2}-\d{2} \(from backup\)”/,
  );
  await closeSettings(page);
  await sidebar(page).getByRole('button', { name: /^Storyboard/ }).click();
  await expect(scenes(page)).toHaveText([/SC 01/]);
  await sidebar(page).getByRole('button', { name: /^Project:/ }).click();
  await page.getByRole('button', { name: 'All projects…' }).click();
  const open = page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /\(from backup\).*Open/ });
  await expect(open).toBeVisible();
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the Projects screen with a recent project passes axe (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await newProject(page, 'Bey County');
    await sidebar(page).getByRole('button', { name: /^Project:/ }).click();
    await page.getByRole('button', { name: 'All projects…' }).click();
    await expect(page.getByRole('list', { name: 'Recent projects' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([]);
  });
}

test('Escape in Settings keeps what was typed in a field not yet left', async ({ page }) => {
  await newProject(page, 'Bey County');
  const tile = await openSettings(page, 'Project');
  await tile.getByLabel('Notes').fill('Call at 6');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
  await expect((await openSettings(page, 'Project')).getByLabel('Notes')).toHaveValue('Call at 6');
});

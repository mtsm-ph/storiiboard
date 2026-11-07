import { fileURLToPath } from 'node:url';
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

test('an empty project still exports its data as JSON, and a JSON that isn’t project data is refused in words', async ({ page }) => {
  await newProject(page, 'Bey County');
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Export Project…', exact: true }).click();
  const exporting = page.getByRole('dialog', { name: 'Export' });
  await exporting.getByRole('radio', { name: 'Project data (JSON)' }).check();
  await expect(exporting.getByText(/^All of it:/)).toBeVisible();
  // No frames, yet there's a project to export.
  const downloaded = page.waitForEvent('download');
  await exporting.getByRole('button', { name: 'Save…' }).click();
  expect((await downloaded).suggestedFilename()).toBe('Bey County project data.json');

  await page.getByRole('button', { name: /^Project:/ }).click();
  await page.getByRole('button', { name: 'All projects…' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import project data…' }).click();
  await (await chooser).setFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"title":"Not a project"}') });
  await expect(page.getByText('“notes.json” isn’t Storiiboard project data.')).toBeVisible();
});

test('a project’s production details: stage, client and deliverables, each an edit that undoes and stays after a reload', async ({ page }) => {
  await newProject(page, 'Bey County');
  let panel = await openSettings(page, 'Project');
  await panel.getByRole('combobox', { name: 'Stage' }).selectOption({ label: 'Pre-production' });
  await panel.getByRole('textbox', { name: 'Format' }).fill('TVC · 60s');
  await panel.getByRole('textbox', { name: 'Company' }).click();
  await panel.getByRole('textbox', { name: 'Company' }).fill('Bey Foods');
  await panel.getByRole('textbox', { name: 'Name' }).first().click();
  await panel.getByRole('textbox', { name: 'New deliverable' }).fill('60s master');
  await page.keyboard.press('Enter');
  await panel.getByRole('textbox', { name: 'New deliverable' }).fill('3 × 9:16 cutdowns');
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  const done = panel.getByRole('checkbox', { name: 'Delivered: 60s master' });
  await done.click();
  await expect(done).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByRole('list', { name: 'Deliverables' }).getByRole('listitem')).toHaveCount(2);
  // An edit like any other: ⌘Z takes back the tick.
  await closeSettings(page);
  await page.keyboard.press(await undoKey(page));
  panel = await openSettings(page, 'Project');
  await expect(panel.getByRole('checkbox', { name: 'Delivered: 60s master' })).toHaveAttribute('aria-checked', 'false');
  // In the file: there after a reload.
  await closeSettings(page);
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /Bey County/ }).first().click();
  panel = await openSettings(page, 'Project');
  await expect(panel.getByRole('combobox', { name: 'Stage' })).toHaveValue('preproduction');
  await expect(panel.getByRole('textbox', { name: 'Format' })).toHaveValue('TVC · 60s');
  await expect(panel.getByRole('textbox', { name: 'Company' })).toHaveValue('Bey Foods');
  await expect(panel.getByRole('list', { name: 'Deliverables' }).getByRole('listitem')).toHaveCount(2);
});

test('production details keep keyboard focus from field to field, and a rename and a remove each undo', async ({ page }) => {
  await newProject(page, 'Bey County');
  let panel = await openSettings(page, 'Project');
  // Leaving a field writes it; the next field keeps focus, and what's typed in it straight away.
  const name = panel.getByRole('textbox', { name: 'Name', exact: true });
  await name.click();
  await page.keyboard.type('Ana Ruiz');
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('textbox', { name: 'Company' })).toBeFocused();
  await page.keyboard.type('Bey Foods');
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('textbox', { name: 'Email' })).toBeFocused();
  await expect(panel.getByRole('textbox', { name: 'Company' })).toHaveValue('Bey Foods');
  // Enter adds a deliverable and stays in the field for the next one.
  const adding = panel.getByRole('textbox', { name: 'New deliverable' });
  await adding.click();
  await page.keyboard.type('Master');
  await page.keyboard.press('Enter');
  await expect(adding).toBeFocused();
  await page.keyboard.type('Cutdowns');
  await page.keyboard.press('Enter');
  const items = panel.getByRole('list', { name: 'Deliverables' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  // A rename, then a remove, each one edit: Remove leaves focus on the next box.
  await panel.getByRole('textbox', { name: 'Deliverable 1' }).fill('60s master');
  await panel.getByRole('textbox', { name: 'Deliverable 1' }).press('Enter');
  await expect(panel.getByRole('checkbox', { name: 'Delivered: 60s master' })).toBeVisible();
  await panel.getByRole('button', { name: 'Remove deliverable: 60s master' }).click();
  await expect(items).toHaveCount(1);
  await expect(panel.getByRole('checkbox', { name: 'Delivered: Cutdowns' })).toBeFocused();
  await closeSettings(page);
  await page.keyboard.press(await undoKey(page));
  panel = await openSettings(page, 'Project');
  await expect(panel.getByRole('textbox', { name: 'Deliverable 1' })).toHaveValue('60s master');
  await closeSettings(page);
  await page.keyboard.press(await undoKey(page));
  panel = await openSettings(page, 'Project');
  await expect(panel.getByRole('textbox', { name: 'Deliverable 1' })).toHaveValue('Master');
});

test('undo and redo with Settings open show in the field they changed, and focus stays where it was', async ({ page }) => {
  await newProject(page, 'Bey County');
  const panel = await openSettings(page, 'Project');
  await panel.getByRole('textbox', { name: 'New deliverable' }).fill('Master');
  await page.keyboard.press('Enter');
  const text = panel.getByRole('textbox', { name: 'Deliverable 1' });
  await text.fill('60s master');
  // Tab writes the rename and moves to its Remove button, where ⌘Z works.
  await page.keyboard.press('Tab');
  const remove = panel.getByRole('button', { name: /^Remove deliverable:/ });
  await expect(remove).toBeFocused();
  await expect(remove).toHaveAccessibleName('Remove deliverable: 60s master');
  const undo = await undoKey(page);
  await page.keyboard.press(undo);
  await expect(text).toHaveValue('Master');
  await expect(remove).toBeFocused();
  await page.keyboard.press(undo.replace('+z', '+Shift+z'));
  await expect(text).toHaveValue('60s master');
  await expect(remove).toBeFocused();
});

test('a company profile saved once is attached to a project, with its logo, updated from the profile, and undone', async ({ page }) => {
  await newProject(page, 'Bey County');
  // Saved on this computer, in Settings → App.
  let panel = await openSettings(page, 'App');
  await panel.getByRole('button', { name: 'Add company' }).click();
  // Named "Company 1" until its name is saved, then by its name: the list's first, either way.
  const company = panel.getByRole('list', { name: 'Company profiles' }).getByRole('group').first();
  await expect(company).toHaveAccessibleName('Company 1');
  await company.getByRole('textbox', { name: 'Name' }).fill('Zima Blue Pictures');
  await company.getByRole('textbox', { name: 'Website' }).click();
  await company.getByRole('textbox', { name: 'Website' }).fill('https://example.com');
  await company.getByRole('textbox', { name: 'Phone' }).click();
  const chooser = page.waitForEvent('filechooser');
  const profile = panel.getByRole('group', { name: 'Zima Blue Pictures' });
  await profile.getByRole('button', { name: 'Choose logo…' }).click();
  await (await chooser).setFiles(fileURLToPath(new URL('./fixtures/images/srgb.jpg', import.meta.url)));
  await expect(profile.getByRole('img', { name: 'Logo of Zima Blue Pictures' })).toBeVisible();

  // Attached in Settings → Project: the project keeps a copy.
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Project', exact: true }).click();
  panel = page.getByRole('dialog', { name: 'Settings' }).getByRole('tabpanel', { name: 'Project', exact: true });
  const menu = panel.getByRole('combobox', { name: 'Company', exact: true });
  // Moving through the menu attaches nothing: Attach does.
  await menu.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  const copy = panel.locator('[data-project-company]');
  await expect(copy).toHaveCount(0);
  await menu.selectOption({ label: 'Zima Blue Pictures' });
  await panel.getByRole('button', { name: 'Attach', exact: true }).click();
  await expect(copy).toContainText('https://example.com');
  await expect(copy.getByRole('img', { name: 'Logo of Zima Blue Pictures' })).toBeVisible();
  await expect(copy).toContainText('The same as its profile on this computer.');

  // The profile changes: the copy doesn't, until Update from profile.
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'App', exact: true }).click();
  panel = page.getByRole('dialog', { name: 'Settings' }).getByRole('tabpanel', { name: 'App', exact: true });
  await panel.getByRole('textbox', { name: 'Phone' }).fill('+1 212 555 0100');
  await panel.getByRole('textbox', { name: 'Email' }).click();
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Project', exact: true }).click();
  panel = page.getByRole('dialog', { name: 'Settings' }).getByRole('tabpanel', { name: 'Project', exact: true });
  await expect(copy).not.toContainText('+1 212 555 0100');
  await panel.getByRole('button', { name: 'Update from profile' }).click();
  await expect(copy).toContainText('+1 212 555 0100');

  // Each was one edit: ⌘Z takes the update back, then the attach.
  const undo = await undoKey(page);
  await panel.getByRole('button', { name: 'Detach company' }).focus();
  await page.keyboard.press(undo);
  await expect(copy).not.toContainText('+1 212 555 0100');
  await page.keyboard.press(undo);
  await expect(copy).toHaveCount(0);
  await expect(panel.getByRole('combobox', { name: 'Company', exact: true })).toHaveValue('');
});

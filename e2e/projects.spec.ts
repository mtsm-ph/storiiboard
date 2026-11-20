import { readFileSync } from 'node:fs';
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
  // Project data (3.14) says it leaves out the Trash and History.
  await expect(exporting.getByText(/^Every scene and frame, pictures and LUTs/)).toBeVisible();
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

test('an import whose stored files are damaged leaves them out, imports the rest, and says how many and where', async ({ page, context, browserName }) => {
  // Chromium asks before a page reads the clipboard; WebKit lets a click write to it as Safari does.
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // 6.27b round 3 (Kevin, Nov 18): a picture on a frame, one on a board and a PDF, each damaged in the exported JSON.
  await newProject(page, 'Bey County');
  const storyboard = page.getByRole('region', { name: 'Storyboard', exact: true });
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await storyboard.getByRole('button', { name: '+ Frame in SC 01' }).click();
  const frame = storyboard.locator('[aria-label="Frames in SC 01"] [data-shot-id]').first();
  await frame.click();
  let chooser = page.waitForEvent('filechooser');
  await page.getByRole('region', { name: 'Frame inspector', exact: true }).getByRole('button', { name: 'Choose picture…' }).click();
  await (await chooser).setFiles(fileURLToPath(new URL('./fixtures/images/srgb.jpg', import.meta.url)));
  await expect(frame.locator('img[data-frame-image]')).toBeVisible();

  // A picture on the Camera board, dropped at its middle.
  const moodboard = page.getByRole('region', { name: 'Moodboard', exact: true });
  await sidebar(page).getByRole('button', { name: /^Moodboard/ }).click();
  const start = moodboard.locator('[data-department-board="camera"]');
  const canvas = page.getByRole('application', { name: 'Camera board' });
  await expect(canvas.or(start)).toBeVisible();
  if (await start.isVisible()) await start.click();
  await expect(canvas).toBeVisible();
  const boardData = moodboard.locator('[data-board-data]');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no board');
  const picture = [...readFileSync(fileURLToPath(new URL('./fixtures/images/p3-red.jpg', import.meta.url)))];
  const transfer = await page.evaluateHandle((data) => {
    const t = new DataTransfer();
    t.items.add(new File([new Uint8Array(data)], 'p3-red.jpg', { type: 'image/jpeg' }));
    return t;
  }, picture);
  await boardData.dispatchEvent('drop', { dataTransfer: transfer, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
  const kinds = async () => (JSON.parse((await boardData.getAttribute('data-board-data')) ?? '[]') as { kind: string }[]).map((i) => i.kind);
  await expect.poll(kinds).toEqual(['picture']);

  // Two PDFs on the project: one is damaged, the other comes back.
  await sidebar(page).getByRole('button', { name: /^Assets/ }).click();
  const assets = page.getByRole('region', { name: 'Assets', exact: true });
  chooser = page.waitForEvent('filechooser');
  await assets.getByRole('button', { name: 'Add PDF…' }).click();
  await (await chooser).setFiles([
    { name: 'Notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% notes\n') },
    { name: 'Recce.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% recce\n') },
  ]);
  await expect(assets).toContainText('2 attachments');

  // Exported as Project data; one byte of each damaged file's bytes changed in the JSON.
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Export Project…', exact: true }).click();
  const exporting = page.getByRole('dialog', { name: 'Export' });
  await exporting.getByRole('radio', { name: 'Project data (JSON)' }).check();
  const downloaded = page.waitForEvent('download');
  await exporting.getByRole('button', { name: 'Save…' }).click();
  type Exported = { tables: Record<string, { columns: string[]; rows: unknown[][] }> };
  const data = JSON.parse(readFileSync(await (await downloaded).path(), 'utf8')) as Exported;
  const files = data.tables.media_files;
  if (!files) throw new Error('no media_files');
  const bytesAt = files.columns.indexOf('bytes');
  const mimeAt = files.columns.indexOf('mime');
  const damaged: Buffer[] = [];
  for (const row of files.rows) {
    const cell = row[bytesAt] as { base64: string };
    const bytes = Buffer.from(cell.base64, 'base64');
    if (String(row[mimeAt]).startsWith('image/') || bytes.includes(Buffer.from('notes'))) {
      bytes[bytes.length - 3] = (bytes[bytes.length - 3] ?? 0) ^ 1;
      damaged.push(bytes);
      row[bytesAt] = { base64: bytes.toString('base64') };
    }
  }
  expect(damaged).toHaveLength(3);

  // Imported from the Projects screen: the rest comes in, and the note says how many and where.
  await sidebar(page).getByRole('button', { name: /^Project:/ }).click();
  await page.getByRole('button', { name: 'All projects…' }).click();
  chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import project data…' }).click();
  page.once('dialog', (prompt) => void prompt.accept('Bey County imported'));
  await (await chooser).setFiles({ name: 'Bey County project data.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  const note = page.getByRole('status').filter({ hasText: 'damaged and left out' });
  await expect(note).toContainText('2 of 2 pictures were damaged and left out. 1 of 2 files was damaged and left out. They show as missing in: ');
  for (const place of ['SC 01 · Frame 1A', 'Board · Camera', 'Project']) await expect(note).toContainText(place);
  // Copy list keeps it (round 4): the whole text, counts and every place, on the clipboard; the notice stays.
  const copyList = note.getByRole('button', { name: 'Copy list' });
  await copyList.focus();
  await page.keyboard.press('Enter');
  const whole = '2 of 2 pictures were damaged and left out. 1 of 2 files was damaged and left out. They show as missing in: ';
  const fallback = note.getByRole('textbox', { name: 'The list, to copy by hand' });
  if (browserName === 'chromium') {
    await expect(note.getByRole('button', { name: 'List copied' })).toBeVisible();
    // The clipboard's content, read where the browser lets a test read it.
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied.startsWith(whole)).toBe(true);
    for (const place of ['SC 01 · Frame 1A', 'Board · Camera', 'Project']) expect(copied).toContain(place);
  } else {
    // Elsewhere the copy may or may not be let through: either it says so, or the list shows to copy by hand.
    await expect(note.getByRole('button', { name: 'List copied' }).or(fallback)).toBeVisible();
  }
  // A copy that fails (round 5): the whole list in a read-only field, selected, so it's still reachable.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('refused')) } });
  });
  await note.getByRole('button', { name: /^(Copy list|List copied|Couldn’t copy the list)$/ }).click();
  await expect(note.getByRole('button', { name: 'Couldn’t copy the list' })).toBeVisible();
  await expect(fallback).toBeFocused();
  await expect(fallback).toHaveJSProperty('readOnly', true);
  expect((await fallback.inputValue()).startsWith(whole)).toBe(true);
  for (const place of ['SC 01 · Frame 1A', 'Board · Camera', 'Project']) await expect(fallback).toHaveValue(new RegExp(place));

  // The frame shows its picture missing; the board keeps its picture item; the damaged PDF is missing, the other saves.
  await sidebar(page).getByRole('button', { name: /^Storyboard/ }).click();
  await expect(storyboard.locator('[aria-label="Frames in SC 01"] [data-shot-id]').first()).toContainText('Picture missing');
  await sidebar(page).getByRole('button', { name: /^Moodboard/ }).click();
  const opened = moodboard.getByRole('region', { name: 'Boards', exact: true }).getByRole('button', { name: /^Camera/ });
  if (await opened.isVisible()) await opened.click();
  await expect.poll(kinds).toEqual(['picture']);
  // The board's picture item shows its picture missing as a gone picture does: the board's data says so per item, by
  // the condition the canvas draws its words by (round 5).
  const missing = async () => (JSON.parse((await boardData.getAttribute('data-board-data')) ?? '[]') as { missing?: boolean }[]).map((i) => i.missing === true);
  await expect.poll(missing).toEqual([true]);
  await sidebar(page).getByRole('button', { name: /^Assets/ }).click();
  await assets.getByRole('button', { name: 'Save a copy…, Notes.pdf' }).click();
  await expect(page.getByText('Notes.pdf isn’t in this project file any more.')).toBeVisible();
  const saved = page.waitForEvent('download');
  await assets.getByRole('button', { name: 'Save a copy…, Recce.pdf' }).click();
  expect((await saved).suggestedFilename()).toBe('Recce.pdf');

  // The damaged bytes are in no table: the imported project's own export holds only the PDF that came back.
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Export Project…', exact: true }).click();
  await exporting.getByRole('radio', { name: 'Full archive (JSON)' }).check();
  const again = page.waitForEvent('download');
  await exporting.getByRole('button', { name: 'Save…' }).click();
  const text = readFileSync(await (await again).path(), 'utf8');
  for (const bytes of damaged) expect(text.includes(bytes.toString('base64'))).toBe(false);
  const archive = JSON.parse(text) as Exported;
  expect(archive.tables.media_files?.rows).toHaveLength(1);
  expect(archive.tables.thumbnails?.rows).toHaveLength(0);
});

test('an import whose LUT is damaged leaves it out, says so with its video’s frame, the Inspector says it’s gone, and the clip plays as shot', async ({ page }) => {
  // Kevin, Nov 18 night 4: a LUT's text is named by its hash, as a picture's bytes are.
  await newProject(page, 'Bey County');
  const storyboard = page.getByRole('region', { name: 'Storyboard', exact: true });
  const inspector = page.getByRole('region', { name: 'Frame inspector', exact: true });
  const lutList = inspector.getByRole('combobox', { name: 'LUT' });
  const chosen = () => lutList.evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent ?? '');
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await storyboard.getByRole('button', { name: '+ Frame in SC 01' }).click();
  let chooser = page.waitForEvent('filechooser');
  await inspector.getByRole('button', { name: 'Link video…' }).click();
  await (await chooser).setFiles(fileURLToPath(new URL('./fixtures/video/A001_C003_2398.mp4', import.meta.url)));
  chooser = page.waitForEvent('filechooser');
  await inspector.getByRole('button', { name: 'Load LUT…' }).click();
  const invert = 'LUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n';
  await (await chooser).setFiles({ name: 'Invert.cube', mimeType: 'text/plain', buffer: Buffer.from(invert) });
  await expect.poll(chosen).toBe('Invert');

  // Exported as Project data; the LUT's text changed in the JSON, its name kept.
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Export Project…', exact: true }).click();
  const exporting = page.getByRole('dialog', { name: 'Export' });
  await exporting.getByRole('radio', { name: 'Project data (JSON)' }).check();
  const downloaded = page.waitForEvent('download');
  await exporting.getByRole('button', { name: 'Save…' }).click();
  type Exported = { tables: Record<string, { columns: string[]; rows: unknown[][] }> };
  const data = JSON.parse(readFileSync(await (await downloaded).path(), 'utf8')) as Exported;
  const luts = data.tables.luts;
  if (!luts) throw new Error('no luts');
  expect(luts.rows).toHaveLength(1);
  const cubeAt = luts.columns.indexOf('cube');
  for (const row of luts.rows) row[cubeAt] = invert.replace('0 0 0\n', '0 0 1\n');

  // Imported from the Projects screen: the rest comes in, and the note counts the LUT and names its video's frame.
  await sidebar(page).getByRole('button', { name: /^Project:/ }).click();
  await page.getByRole('button', { name: 'All projects…' }).click();
  chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import project data…' }).click();
  page.once('dialog', (prompt) => void prompt.accept('Bey County imported'));
  await (await chooser).setFiles({ name: 'Bey County project data.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  const note = page.getByRole('status').filter({ hasText: 'damaged and left out' });
  await expect(note).toContainText('The LUT was damaged and left out. It shows as missing in: SC 01 · Frame 1A.');

  // The frame's video keeps its LUT's id; its Inspector says the LUT is no longer in the project.
  await sidebar(page).getByRole('button', { name: /^Storyboard/ }).click();
  await storyboard.locator('[aria-label="Frames in SC 01"] [data-shot-id]').first().click();
  await expect.poll(chosen).toBe('LUT not in the project');
  expect(await lutList.locator('option').allTextContents()).toEqual(['None (as shot)', 'LUT not in the project']);

  // And the clip plays, ungraded (round 2): its copy is the one as shot, made if there's none yet, and its preview loads.
  const copyLine = inspector.locator('[data-copy-state]');
  const make = inspector.getByRole('button', { name: 'Make playback copy' });
  await expect(copyLine.filter({ hasText: 'Playback copy ready.' }).or(make)).toBeVisible({ timeout: 15_000 });
  if (await make.isVisible()) await make.click();
  // A pretend copy takes 2.5 s; a loaded runner's timers can run late.
  await expect(copyLine).toHaveText('Playback copy ready.', { timeout: 15_000 });
  const clip = inspector.locator('[data-clip-preview] video');
  await expect(clip).toHaveCount(1);
  await expect.poll(() => clip.evaluate((video: HTMLVideoElement) => video.readyState), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
});

test('no section can be chosen while a project opens, by click or key, and every one can once it is open', async ({ page }) => {
  await newProject(page, 'Bey County');
  await sidebar(page).getByRole('button', { name: '+ Add Scene' }).click();
  await expect(scenes(page)).toHaveText([/SC 01/]);

  // The open after a reload waits for sql.js's wasm: held here, the project stays opening until the test lets it go.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let asked!: () => void;
  const requested = new Promise<void>((resolve) => (asked = resolve));
  await page.route(/sql-wasm.*\.wasm/, async (route) => {
    asked();
    await gate;
    await route.continue();
  });
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await requested;

  // Opening: every section is disabled, so assistive technology says so too, and its key does nothing.
  const section = (name: string) => sidebar(page).locator('[id^="section-"]').filter({ hasText: new RegExp(`^${name}`) });
  for (const name of ['Storyboard', 'Assets', 'Team', 'Setup', 'Production', 'Moodboard']) await expect(section(name)).toBeDisabled();
  await page.keyboard.press('Alt+4');
  // A press on Setup now, released once the project is open: the list grows under Storyboard as the project arrives,
  // so the release lands on another section (planLayers on WebKit, Nov 20). Neither is chosen.
  const box = await section('Setup').boundingBox();
  if (!box) throw new Error('Setup has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  release();
  await expect(scenes(page)).toHaveText([/SC 01/]);
  await page.mouse.up();

  // Open: the project's workspace, as after any open, with its section the current one and no other.
  await expect(page.getByRole('region', { name: 'Storyboard workspace' })).toBeVisible();
  await expect(section('Storyboard')).toHaveAttribute('aria-current', 'page');
  await expect(sidebar(page).locator('[aria-current="page"]')).toHaveCount(1);
  for (const name of ['Storyboard', 'Assets', 'Team', 'Setup', 'Production', 'Moodboard']) await expect(section(name)).toBeEnabled();
  await section('Setup').click();
  await expect(page.getByRole('region', { name: 'Setup workspace' })).toBeVisible();
  await expect(section('Setup')).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Alt+5');
  await expect(page.getByRole('region', { name: 'Production workspace' })).toBeVisible();
});

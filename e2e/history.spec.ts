import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { answerAsk } from './ask';
import { skipOnboarding } from './onboarding';
import { openSettings } from './settings';

// The History tile (1.22) in the memory build: every step in words, newest first; Restore to here as a step of its
// own; one frame's own changes, field by field, with an old value to put back; and named versions (1.23).

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  for (let i = 0; i < 3; i += 1) await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
});

const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const history = (page: Page) => page.getByRole('region', { name: 'History', exact: true });
const steps = (page: Page) => history(page).getByRole('list', { name: 'Steps, newest first' }).getByRole('listitem');
const frames = (page: Page) => board(page).locator('[data-shot-id]');
const undoKey = async (page: Page) => `${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`;

// The top bar's History button (polish 3), beside the project name.
async function openHistory(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).click();
  await expect(history(page)).toBeVisible();
}

async function setLens(page: Page, mm: string) {
  const lens = inspector(page).getByLabel('Lens (mm)');
  await lens.fill(mm);
  await lens.press('Enter');
}

test('the top bar’s History button, beside the project name, and the project menu open the same tile', async ({ page }) => {
  const banner = page.getByRole('banner');
  const button = banner.getByRole('button', { name: 'History', exact: true });
  // Right after the project's name, as Kevin asked: name, then History.
  const name = await banner.getByText('Bey County', { exact: true }).locator('..').boundingBox();
  const box = await button.boundingBox();
  if (!name || !box) throw new Error('not on screen');
  expect(Math.abs(box.x - (name.x + name.width))).toBeLessThan(2);

  await button.click();
  await expect(history(page)).toBeVisible();
  // Focus goes into the tile, on its first control, so the keyboard needn't cross the workspace to reach it.
  await expect(history(page).getByLabel('Name this point')).toBeFocused();
  // Asked again while it's in view: still one History.
  await button.click();
  await expect(history(page)).toHaveCount(1);

  // Hidden behind a maximized tile, it comes to the front.
  await page.getByRole('button', { name: 'Maximize Storyboard' }).click();
  await expect(history(page)).toHaveCount(0);
  await button.click();
  await expect(history(page)).toBeVisible();

  // A background tab in a stack is picked.
  const board = await page.getByRole('region', { name: 'Storyboard', exact: true }).boundingBox();
  const bar = await history(page).locator('div').first().boundingBox();
  if (!board || !bar) throw new Error('not on screen');
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(board.x + board.width / 2, board.y + board.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.getByRole('tab', { name: 'Storyboard' }).click();
  await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'false');
  await button.click();
  await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');

  // The project menu's History is the same tile.
  await page.getByRole('button', { name: 'Close History' }).click();
  await expect(history(page)).toHaveCount(0);
  const project = page.getByRole('button', { name: 'Project', exact: true });
  await project.click();
  await page.locator(`[id="${(await project.getAttribute('aria-controls')) ?? ''}"]`).getByRole('button', { name: 'History', exact: true }).click();
  await expect(history(page)).toHaveCount(1);
});

test('History from the Projects screen goes back to the workspace, with History in front', async ({ page }) => {
  await page.getByRole('button', { name: /^Project:/ }).click();
  await page.getByRole('button', { name: 'All projects…' }).click();
  await expect(page.getByRole('region', { name: 'Projects', exact: true })).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Projects', exact: true })).toHaveCount(0);
  await expect(history(page)).toBeVisible();
});

test('each edit carries the profile’s name, or only its initials; edits made before carry none (Kevin, Nov 5)', async ({ page }) => {
  // The edits in beforeEach were made with no name in the profile: no name on them.
  await openHistory(page);
  await expect(steps(page).first()).toContainText('Added frame 1C');
  await expect(steps(page).first()).not.toContainText(' · ');

  let profile = await openSettings(page, 'Profile');
  await expect(profile.getByText('people you share a project with can see it in History', { exact: false })).toBeVisible();
  await profile.getByLabel('Your name').fill('Kevin Matos');
  await profile.getByLabel('Your name').press('Enter');
  await page.keyboard.press('Escape');
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(steps(page).first()).toContainText('Added frame 1D');
  await expect(steps(page).first()).toContainText('Kevin Matos ·');
  // The earlier step still has none.
  await expect(steps(page).nth(1)).not.toContainText('Kevin Matos');

  // Initials only, from here on.
  profile = await openSettings(page, 'Profile');
  await profile.getByRole('switch', { name: 'Sign my edits with my initials only' }).click();
  await page.keyboard.press('Escape');
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(steps(page).first()).toContainText('Added frame 1E');
  await expect(steps(page).first()).toContainText('KM ·');
  await expect(steps(page).first()).not.toContainText('Kevin Matos');
  // Undo is an edit of its own, by the same person.
  await page.keyboard.press(`${(await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control'}+z`);
  await expect(steps(page).first()).toContainText('KM ·');
});

test('lists every step in words, newest first, and Restore to here is a step undo takes back', async ({ page }) => {
  await openHistory(page);
  await expect(steps(page).first()).toContainText('Added frame 1C');
  await expect(steps(page).nth(3)).toContainText('Added scene SC 01');

  // Back to just after the first frame: two frames go, as one new step. The tile says it's restoring meanwhile.
  const status = history(page).getByRole('status');
  await expect(status).toHaveText('');
  // Never inside a busy region, which a screen reader may hold back until it's done.
  expect(await status.evaluate((line) => line.closest('[aria-busy]') === null)).toBe(true);
  await status.evaluate((line) => {
    const said: string[] = [];
    Object.assign(window, { restoreSaid: said });
    new MutationObserver(() => said.push(line.textContent)).observe(line, { subtree: true, childList: true, characterData: true });
  });
  await steps(page).nth(2).getByRole('button', { name: /^Restore to here/ }).click();
  await expect(frames(page)).toHaveCount(1);
  await expect(steps(page).first()).toContainText('Restored the project to: Added frame 1A');
  await expect(status).toHaveText('');
  await expect(history(page).locator('[aria-busy="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { restoreSaid: string[] }).restoreSaid)).toContain('Restoring the project…');

  await frames(page).first().click();
  await page.keyboard.press(await undoKey(page));
  await expect(frames(page)).toHaveCount(3);
  await expect(steps(page).first()).toContainText('Undid: Restored the project to');
});

test('a second quick click on Restore to here is dropped, never restoring the step that moved under the pointer', async ({ page }) => {
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await openHistory(page);
  await expect(steps(page).first()).toContainText('Added frame 1D');
  await expect(steps(page).nth(3)).toContainText('Added frame 1A');
  const button = steps(page).nth(3).getByRole('button', { name: /^Restore to here/ });
  // Clicked by position, as a person's pointer would, so it has to be on screen first.
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) throw new Error('no button');
  // Each restore adds a step at the top, so 150 ms later the same spot holds the button of “Added frame 1B”.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(frames(page)).toHaveCount(1);
  await expect(page.getByRole('status').getByText('Restored the project to after “Added frame 1A”.', { exact: false })).toBeVisible();
  await page.waitForTimeout(700);
  await expect(frames(page)).toHaveCount(1);
  await expect(history(page).getByText('Restored the project to: ', { exact: false })).toHaveCount(1);
});

test('Restore to here on the point the project is already at says so', async ({ page }) => {
  await openHistory(page);
  await steps(page).nth(2).getByRole('button', { name: /^Restore to here/ }).click();
  await expect(frames(page)).toHaveCount(1);
  // The restore is a step of its own at the top; the point it went back to is still listed below.
  await expect(steps(page).nth(3)).toContainText('Added frame 1A');
  // After the rows settle (a click straight away would be taken for a double click).
  await page.waitForTimeout(700);
  await steps(page).nth(3).getByRole('button', { name: /^Restore to here/ }).click();
  await expect(page.getByRole('status').getByText('Nothing to restore: the project is already as it was after “Added frame 1A”.')).toBeVisible();
  await expect(history(page).getByText('Restored the project to: ', { exact: false })).toHaveCount(1);
});

test('a second quick click on Put back is dropped, never putting back the row that moved under the pointer', async ({ page }) => {
  await frames(page).first().click();
  await setLens(page, '35');
  await setLens(page, '50');
  await setLens(page, '85');
  await openHistory(page);
  await history(page).getByRole('switch', { name: 'Only frame 1A' }).click();
  const changes = history(page).getByRole('table', { name: 'Changes to frame 1A, newest first' });
  const button = changes.getByRole('button', { name: 'Put back lens 35mm' });
  // Clicked by position, as a person's pointer would, so it has to be on screen first.
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) throw new Error('no button');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(inspector(page).getByLabel('Lens (mm)')).toHaveValue('35');
  await page.waitForTimeout(700);
  await expect(inspector(page).getByLabel('Lens (mm)')).toHaveValue('35');
  await expect(changes.getByRole('row').nth(1)).toContainText(/lens\s*85mm\s*35mm/);
});

test('one frame’s own changes, field by field, with an old value to put back', async ({ page }) => {
  await frames(page).first().click();
  await setLens(page, '35');
  await setLens(page, '50');
  await openHistory(page);
  await expect(steps(page).first()).toContainText('1A: lens 35mm → 50mm');

  await history(page).getByRole('switch', { name: 'Only frame 1A' }).click();
  const changes = history(page).getByRole('table', { name: 'Changes to frame 1A, newest first' });
  await expect(changes.getByRole('row').nth(1)).toContainText('35mm');
  await expect(changes.getByRole('row').nth(1)).toContainText('50mm');
  await changes.getByRole('button', { name: 'Put back lens 35mm' }).click();
  await expect(inspector(page).getByLabel('Lens (mm)')).toHaveValue('35');
});

test('a named version opens as a copy at that point, and the original keeps every frame', async ({ page }) => {
  // With a name in the profile, so the copy's restore step says who opened it.
  const profile = await openSettings(page, 'Profile');
  await profile.getByLabel('Your name').fill('Kevin Matos');
  await profile.getByLabel('Your name').press('Enter');
  await page.keyboard.press('Escape');
  await openHistory(page);
  await history(page).getByLabel('Name this point').fill('Board sent to client');
  await history(page).getByRole('button', { name: 'Name version' }).click();
  await expect(history(page).getByRole('list', { name: 'Named versions' })).toContainText('Board sent to client');
  await expect(steps(page).first()).toContainText('Board sent to client');

  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(frames(page)).toHaveCount(4);
  // The tile says which version it's copying while the copy is made, and stops once it opens.
  const status = history(page).getByRole('status');
  await expect(status).toHaveText('');
  await status.evaluate((line) => {
    const said: string[] = [];
    Object.assign(window, { openSaid: said });
    new MutationObserver(() => said.push(line.textContent)).observe(line, { subtree: true, childList: true, characterData: true });
  });
  await history(page).getByRole('button', { name: 'Open version Board sent to client' }).click();
  // The copy shares the project's title; the notice names its file.
  await expect(page.getByRole('status').getByText(/Opened version “Board sent to client” as a separate project, “Bey County \(Board sent to client\)”/)).toBeVisible();
  await expect(frames(page)).toHaveCount(3);
  // The copy's newest step, the restore Open version made, is signed like any other.
  await expect(steps(page).first()).toContainText('Kevin Matos ·');
  await expect(history(page).getByRole('status')).toHaveText('');
  await expect(history(page).locator('[aria-busy="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { openSaid: string[] }).openSaid)).toContain('Copying “Board sent to client”…');

  // The original, from the switcher: all four frames.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Project: / }).click();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County$/ }).click();
  await expect(frames(page)).toHaveCount(4);

  // Deleting the version asks first, and leaves the steps: every one of them is still listed, only the name goes.
  const before = await steps(page).allTextContents();
  await history(page).getByRole('button', { name: 'Delete version Board sent to client' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Delete version?' })).toBeVisible();
  const said = await answerAsk(page, true);
  await expect(history(page).getByRole('list', { name: 'Named versions' })).toHaveCount(0);
  expect(said).toContain('“Board sent to client” will be deleted');
  await expect(steps(page)).toHaveCount(before.length);
  expect(await steps(page).allTextContents()).toEqual(before.map((text) => text.replace('Board sent to client', '')));
});

test('naming a version twice in a row, before the first is written, names it once', async ({ page }) => {
  await openHistory(page);
  const field = history(page).getByLabel('Name this point');
  await field.fill('Board sent to client');
  // Two Enters in the same moment, as a double press sends them: the second lands before the first name is written.
  await field.evaluate((input) => {
    for (let i = 0; i < 2; i += 1) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await expect(history(page).getByRole('list', { name: 'Named versions' }).getByRole('listitem')).toHaveCount(1);
  await expect(field).toHaveValue('');
  await expect(history(page).getByRole('list', { name: 'Named versions' }).getByRole('listitem')).toHaveCount(1);
});

/** The project files the memory build holds (src/core/storage/memoryDriver.ts), drafts included. */
const memoryFiles = (page: Page) =>
  page.evaluate(() => Object.keys(JSON.parse(window.localStorage.getItem('storiiboard.memory-files') ?? '{}') as Record<string, string>).sort());

test('Open version pressed twice in a row makes one copy', async ({ page }) => {
  await openHistory(page);
  await history(page).getByLabel('Name this point').fill('Board sent to client');
  await history(page).getByRole('button', { name: 'Name version' }).click();
  const open = history(page).getByRole('button', { name: 'Open version Board sent to client' });
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  // Two clicks in the same moment, as a double press sends them: the second lands while the first copy is made.
  await open.evaluate((button: HTMLElement) => {
    button.click();
    button.click();
  });
  await expect(page.getByRole('status').getByText(/Opened version “Board sent to client”/)).toBeVisible();
  await expect(frames(page)).toHaveCount(3);
  const copies = (await memoryFiles(page)).filter((path) => path.includes('(Board sent to client'));
  expect(copies.map((path) => path.slice(path.lastIndexOf('/') + 1))).toEqual(['Bey County (Board sent to client).sbd']);
});

test('two versions with the same name on one step are both shown, each its own', async ({ page }) => {
  const duplicateKeys: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('same key')) duplicateKeys.push(message.text());
  });
  await openHistory(page);
  for (let i = 0; i < 2; i += 1) {
    await history(page).getByLabel('Name this point').fill('Locked for shoot');
    await history(page).getByRole('button', { name: 'Name version' }).click();
    await expect(history(page).getByRole('list', { name: 'Named versions' }).getByRole('listitem')).toHaveCount(i + 1);
  }
  await expect(steps(page).first().getByText('Locked for shoot', { exact: true })).toHaveCount(2);
  // Deleting one leaves the other, in the list and on its step.
  await history(page).getByRole('button', { name: 'Delete version Locked for shoot' }).first().click();
  await answerAsk(page, true);
  await expect(history(page).getByRole('list', { name: 'Named versions' }).getByRole('listitem')).toHaveCount(1);
  await expect(steps(page).first().getByText('Locked for shoot', { exact: true })).toHaveCount(1);
  expect(duplicateKeys).toEqual([]);
});

test('Delete… from the keyboard moves focus to the next version, then to the heading once none are left', async ({ page }) => {
  await openHistory(page);
  const versions = history(page).getByRole('list', { name: 'Named versions' }).getByRole('listitem');
  const field = history(page).getByLabel('Name this point');
  await field.fill('Locked for shoot');
  await history(page).getByRole('button', { name: 'Name version' }).click();
  await expect(versions).toHaveCount(1);
  // A step between, so the two are listed in a known order: newest first.
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await field.fill('Board sent to client');
  await history(page).getByRole('button', { name: 'Name version' }).click();
  await expect(versions).toHaveCount(2);
  await expect(versions.first()).toContainText('Board sent to client');

  await history(page).getByRole('button', { name: 'Delete version Board sent to client' }).focus();
  await page.keyboard.press('Enter');
  // The question takes the keyboard too: Tab to Delete version, and Enter.
  const asked = page.getByRole('alertdialog', { name: 'Delete version?' });
  await asked.getByRole('button', { name: 'Delete version', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(versions).toHaveCount(1);
  // The row that took its place: Enter again deletes the next one, as in a list of files.
  await expect(history(page).getByRole('button', { name: 'Delete version Locked for shoot' })).toBeFocused();
  await page.keyboard.press('Enter');
  await asked.getByRole('button', { name: 'Delete version', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(history(page).getByRole('list', { name: 'Named versions' })).toHaveCount(0);
  await expect(history(page).getByRole('heading', { name: 'Named versions' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(field).toBeFocused();
});

test('a Put back from the keyboard keeps focus in the table, so the next Tab reaches the rows again', async ({ page }) => {
  await frames(page).first().click();
  await setLens(page, '35');
  await setLens(page, '50');
  await openHistory(page);
  await history(page).getByRole('switch', { name: 'Only frame 1A' }).click();
  const changes = history(page).getByRole('table', { name: 'Changes to frame 1A, newest first' });
  await changes.getByRole('button', { name: 'Put back lens 35mm' }).focus();
  await page.keyboard.press('Enter');
  await expect(inspector(page).getByLabel('Lens (mm)')).toHaveValue('35');
  await expect(changes.getByRole('row').nth(1)).toContainText(/lens\s*50mm\s*35mm/);
  await expect(changes).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(changes.getByRole('button', { name: /^Put back/ }).first()).toBeFocused();
});

test('Show older steps keeps focus in the list once the last page is in', async ({ page }) => {
  await frames(page).first().click();
  // Four steps so far; this many more puts the oldest past the first page of 100.
  for (let i = 0; i < 97; i += 1) await setLens(page, String(20 + i));
  await openHistory(page);
  await expect(steps(page)).toHaveCount(100);
  const older = history(page).getByRole('button', { name: 'Show older steps' });
  await older.focus();
  await page.keyboard.press('Enter');
  await expect(steps(page)).toHaveCount(101);
  await expect(older).toHaveCount(0);
  await expect(history(page).getByRole('list', { name: 'Steps, newest first' })).toBeFocused();
});

test('a sketch names its frame in the steps, and shows in the frame’s own history', async ({ page }) => {
  await frames(page).first().click();
  await page.keyboard.press('s');
  const editor = page.getByRole('dialog', { name: 'Sketch 1A' });
  const box = await editor.locator('[data-sketch-frame]').boundingBox();
  if (!box) throw new Error('no frame');
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) await page.mouse.move(box.x + box.width * (0.2 + 0.1 * i), box.y + box.height * (0.3 + 0.05 * i));
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await openHistory(page);
  await expect(steps(page).first()).toContainText('Sketched on 1A');
  await history(page).getByRole('switch', { name: 'Only frame 1A' }).click();
  const changes = history(page).getByRole('table', { name: 'Changes to frame 1A, newest first' });
  await expect(changes.getByRole('row').nth(1)).toContainText(/Sketched\s*—/); // no name: made with an empty profile
});

async function addField(page: Page, name: string, value: string) {
  await inspector(page).getByLabel('New field').fill(name);
  await inspector(page).getByRole('button', { name: 'Add field' }).click();
  await setField(page, name, value);
}

async function setField(page: Page, name: string, value: string) {
  const field = inspector(page).getByRole('textbox', { name, exact: true });
  await field.fill(value);
  await field.press('Enter');
}

const fontOf = (where: Locator, text: string) =>
  where.locator('.font-mono', { hasText: text }).first().evaluate((el) => getComputedStyle(el).fontFamily);

test('a custom field goes back on its own, its values shown, and the value already there isn’t offered', async ({ page }) => {
  await frames(page).first().click();
  await addField(page, 'Drone', 'Mavic 3');
  await setField(page, 'Drone', 'FPV');
  await addField(page, 'VFX', 'Sky replace');
  await openHistory(page);
  await expect(steps(page).first()).toContainText('1A: VFX — → Sky replace');
  await expect(steps(page).nth(1)).toContainText('1A: added the field VFX');
  await expect(steps(page).nth(2)).toContainText('1A: Drone Mavic 3 → FPV');

  await history(page).getByRole('switch', { name: 'Only frame 1A' }).click();
  const changes = history(page).getByRole('table', { name: 'Changes to frame 1A, newest first' });
  await expect(changes.getByRole('row').nth(2)).toContainText(/VFX\s*no field\s*—\s*—/);
  await expect(changes.getByRole('row').nth(3)).toContainText(/Drone\s*Mavic 3\s*FPV\s*—/);
  await changes.getByRole('button', { name: 'Put back Drone Mavic 3', exact: true }).click();
  await expect(inspector(page).getByRole('textbox', { name: 'Drone', exact: true })).toHaveValue('Mavic 3');
  await expect(inspector(page).getByRole('textbox', { name: 'VFX', exact: true })).toHaveValue('Sky replace');
  // Mavic 3 is on the frame again: nothing to put back from that change now.
  await expect(changes.getByRole('row').nth(1)).toContainText(/Drone\s*FPV\s*Mavic 3/);
  await expect(changes.getByRole('button', { name: 'Put back Drone Mavic 3', exact: true })).toHaveCount(0);
});

test('a new selection never shows the frame selected before, so Put back can’t reach it', async ({ page }) => {
  await frames(page).first().click();
  await setLens(page, '35');
  await openHistory(page);
  await history(page).getByRole('switch', { name: 'Only frame 1A' }).click();
  await expect(history(page).getByRole('table', { name: 'Changes to frame 1A, newest first' })).toContainText('35mm');

  // Every state the tile passes through on its way to 1B's changes, however briefly.
  await history(page).evaluate((tile) => {
    const seen: string[] = [];
    Object.assign(window, { historySeen: seen });
    new MutationObserver(() => seen.push(tile.textContent)).observe(tile, { subtree: true, childList: true, characterData: true });
  });
  await frames(page).nth(1).click();
  const changes = history(page).getByRole('table', { name: 'Changes to frame 1B, newest first' });
  await expect(changes).toContainText('Added');
  await expect(changes).not.toContainText('35mm');
  const seen = await page.evaluate(() => (window as unknown as { historySeen: string[] }).historySeen);
  expect(seen.filter((text) => text.includes('Only frame 1B') && text.includes('35mm'))).toEqual([]);
});

test('a long, multi-line old action reads in full in the frame’s own history, and Put back brings all of it', async ({ page }) => {
  const action = 'INT. KITCHEN - she turns from the window,\nsees him at the door, drops the cup.';
  await frames(page).first().click();
  const area = inspector(page).getByLabel('Action');
  await area.fill(action);
  await area.blur();
  await area.fill('x');
  await area.blur();
  await openHistory(page);
  await expect(steps(page).first()).toContainText('1A: action INT. KITCHEN - she turns from the windo… → x');
  await history(page).getByRole('switch', { name: 'Only frame 1A' }).click();
  const changes = history(page).getByRole('table', { name: 'Changes to frame 1A, newest first' });
  const before = changes.getByRole('row').nth(1).getByRole('cell').nth(1);
  await expect(before).toContainText('drops the cup.');
  expect(await before.evaluate((cell) => (cell as HTMLElement).innerText)).toBe(action);
  await changes.getByRole('button', { name: /^Put back action INT\. KITCHEN .*drops the cup\.$/ }).click();
  await expect(inspector(page).getByLabel('Action')).toHaveValue(action);
});

test('a scene’s own changes, field by field, with its old name to put back', async ({ page }) => {
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  const name = inspector(page).getByLabel('Name');
  await name.fill('Penn Station');
  await name.press('Enter');
  await name.fill('Dock');
  await name.press('Enter');
  await openHistory(page);
  await expect(steps(page).first()).toContainText('SC 02: name Penn Station → Dock');
  await history(page).getByRole('switch', { name: 'Only scene SC 02' }).click();
  const changes = history(page).getByRole('table', { name: 'Changes to scene SC 02, newest first' });
  await expect(changes.getByRole('row').nth(1)).toContainText(/name\s*Penn Station\s*Dock/);
  await changes.getByRole('button', { name: 'Put back name Penn Station' }).click();
  await expect(inspector(page).getByLabel('Name')).toHaveValue('Penn Station');
  await expect(changes.getByRole('row').nth(1)).toContainText(/name\s*Dock\s*Penn Station/);
});

test('shot numbers, lens and T-stop are set in mono, in the steps and the frame’s toggle', async ({ page }) => {
  await frames(page).first().click();
  await setLens(page, '50');
  await openHistory(page);
  await expect(steps(page).first()).toContainText('1A: lens — → 50mm');
  expect(await fontOf(steps(page).first(), '50mm')).toContain('JetBrains Mono');
  expect(await fontOf(steps(page).first(), '1A')).toContain('JetBrains Mono');
  expect(await fontOf(history(page), '1A')).toContain('JetBrains Mono');
  await expect(history(page).getByRole('switch', { name: 'Only frame 1A' })).toBeVisible();
});

test('a step whose picture Clean up old pictures deleted says so at once, with History open beside it', async ({ page }) => {
  await frames(page).first().click();
  const chooser = page.waitForEvent('filechooser');
  await inspector(page).getByRole('button', { name: 'Choose picture…' }).click();
  await (await chooser).setFiles(fileURLToPath(new URL('./fixtures/images/srgb.jpg', import.meta.url)));
  await expect(frames(page).first().locator('img[data-frame-image]')).toBeVisible();
  // Undone: only History uses the picture now.
  await page.keyboard.press(await undoKey(page));
  await expect(frames(page).first().locator('img[data-frame-image]')).toHaveCount(0);

  await openHistory(page);
  const pictureStep = steps(page).filter({ hasText: /^Set the picture of 1A/ });
  await expect(pictureStep).toHaveCount(1);
  await expect(pictureStep).not.toContainText('(picture removed)');

  // From Settings, which opens over the workspace: History stays in sight behind it.
  const storage = await openSettings(page, 'Storage');
  await storage.getByRole('button', { name: 'Clean up old pictures…' }).click();
  await answerAsk(page, true);
  // No record and no undo state changed, yet the step reads again.
  await expect(pictureStep).toContainText('(picture removed)');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`History passes axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await openHistory(page);
    await expect(steps(page)).toHaveCount(4);
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  });
}

test('the project menu in groups, and its shortcuts: ⌘⇧H History, ⌘E Export, ⌘, Settings (polish A)', async ({ page }) => {
  const project = page.getByRole('button', { name: 'Project', exact: true });
  await project.click();
  const panel = page.locator(`[id="${(await project.getAttribute('aria-controls')) ?? ''}"]`);
  await expect(panel.getByRole('group')).toHaveCount(2);
  await expect(panel.getByRole('group').nth(0).getByRole('button')).toHaveText([/^History/, /^Settings…/]);
  await expect(panel.getByRole('group').nth(1).getByRole('button')).toHaveText([/^Export Project…/, 'Watermark Settings…']);
  // Archive on its own at the bottom.
  await expect(panel.getByRole('button').last()).toHaveText('Archive Project');
  await page.keyboard.press('Escape');

  const mod = (await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+Shift+KeyH`);
  await expect(history(page)).toBeVisible();
  await page.keyboard.press(`${mod}+KeyE`);
  await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();
  // Inside a window the app's shortcuts wait: ⌘, does nothing over Export.
  await page.keyboard.press(`${mod}+Comma`);
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${mod}+Comma`);
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
});

test('a shortcut the menu shows, pressed with the menu open, closes it and leaves focus where it went', async ({ page }) => {
  const mod = (await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control';
  const project = page.getByRole('button', { name: 'Project', exact: true });
  await project.click();
  const panel = page.locator(`[id="${(await project.getAttribute('aria-controls')) ?? ''}"]`);
  await page.keyboard.press(`${mod}+Shift+KeyH`);
  await expect(history(page)).toBeVisible();
  await expect(panel).toHaveCount(0);
  expect(await history(page).evaluate((tile) => tile.contains(document.activeElement))).toBe(true);

  // ⌘E over an open menu: Escape closes Export alone, and the menu stays closed.
  await project.click();
  await page.keyboard.press(`${mod}+KeyE`);
  await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();
  await expect(panel).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Export' })).toHaveCount(0);
  // The menu item that opened it went with the menu: focus lands on the workspace rather than the page.
  await expect(page.locator('#workspace-panel')).toBeFocused();
  // Typing in a field: ⌘E still opens Export, as menus' shortcuts do anywhere.
  await history(page).getByLabel('Name this point').focus();
  await page.keyboard.press(`${mod}+KeyE`);
  await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();
});

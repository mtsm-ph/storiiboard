import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// The History tile (1.22) in the memory build: every step in words, newest first; Restore to here as a step of its
// own; and one frame's own changes, field by field, with an old value to put back.

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

async function openHistory(page: Page) {
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(history(page)).toBeVisible();
}

async function setLens(page: Page, mm: string) {
  const lens = inspector(page).getByLabel('Lens (mm)');
  await lens.fill(mm);
  await lens.press('Enter');
}

test('lists every step in words, newest first, and Restore to here is a step undo takes back', async ({ page }) => {
  await openHistory(page);
  await expect(steps(page).first()).toContainText('Added frame 1C');
  await expect(steps(page).nth(3)).toContainText('Added scene SC 01');

  // Back to just after the first frame: two frames go, as one new step.
  await steps(page).nth(2).getByRole('button', { name: /^Restore to here/ }).click();
  await expect(frames(page)).toHaveCount(1);
  await expect(steps(page).first()).toContainText('Restored the project to: Added frame 1A');

  await frames(page).first().click();
  await page.keyboard.press(await undoKey(page));
  await expect(frames(page)).toHaveCount(3);
  await expect(steps(page).first()).toContainText('Undid: Restored the project to');
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
  await expect(changes.getByRole('row').nth(1)).toContainText(/Sketched\s*You/);
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
  await expect(changes.getByRole('row').nth(2)).toContainText(/VFX\s*no field\s*—\s*You/);
  await expect(changes.getByRole('row').nth(3)).toContainText(/Drone\s*Mavic 3\s*FPV\s*You/);
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

for (const scheme of ['light', 'dark'] as const) {
  test(`History passes axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await openHistory(page);
    await expect(steps(page)).toHaveCount(4);
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  });
}

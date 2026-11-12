import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// Decks (5.5) in the memory build: a deck made from each template, the Pages panel (reorder by keyboard, 9:16 and 4:5 pages),
// field cards that read the project, and Present. The canvas is pixels, so the tests read the board's items from its data
// (data-board-data, data-board-fields) and the presentation's from its own hooks (data-present-*).

test.use({ viewport: { width: 1440, height: 900 } });

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

interface Item {
  id: string;
  kind: string;
  name: string;
  format: string;
  orientation: string;
  field: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const tile = (page: Page) => page.getByRole('region', { name: 'Moodboard', exact: true });
const items = async (page: Page): Promise<Item[]> => JSON.parse((await tile(page).locator('[data-board-data]').getAttribute('data-board-data')) ?? '[]') as Item[];
const fields = async (page: Page): Promise<{ id: string; field: string; text: string }[]> =>
  JSON.parse((await tile(page).locator('[data-board-fields]').getAttribute('data-board-fields')) ?? '[]') as { id: string; field: string; text: string }[];
const pagesOf = async (page: Page) => (await items(page)).filter((i) => i.kind === 'page');
const panel = (page: Page) => tile(page).getByRole('complementary', { name: 'Pages' });
const rows = (page: Page) => panel(page).locator('[data-page-row]');
const present = (page: Page) => page.locator('[data-present]');

const TEMPLATES = { Blank: 1, Treatment: 3, Lookbook: 2, Pitch: 6, 'Shot list': 1 } as const;

async function openPicker(page: Page) {
  await sidebar(page).getByRole('button', { name: /^Moodboard/ }).click();
  await expect(tile(page).getByRole('button', { name: 'New deck' })).toBeVisible();
}

/** New deck with a name and template (and a format for Blank); the deck opens. */
async function newDeck(page: Page, name: string, template: keyof typeof TEMPLATES, format?: string) {
  await tile(page).getByRole('button', { name: 'New deck' }).click();
  await tile(page).getByLabel('Deck name').fill(name);
  await tile(page).getByLabel('Template').selectOption({ label: template });
  if (format) await tile(page).getByLabel('Page format').selectOption({ label: format });
  await tile(page).getByRole('button', { name: 'Create deck' }).click();
  await expect(page.getByRole('application', { name: `${name} board` })).toBeVisible();
  await page.waitForTimeout(100);
}

test('makes a deck from each template, with its pages in a row 200 units apart', async ({ page }) => {
  await openPicker(page);
  for (const [template, count] of Object.entries(TEMPLATES) as [keyof typeof TEMPLATES, number][]) {
    await newDeck(page, `${template} deck`, template);
    const pages = await pagesOf(page);
    expect(pages, template).toHaveLength(count);
    await expect(rows(page)).toHaveCount(count);
    pages.slice(1).forEach((p, i) => {
      const before = pages[i] as Item;
      expect(p.x).toBe(before.x + before.width + 200);
    });
    // The first page of a Treatment is paper, of a Shot list landscape paper, of the others 16:9; a deck never has an item outside its pages.
    const first = pages[0] as Item;
    if (template === 'Treatment') expect([first.format, first.orientation]).toEqual([expect.stringMatching(/^(a4|letter)$/), 'portrait']);
    if (template === 'Shot list') expect([first.format, first.orientation]).toEqual([expect.stringMatching(/^(a4|letter)$/), 'landscape']);
    if (template === 'Lookbook' || template === 'Pitch') expect(first.format).toBe('16:9');
    await tile(page).locator('[data-boards-back]').click();
    await expect(tile(page).getByRole('button', { name: `${template} deck` })).toBeVisible();
  }
  // The picker lists them with the boards, marked as decks.
  await expect(tile(page).locator('[data-board-open]').filter({ hasText: 'Deck' })).toHaveCount(5);
});

test('reorders the pages in the panel from the keyboard, and adds a 9:16 and a 4:5 page', async ({ page }) => {
  await openPicker(page);
  await newDeck(page, 'Pitch', 'Pitch');
  const names = async () => (await rows(page).locator('[data-user-text]').allInnerTexts()).slice(0, 3);
  expect(await names()).toEqual(['Title', 'Logline', 'The team']);
  const down = panel(page).getByRole('button', { name: 'Move Page 2, Logline down' });
  await down.focus();
  await page.keyboard.press('Enter');
  await expect.poll(names).toEqual(['Title', 'The team', 'Logline']);
  // The numbers follow the order; the canvas draws the same order.
  await expect(rows(page).nth(1)).toContainText('2');
  expect((await pagesOf(page)).map((p) => p.name).slice(0, 3)).toEqual(['Title', 'The team', 'Logline']);
  // Focus stays on the same page's button, which moved.
  await expect(panel(page).getByRole('button', { name: 'Move Page 3, Logline down' })).toBeFocused();
  await panel(page).getByRole('button', { name: 'Move Page 3, Logline up' }).press('Enter');
  await expect.poll(names).toEqual(['Title', 'Logline', 'The team']);
  // A 9:16 and a 4:5 page.
  for (const format of ['9:16 vertical', '4:5 portrait']) {
    await panel(page).getByLabel('Page format').selectOption({ label: format });
    await panel(page).getByRole('button', { name: 'Add page' }).click();
  }
  await expect(rows(page)).toHaveCount(8);
  const added = (await pagesOf(page)).slice(-2);
  expect(added.map((p) => [p.format, p.width, p.height])).toEqual([
    ['9:16', 1080, 1920],
    ['4:5', 1080, 1350],
  ]);
  const all = await pagesOf(page);
  expect(added[0]?.x).toBe((all[5]?.x ?? 0) + (all[5]?.width ?? 0) + 200);
});

test('shows a change to the logline in Settings on the field card', async ({ page }) => {
  await openPicker(page);
  await newDeck(page, 'Pitch', 'Pitch');
  const logline = async () => (await fields(page)).find((f) => f.field === 'logline');
  expect((await logline())?.text).toBe('');
  const cardBefore = (await items(page)).find((i) => i.field === 'logline');
  const project = await openSettings(page, 'Project');
  await project.getByLabel('Logline').fill('A diner at dawn.');
  await project.getByLabel('Logline').press('Enter');
  await closeSettings(page);
  await expect.poll(async () => (await logline())?.text).toBe('A diner at dawn.');
  expect((await fields(page)).find((f) => f.field === 'title')?.text).toBe('Bey County');
  // Nothing was written to the card: its stored props are exactly what they were, and the step is the project's, not the card's.
  expect((await items(page)).find((i) => i.field === 'logline')).toEqual(cardBefore);
  await page.getByRole('button', { name: 'History' }).click();
  const history = page.getByRole('region', { name: 'History', exact: true });
  await expect(history).toContainText(/logline/i);
  await expect(history).not.toContainText('Logline field card');
});

test('presents page by page: next, previous, End, Escape returns focus, and nothing outside the pages is shown', async ({ page }) => {
  await openPicker(page);
  await newDeck(page, 'Pitch', 'Pitch');
  const canvas = page.getByRole('application', { name: 'Pitch board' });
  // A sticky note near the top of the canvas, above the first page (the deck opens fitted to it), so on no page.
  await tile(page).getByRole('button', { name: /^Sticky/ }).click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width / 2, box.y + 40);
  await page.keyboard.type('Working space');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await items(page)).filter((i) => i.kind === 'sticky').length).toBe(1);
  const sticky = (await items(page)).find((i) => i.kind === 'sticky') as Item;
  const pages = await pagesOf(page);
  // The sticky is wholly inside no page.
  for (const p of pages) {
    const inside = sticky.x >= p.x && sticky.y >= p.y && sticky.x + sticky.width <= p.x + p.width && sticky.y + sticky.height <= p.y + p.height;
    expect(inside).toBe(false);
  }
  const button = tile(page).getByRole('button', { name: 'Present', exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(present(page)).toBeVisible();
  await expect(present(page)).toHaveAttribute('data-present-page', '1');
  await expect(present(page)).toHaveAttribute('data-present-count', '6');
  await expect(present(page).getByRole('status')).toHaveText('Page 1 of 6, Title');
  const shown = async () => JSON.parse((await present(page).getAttribute('data-present-items')) ?? '[]') as string[];
  // What the renderer itself drew (PageStage's own hook), not what the sequence says.
  const drawn = async () => JSON.parse((await present(page).locator('[data-stage-items]').getAttribute('data-stage-items', { timeout: 3000 })) ?? '[]') as string[];
  await page.keyboard.press('ArrowRight');
  await expect(present(page).getByRole('status')).toHaveText('Page 2 of 6, Logline');
  await page.keyboard.press('Space');
  await page.keyboard.press('PageDown');
  await expect(present(page)).toHaveAttribute('data-present-page', '4');
  await expect(present(page).getByRole('status')).toHaveText('Page 4 of 6, The look');
  await page.keyboard.press('ArrowLeft');
  await expect(present(page)).toHaveAttribute('data-present-page', '3');
  await page.keyboard.press('PageUp');
  await expect(present(page)).toHaveAttribute('data-present-page', '2');
  await page.keyboard.press('End');
  await expect(present(page)).toHaveAttribute('data-present-page', '6');
  await expect(present(page).getByRole('status')).toHaveText('Page 6 of 6, Closing');
  await page.keyboard.press('ArrowRight');
  await expect(present(page)).toHaveAttribute('data-present-page', '6');
  await page.keyboard.press('Home');
  await expect(present(page)).toHaveAttribute('data-present-page', '1');
  // Every page, in turn: the sticky is on none of them, and nothing but this page's own items is.
  for (let n = 1; n <= pages.length; n += 1) {
    await expect(present(page)).toHaveAttribute('data-present-page', String(n));
    expect(await shown()).not.toContain(sticky.id);
    const stage = await drawn();
    expect(stage).not.toContain(sticky.id);
    expect(stage[0]).toBe(pages[n - 1]?.id);
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.press('Escape');
  await expect(present(page)).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('starts on the selected page, and is a no-op without pages', async ({ page }) => {
  await openPicker(page);
  await newDeck(page, 'Social', 'Blank', '9:16 vertical');
  await rows(page).first().getByRole('button', { name: 'Delete Page 1' }).click();
  await expect(rows(page)).toHaveCount(0);
  const button = tile(page).getByRole('button', { name: 'Present', exact: true });
  await expect(button).toBeDisabled();
  await expect(tile(page).getByText('Add a page to present.')).toBeVisible();
  await page.keyboard.press('Control+Alt+KeyP');
  await expect(present(page)).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Add page' }).click();
  await panel(page).getByRole('button', { name: 'Add page' }).click();
  await expect(rows(page)).toHaveCount(2);
  await rows(page).nth(1).locator('[data-page-select]').click();
  await page.keyboard.press('Control+Alt+KeyP');
  await expect(present(page)).toHaveAttribute('data-present-page', '2');
  await page.keyboard.press('Escape');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`passes axe with the Pages panel and the presentation open, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await openPicker(page);
    const rules = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    const check = async () => {
      await page.evaluate(() => document.fonts.ready.then(() => true));
      const result = await new AxeBuilder({ page }).withTags(rules).analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    };
    // The picker with the New deck form open.
    await tile(page).getByRole('button', { name: 'New deck' }).click();
    await check();
    await tile(page).getByLabel('Deck name').fill('Pitch');
    await tile(page).getByLabel('Template').selectOption({ label: 'Pitch' });
    await tile(page).getByRole('button', { name: 'Create deck' }).click();
    await expect(page.getByRole('application', { name: 'Pitch board' })).toBeVisible();
    await expect(panel(page)).toBeVisible();
    await check();
    // A page selected, with its colour in the strip.
    await rows(page).first().locator('[data-page-select]').click();
    await expect(tile(page).getByRole('group', { name: 'Properties of the selection' })).toBeVisible();
    await check();
    await tile(page).getByRole('button', { name: 'Present', exact: true }).click();
    await expect(present(page)).toBeVisible();
    await check();
    await page.keyboard.press('Escape');
    await expect(present(page)).toHaveCount(0);
  });
}

test('keeps the keys to itself while presenting: Undo changes nothing in the project', async ({ page }) => {
  await openPicker(page);
  await newDeck(page, 'Pitch', 'Pitch');
  await expect(rows(page)).toHaveCount(6);
  await tile(page).getByRole('button', { name: 'Present', exact: true }).click();
  await expect(present(page)).toBeVisible();
  const mod = (await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control';
  // The deck was the last edit: an undo behind the presentation would take it away.
  await page.keyboard.press(`${mod}+z`);
  await page.keyboard.press('Alt+2');
  await page.keyboard.press(`${mod}+,`);
  await expect(present(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(present(page)).toHaveCount(0);
  await expect(page.getByRole('application', { name: 'Pitch board' })).toBeVisible();
  await expect(rows(page)).toHaveCount(6);
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
});

test('adds a field card from the Add field menu with the keyboard', async ({ page }) => {
  await openPicker(page);
  await newDeck(page, 'Social', 'Blank', '9:16 vertical');
  expect(await fields(page)).toEqual([]);
  const add = tile(page).getByRole('button', { name: 'Add field' });
  await add.focus();
  await page.keyboard.press('Enter');
  await expect(add).toHaveAttribute('aria-expanded', 'true');
  const crew = tile(page).getByRole('button', { name: 'Crew', exact: true });
  await crew.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await fields(page)).map((f) => f.field)).toEqual(['crew']);
});

test('traps Tab inside the presentation, exits with Enter on Exit, and the clipboard and Undo are the app again after it', async ({ page }) => {
  await openPicker(page);
  await newDeck(page, 'Pitch', 'Pitch');
  const button = tile(page).getByRole('button', { name: 'Present', exact: true });
  await button.click();
  await expect(present(page)).toBeFocused();
  const exit = present(page).getByRole('button', { name: 'Exit' });
  // Tab goes to Exit and back to the presentation, never out to the app behind it.
  await page.keyboard.press('Tab');
  await expect(exit).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(present(page)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(exit).toBeFocused();
  // A paste, a cut and a copy during the presentation reach nothing behind it.
  const reached = await page.evaluate(() => {
    let seen = 0;
    for (const name of ['paste', 'cut', 'copy']) window.addEventListener(name, () => (seen += 1));
    const results = ['paste', 'cut', 'copy'].map((name) => {
      const data = new DataTransfer();
      data.setData('text/plain', 'https://example.com');
      return document.body.dispatchEvent(new ClipboardEvent(name, { clipboardData: data, bubbles: true, cancelable: true }));
    });
    return { seen, results };
  });
  expect(reached).toEqual({ seen: 0, results: [false, false, false] });
  await page.keyboard.press('Enter');
  await expect(present(page)).toHaveCount(0);
  await expect(button).toBeFocused();
  // Undo is the project's again: the deck was the last edit, so it goes.
  const mod = (await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+z`);
  await expect(page.getByRole('application', { name: 'Pitch board' })).toHaveCount(0);
});

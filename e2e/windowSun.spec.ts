import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// Sun through the windows and heights for the 3D set (6.5.6) in the memory build. A closed room with north up the plan
// and a sun path with its own place (Inwood, New York) and date (21 June 2026); a window in the south wall: the Selection
// tile says it faces S, its hours of direct sun and that what stands outside isn't known. Dragged to the north wall, it
// faces N and its hours change. Its sill and top typed (the top in feet), a top under the sill refused in a line under the
// fields; the room's ceiling typed in feet; undo takes each back. The compass opens every outside window's hours. axe on
// the new fields.
//
// The browser build answers a sun path's own coordinates with this computer's zone (as quickSun.spec.ts says), so the
// browser is set to New York here.

test.use({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/New_York', deviceScaleFactor: 1 });

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
  level: string;
  wallId?: string;
  width?: number;
}

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const selectionTile = (page: Page) => page.getByRole('region', { name: 'Selection', exact: true });
const libraryTile = (page: Page) => page.getByRole('region', { name: 'Library', exact: true });
const canvas = (page: Page) => planTile(page).locator('[data-canvas]');
const compass = (page: Page) => planTile(page).locator('[data-compass-button]');
const items = async (page: Page): Promise<Item[]> => JSON.parse((await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as Item[];
const ofKind = async (page: Page, kind: string) => (await items(page)).filter((i) => i.kind === kind);
const selection = async (page: Page): Promise<string[]> => JSON.parse((await canvas(page).getAttribute('data-selection')) ?? '[]') as string[];
const field = (page: Page, name: string) => selectionTile(page).getByRole('textbox', { name, exact: true });
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Where a world point (canvas units: cm) is on screen, from the view the canvas reports. */
async function screen(page: Page, x: number, y: number) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  const attr = async (name: string) => Number(await canvas(page).getAttribute(name));
  const zoom = await attr('data-zoom');
  return { x: box.x + box.width / 2 + (x - (await attr('data-cx'))) * zoom, y: box.y + box.height / 2 + (y - (await attr('data-cy'))) * zoom };
}
async function clickAt(page: Page, x: number, y: number) {
  const at = await screen(page, x, y);
  await page.mouse.click(at.x, at.y);
}

test('a window’s sun: its facing and hours, changed by its wall; its sill and top, the room’s ceiling, each undone', async ({ page }) => {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Meters' });
  await closeSettings(page, 'apply');
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();

  // A closed 4 × 3 m room, drawn point to point round its corners.
  await canvas(page).focus();
  await page.keyboard.press('w');
  for (const [x, y] of [
    [-200, -150],
    [200, -150],
    [200, 150],
    [-200, 150],
    [-200, -150],
  ] as const) {
    await clickAt(page, x, y);
  }
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await ofKind(page, 'wall')).map((w) => w.width)).toEqual([4, 3, 4, 3]);
  const [top, , bottom] = await ofKind(page, 'wall');

  // North up the plan, from the Library.
  const northButton = libraryTile(page).locator('[data-library-icon="production/north"]');
  await northButton.scrollIntoViewIfNeeded();
  await northButton.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await ofKind(page, 'north')).length).toBe(1);

  // Quick sun: a sun path with its own place and date.
  await compass(page).click();
  await planTile(page).getByRole('button', { name: 'Add sun path' }).click();
  await expect.poll(async () => (await ofKind(page, 'sun')).length).toBe(1);
  const ownPlace = selectionTile(page).getByRole('textbox', { name: 'Its own place', exact: true });
  await ownPlace.fill('40.8677, -73.9212');
  await ownPlace.press('Enter');
  const ownDate = selectionTile(page).getByLabel('Its own date', { exact: true });
  await ownDate.fill('2026-06-21');
  await ownDate.press('Enter');
  await expect(selectionTile(page).locator('[data-sun-zone]')).toHaveText('Times in America/New_York, from the coordinates');

  // A window in the south wall: it faces S, with its hours and the line about what's outside.
  await canvas(page).focus();
  await page.keyboard.press('n');
  await clickAt(page, 0, 150);
  await expect.poll(async () => (await ofKind(page, 'window')).map((w) => w.wallId)).toEqual([bottom?.id]);
  const windowId = (await ofKind(page, 'window'))[0]?.id ?? '';
  await page.keyboard.press('Escape');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'select');
  await clickAt(page, 0, 150);
  await expect.poll(() => selection(page)).toEqual([windowId]);
  const sun = selectionTile(page).locator('[data-window-sun]');
  await expect(sun).toHaveAttribute('data-window-sun', 'outside');
  await expect(sun.locator('[data-window-facing]')).toHaveAttribute('data-window-facing', 'S');
  await expect(sun.locator('[data-window-facing]')).toHaveText('Facing S · 180°');
  const hours = sun.locator('[data-window-hours]');
  await expect(hours).toHaveText(/^Direct sun: \d\d:\d\d to \d\d:\d\d$/);
  const southHours = await hours.textContent();
  await expect(sun.locator('[data-window-unknown]')).toHaveText('Buildings and trees outside aren’t known.');

  // Dragged to the north wall: it faces N, and the hours change (early morning and evening).
  const from = await screen(page, 0, 150);
  const to = await screen(page, 0, -150);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await ofKind(page, 'window')).map((w) => w.wallId)).toEqual([top?.id]);
  await expect(sun.locator('[data-window-facing]')).toHaveAttribute('data-window-facing', 'N');
  await expect(hours).toHaveText(/^Direct sun: \d\d:\d\d to \d\d:\d\d and \d\d:\d\d to \d\d:\d\d$/);
  expect(await hours.textContent()).not.toBe(southHours);

  // Its sill and top: the top typed in feet, shown in metres; a top under the sill refused, said under the fields.
  await field(page, 'Sill height').fill('0.9 m');
  await field(page, 'Sill height').press('Enter');
  await expect(field(page, 'Sill height')).toHaveValue('0.90 m');
  await field(page, 'Top height').fill('0.5 m');
  await field(page, 'Top height').press('Enter');
  await expect(selectionTile(page).locator('[data-height-refused]')).toHaveText('The top has to be above the sill.');
  await expect(field(page, 'Top height')).toHaveValue('');
  await field(page, 'Top height').fill('7ft');
  await field(page, 'Top height').press('Enter');
  await expect(field(page, 'Top height')).toHaveValue('2.13 m');
  await expect(selectionTile(page).locator('[data-height-refused]')).toHaveCount(0);
  // With both set, its height is the glass between them, shown and not typed.
  await expect(field(page, 'Height')).toHaveValue('1.23 m');
  await expect(field(page, 'Height')).toHaveAttribute('readonly', '');
  await expect(selectionTile(page).locator('[data-height-from-glass]')).toHaveText('Its height is the top less the sill while both are set.');
  // The hours stay as they were: a sill and a top never change them.
  await expect(hours).toHaveText(/ and /);
  for (const theme of ['light', 'dark'] as const) {
    await page.locator('html').evaluate((html, value) => {
      html.setAttribute('data-theme', value);
    }, theme);
    const { violations } = await new AxeBuilder({ page }).include('[data-window-heights]').include('[data-window-sun]').withTags(tags).analyze();
    expect(violations, theme).toEqual([]);
  }
  await page.locator('html').evaluate((html) => {
    html.setAttribute('data-theme', 'light');
  });

  // The room's ceiling, typed in feet; one under the window refused.
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => selection(page)).toEqual([]);
  await field(page, 'Ceiling height').fill('8ft');
  await field(page, 'Ceiling height').press('Enter');
  await expect(field(page, 'Ceiling height')).toHaveValue('2.44 m');
  await field(page, 'Ceiling height').fill('2 m');
  await field(page, 'Ceiling height').press('Enter');
  await expect(selectionTile(page).locator('[data-height-refused]')).toHaveText('A window in the room reaches higher than that.');
  await expect(field(page, 'Ceiling height')).toHaveValue('2.44 m');
  const { violations } = await new AxeBuilder({ page }).include('[data-ceiling]').withTags(tags).analyze();
  expect(violations).toEqual([]);

  // The compass opens north and the sun path, with every outside window's hours.
  await compass(page).click();
  await expect.poll(async () => (await selection(page)).length).toBe(2);
  const list = selectionTile(page).locator('[data-window-sun-list]');
  await expect(list.locator(`[data-window-sun-item="${windowId}"]`)).toHaveText(/^Window, facing N: \d\d:\d\d to \d\d:\d\d and \d\d:\d\d to \d\d:\d\d$/);
  await expect(list).toContainText('Buildings and trees outside aren’t known.');

  // Undo takes back the ceiling, the top, the sill and the move, one at a time.
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  const undo = async () => {
    await canvas(page).focus();
    await page.keyboard.press(`${await mod(page)}+z`);
  };
  await undo();
  await expect(field(page, 'Ceiling height')).toHaveValue('');
  await clickAt(page, 0, -150);
  await expect.poll(() => selection(page)).toEqual([windowId]);
  await undo();
  await expect(field(page, 'Top height')).toHaveValue('');
  await expect(field(page, 'Sill height')).toHaveValue('0.90 m');
  await undo();
  await expect(field(page, 'Sill height')).toHaveValue('');
  await undo();
  await expect.poll(async () => (await ofKind(page, 'window')).map((w) => w.wallId)).toEqual([bottom?.id]);
  await expect(sun.locator('[data-window-facing]')).toHaveAttribute('data-window-facing', 'S');
  await expect(hours).toHaveText(southHours ?? '');
});

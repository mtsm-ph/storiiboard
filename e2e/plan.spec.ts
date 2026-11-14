import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// The plan in real units (6.2a) in the memory build: a scene's setup picked in the Setups tile, its room started, three
// walls drawn point to point (the second by typing 3.5m, the third, with the plan in feet, by typing 12' 6"), read and
// changed in the Selection tile, moved and turned, a run undone and redone, a wall deleted and restored from the Trash,
// all there after a reload; the plan stays paper in dark; the keyboard path; and axe on both tiles. The canvas is pixels,
// so the tests read the plan from the data its tile keeps (data-plan-data, in metres) and the canvas's own attributes.

test.use({ viewport: { width: 1440, height: 900 } });

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
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
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

interface Wall {
  id: string;
  width: number;
  height: number;
  rotation: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const selectionTile = (page: Page) => page.getByRole('region', { name: 'Selection', exact: true });
const canvas = (page: Page) => planTile(page).locator('[data-canvas]');
const walls = async (page: Page): Promise<Wall[]> => JSON.parse((await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as Wall[];
const widths = async (page: Page) => (await walls(page)).map((w) => w.width);
const selection = async (page: Page): Promise<string[]> => JSON.parse((await canvas(page).getAttribute('data-selection')) ?? '[]') as string[];
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');

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
async function moveTo(page: Page, x: number, y: number) {
  const at = await screen(page, x, y);
  await page.mouse.move(at.x, at.y, { steps: 4 });
}
const field = (page: Page, name: string): Locator => selectionTile(page).getByRole('textbox', { name, exact: true });

async function setUnits(page: Page, label: 'Metres' | 'Feet and inches') {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label });
  await closeSettings(page);
}

/** The Setup workspace on SC 01's Setup 1, its room started. */
async function startRoom(page: Page) {
  // Metres whatever this computer's region says (feet in the US).
  await setUnits(page, 'Metres');
  await toSection(page, 'Setup');
  await expect(planTile(page)).toContainText('Pick a setup, or a scene’s heading, in the Setups tile to see its plan.');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 01 · Setup 1');
  await expect(planTile(page)).toContainText('SC 01 has no room yet.');
  await planTile(page).getByRole('button', { name: 'Start the room' }).click();
  await expect(canvas(page)).toBeVisible();
  await expect(selectionTile(page)).toContainText('Used by 1 scene');
}

/** Draws the three walls: a 3 m one by two clicks, 3.5m typed, then in feet 12' 6" typed. */
async function drawThree(page: Page) {
  await canvas(page).focus();
  await page.keyboard.press('w');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'host:wall');
  await clickAt(page, -150, -150);
  await clickAt(page, 150, -150);
  await moveTo(page, 150, 0);
  await page.keyboard.type('3.5m');
  await expect(planTile(page).locator('[data-path-length]')).toHaveAttribute('data-path-length', '3.5m');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(() => widths(page)).toEqual([3, 3.5]);
  await expect(canvas(page)).toHaveAttribute('data-tool', 'select');

  await setUnits(page, 'Feet and inches');
  await expect(planTile(page).locator('[data-plan-unit]')).toHaveAttribute('data-plan-unit', 'feet');
  await canvas(page).focus();
  await page.keyboard.press('w');
  // The second wall's end: the click joins it.
  await clickAt(page, 151, 199);
  await moveTo(page, -100, 200);
  await page.keyboard.type('12\' 6"');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(() => widths(page)).toEqual([3, 3.5, 3.81]);
  const [, second, third] = await walls(page);
  expect(third?.start.x).toBeCloseTo(second?.end.x ?? 0, 4);
  expect(third?.start.y).toBeCloseTo(second?.end.y ?? 0, 4);
}

test('starts a room, draws walls by click and typed length in metres and feet, reads and changes them, undoes a run, and keeps it all', async ({ page }) => {
  await startRoom(page);
  await drawThree(page);

  // The third wall reads 12' 6" while the plan shows feet, and 3.81 m in metres.
  await clickAt(page, 150 - 190.5, 200);
  await expect.poll(() => selection(page)).toHaveLength(1);
  await expect(field(page, 'Length')).toHaveValue('12\' 6"');
  await setUnits(page, 'Metres');
  await expect(field(page, 'Length')).toHaveValue('3.81 m');
  await expect(selectionTile(page).locator('[data-selection-kind]')).toHaveText('Wall');

  // Undo takes the whole last run back, redo brings it again.
  const undo = `${await mod(page)}+z`;
  await canvas(page).focus();
  await page.keyboard.press(undo);
  await expect.poll(() => widths(page)).toEqual([3, 3.5]);
  await page.keyboard.press(`${await mod(page)}+Shift+z`);
  await expect.poll(() => widths(page)).toEqual([3, 3.5, 3.81]);

  // The second wall: read, then a length changed in the Selection tile, then a height set, then an unreadable length refused.
  await clickAt(page, 150, 25);
  await expect(field(page, 'Length')).toHaveValue('3.50 m');
  await field(page, 'Length').fill('4 m');
  await field(page, 'Length').press('Enter');
  await expect.poll(async () => (await walls(page))[1]?.width).toBe(4);
  await field(page, 'Height').fill('2.4');
  await field(page, 'Height').press('Enter');
  await expect(field(page, 'Height')).toHaveValue('2.40 m');
  await field(page, 'Thickness').fill('thick');
  await field(page, 'Thickness').press('Enter');
  await expect(page.getByText('Not a length. Try 3.5 m, 350 cm, 12 ft or 12\' 6".')).toBeVisible();
  await expect(field(page, 'Thickness')).toHaveValue('0.10 m');

  // Moved by a drag, then turned in the Selection tile.
  const before = (await walls(page))[1];
  const from = await screen(page, 150, 50);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 100, from.y, { steps: 8 });
  await page.mouse.up();
  // About a metre: the box's nearer edge snaps onto the grid (here its face, 5 cm off its middle line).
  await expect.poll(async () => Math.abs(((await walls(page))[1]?.start.x ?? 0) - (before?.start.x ?? 0) - 1)).toBeLessThanOrEqual(0.06);
  await field(page, 'Rotation').fill('45');
  await field(page, 'Rotation').press('Enter');
  await expect.poll(async () => (await walls(page))[1]?.rotation).toBe(45);

  // Deleted to the Trash, listed as a plan item, and restored.
  await canvas(page).focus();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await walls(page)).length).toBe(2);
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const trash = page.getByRole('region', { name: 'Trash', exact: true });
  await trash.getByRole('button', { name: /^Restore plan item Wall in / }).click();
  await expect.poll(async () => (await walls(page)).length).toBe(3);
  const kept = await walls(page);

  // After a reload, all of it is there.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await expect.poll(() => walls(page)).toEqual(kept);
  // The scene's heading shows its room with no setup.
  await setupsTile(page).locator('[data-setups-scene-pick]').first().click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 01');
  await expect.poll(async () => (await walls(page)).length).toBe(3);
});

test('stays paper in dark, takes the keyboard, and passes axe on the Plan and Selection tiles', async ({ page }) => {
  await startRoom(page);
  await drawThree(page);
  // The room's own fields with nothing selected: its name, edited.
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  await field(page, 'Room name').fill('Diner');
  await field(page, 'Room name').press('Enter');
  await expect(canvas(page)).toHaveAttribute('aria-label', 'Plan of Diner');

  // The keyboard: Tab through the walls, arrows nudge by a centimetre, the tool by its letter.
  await canvas(page).focus();
  const all = (await walls(page)).map((w) => w.id);
  await clickAt(page, 0, -150);
  await expect.poll(() => selection(page)).toEqual([all[0]]);
  await page.keyboard.press('Tab');
  await expect.poll(() => selection(page)).toEqual([all[1]]);
  const x = (await walls(page))[1]?.start.x ?? 0;
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await walls(page))[1]?.start.x).toBeCloseTo(x + 0.01, 4);
  await page.keyboard.press('w');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'host:wall');
  await page.keyboard.press('v');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'select');
  // The scale bar shows a round length.
  await expect(planTile(page).locator('[data-scale-bar]')).toHaveAttribute('data-scale-bar', /^\d+(\.\d+)? (m|ft)$/);

  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  const axe = async () => {
    expect((await new AxeBuilder({ page }).include('[data-plan-tile]').withTags(tags).analyze()).violations).toEqual([]);
    expect((await new AxeBuilder({ page }).include('[data-selection-tile]').withTags(tags).analyze()).violations).toEqual([]);
  };
  await axe();

  // Dark: the app around it follows the theme, the plan stays paper.
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.locator('html').evaluate((html) => {
    html.setAttribute('data-theme', 'dark');
  });
  expect(await canvas(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(238, 233, 223)');
  await clickAt(page, 0, -150);
  await axe();
});

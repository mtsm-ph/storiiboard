import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// The library (6.3) in the memory build: a sofa dragged from the Library onto a scene's room reads 2.00 m by 0.90 m in
// the Selection tile; a C-stand placed from the keyboard goes into the setup and the arrows nudge it; the scene's other
// setup shows the sofa, not the C-stand; a table resized and turned by typing; a camera, not placeable yet, says why;
// undo, redo and a reload; the plan stays paper in dark; and axe on the Library tile. The canvas is pixels, so the tests
// read the plan from the data its tile keeps (data-plan-data, in metres).

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

interface Icon {
  id: string;
  kind: string;
  icon: string;
  level: string;
  layer: string;
  width: number;
  height: number;
  rotation: number;
  centre: { x: number; y: number };
}

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const selectionTile = (page: Page) => page.getByRole('region', { name: 'Selection', exact: true });
const libraryTile = (page: Page) => page.getByRole('region', { name: 'Library', exact: true });
const canvas = (page: Page) => planTile(page).locator('[data-canvas]');
const libraryIcon = (page: Page, id: string) => libraryTile(page).locator(`[data-library-icon="${id}"]`);
const icons = async (page: Page): Promise<Icon[]> =>
  (JSON.parse((await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as Icon[]).filter((item) => item.kind === 'icon');
const iconNames = async (page: Page) => (await icons(page)).map((i) => i.icon);
const selection = async (page: Page): Promise<string[]> => JSON.parse((await canvas(page).getAttribute('data-selection')) ?? '[]') as string[];
const field = (page: Page, name: string): Locator => selectionTile(page).getByRole('textbox', { name, exact: true });
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');

/** Where a world point (canvas units: cm) is on screen, from the view the canvas reports. */
async function screen(page: Page, x: number, y: number) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  const attr = async (name: string) => Number(await canvas(page).getAttribute(name));
  const zoom = await attr('data-zoom');
  return { x: box.x + box.width / 2 + (x - (await attr('data-cx'))) * zoom, y: box.y + box.height / 2 + (y - (await attr('data-cy'))) * zoom };
}

/** An icon dragged from the Library to a world point on the plan, by the pointer. */
async function dragIcon(page: Page, id: string, to: { x: number; y: number }) {
  const button = libraryIcon(page, id);
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) throw new Error(`no ${id} in the Library`);
  const target = await screen(page, to.x, to.y);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x - 40, target.y - 40, { steps: 6 });
  await page.mouse.move(target.x, target.y, { steps: 6 });
  // The ghost is over the plan, at the icon's real size.
  await expect(page.locator(`[data-library-ghost="${id}"]`)).toHaveAttribute('data-library-ghost-over', 'plan');
  await page.mouse.up();
}

async function setUnits(page: Page, label: 'Metres' | 'Feet and inches') {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label });
  await closeSettings(page);
}

/** The Setup workspace on SC 01's Setup 1, its room started. */
async function startRoom(page: Page) {
  await setUnits(page, 'Metres');
  await toSection(page, 'Setup');
  await expect(libraryTile(page).locator('[data-library-says]')).toHaveText('Pick a setup, or a scene’s heading, in the Setups tile to place items on its plan.');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 01 · Setup 1');
  await expect(libraryTile(page).locator('[data-library-says]')).toContainText('SC 01 has no room yet.');
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();
  await expect(libraryTile(page).locator('[data-library-tile]')).toHaveAttribute('data-library-state', 'ready');
}

test('drags a sofa into the room, places a C-stand from the keyboard into the setup, and the other setup shows only the sofa', async ({ page }) => {
  await startRoom(page);
  await dragIcon(page, 'set-art/sofa', { x: 0, y: 0 });
  await expect.poll(() => iconNames(page)).toEqual(['set-art/sofa']);
  const [sofa] = await icons(page);
  expect(sofa).toMatchObject({ level: 'room', layer: 'set-art', width: 2, height: 0.9 });
  // Under the pointer, give or take the grid's pull.
  expect(Math.abs(sofa?.centre.x ?? 9)).toBeLessThanOrEqual(0.06);
  expect(Math.abs(sofa?.centre.y ?? 9)).toBeLessThanOrEqual(0.06);
  await expect.poll(() => selection(page)).toEqual([sofa?.id]);
  await expect(selectionTile(page).locator('[data-selection-kind]')).toHaveText('Sofa');
  await expect(field(page, 'Width')).toHaveValue('2.00 m');
  await expect(field(page, 'Depth')).toHaveValue('0.90 m');
  // A set piece can be made this setup's only.
  await expect(selectionTile(page).locator('[data-setup-only]')).toHaveAttribute('data-setup-only', 'off');

  // A C-stand from the keyboard: in the middle of the view, selected, and the plan takes the focus.
  await libraryIcon(page, 'grip/c-stand').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => iconNames(page)).toEqual(['set-art/sofa', 'grip/c-stand']);
  const stand = (await icons(page)).find((i) => i.icon === 'grip/c-stand');
  expect(stand).toMatchObject({ level: 'setup', layer: 'grip', width: 0.9, height: 0.9 });
  await expect.poll(() => selection(page)).toEqual([stand?.id]);
  await expect(canvas(page)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await icons(page)).find((i) => i.icon === 'grip/c-stand')?.centre.x).toBeCloseTo((stand?.centre.x ?? 0) + 0.01, 4);
  // A setup's own icon has no "This setup only" switch: it is only the setup's already.
  await expect(selectionTile(page).locator('[data-setup-only]')).toHaveCount(0);

  // The scene's other setup shows the sofa (the room's), not the C-stand (Setup 1's).
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 01 · Setup 2');
  await expect.poll(() => iconNames(page)).toEqual(['set-art/sofa']);
  // And the scene with no setup shows the room's sofa too.
  await setupsTile(page).locator('[data-setups-scene-pick]').first().click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 01');
  await expect.poll(() => iconNames(page)).toEqual(['set-art/sofa']);
});

test('resizes and turns a table by typing, refuses a camera with words, and keeps it all through undo, redo and a reload', async ({ page }) => {
  await startRoom(page);
  await libraryIcon(page, 'set-art/table').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => iconNames(page)).toEqual(['set-art/table']);
  await expect(field(page, 'Width')).toHaveValue('1.50 m');
  await expect(field(page, 'Depth')).toHaveValue('0.80 m');
  const placed = (await icons(page))[0];

  await field(page, 'Width').fill('2.4');
  await field(page, 'Width').press('Enter');
  await expect.poll(async () => (await icons(page))[0]?.width).toBe(2.4);
  await expect(field(page, 'Width')).toHaveValue('2.40 m');
  // Resized about its middle.
  expect((await icons(page))[0]?.centre).toEqual(placed?.centre);
  await field(page, 'Rotation').fill('90');
  await field(page, 'Rotation').press('Enter');
  await expect.poll(async () => (await icons(page))[0]?.rotation).toBe(90);

  // A camera comes later in this phase: greyed out, and it says so when pressed or dragged.
  const camera = libraryIcon(page, 'camera/camera');
  await expect(camera).toHaveAttribute('aria-disabled', 'true');
  await expect(libraryTile(page).locator('[data-library-group="camera"]')).toContainText('Coming in this phase');
  await camera.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Camera: coming in this phase.', { exact: true })).toBeVisible();
  const box = await camera.boundingBox();
  const target = await screen(page, 200, 200);
  if (!box) throw new Error('no camera in the Library');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  expect(await iconNames(page)).toEqual(['set-art/table']);

  // Undo the turn, then redo it.
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await icons(page))[0]?.rotation).toBe(0);
  await page.keyboard.press(`${await mod(page)}+Shift+z`);
  await expect.poll(async () => (await icons(page))[0]?.rotation).toBe(90);

  // After a reload, it is all there.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await expect.poll(async () => (await icons(page)).map((i) => [i.icon, i.width, i.height, i.rotation])).toEqual([['set-art/table', 2.4, 0.8, 90]]);
});

test('says what a scene with no setup takes, filters by name, stays paper in dark, and passes axe on the Library', async ({ page }) => {
  await startRoom(page);
  // The scene's heading: set pieces go in its room; a C-stand needs a setup, and says so.
  await setupsTile(page).locator('[data-setups-scene-pick]').first().click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 01');
  await expect(libraryTile(page).locator('[data-library-says]')).toHaveText('No setup is shown: set pieces go in the scene’s room, the rest need a setup picked in the Setups tile.');
  await libraryIcon(page, 'grip/c-stand').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('C-stand goes in a setup: pick one in the Setups tile.', { exact: true })).toBeVisible();
  await libraryIcon(page, 'set-art/chair').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => iconNames(page)).toEqual(['set-art/chair']);

  // The filter narrows by name.
  await libraryTile(page).getByRole('searchbox', { name: 'Filter' }).fill('sofa');
  await expect(libraryTile(page).locator('[data-library-icon]')).toHaveCount(1);
  await libraryTile(page).getByRole('searchbox', { name: 'Filter' }).fill('');
  await expect(libraryTile(page).locator('[data-library-icon]')).toHaveCount(68);

  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  const axe = async () => {
    expect((await new AxeBuilder({ page }).include('[data-library-tile]').withTags(tags).analyze()).violations).toEqual([]);
  };
  await axe();

  // Dark: the app around it follows the theme, the plan stays paper.
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.locator('html').evaluate((html) => {
    html.setAttribute('data-theme', 'dark');
  });
  expect(await canvas(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(238, 233, 223)');
  await axe();
});

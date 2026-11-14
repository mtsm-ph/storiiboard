import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// The plan's layers (6.8) in the memory build: a plan with a wall, a sofa, a camera, a light and a mark. Lighting
// hidden (the light leaves the plan's data, the header says so), art locked (a click on the wall picks nothing, Select
// all leaves it and the sofa out), cast dimmed, camera soloed and back by the tile and by the keys, "This is me" a
// gaffer and My department; the state through a reload; no History step for any of it; axe on the Layers tile. The
// canvas is pixels, so the tests read the plan from the data its tile keeps.

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
  await expect(page.getByRole('region', { name: 'Storyboard', exact: true }).getByRole('button', { name: '+ Frame in SC 01' })).toBeVisible();
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

interface Item {
  id: string;
  kind: string;
  layer: string | null;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  dim?: boolean;
  locked?: boolean;
}

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const layersTile = (page: Page) => page.getByRole('region', { name: 'Layers', exact: true });
const libraryTile = (page: Page) => page.getByRole('region', { name: 'Library', exact: true });
const canvas = (page: Page) => planTile(page).locator('[data-canvas]');
const row = (page: Page, layer: string) => layersTile(page).locator(`[data-layer="${layer}"]`);
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');
const items = async (page: Page): Promise<Item[]> => JSON.parse((await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as Item[];
const kinds = async (page: Page) => (await items(page)).map((i) => i.kind).sort();
const selection = async (page: Page): Promise<string[]> => JSON.parse((await canvas(page).getAttribute('data-selection')) ?? '[]') as string[];
const shows = async (page: Page): Promise<Record<string, string | null>> =>
  Object.fromEntries(await layersTile(page).locator('[data-layer]').evaluateAll((rows) => rows.map((r) => [r.getAttribute('data-layer') ?? '', r.getAttribute('data-layer-show')] as const)));

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

/** SC 01's Setup 1 in metres with its room: a wall drawn above the middle, then a sofa, a camera, a light and a mark. */
async function buildPlan(page: Page) {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Metres' });
  await closeSettings(page);
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();
  await canvas(page).focus();
  await page.keyboard.press('w');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'host:wall');
  await clickAt(page, -200, -200);
  await clickAt(page, 200, -200);
  await page.keyboard.press('Enter');
  await expect.poll(() => kinds(page)).toEqual(['wall']);
  const sofa = libraryTile(page).locator('[data-library-icon="set-art/sofa"]');
  await sofa.scrollIntoViewIfNeeded();
  await sofa.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => kinds(page)).toEqual(['icon', 'wall']);
  for (const key of ['c', 'l', 'm']) {
    await canvas(page).focus();
    await page.keyboard.press(key);
    await page.keyboard.press('Enter');
  }
  await expect.poll(() => kinds(page)).toEqual(['camera', 'icon', 'light', 'mark', 'wall']);
  await canvas(page).focus();
  await page.keyboard.press('Escape');
}

const byKind = async (page: Page, kind: string): Promise<Item> => {
  const found = (await items(page)).find((i) => i.kind === kind);
  if (!found) throw new Error(`no ${kind}`);
  return found;
};

/** How many steps History lists. */
async function historySteps(page: Page): Promise<number> {
  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('region', { name: 'History', exact: true });
  await expect(history).toBeVisible();
  await expect(history.locator('[aria-busy="true"]')).toHaveCount(0);
  return history.getByRole('list', { name: 'Steps, newest first' }).getByRole('listitem').count();
}

test('hides, locks, dims and solos layers, starts a gaffer on lighting and grip, keeps the state, and writes no History', async ({ page }) => {
  await buildPlan(page);
  await expect(row(page, 'set-art').locator('[data-layer-count]')).toHaveAttribute('data-layer-count', '2');
  await expect(row(page, 'sound')).toHaveAttribute('data-layer-empty', 'true');
  await expect(planTile(page).locator('[data-layers-note]')).toHaveCount(0);
  const before = await historySteps(page);
  await toSection(page, 'Setup');
  await expect(layersTile(page)).toBeVisible();

  // Lighting hidden: the light leaves the plan, and the header says so.
  await row(page, 'lighting').getByRole('radio', { name: 'Hidden' }).click();
  await expect.poll(() => kinds(page)).toEqual(['camera', 'icon', 'mark', 'wall']);
  await expect(planTile(page).locator('[data-layers-note]')).toContainText('1 layer hidden');

  // Art locked: the wall is drawn but a click on it picks nothing, and Select all leaves it and the sofa out.
  await layersTile(page).getByRole('switch', { name: 'Lock the Set and art layer' }).click();
  await expect(layersTile(page).getByRole('switch', { name: 'Lock the Set and art layer' })).toHaveAttribute('aria-checked', 'true');
  await expect(planTile(page).locator('[data-layers-note]')).toContainText('1 layer hidden · 1 layer locked');
  const wall = await byKind(page, 'wall');
  expect(wall).toMatchObject({ layer: 'set-art', locked: true });
  await clickAt(page, 0, -200);
  await expect.poll(() => selection(page)).toEqual([]);
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+a`);
  const camera = await byKind(page, 'camera');
  const mark = await byKind(page, 'mark');
  await expect.poll(async () => (await selection(page)).sort()).toEqual([camera.id, mark.id].sort());
  // Delete after Select all changes nothing on the hidden or locked layers.
  await page.keyboard.press('Delete');
  await expect.poll(() => kinds(page)).toEqual(['icon', 'wall']);
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(() => kinds(page)).toEqual(['camera', 'icon', 'mark', 'wall']);

  // Cast dimmed: the mark is drawn dimmed and still picked.
  await row(page, 'cast').getByRole('radio', { name: 'Dimmed' }).click();
  await expect.poll(async () => (await byKind(page, 'mark')).dim).toBe(true);

  // Solo camera, and back to what was before.
  await row(page, 'camera').getByRole('button', { name: /^Solo the Camera layer/ }).click();
  await expect(row(page, 'camera').getByRole('button', { name: /^Solo the Camera layer/ })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => shows(page)).toEqual({ camera: 'shown', lighting: 'dimmed', grip: 'dimmed', 'set-art': 'dimmed', sound: 'dimmed', production: 'dimmed', cast: 'dimmed' });
  await expect.poll(() => kinds(page)).toEqual(['camera', 'icon', 'light', 'mark', 'wall']);
  await row(page, 'camera').getByRole('button', { name: /^Solo the Camera layer/ }).click();
  await expect.poll(() => shows(page)).toEqual({ camera: 'shown', lighting: 'hidden', grip: 'shown', 'set-art': 'shown', sound: 'shown', production: 'shown', cast: 'dimmed' });
  await expect(row(page, 'set-art')).toHaveAttribute('data-layer-locked', 'true');

  // The keys on the plan: 2 solos lighting, 2 again puts it back, 0 shows all.
  await canvas(page).focus();
  await page.keyboard.press('2');
  await expect.poll(async () => (await shows(page)).lighting).toBe('shown');
  await expect.poll(async () => (await shows(page)).camera).toBe('dimmed');
  await page.keyboard.press('2');
  await expect.poll(async () => (await shows(page)).lighting).toBe('hidden');
  await page.keyboard.press('0');
  await expect.poll(() => shows(page)).toEqual({ camera: 'shown', lighting: 'shown', grip: 'shown', 'set-art': 'shown', sound: 'shown', production: 'shown', cast: 'shown' });
  await expect(planTile(page).locator('[data-layers-note]')).toHaveCount(0);
  await expect(row(page, 'set-art')).not.toHaveAttribute('data-layer-locked', 'true');
  // None of it is a step in History: only the Delete and its undo are.
  expect(await historySteps(page)).toBe(before + 2);

  // "This is me" a gaffer, then My department: lighting and grip shown, the rest dimmed.
  await toSection(page, 'Production');
  const people = page.getByRole('region', { name: 'Cast and crew', exact: true });
  await people.getByRole('button', { name: '+ New person' }).click();
  await page.keyboard.type('Sam Ortiz');
  await page.keyboard.press('Enter');
  const editor = people.locator('[data-person-editor]');
  await editor.getByRole('combobox', { name: 'Role' }).selectOption({ label: 'Gaffer' });
  await editor.getByRole('button', { name: 'This is me' }).click();
  const withSam = await historySteps(page);
  await toSection(page, 'Setup');
  await layersTile(page).getByRole('button', { name: 'My department' }).click();
  const gaffer = { camera: 'dimmed', lighting: 'shown', grip: 'shown', 'set-art': 'dimmed', sound: 'dimmed', production: 'dimmed', cast: 'dimmed' };
  await expect.poll(() => shows(page)).toEqual(gaffer);
  await expect.poll(async () => (await byKind(page, 'light')).dim).toBeUndefined();
  await expect.poll(async () => (await byKind(page, 'camera')).dim).toBe(true);

  // A reload keeps the state: it is this computer's.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await expect.poll(() => shows(page)).toEqual(gaffer);

  // My department and the reload wrote no step either.
  expect(await historySteps(page)).toBe(withSam);
});

test('the Layers tile is reached and read by the keyboard, and passes axe', async ({ page }) => {
  await buildPlan(page);
  const show = row(page, 'camera').getByRole('radiogroup', { name: 'Camera layer' });
  await expect(show.getByRole('radio', { name: 'Shown' })).toHaveAttribute('aria-checked', 'true');
  // Tab reaches the camera row's choice; the arrows pick, without the pointer.
  await layersTile(page).getByRole('button', { name: 'My department' }).focus();
  await page.keyboard.press('Tab');
  await expect(show.getByRole('radio', { name: 'Shown' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(show.getByRole('radio', { name: 'Dimmed' })).toHaveAttribute('aria-checked', 'true');
  await expect(show.getByRole('radio', { name: 'Dimmed' })).toBeFocused();
  await page.keyboard.press('Tab');
  const lock = layersTile(page).getByRole('switch', { name: 'Lock the Camera layer' });
  await expect(lock).toBeFocused();
  await page.keyboard.press('Space');
  await expect(lock).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Tab');
  await expect(row(page, 'camera').getByRole('button', { name: /^Solo the Camera layer/ })).toBeFocused();
  await expect(planTile(page).locator('[data-layers-note]')).toContainText('1 layer locked');
  // The header's Show all puts everything back.
  await planTile(page).getByRole('button', { name: 'Show all' }).click();
  await expect(planTile(page).locator('[data-layers-note]')).toHaveCount(0);
  await expect(show.getByRole('radio', { name: 'Shown' })).toHaveAttribute('aria-checked', 'true');

  await row(page, 'lighting').getByRole('radio', { name: 'Hidden' }).click();
  await layersTile(page).getByRole('switch', { name: 'Lock the Set and art layer' }).click();
  const results = await new AxeBuilder({ page }).include('[data-layers-tile]').analyze();
  expect(results.violations).toEqual([]);
  const plan = await new AxeBuilder({ page }).include('[data-plan-heading]').analyze();
  expect(plan.violations).toEqual([]);
});

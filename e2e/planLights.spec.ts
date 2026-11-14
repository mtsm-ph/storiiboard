import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// Lights, flags and diffusion on a plan (6.5) in the memory build: a 1,200 W light in Gear; a fresnel placed with the
// L tool, its gear item picked and its watts read from it, 650 W typed over them, its height set and shown on the plan,
// its beam changed; a 4×4 diffusion from the Library made an 8×8; the legend's total with an unknown light; a frame of
// the setup put in a shoot day whose list lacks the light, and the finding in Shoot days; undo, redo and a reload; and
// axe on the Selection tile and Shoot days. The canvas is pixels, so the tests read the plan from the data its tile
// keeps (data-plan-data, in metres).

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
  await storyboard(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(storyboard(page).locator('[data-shot-id]')).toHaveCount(1);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

interface Item {
  id: string;
  kind: string;
  icon: string;
  level: string;
  layer: string;
  width: number;
  height: number;
  gearId: string | null;
  watts: number | null;
  beamDeg: number | null;
  heightM: number | null;
  beam?: number | null;
  labels: string[];
}

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const storyboard = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const gear = (page: Page) => page.getByRole('region', { name: 'Gear', exact: true });
const editor = (page: Page) => gear(page).locator('[data-gear-editor]');
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const selectionTile = (page: Page) => page.getByRole('region', { name: 'Selection', exact: true });
const libraryTile = (page: Page) => page.getByRole('region', { name: 'Library', exact: true });
const days = (page: Page) => page.getByRole('region', { name: 'Shoot days', exact: true });
const canvas = (page: Page) => planTile(page).locator('[data-canvas]');
const field = (page: Page, name: string) => selectionTile(page).getByRole('textbox', { name, exact: true });
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');
const items = async (page: Page): Promise<Item[]> => JSON.parse((await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as Item[];
const lights = async (page: Page) => (await items(page)).filter((i) => i.kind === 'light');
const frames = async (page: Page) => (await items(page)).filter((i) => i.kind === 'diffusion' || i.kind === 'flag');
const selection = async (page: Page): Promise<string[]> => JSON.parse((await canvas(page).getAttribute('data-selection')) ?? '[]') as string[];

/** A field in the Selection tile typed and left with Enter. */
async function type(page: Page, name: string, value: string) {
  const input = field(page, name);
  await input.fill(value);
  await input.press('Enter');
}

/** A light placed with the L tool, from the keyboard: in the middle of the view, selected. */
async function placeLight(page: Page): Promise<string> {
  const before = (await lights(page)).map((l) => l.id);
  await canvas(page).focus();
  await page.keyboard.press('l');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await lights(page)).length).toBe(before.length + 1);
  const made = (await lights(page)).find((l) => !before.includes(l.id));
  if (!made) throw new Error('no light placed');
  await expect.poll(() => selection(page)).toEqual([made.id]);
  return made.id;
}

test('lights with their gear item’s watts, a height and a beam; a frame sized by name; the legend’s total; the gear check', async ({ page }) => {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Metres' });
  await closeSettings(page);

  // A 1,200 W light in Gear.
  await toSection(page, 'Production');
  await gear(page).getByRole('button', { name: '+ New item' }).click();
  await expect(editor(page).getByLabel('Name')).toBeFocused();
  await page.keyboard.type('Fresnel 1K');
  await page.keyboard.press('Enter');
  const watts = editor(page).getByLabel('Watts', { exact: true });
  await watts.fill('1200');
  await watts.press('Enter');
  await expect(watts).toHaveValue('1200');

  // The setup with the frame in it, its room started.
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await setupsTile(page).locator('[data-setup-add-frame]').first().click();
  await expect(setupsTile(page).locator('[data-setup-frame]')).toHaveCount(1);
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();

  // A fresnel from the L tool: a light of the setup, its 40° beam, no watts yet.
  const key = await placeLight(page);
  expect((await lights(page))[0]).toMatchObject({ icon: 'lighting/fresnel', level: 'setup', layer: 'lighting', gearId: null, watts: null, beam: 40, labels: [] });
  await expect(selectionTile(page).locator('[data-selection-kind]')).toHaveText('Fresnel');

  // Its gear item picked: the watts are the item's, read live.
  await selectionTile(page).getByRole('combobox', { name: 'Gear item', exact: true }).selectOption({ label: 'Fresnel 1K' });
  await expect(selectionTile(page).locator('[data-light-watts-from="gear"]')).toHaveText('From the gear item: 1,200 W. Type here to use another.');
  await expect.poll(async () => (await lights(page))[0]?.labels).toEqual(['1,200 W']);

  // 650 W typed over them, a height set (shown by the light on the plan), the beam narrowed.
  await type(page, 'Watts', '650');
  await expect.poll(async () => (await lights(page))[0]?.watts).toBe(650);
  await expect(selectionTile(page).locator('[data-light-watts]')).toHaveAttribute('data-light-watts', 'light');
  await type(page, 'Height', '2.4');
  await expect.poll(async () => (await lights(page))[0]?.labels).toEqual(['650 W', '2.40 m']);
  await type(page, 'Beam angle', '25');
  await expect.poll(async () => (await lights(page))[0]?.beam).toBe(25);
  await expect(field(page, 'Beam angle')).toHaveValue('25°');
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[data-selection-tile]').withTags(tags).analyze()).violations).toEqual([]);

  // A 4×4 diffusion from the Library, made an 8×8 by its name: a line from above, its width the frame's.
  const diffusion = libraryTile(page).locator('[data-library-icon="grip/diffusion-4x4"]');
  await diffusion.scrollIntoViewIfNeeded();
  await diffusion.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await frames(page)).length).toBe(1);
  expect((await frames(page))[0]).toMatchObject({ kind: 'diffusion', layer: 'grip', width: 1.22, height: 0.05 });
  const size = selectionTile(page).getByRole('combobox', { name: 'Size', exact: true });
  await expect(size).toHaveValue('4x4');
  await size.selectOption({ label: '8×8' });
  await expect.poll(async () => (await frames(page))[0]?.width).toBe(2.44);
  await expect(field(page, 'Width')).toHaveValue('2.44 m');

  // A second light with no wattage: the legend's total says it's unknown.
  await placeLight(page);
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => selection(page)).toEqual([]);
  const legend = selectionTile(page).locator('[data-plan-legend]');
  await expect(legend.locator('[data-legend-total]')).toContainText('650 W + 1 unknown');
  await expect(legend.locator('[data-legend-group="lighting"]')).toContainText('Fresnel · 2.40 m · 650 W');
  await expect(legend.locator('[data-legend-group="grip"]')).toContainText('Diffusion 4×4');
  expect((await new AxeBuilder({ page }).include('[data-selection-tile]').withTags(tags).analyze()).violations).toEqual([]);

  // The frame in a shoot day whose list lacks the light: Shoot days says so, from the plan.
  await toSection(page, 'Production');
  const day = days(page).locator('[data-day-editor]');
  await days(page).getByRole('button', { name: '+ New day' }).click();
  await day.getByRole('button', { name: /^Add 1A to Day 1/ }).click();
  const missing = day.getByRole('list', { name: 'Frames needing gear not on this day’s list' });
  await expect(missing.locator('[data-gear-from="plan"]')).toHaveText(/SC 01: Setup 1’s plan needs Fresnel 1K/);
  expect((await new AxeBuilder({ page }).include('[aria-label="Shoot days"]').withTags(tags).analyze()).violations).toEqual([]);

  // Undo takes the frame out of the day, and the finding with it; redo brings both back.
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect(missing).toHaveCount(0);
  await page.keyboard.press(`${await mod(page)}+Shift+z`);
  await expect(missing.locator('[data-gear-from="plan"]')).toHaveCount(1);
  // Added to the day from the finding, it goes.
  await missing.getByRole('button', { name: /^Add to this day, for SC 01 · Setup 1/ }).click();
  await expect(missing).toHaveCount(0);

  // After a reload, it is all there.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await expect.poll(async () => (await lights(page)).find((l) => l.id === key)).toMatchObject({ watts: 650, beamDeg: 25, heightM: 2.4, labels: ['650 W', '2.40 m'] });
  expect((await lights(page)).find((l) => l.id === key)?.gearId).not.toBeNull();
  expect((await frames(page))[0]?.width).toBe(2.44);
});

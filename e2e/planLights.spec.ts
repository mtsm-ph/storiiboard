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
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Meters' });
  await closeSettings(page, 'apply');

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
  await expect(selectionTile(page).locator('[data-selection-kind]')).toHaveText('Diffusion · 4×4');
  await size.selectOption({ label: '8×8' });
  await expect.poll(async () => (await frames(page))[0]?.width).toBe(2.44);
  await expect(field(page, 'Width')).toHaveValue('2.44 m');
  // Named by its size now, never the icon it was placed as (6.5 review).
  await expect(selectionTile(page).locator('[data-selection-kind]')).toHaveText('Diffusion · 8×8');

  // A second light with no wattage: the legend's total says it's unknown.
  await placeLight(page);
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => selection(page)).toEqual([]);
  const legend = selectionTile(page).locator('[data-plan-legend]');
  await expect(legend.locator('[data-legend-total]')).toContainText('650 W + 1 unknown');
  await expect(legend.locator('[data-legend-group="lighting"]')).toContainText('Fresnel · 2.40 m · 650 W');
  await expect(legend.locator('[data-legend-group="grip"]')).toContainText('Diffusion · 8×8');
  await expect(legend.locator('[data-legend-group="grip"]')).not.toContainText('4×4');
  expect((await new AxeBuilder({ page }).include('[data-selection-tile]').withTags(tags).analyze()).violations).toEqual([]);

  // The frame in a shoot day whose list lacks the light: Shoot days says so, from the plan.
  await toSection(page, 'Production');
  const day = days(page).locator('[data-day-editor]');
  await days(page).getByRole('button', { name: '+ New day' }).click();
  await day.getByRole('button', { name: /^Add 1A to Day 1/ }).click();
  const missing = day.getByRole('list', { name: 'Gear needed that isn’t on this day’s list' });
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

/** Where a world point (canvas units: cm) is on screen, from the view the canvas reports. */
async function screen(page: Page, x: number, y: number) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  const attr = async (name: string) => Number(await canvas(page).getAttribute(name));
  const zoom = await attr('data-zoom');
  return { x: box.x + box.width / 2 + (x - (await attr('data-cx'))) * zoom, y: box.y + box.height / 2 + (y - (await attr('data-cy'))) * zoom };
}

test('turns a standing flag with the rotate handle at 200%, its 5 cm depth kept (6.5 review)', async ({ page }) => {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Meters' });
  await closeSettings(page, 'apply');
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();
  const flag = libraryTile(page).locator('[data-library-icon="grip/flag"]');
  await flag.scrollIntoViewIfNeeded();
  await flag.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await frames(page)).length).toBe(1);
  const placed = (await frames(page))[0] as Item & { rotation: number; centre: { x: number; y: number } };
  expect(placed).toMatchObject({ kind: 'flag', width: 0.91, height: 0.05, rotation: 0 });
  await expect.poll(() => selection(page)).toEqual([placed.id]);
  // Zoomed in to about 200%: the 5 cm bar is 10 px thick, under the boards' least size of 8 units (16 px) there.
  await canvas(page).focus();
  for (let i = 0; i < 12 && Number(await canvas(page).getAttribute('data-zoom')) < 1.95; i += 1) await page.keyboard.press('+');
  await expect.poll(async () => Number(await canvas(page).getAttribute('data-zoom'))).toBeGreaterThanOrEqual(1.95);
  const cx = placed.centre.x * 100;
  const cy = placed.centre.y * 100;
  // The rotate handle sits 24 px above the top edge's middle; dragged to 45° clockwise of straight up, the flag turns 45°.
  const top = await screen(page, cx, cy - 2.5);
  const centre = await screen(page, cx, cy);
  const reach = 400;
  await page.mouse.move(top.x, top.y - 24);
  await page.mouse.down();
  await page.mouse.move(centre.x + reach * Math.SQRT1_2, centre.y - reach * Math.SQRT1_2, { steps: 14 });
  await page.mouse.up();
  // Turned about 45° (the handle follows the pointer's angle round the box's middle on screen, to a degree or two).
  await expect.poll(async () => Math.abs((((await frames(page))[0] as (Item & { rotation: number }) | undefined)?.rotation ?? 0) - 45)).toBeLessThanOrEqual(3);
  expect((await frames(page))[0]).toMatchObject({ width: 0.91, height: 0.05 });
});

/** A flag from the Library in a new room of SC 01's first setup, in metres: placed and selected. */
async function placeFlag(page: Page): Promise<Item & { centre: { x: number; y: number } }> {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Meters' });
  await closeSettings(page, 'apply');
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();
  const flag = libraryTile(page).locator('[data-library-icon="grip/flag"]');
  await flag.scrollIntoViewIfNeeded();
  await flag.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await frames(page)).length).toBe(1);
  const placed = (await frames(page))[0] as Item & { centre: { x: number; y: number } };
  await expect.poll(() => selection(page)).toEqual([placed.id]);
  return placed;
}

test('picks a flag 3 px off its line at about 25%, by a click and by a right-click (6.5 second review)', async ({ page }) => {
  const placed = await placeFlag(page);
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => selection(page)).toEqual([]);
  // Zoomed out to about 25%: the 5 cm bar is barely a pixel; it is picked 8 px thick, 4 px either side of its line.
  for (let i = 0; i < 20 && Number(await canvas(page).getAttribute('data-zoom')) > 0.27; i += 1) await page.keyboard.press('-');
  const zoom = Number(await canvas(page).getAttribute('data-zoom'));
  expect(zoom).toBeLessThanOrEqual(0.27);
  expect(zoom).toBeGreaterThanOrEqual(0.2);
  const at = await screen(page, placed.centre.x * 100, placed.centre.y * 100);
  await page.mouse.click(at.x, at.y + 3);
  await expect.poll(() => selection(page)).toEqual([placed.id]);
  // Off it, and the same point's right-click opens its menu, the flag picked.
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => selection(page)).toEqual([]);
  await page.mouse.click(at.x, at.y + 3, { button: 'right' });
  await expect(canvas(page).getByRole('group', { name: 'Board actions' })).toBeVisible();
  await expect.poll(() => selection(page)).toEqual([placed.id]);
});

test('a selected standing flag moves by its body: a press on its line, or a pixel either side, and a drag of a metre move it a metre, at 100% and zoomed out (6.17 review, as a wall, 6.19c)', async ({ page }) => {
  const placed = await placeFlag(page);
  const zoom = async () => Number(await canvas(page).getAttribute('data-zoom'));
  expect(await zoom()).toBe(1);
  type Placed = Item & { centre: { x: number; y: number }; rotation: number };
  // As 6.19c's wall test: every press aimed at a whole CSS pixel from the measured box (an engine may deliver only whole
  // pixels), round(L) and round(L) ± 1 for its line at screen y = L. The 5 cm bar is 5 px thick at 100% and is picked 8 px
  // thick at any zoom (pickThickness), so all three are on it with a whole pixel to spare (within 1.5 of L, under 4 - 1).
  // Without endsOnly, the anchors in the middle of its long sides (8 px, on its edges 2.5 px from L) take every one.
  const dragsByItsBody = async () => {
    for (const off of [0, -1, 1]) {
      const was = (await frames(page))[0] as Placed | undefined;
      if (!was) throw new Error('no flag');
      const exact = await screen(page, was.centre.x * 100, was.centre.y * 100);
      const at = { x: Math.round(exact.x), y: Math.round(exact.y) + off };
      await page.mouse.click(at.x, at.y);
      await expect.poll(() => selection(page)).toEqual([placed.id]);
      const metre = 100 * (await zoom());
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await page.mouse.move(at.x, at.y + metre, { steps: 8 });
      await page.mouse.up();
      await expect.poll(async () => (((await frames(page))[0] as Placed | undefined)?.centre.y ?? 0) - was.centre.y).toBeCloseTo(1, 3);
      const now = (await frames(page))[0] as Placed | undefined;
      expect(now?.centre.x).toBeCloseTo(was.centre.x, 3);
      expect(now?.width).toBe(was.width);
      expect(now?.height).toBe(was.height);
      expect(now?.rotation).toBe(was.rotation);
    }
  };
  await dragsByItsBody();
  // Zoomed out to about 50%: the bar is 2.5 px, the anchors still 8 px, the pick still 8 px.
  const zoomOut = planTile(page).getByRole('button', { name: 'Zoom out', exact: true });
  while ((await zoom()) / 1.25 >= 0.5) {
    const was = await zoom();
    await zoomOut.click();
    await expect.poll(zoom).toBeLessThan(was);
  }
  expect(await zoom()).toBeLessThan(0.6);
  await dragsByItsBody();
});

test('a standing flag picked alone still resizes from its end anchor, its depth kept; turned 30°, it still moves by its body (6.17 review)', async ({ page }) => {
  const placed = await placeFlag(page);
  type Placed = Item & { centre: { x: number; y: number }; rotation: number };
  const flag = async () => (await frames(page))[0] as Placed | undefined;
  expect(Number(await canvas(page).getAttribute('data-zoom'))).toBe(1);
  expect(placed).toMatchObject({ width: 0.91, height: 0.05 });
  // Its end anchor sits on the middle of its right end (endsOnly keeps the end and corner anchors): dragged half a metre
  // right, the flag is half a metre longer and as deep as before.
  const end = await screen(page, placed.centre.x * 100 + (placed.width * 100) / 2, placed.centre.y * 100);
  const at = { x: Math.round(end.x), y: Math.round(end.y) };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 50, at.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await flag())?.width ?? 0).toBeCloseTo(1.41, 2);
  expect((await flag())?.height).toBe(0.05);
  expect((await flag())?.rotation).toBe(0);
  await expect.poll(() => selection(page)).toEqual([placed.id]);

  // Turned 30° by typing, a press on its middle and a drag of a metre down move it a metre, its size and turn kept.
  await type(page, 'Rotation', '30');
  await expect.poll(async () => (await flag())?.rotation).toBe(30);
  const was = await flag();
  if (!was) throw new Error('no flag');
  const middle = await screen(page, was.centre.x * 100, was.centre.y * 100);
  const press = { x: Math.round(middle.x), y: Math.round(middle.y) };
  await page.mouse.click(press.x, press.y);
  await expect.poll(() => selection(page)).toEqual([placed.id]);
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  await page.mouse.move(press.x, press.y + 100, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => ((await flag())?.centre.y ?? 0) - was.centre.y).toBeCloseTo(1, 3);
  const now = await flag();
  expect(now?.centre.x).toBeCloseTo(was.centre.x, 3);
  expect(now?.width).toBe(was.width);
  expect(now?.height).toBe(0.05);
  expect(now?.rotation).toBe(30);
});

test('a measure picked alone resizes from its end anchor, its start kept (6.17 review)', async ({ page }) => {
  await placeFlag(page);
  // A 3 m measure along the plan, from the keyboard: R, Enter, an arrow for its direction, its length, Enter twice.
  await canvas(page).focus();
  await page.keyboard.press('r');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'host:measure');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('3m');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  type Measure = Item & { start: { x: number; y: number }; end: { x: number; y: number }; rotation: number };
  const measure = async () => (await items(page)).find((i) => i.kind === 'measure') as Measure | undefined;
  await expect.poll(async () => (await measure())?.width).toBe(3);
  const made = await measure();
  if (!made) throw new Error('no measure');
  await page.keyboard.press('v');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'select');
  await expect.poll(() => selection(page)).toEqual([made.id]);
  // Its end anchor, on its end: dragged a metre further along, the measure is 4 m from the same start.
  const end = await screen(page, made.end.x * 100, made.end.y * 100);
  const at = { x: Math.round(end.x), y: Math.round(end.y) };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 100, at.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await measure())?.width ?? 0).toBeCloseTo(4, 2);
  const now = await measure();
  expect(now?.start.x).toBeCloseTo(made.start.x, 3);
  expect(now?.start.y).toBeCloseTo(made.start.y, 3);
  expect(now?.height).toBe(made.height);
  expect(now?.rotation).toBe(made.rotation);
});

test('names a typed frame in the Trash and History in the plan’s unit, and again when the setting changes (6.5 second review)', async ({ page }) => {
  await placeFlag(page);
  await type(page, 'Width', '1.5');
  await expect.poll(async () => (await frames(page))[0]?.width).toBe(1.5);
  await canvas(page).focus();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await frames(page)).length).toBe(0);
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const trash = page.getByRole('region', { name: 'Trash', exact: true });
  await expect(trash).toContainText('Flag · 1.50 m');
  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('region', { name: 'History', exact: true });
  await expect(history).toContainText('Deleted a flag · 1.50 m');
  // Feet and inches: both lists name it again, with nothing else touched.
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Feet and inches' });
  await closeSettings(page, 'apply');
  await expect(trash).toContainText('Flag · 4\' 11"');
  await expect(trash).not.toContainText('1.50 m');
  await expect(history).toContainText('Deleted a flag · 4\' 11"');
});

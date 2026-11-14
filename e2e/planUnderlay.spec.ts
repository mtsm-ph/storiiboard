import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// The room's underlays and measures (6.9) in the memory build: a picture added as an underlay from the room's menu (as a
// board's picture is chosen), "Not to scale yet", Set scale by two clicks and "4m", a wall traced over it and measured
// (the label reads the wall's length), the underlay unlocked and locked again in the Layers tile, seen from another
// scene set in the room, undo, redo and a reload; the Measure tool from the keyboard; axe on the plan's heading, the
// Layers and Selection tiles and the scale question. The canvas is pixels, so the tests read the plan from the data its
// tile keeps (data-plan-data, data-picture-levels).

test.use({ viewport: { width: 1440, height: 900 } });

const imagePath = fileURLToPath(new URL('./fixtures/images/srgb.jpg', import.meta.url));

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
  const scenes = page.getByRole('region', { name: 'Scenes', exact: true });
  await scenes.getByRole('button', { name: '+ New scene' }).click();
  await expect(page.getByRole('region', { name: 'Storyboard', exact: true }).getByRole('button', { name: '+ Frame in SC 01' })).toBeVisible();
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

interface Item {
  id: string;
  kind: string;
  layer: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  scaled?: boolean;
  sha?: string | null;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  labels?: string[];
  dim?: boolean;
  locked?: boolean;
}

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const layersTile = (page: Page) => page.getByRole('region', { name: 'Layers', exact: true });
const selectionTile = (page: Page) => page.getByRole('region', { name: 'Selection', exact: true });
const libraryTile = (page: Page) => page.getByRole('region', { name: 'Library', exact: true });
const canvas = (page: Page) => planTile(page).locator('[data-canvas]');
const holder = (page: Page) => planTile(page).locator('[data-plan-data]');
const items = async (page: Page): Promise<Item[]> => JSON.parse((await holder(page).getAttribute('data-plan-data')) ?? '[]') as Item[];
const ofKind = async (page: Page, kind: string) => (await items(page)).filter((i) => i.kind === kind);
const one = async (page: Page, kind: string): Promise<Item> => {
  const found = await ofKind(page, kind);
  if (found.length !== 1 || !found[0]) throw new Error(`expected one ${kind}, found ${String(found.length)}`);
  return found[0];
};
const kinds = async (page: Page) => (await items(page)).map((i) => i.kind).sort();
const selection = async (page: Page): Promise<string[]> => JSON.parse((await canvas(page).getAttribute('data-selection')) ?? '[]') as string[];
const levels = async (page: Page): Promise<Record<string, string>> => JSON.parse((await holder(page).getAttribute('data-picture-levels')) ?? '{}') as Record<string, string>;
const underlayRow = (page: Page) => layersTile(page).locator('[data-underlay-layer]');
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

/** SC 01's Setup 1 in metres with its room started. */
async function startRoom(page: Page) {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Metres' });
  await closeSettings(page);
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();
}

/** The picture chosen from the room's menu, as a board's Picture button chooses one in the browser build. */
async function addUnderlayFromMenu(page: Page) {
  await planTile(page).getByRole('button', { name: /^Room: / }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Add underlay…' }).or(page.locator('[data-add-underlay]')).first().click();
  await (await chooser).setFiles(imagePath);
  await expect.poll(() => kinds(page)).toEqual(['underlay']);
}

test('an underlay set to scale by two clicks and "4m", a wall traced over it and measured, through the layers, another scene, undo and a reload', async ({ page }) => {
  await startRoom(page);
  await addUnderlayFromMenu(page);
  const added = await one(page, 'underlay');
  // Beneath everything, dimmed and locked by its own row, its longer side 10 m, centred in the view, its picture drawn.
  expect(added).toMatchObject({ layer: 'underlay', dim: true, locked: true, scaled: false });
  expect(Math.max(added.width, added.height)).toBe(10);
  expect(added.sha).toMatch(/^[0-9a-f]{64}$/);
  // 10 m at 100% is 1000 px on its long edge, past the thumbnail's 640: the stored picture, as a board draws one.
  await expect.poll(async () => Object.values(await levels(page))).toEqual(['original']);
  await expect(underlayRow(page)).toHaveAttribute('data-layer-show', 'dimmed');
  await expect(underlayRow(page)).toHaveAttribute('data-layer-locked', 'true');
  await expect(underlayRow(page).locator('[data-layer-count]')).toHaveAttribute('data-layer-count', '1');
  await expect(planTile(page).locator('[data-underlay-unscaled]')).toContainText('Not to scale yet');
  // Locked: a click on it picks nothing.
  await canvas(page).focus();
  await clickAt(page, 300, 100);
  expect(await selection(page)).toEqual([]);

  // Set scale: two clicks 2 m apart on the plan, then "4m" typed in the question.
  await planTile(page).locator('[data-underlay-scale-now]').click();
  await expect(canvas(page)).toHaveAttribute('data-tool', 'host:scale');
  await expect(planTile(page).locator('[data-scale-hint]')).toBeVisible();
  await clickAt(page, -100, 0);
  await clickAt(page, 100, 0);
  const question = page.locator('[data-scale-window]');
  await expect(question).toBeVisible();
  await expect(question).toContainText('2.00 m');
  await question.getByRole('textbox', { name: 'Distance between the points' }).fill('four');
  await question.getByRole('textbox', { name: 'Distance between the points' }).press('Enter');
  await expect(question.locator('[data-scale-refused]')).toBeVisible();
  const axeQuestion = await new AxeBuilder({ page }).include('[data-scale-window]').analyze();
  expect(axeQuestion.violations).toEqual([]);
  await question.getByRole('textbox', { name: 'Distance between the points' }).fill('4m');
  await question.getByRole('textbox', { name: 'Distance between the points' }).press('Enter');
  await expect(question).toHaveCount(0);
  await expect.poll(async () => (await one(page, 'underlay')).scaled).toBe(true);
  const scaled = await one(page, 'underlay');
  expect(scaled.width).toBeCloseTo(added.width * 2, 3);
  // Scaled about the first point (x = -1 m): the middle went from 0 to 1 m, to the centimetre (a click lands on a whole pixel).
  expect(scaled.x + scaled.width / 2).toBeCloseTo(1, 2);
  await expect(planTile(page).locator('[data-underlay-unscaled]')).toHaveCount(0);
  await expect(canvas(page)).toHaveAttribute('data-tool', 'select');

  // A wall traced over it, then measured end to end: the measure's label reads the wall's length.
  await canvas(page).focus();
  await page.keyboard.press('w');
  await clickAt(page, -200, -200);
  await clickAt(page, 200, -200);
  await page.keyboard.press('Enter');
  await expect.poll(() => kinds(page)).toEqual(['underlay', 'wall']);
  const wall = await one(page, 'wall');
  expect(wall.width).toBe(4);
  await canvas(page).focus();
  await page.keyboard.press('r');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'host:measure');
  // A few pixels off each end: the clicks join the wall's ends.
  await clickAt(page, -197, -198);
  await clickAt(page, 198, -203);
  await page.keyboard.press('Enter');
  await expect.poll(() => kinds(page)).toEqual(['measure', 'underlay', 'wall']);
  const measure = await one(page, 'measure');
  expect(measure.layer).toBe('production');
  expect(measure.start?.x).toBeCloseTo(wall.start?.x ?? 1, 6);
  expect(measure.start?.y).toBeCloseTo(wall.start?.y ?? 1, 6);
  expect(measure.end?.x).toBeCloseTo(wall.end?.x ?? 0, 6);
  expect(measure.end?.y).toBeCloseTo(wall.end?.y ?? 0, 6);
  expect(measure.labels).toEqual(['4.00 m']);
  await expect(selectionTile(page).locator('[data-selection-kind]')).toHaveText('Measure');
  await expect(selectionTile(page).getByRole('textbox', { name: 'Length', exact: true })).toHaveValue('4.00 m');

  // Unlocked in the Layers tile, the underlay is picked; locked again, it leaves the selection.
  await underlayRow(page).locator('[data-layer-lock="underlay"]').click();
  await expect(underlayRow(page)).not.toHaveAttribute('data-layer-locked', 'true');
  await expect.poll(async () => (await one(page, 'underlay')).locked).toBeUndefined();
  await clickAt(page, 300, 150);
  await expect.poll(() => selection(page)).toEqual([scaled.id]);
  await expect(selectionTile(page).locator('[data-selection-kind]')).toHaveText('Underlay');
  await expect(selectionTile(page).locator('[data-selection-set-scale]')).toBeVisible();
  const axeSelection = await new AxeBuilder({ page }).include('[data-selection-tile]').analyze();
  expect(axeSelection.violations).toEqual([]);
  await underlayRow(page).locator('[data-layer-lock="underlay"]').click();
  await expect(underlayRow(page)).toHaveAttribute('data-layer-locked', 'true');
  await expect.poll(() => selection(page)).toEqual([]);
  const axeLayers = await new AxeBuilder({ page }).include('[data-layers-tile]').analyze();
  expect(axeLayers.violations).toEqual([]);
  const axeHeading = await new AxeBuilder({ page }).include('[data-plan-heading]').analyze();
  expect(axeHeading.violations).toEqual([]);

  // Undo takes the measure back, redo brings it again.
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(() => kinds(page)).toEqual(['underlay', 'wall']);
  await page.keyboard.press(`${await mod(page)}+Shift+z`);
  await expect.poll(() => kinds(page)).toEqual(['measure', 'underlay', 'wall']);

  // Another scene set in the same room sees the underlay, set to scale.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Storyboard/ }).click();
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 02' }).click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 02 · Setup 1');
  await planTile(page).locator('[data-room-choice]').click();
  await expect.poll(() => kinds(page)).toEqual(['measure', 'underlay', 'wall']);
  expect((await one(page, 'underlay')).id).toBe(scaled.id);
  expect((await one(page, 'underlay')).scaled).toBe(true);

  // After a reload, all of it is there.
  const kept = await items(page);
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).locator('section[aria-label="SC 02"] [data-setup-select]').click();
  await expect.poll(() => items(page)).toEqual(kept);
  await expect(underlayRow(page)).toHaveAttribute('data-layer-locked', 'true');
});

test('the Measure tool from the keyboard: R, Enter, a typed length, Enter; the Library picks it too', async ({ page }) => {
  await startRoom(page);
  await canvas(page).focus();
  await page.keyboard.press('r');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'host:measure');
  // From the keyboard the run starts in the middle of the view; an arrow sets its direction, a typed length its end.
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('3m');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(() => kinds(page)).toEqual(['measure']);
  const measure = await one(page, 'measure');
  expect(measure.width).toBe(3);
  expect(measure.labels).toEqual(['3.00 m']);
  await expect(selectionTile(page).getByRole('textbox', { name: 'Length', exact: true })).toHaveValue('3.00 m');
  // A length typed in the Selection tile keeps its start.
  await selectionTile(page).getByRole('textbox', { name: 'Length', exact: true }).fill('2.5');
  await selectionTile(page).getByRole('textbox', { name: 'Length', exact: true }).press('Enter');
  await expect.poll(async () => (await one(page, 'measure')).width).toBe(2.5);
  expect((await one(page, 'measure')).start?.x).toBeCloseTo(measure.start?.x ?? 1, 6);
  expect((await one(page, 'measure')).start?.y).toBeCloseTo(measure.start?.y ?? 1, 6);

  // The kit's measure in the Library picks the tool.
  const entry = libraryTile(page).locator('[data-library-icon="production/measure"]');
  await entry.scrollIntoViewIfNeeded();
  await entry.focus();
  await page.keyboard.press('Enter');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'host:measure');
  await expect(canvas(page)).toBeFocused();
});

/** Files as a drag or the clipboard carries them, built in the page. */
function files(page: Page, list: { name: string; type: string; data: number[] }[]) {
  return page.evaluateHandle((list) => {
    const transfer = new DataTransfer();
    for (const { name, type, data } of list) transfer.items.add(new File([new Uint8Array(data)], name, { type }));
    return transfer;
  }, list);
}

test('a picture dropped or pasted onto the plan is an underlay where it lands; a PDF is said, never added', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const jpeg = { name: 'floor-plan.jpg', type: 'image/jpeg', data: [...readFileSync(imagePath)] };
  await startRoom(page);
  // Dropped 2 m right of the middle: its middle there.
  const at = await screen(page, 200, 0);
  await holder(page).dispatchEvent('drop', { dataTransfer: await files(page, [jpeg]), clientX: at.x, clientY: at.y });
  await expect.poll(() => kinds(page)).toEqual(['underlay']);
  const dropped = await one(page, 'underlay');
  // Within a pixel of the drop point (1 px is 1 cm at 100%).
  expect(Math.abs(dropped.x + dropped.width / 2 - 2)).toBeLessThanOrEqual(0.01);
  // Pasted with nothing copied on the plan: a second one, in the middle of the view.
  await canvas(page).focus();
  const transfer = await files(page, [jpeg]);
  await page.evaluate((data) => {
    document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, transfer);
  await expect.poll(async () => (await ofKind(page, 'underlay')).length).toBe(2);
  // A PDF floor plan isn't read in this version: said, and nothing added.
  await holder(page).dispatchEvent('drop', { dataTransfer: await files(page, [{ name: 'plan.pdf', type: 'application/pdf', data: [37, 80, 68, 70] }]), clientX: at.x, clientY: at.y });
  await expect(page.getByText('A PDF can’t be an underlay yet. Save it as a picture first.')).toBeVisible();
  expect((await ofKind(page, 'underlay')).length).toBe(2);
});

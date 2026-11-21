import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// Cast marks and camera moves on a plan (6.7) in the memory build: a script with ANA and BEN in one scene, two setups,
// a room. A mark placed with the Mark tool, given to ANA, two next positions (the button, then Shift+M), numbered 1, 2,
// 3 with the path on the first; position 3 moved earlier; the same marks in the scene's other setup; one made this
// setup's only; a camera with a next position and its move's length in the Selection tile; undo, redo and a reload;
// and axe on the Selection tile. The canvas is pixels, so the tests read the plan from the data its tile keeps.

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
  // A script with one scene and two speaking characters.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: 'Import script…' }).click();
  await (await chooser).setFiles({
    name: 'Bey County.fountain',
    mimeType: 'text/plain',
    buffer: Buffer.from('INT. DINER - NIGHT\n\nAna walks to the counter.\n\nANA\nWe’re closed.\n\nBEN\nI know.\n'),
  });
  await page.getByRole('dialog', { name: /^Import / }).getByRole('button', { name: 'Import 1 scene' }).click();
  await expect(page.getByRole('region', { name: 'Storyboard', exact: true }).getByRole('button', { name: '+ Frame in SC 01' })).toBeVisible();
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

interface Item {
  id: string;
  kind: string;
  level: string;
  layer: string;
  centre: { x: number; y: number };
  owner: { kind: string; id: string } | null;
  number: number | null;
  count: number | null;
  labels: string[];
  path?: { x: number; y: number }[];
  moveM?: number;
}

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const selectionTile = (page: Page) => page.getByRole('region', { name: 'Selection', exact: true });
const canvas = (page: Page) => planTile(page).locator('[data-canvas]');
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');
const items = async (page: Page): Promise<Item[]> => JSON.parse((await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as Item[];
const marks = async (page: Page) => (await items(page)).filter((i) => i.kind === 'mark');
const selection = async (page: Page): Promise<string[]> => JSON.parse((await canvas(page).getAttribute('data-selection')) ?? '[]') as string[];
/** Each mark's labels, in plan data order. */
const labels = async (page: Page) => (await marks(page)).map((m) => m.labels.join(' | '));

/** Where a world point (canvas units: cm) is on screen, from the view the canvas reports. */
async function screen(page: Page, x: number, y: number) {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('no canvas');
  const attr = async (name: string) => Number(await canvas(page).getAttribute(name));
  const zoom = await attr('data-zoom');
  return { x: box.x + box.width / 2 + (x - (await attr('data-cx'))) * zoom, y: box.y + box.height / 2 + (y - (await attr('data-cy'))) * zoom };
}

/** A mark picked by a click on its middle. */
async function pick(page: Page, id: string) {
  const mark = (await items(page)).find((i) => i.id === id);
  if (!mark) throw new Error('no such mark');
  const at = await screen(page, mark.centre.x * 100, mark.centre.y * 100);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => selection(page)).toEqual([id]);
}

/** The Setup workspace in metres on SC 01, two setups, Setup 1 shown, its room started. */
async function setUp(page: Page) {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Metres' });
  await closeSettings(page, 'apply');
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await expect(setupsTile(page).locator('[data-setup-select]')).toHaveCount(2);
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 01 · Setup 1');
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();
}

test('places a character’s marks with their path, reorders them, shows them in each setup, and moves a camera', async ({ page }) => {
  await setUp(page);
  // The Mark tool from the keyboard: a plain mark in the middle of the view, selected.
  await canvas(page).focus();
  await page.keyboard.press('m');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'host:mark');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await marks(page)).length).toBe(1);
  const [plain] = await marks(page);
  expect(plain).toMatchObject({ level: 'blocking', layer: 'cast', owner: null, number: null });
  await expect.poll(() => selection(page)).toEqual([plain?.id]);
  await expect(selectionTile(page).locator('[data-selection-kind]')).toHaveText('Plain mark');

  // Given to ANA: her position 1.
  await selectionTile(page).getByRole('combobox', { name: 'Who' }).selectOption({ label: 'ANA' });
  await expect.poll(() => labels(page)).toEqual(['ANA 1']);
  await expect(selectionTile(page).locator('[data-mark-position]')).toHaveAttribute('data-mark-position', '1/1');
  // At either end, Earlier and Later are disabled, saying why in their names.
  await expect(selectionTile(page).getByRole('button', { name: 'Earlier: this is the first position' })).toBeDisabled();
  await expect(selectionTile(page).getByRole('button', { name: 'Later: this is the last position' })).toBeDisabled();

  // Two next positions: the Selection tile's button, then Shift+M on the plan; each is selected.
  await selectionTile(page).getByRole('button', { name: 'Next position' }).click();
  await expect.poll(async () => (await marks(page)).length).toBe(2);
  await canvas(page).focus();
  await page.keyboard.press('Shift+M');
  await expect.poll(async () => (await marks(page)).length).toBe(3);
  const [first, second, third] = await marks(page);
  if (!first || !second || !third) throw new Error('three marks');
  await expect.poll(() => selection(page)).toEqual([third.id]);
  expect([first, second, third].map((m) => m.number)).toEqual([1, 2, 3]);
  await expect.poll(() => labels(page)).toEqual(['ANA 1', 'ANA 2', 'ANA 3']);
  // Each 1 m to the right of the one before; the path on the first, through all three.
  expect(second.centre.x - first.centre.x).toBeCloseTo(1, 4);
  expect(third.centre.x - second.centre.x).toBeCloseTo(1, 4);
  expect((await marks(page))[0]?.path).toHaveLength(3);
  // The arrows move the new one.
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await marks(page))[2]?.centre.y).toBeCloseTo(first.centre.y + 0.1, 4);

  // Position 3 earlier: the third mark is position 2 now, the second position 3.
  await expect(selectionTile(page).locator('[data-mark-position]')).toHaveAttribute('data-mark-position', '3/3');
  await selectionTile(page).getByRole('button', { name: 'Earlier' }).click();
  await expect.poll(async () => (await marks(page)).find((m) => m.id === third.id)?.number).toBe(2);
  expect((await marks(page)).find((m) => m.id === second.id)?.number).toBe(3);
  await expect(selectionTile(page).locator('[data-mark-position]')).toHaveAttribute('data-mark-position', '2/3');
  await expect(selectionTile(page).getByRole('button', { name: 'Earlier' })).toBeEnabled();

  // The legend names ANA with her three positions.
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  await expect(selectionTile(page).locator('[data-legend-group="cast"]')).toContainText('ANA · 3 positions');

  // Setup 2 shows the same marks, the same numbers.
  await setupsTile(page).locator('[data-setup-select]').nth(1).click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 01 · Setup 2');
  // By number (each mark's own order, never drawing order): position 3 moved earlier sits between the other two.
  await expect.poll(async () => (await marks(page)).map((m) => [m.id, m.number]).sort((a, b) => Number(a[1]) - Number(b[1]))).toEqual([
    [first.id, 1],
    [third.id, 2],
    [second.id, 3],
  ]);

  // Position 3 (the second mark) made this setup's only: Setup 2 still has it; Setup 1 shows two positions.
  await pick(page, second.id);
  await selectionTile(page).getByRole('switch', { name: 'This setup only' }).click();
  await expect.poll(async () => (await marks(page)).find((m) => m.id === second.id)?.level).toBe('setup');
  expect((await marks(page)).find((m) => m.id === second.id)?.number).toBe(3);
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await expect.poll(async () => (await marks(page)).map((m) => m.id).sort()).toEqual([first.id, third.id].sort());
  await expect.poll(() => labels(page)).toEqual(['ANA 1', 'ANA 2']);

  // A camera with a next position: the move's length in the Selection tile.
  await canvas(page).focus();
  await page.keyboard.press('c');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await items(page)).filter((i) => i.kind === 'camera').length).toBe(1);
  // A metre up, clear of ANA's first mark in the middle of the view.
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(async () => (await items(page)).find((i) => i.kind === 'camera')?.centre.y).toBeCloseTo(first.centre.y - 1, 4);
  await expect(selectionTile(page).locator('[data-camera-move]')).toHaveAttribute('data-camera-move', 'none');
  await selectionTile(page).getByRole('button', { name: 'Next position' }).click();
  await expect.poll(async () => (await marks(page)).filter((m) => m.owner?.kind === 'camera').length).toBe(1);
  const ghost = (await marks(page)).find((m) => m.owner?.kind === 'camera');
  expect(ghost).toMatchObject({ level: 'setup', layer: 'camera', number: 2, count: 2, labels: ['Camera 2', '1.00 m move'] });
  const camera = (await items(page)).find((i) => i.kind === 'camera');
  await pick(page, camera?.id ?? '');
  await expect(selectionTile(page).locator('[data-camera-move-length]')).toHaveText('1.00 m move');
  await expect(selectionTile(page).locator('[data-camera-position]')).toHaveCount(2);
  expect((await items(page)).find((i) => i.kind === 'camera')?.moveM).toBe(1);

  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[data-selection-tile]').withTags(tags).analyze()).violations).toEqual([]);
  await pick(page, first.id);
  expect((await new AxeBuilder({ page }).include('[data-selection-tile]').withTags(tags).analyze()).violations).toEqual([]);

  // Undo takes the camera's next position off; redo puts it back.
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await marks(page)).filter((m) => m.owner?.kind === 'camera').length).toBe(0);
  await page.keyboard.press(`${await mod(page)}+Shift+z`);
  await expect.poll(async () => (await marks(page)).filter((m) => m.owner?.kind === 'camera').length).toBe(1);

  // After a reload, it is all there.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await expect.poll(() => labels(page)).toEqual(['ANA 1', 'ANA 2', 'Camera 2 | 1.00 m move']);
  await setupsTile(page).locator('[data-setup-select]').nth(1).click();
  await expect.poll(async () => (await marks(page)).map((m) => m.number)).toEqual([1, 2, 3]);
});

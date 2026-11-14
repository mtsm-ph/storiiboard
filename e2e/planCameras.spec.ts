import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// Cameras on a plan (6.4) in the memory build: a body and lenses in Gear, two frames in a setup, a camera placed with
// the C tool, the frames linked in the Frames tile, the field of view read in the Selection tile for Kevin's case
// (50 mm on a 2× zoom at 2.39:1: 51.1°); the lens changed in the Inspector changes the plan's label with no edit to
// the plan; On its side; a lens typed on a frameless camera, then a frame with another lens linked to it, and the lens
// check with its button; undo, redo and a reload; and axe on the Frames and Selection tiles. The canvas is pixels, so
// the tests read the plan from the data its tile keeps (data-plan-data).

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
  await storyboard(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(storyboard(page).locator('[data-shot-id]')).toHaveCount(2);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

interface Camera {
  id: string;
  kind: string;
  icon: string;
  level: string;
  layer: string;
  shotIds: string[];
  onSide: boolean;
  rotation: number;
  lensMm: number | null;
  cone: number | null;
  labels: string[];
}

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const storyboard = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const gear = (page: Page) => page.getByRole('region', { name: 'Gear', exact: true });
const editor = (page: Page) => gear(page).locator('[data-gear-editor]');
const inspector = (page: Page) => page.getByRole('region', { name: 'Frame inspector', exact: true });
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const selectionTile = (page: Page) => page.getByRole('region', { name: 'Selection', exact: true });
const framesTile = (page: Page) => page.getByRole('region', { name: 'Frames in setup', exact: true });
/** A frame's button in the Frames tile, by its shot number: its name starts with what it shows. */
const pickFrame = (page: Page, number: string) => framesTile(page).getByRole('button', { name: new RegExp(`^${number}.*shot from`) });
const canvas = (page: Page) => planTile(page).locator('[data-canvas]');
const mod = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta' : 'Control');
const cameras = async (page: Page): Promise<Camera[]> =>
  (JSON.parse((await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as Camera[]).filter((item) => item.kind === 'camera');
const selection = async (page: Page): Promise<string[]> => JSON.parse((await canvas(page).getAttribute('data-selection')) ?? '[]') as string[];

async function newItem(page: Page, name: string, kind: 'Camera body' | 'Lens') {
  await gear(page).getByRole('button', { name: '+ New item' }).click();
  await expect(editor(page).getByLabel('Name')).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await editor(page).getByRole('radio', { name: kind, exact: true }).click();
  await expect(editor(page).getByRole('radio', { name: kind, exact: true })).toHaveAttribute('aria-checked', 'true');
}

async function fill(page: Page, label: string, value: string) {
  const field = editor(page).getByRole('textbox', { name: label, exact: true });
  await field.fill(value);
  await field.press('Enter');
}

/** A frame's lens picked and its focal length typed in the Inspector. */
async function frameLens(page: Page, index: number, lens: string, mm?: string) {
  await toSection(page, 'Storyboard');
  await storyboard(page).locator('[data-shot-id]').nth(index).click();
  await inspector(page).getByRole('combobox', { name: 'Lens', exact: true }).selectOption({ label: lens });
  if (mm !== undefined) {
    const field = inspector(page).getByRole('textbox', { name: 'Lens (mm)', exact: true });
    await field.fill(mm);
    await field.press('Enter');
    await expect(field).toHaveValue(mm);
  }
}

/** A body, a 2× zoom and a 24 mm prime; 1A on the zoom at 50 mm, 1B on the prime; the frame 2.39:1. */
async function gearAndFrames(page: Page) {
  const project = await openSettings(page, 'Project');
  await project.getByLabel('Aspect ratio').selectOption('2.39:1');
  await closeSettings(page);
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Metres' });
  await closeSettings(page);
  await toSection(page, 'Production');
  await newItem(page, 'FX3', 'Camera body');
  await editor(page).getByLabel('Camera and recording mode').selectOption({ label: 'Sony FX3: Full frame 16:9, 35.6 × 20 mm' });
  await newItem(page, 'Optimo', 'Lens');
  await editor(page).getByRole('radio', { name: 'Zoom', exact: true }).click();
  await fill(page, 'To (mm)', '72');
  await fill(page, 'From (mm)', '30');
  await editor(page).getByRole('combobox', { name: 'Squeeze', exact: true }).selectOption('2');
  await newItem(page, 'Cooke', 'Lens');
  await fill(page, 'Focal length (mm)', '24');
  await frameLens(page, 0, 'Optimo · 30–72 mm 2×', '50');
  await frameLens(page, 1, 'Cooke · 24 mm');
}

/** The Setup workspace on SC 01's Setup 1, both frames in it, its room started. */
async function setupWithFrames(page: Page) {
  await toSection(page, 'Setup');
  await expect(framesTile(page).locator('[data-frames-state]')).toHaveAttribute('data-frames-state', 'noSetup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await expect(framesTile(page).locator('[data-frames-state]')).toHaveAttribute('data-frames-state', 'noFrames');
  await setupsTile(page).locator('[data-setup-add-frame]').first().click();
  await setupsTile(page).locator('[data-setup-add-frame]').first().click();
  await expect(setupsTile(page).locator('[data-setup-frame]')).toHaveCount(2);
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();
  await expect(framesTile(page).locator('[data-frames-no-cameras]')).toBeVisible();
}

/** A camera placed with the C tool, from the keyboard: in the middle of the view, selected. */
async function placeCamera(page: Page): Promise<string> {
  const before = (await cameras(page)).map((c) => c.id);
  await canvas(page).focus();
  await page.keyboard.press('c');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await cameras(page)).length).toBe(before.length + 1);
  const made = (await cameras(page)).find((c) => !before.includes(c.id));
  if (!made) throw new Error('no camera placed');
  await expect.poll(() => selection(page)).toEqual([made.id]);
  return made.id;
}

test('links frames to a camera, draws the frame’s lens live, and checks a typed lens against a frame’s', async ({ page }) => {
  await gearAndFrames(page);
  await setupWithFrames(page);
  const first = await placeCamera(page);
  expect((await cameras(page))[0]).toMatchObject({ icon: 'camera/camera', level: 'setup', layer: 'camera', shotIds: [], cone: null });
  // No frame yet and nothing typed: the label says what's missing.
  await expect.poll(async () => (await cameras(page))[0]?.labels).toEqual(['A · No focal length']);

  // Both frames linked in the Frames tile.
  await framesTile(page).getByRole('combobox', { name: 'Camera for 1A' }).selectOption({ label: 'A · Camera' });
  await framesTile(page).getByRole('combobox', { name: 'Camera for 1B' }).selectOption({ label: 'A · Camera' });
  await expect.poll(async () => (await cameras(page))[0]?.shotIds.length).toBe(2);
  // 1A, the first in board order, is shown: Kevin's 51.1°, not the whole sensor's 70.9°.
  await expect(selectionTile(page).locator('[data-camera-fov]')).toContainText('51.1° · 47.8 mm of 35.6 × 20.0');
  await expect.poll(async () => (await cameras(page))[0]?.labels).toEqual(['A · 50 mm · 51.1°']);
  await expect(selectionTile(page).locator('[data-camera-lens]')).toHaveAttribute('data-camera-lens', 'frame');
  await expect(selectionTile(page).locator('[data-camera-frame][data-shown="true"]')).toContainText('1A');
  // Pressing 1B in the Frames tile shows its lens and selects its camera.
  await pickFrame(page, '1B').click();
  await expect.poll(async () => (await cameras(page))[0]?.labels[0]).toMatch(/^A · 24 mm · /);
  await expect.poll(() => selection(page)).toEqual([first]);
  await pickFrame(page, '1A').click();
  await expect.poll(async () => (await cameras(page))[0]?.labels).toEqual(['A · 50 mm · 51.1°']);

  // The lens changed on the board: the plan's label follows, with no edit to the plan.
  await frameLens(page, 0, 'Optimo · 30–72 mm 2×', '35');
  await toSection(page, 'Setup');
  await expect.poll(async () => (await cameras(page))[0]?.labels[0]).toMatch(/^A · 35 mm · /);
  await page.getByRole('banner').getByRole('button', { name: 'History', exact: true }).click();
  const steps = page.getByRole('region', { name: 'History', exact: true }).getByRole('list', { name: 'Steps, newest first' }).getByRole('listitem');
  await expect(steps.first()).not.toContainText('camera');
  await page.keyboard.press('Escape');

  // On its side: the de-squeezed area turned, 20.0 mm wide at 35 mm.
  await canvas(page).focus();
  await pickFrame(page, '1A').click();
  await selectionTile(page).getByRole('switch', { name: 'On its side' }).click();
  await expect.poll(async () => (await cameras(page))[0]?.onSide).toBe(true);
  await expect.poll(async () => (await cameras(page))[0]?.labels).toEqual(['A · 35 mm · 31.9°']);

  // [ and ] turn the selected camera.
  await canvas(page).focus();
  await page.keyboard.press(']');
  await expect.poll(async () => (await cameras(page)).find((c) => c.id === first)?.rotation).toBe(5);
  await page.keyboard.press('Shift+BracketLeft');
  await expect.poll(async () => (await cameras(page)).find((c) => c.id === first)?.rotation).toBe(4);

  // A second camera, frameless: a lens typed on it, then 1B (24 mm) taken over from the first one.
  const second = await placeCamera(page);
  const focal = selectionTile(page).getByRole('textbox', { name: 'Focal length (mm)', exact: true });
  await focal.fill('85');
  await focal.press('Enter');
  await expect.poll(async () => (await cameras(page)).find((c) => c.id === second)?.lensMm).toBe(85);
  await expect(selectionTile(page).locator('[data-lens-check]')).toHaveCount(0);
  await framesTile(page).getByRole('combobox', { name: 'Camera for 1B' }).selectOption({ label: 'A · Camera (2)' });
  await expect.poll(async () => (await cameras(page)).find((c) => c.id === second)?.shotIds).toHaveLength(1);
  await expect.poll(async () => (await cameras(page)).find((c) => c.id === first)?.shotIds).toHaveLength(1);
  const check = selectionTile(page).locator('[data-lens-check]');
  await expect(check).toContainText('Frame 1B uses 24 mm; this camera has 85 mm typed.');
  // The cone draws the frame's lens all the same.
  await expect.poll(async () => (await cameras(page)).find((c) => c.id === second)?.labels[0]).toMatch(/^A · 24 mm · /);

  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  for (const area of ['[data-selection-tile]', '[data-frames-tile]']) {
    expect((await new AxeBuilder({ page }).include(area).withTags(tags).analyze()).violations, area).toEqual([]);
  }

  await check.getByRole('button', { name: 'Use the frame’s lens' }).click();
  await expect(check).toHaveCount(0);
  await expect.poll(async () => (await cameras(page)).find((c) => c.id === second)?.lensMm).toBeNull();

  // Undo brings the typed lens and the check back; redo takes them off again.
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect(selectionTile(page).locator('[data-lens-check]')).toBeVisible();
  await page.keyboard.press(`${await mod(page)}+Shift+z`);
  await expect(selectionTile(page).locator('[data-lens-check]')).toHaveCount(0);

  // After a reload, it is all there.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await expect.poll(async () => (await cameras(page)).map((c) => [c.shotIds.length, c.onSide, c.lensMm])).toEqual([
    [1, true, null],
    [1, false, null],
  ]);
  await expect.poll(async () => (await cameras(page)).map((c) => c.labels[0])).toEqual(['A · 35 mm · 31.9°', expect.stringMatching(/^A · 24 mm · /)]);
  await expect(framesTile(page).locator('[data-frames-frame]')).toHaveCount(2);
});

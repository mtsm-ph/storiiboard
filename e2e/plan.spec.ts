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
  kind: string;
  width: number;
  height: number;
  rotation: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

interface Opening {
  id: string;
  kind: string;
  level: string;
  wallId: string;
  along: number;
  width: number;
  hinge: string;
  swing: string;
  fromStart: number;
  fromEnd: number;
  centre: { x: number; y: number };
}

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const selectionTile = (page: Page) => page.getByRole('region', { name: 'Selection', exact: true });
const canvas = (page: Page) => planTile(page).locator('[data-canvas]');
const planData = async (page: Page): Promise<(Wall & Opening)[]> => JSON.parse((await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as (Wall & Opening)[];
const walls = async (page: Page): Promise<Wall[]> => (await planData(page)).filter((item) => item.kind === 'wall');
const openings = async (page: Page): Promise<Opening[]> => (await planData(page)).filter((item) => item.kind !== 'wall');
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
  await planTile(page).getByRole('button', { name: 'New room' }).click();
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
  // Enter writes it and keeps the focus in the field, showing it as the plan has it.
  await expect(field(page, 'Length')).toBeFocused();
  await expect(field(page, 'Length')).toHaveValue('4.00 m');
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
  // A metre exactly: a wall snaps by its middle line's ends, so it stays on the grid line, and its other axis never moves.
  await expect.poll(async () => Math.abs(((await walls(page))[1]?.start.x ?? 0) - (before?.start.x ?? 0) - 1)).toBeLessThanOrEqual(0.001);
  expect(Math.abs(((await walls(page))[1]?.start.y ?? 0) - (before?.start.y ?? 0))).toBeLessThanOrEqual(0.001);
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

test('a run of walls belongs to the view it began in: picking another setup writes it there, never into the other room', async ({ page }) => {
  // A second scene, with its own setup and room.
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await startRoom(page);
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 02' }).click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 02 · Setup 1');
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();

  // Back on SC 01: a run of two fixed points, then SC 02's setup picked mid-run.
  await setupsTile(page).locator('section[aria-label="SC 01"] [data-setup-select]').click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 01 · Setup 1');
  await canvas(page).focus();
  await page.keyboard.press('w');
  await clickAt(page, -150, -150);
  await clickAt(page, 150, -150);
  await moveTo(page, 150, 100);
  await expect(canvas(page)).toHaveAttribute('data-path', /.+/);
  await setupsTile(page).locator('section[aria-label="SC 02"] [data-setup-select]').click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 02 · Setup 1');

  // SC 02's plan has no run and no walls; Enter there writes nothing.
  await expect(canvas(page)).not.toHaveAttribute('data-path', /.*/);
  await expect(canvas(page)).toHaveAttribute('data-tool', 'select');
  await canvas(page).focus();
  await page.keyboard.press('Enter');
  expect(await walls(page)).toEqual([]);
  // SC 01's room has the one wall its fixed points made, and no more.
  await setupsTile(page).locator('section[aria-label="SC 01"] [data-setup-select]').click();
  await expect.poll(() => widths(page)).toEqual([3]);
  await setupsTile(page).locator('section[aria-label="SC 02"] [data-setup-select]').click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 02 · Setup 1');
  expect(await walls(page)).toEqual([]);
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

// 6.2b: doors and windows in walls, shared rooms and their copies.

/** One 4 m wall across the middle of the view, from (-2 m, 0) to (2 m, 0). */
async function drawWall(page: Page) {
  await canvas(page).focus();
  await page.keyboard.press('w');
  await clickAt(page, -200, 0);
  await clickAt(page, 200, 0);
  await page.keyboard.press('Enter');
  await expect.poll(() => widths(page)).toEqual([4]);
}

/** A drag on the canvas between two world points (canvas units). */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const a = await screen(page, from.x, from.y);
  const b = await screen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
}

test('puts a door and a window in a wall, slides and types the door’s place, flips it, and both follow the wall, through undo and a reload', async ({ page }) => {
  await startRoom(page);
  await drawWall(page);

  // The Door tool previews over the wall, and a click puts it there, snapped to the grid along it.
  await canvas(page).focus();
  await page.keyboard.press('d');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'host:door');
  await moveTo(page, -100, 10);
  await expect(planTile(page).locator('[data-plan-data]')).toHaveAttribute('data-plan-preview', /"along":1\b/);
  await clickAt(page, -100, 10);
  await expect.poll(async () => (await openings(page)).map((o) => [o.kind, o.along])).toEqual([['door', 1]]);
  // Over no wall, the Window tool puts nothing; over the wall, a window.
  await page.keyboard.press('n');
  await clickAt(page, 100, 200);
  await expect.poll(async () => (await openings(page)).length).toBe(1);
  await page.keyboard.press('n');
  await clickAt(page, 100, 0);
  await expect.poll(async () => (await openings(page)).map((o) => [o.kind, o.along])).toEqual([
    ['door', 1],
    ['window', 3],
  ]);

  // The door slides along the wall by a drag (by its swing, clear of the wall), half a metre.
  await drag(page, { x: -100, y: -40 }, { x: -50, y: 60 });
  await expect.poll(async () => (await openings(page))[0]?.along).toBe(1.5);
  await expect(selectionTile(page).locator('[data-selection-kind]')).toHaveText('Door');
  // Its distance from the wall's start, typed: its edge 0.50 m from the start.
  await field(page, 'From wall start').fill('0.5 m');
  await field(page, 'From wall start').press('Enter');
  await expect.poll(async () => (await openings(page))[0]?.along).toBe(0.95);
  await expect(field(page, 'From wall end')).toHaveValue('2.60 m');
  // Over the window, refused, and nothing saved.
  await field(page, 'From wall start').fill('2 m');
  await field(page, 'From wall start').press('Enter');
  await expect(page.getByText('That doesn’t fit: it would run off the wall or over another door or window.')).toBeVisible();
  await expect.poll(async () => (await openings(page))[0]?.along).toBe(0.95);
  // F flips its swing, Shift+F its hinge.
  await canvas(page).focus();
  await page.keyboard.press('f');
  await expect.poll(async () => (await openings(page))[0]?.swing).toBe('right');
  await page.keyboard.press('Shift+F');
  await expect.poll(async () => (await openings(page))[0]?.hinge).toBe('end');
  await expect(selectionTile(page).getByRole('combobox', { name: 'Opens to' })).toHaveValue('right');

  // The wall moved a metre down: both follow.
  await clickAt(page, 0, 0);
  await expect(selectionTile(page).locator('[data-selection-kind]')).toHaveText('Wall');
  await drag(page, { x: 0, y: 0 }, { x: 0, y: 100 });
  await expect.poll(async () => (await openings(page)).map((o) => Math.round(o.centre.y * 100) / 100)).toEqual([1, 1]);
  // A wall can't be typed shorter than its openings need.
  await field(page, 'Length').fill('3 m');
  await field(page, 'Length').press('Enter');
  await expect(page.getByText('Its doors and windows need the wall to be at least 3.60 m.')).toBeVisible();
  await expect.poll(() => widths(page)).toEqual([4]);

  // Undo takes the move back, and redo brings it again.
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await openings(page)).map((o) => Math.round(o.centre.y * 100) / 100)).toEqual([0, 0]);
  await page.keyboard.press(`${await mod(page)}+Shift+z`);
  await expect.poll(async () => (await openings(page)).map((o) => Math.round(o.centre.y * 100) / 100)).toEqual([1, 1]);

  // Deleting the wall takes its openings; the Trash lists the wall, and restoring it brings them back.
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await planData(page)).length).toBe(0);
  await page.getByRole('button', { name: /^Layout/ }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  const trash = page.getByRole('region', { name: 'Trash', exact: true });
  await expect(trash.getByRole('button', { name: /^Restore plan item Door/ })).toHaveCount(0);
  await trash.getByRole('button', { name: /^Restore plan item Wall in / }).click();
  await expect.poll(async () => (await openings(page)).length).toBe(2);
  const kept = await planData(page);

  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await expect.poll(() => planData(page)).toEqual(kept);
});

test('the keyboard puts a door in the middle of the selected wall, and the Door and Window tools take their letters', async ({ page }) => {
  await startRoom(page);
  await drawWall(page);
  await canvas(page).focus();
  await page.keyboard.press('Escape');
  await clickAt(page, 0, 0);
  await expect.poll(() => selection(page)).toHaveLength(1);
  await page.keyboard.press('d');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await openings(page)).map((o) => [o.kind, o.along])).toEqual([['door', 2]]);
  await expect(canvas(page)).toHaveAttribute('data-tool', 'select');
  // The door is selected: arrows nudge it along the wall, a centimetre at a time.
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await openings(page))[0]?.along).toBe(2.01);
  await page.keyboard.press('n');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'host:window');
  await page.keyboard.press('Escape');
  await expect(canvas(page)).toHaveAttribute('data-tool', 'select');
});

/** A frame in a scene, set at Diner from the "/" menu (a location typed is found by its name). */
async function atDiner(page: Page, scene: string) {
  const board = page.getByRole('region', { name: 'Storyboard', exact: true });
  await board.getByRole('button', { name: `+ Frame in ${scene}` }).click();
  await expect(board.locator('[data-shot-id]').first()).toBeVisible();
  await page.keyboard.press('/');
  await page.keyboard.type('loc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Diner');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Frame inspector', exact: true }).locator('span', { hasText: /^Diner$/ })).toBeVisible();
}

test('two scenes at one location share a room until one takes a separate copy, and a scene can use another room', async ({ page }) => {
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await atDiner(page, 'SC 01');
  await atDiner(page, 'SC 02');
  await startRoom(page);
  await drawWall(page);

  // SC 02's chooser offers the room already drawn at its location, with how many scenes use it; by the keyboard.
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 02' }).click();
  await expect(planTile(page).locator('[data-plan-header]')).toHaveText('SC 02 · Setup 1');
  const choice = planTile(page).locator('[data-room-choice]');
  await expect(choice).toHaveText(['DinerDiner · Used by 1 scene']);
  await choice.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => widths(page)).toEqual([4]);
  await expect(planTile(page).locator('[data-room-shared]')).toHaveText('Also in SC 01');

  // Drawn in one, seen in the other.
  await canvas(page).focus();
  await page.keyboard.press('w');
  await clickAt(page, 200, 0);
  await clickAt(page, 200, -100);
  await page.keyboard.press('Enter');
  await expect.poll(() => widths(page)).toEqual([4, 1]);
  const one = setupsTile(page).locator('section[aria-label="SC 01"] [data-setup-select]');
  const two = setupsTile(page).locator('section[aria-label="SC 02"] [data-setup-select]');
  await one.click();
  await expect.poll(() => widths(page)).toEqual([4, 1]);
  await expect(planTile(page).locator('[data-room-shared]')).toHaveText('Also in SC 02');

  // SC 02 takes a separate copy: a change there no longer reaches SC 01.
  await two.click();
  await planTile(page).getByRole('button', { name: 'Room: Diner', exact: true }).click();
  await page.getByRole('button', { name: 'Make a separate copy' }).click();
  await expect(planTile(page).getByRole('button', { name: 'Room: Diner (SC 02)', exact: true })).toBeVisible();
  await expect(planTile(page).locator('[data-room-shared]')).toHaveCount(0);
  await clickAt(page, 0, 0);
  await field(page, 'Length').fill('5 m');
  await field(page, 'Length').press('Enter');
  await expect.poll(() => widths(page)).toEqual([5, 1]);
  await one.click();
  await expect.poll(() => widths(page)).toEqual([4, 1]);

  // Undo the length, then the copy: SC 02 is in the shared room again; redo both.
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+z`);
  await page.keyboard.press(`${await mod(page)}+z`);
  await two.click();
  await expect(planTile(page).getByRole('button', { name: 'Room: Diner', exact: true })).toBeVisible();
  await expect(planTile(page).locator('[data-room-shared]')).toHaveText('Also in SC 01');
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+Shift+z`);
  await page.keyboard.press(`${await mod(page)}+Shift+z`);
  await expect(planTile(page).getByRole('button', { name: 'Room: Diner (SC 02)', exact: true })).toBeVisible();
  await expect.poll(() => widths(page)).toEqual([5, 1]);

  // "Use another room…": back to the shared one; the copy stays, offered in the list.
  await planTile(page).getByRole('button', { name: 'Room: Diner (SC 02)', exact: true }).click();
  await page.getByRole('button', { name: 'Use another room…' }).click();
  const window = page.getByRole('dialog', { name: 'Use another room' });
  await expect(window.locator('[data-room-choice]')).toHaveText(['DinerDiner · Used by 1 scene']);
  await window.locator('[data-room-choice]').click();
  await expect(window).toHaveCount(0);
  await expect.poll(() => widths(page)).toEqual([4, 1]);
  await expect(planTile(page).locator('[data-room-shared]')).toHaveText('Also in SC 01');

  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[data-plan-tile]').withTags(tags).analyze()).violations).toEqual([]);
  await planTile(page).getByRole('button', { name: 'Room: Diner', exact: true }).click();
  await page.getByRole('button', { name: 'Use another room…' }).click();
  await expect(window.locator('[data-room-choice]')).toHaveText(['Diner (SC 02)Diner · Used by 0 scenes']);
  expect((await new AxeBuilder({ page }).include('dialog[open]').withTags(tags).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');

  // After a reload, SC 02 is in the shared room and the copy is still there to use.
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await toSection(page, 'Setup');
  await two.click();
  await expect(planTile(page).locator('[data-room-shared]')).toHaveText('Also in SC 01');
  await expect.poll(() => widths(page)).toEqual([4, 1]);
});

test('a door in the Selection tile passes axe', async ({ page }) => {
  await startRoom(page);
  await drawWall(page);
  await canvas(page).focus();
  await page.keyboard.press('d');
  await clickAt(page, -100, 0);
  await expect.poll(async () => (await openings(page)).length).toBe(1);
  await expect(selectionTile(page).locator('[data-selection-kind]')).toHaveText('Door');
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).include('[data-selection-tile]').withTags(tags).analyze()).violations).toEqual([]);
  expect((await new AxeBuilder({ page }).include('[data-plan-tile]').withTags(tags).analyze()).violations).toEqual([]);
});

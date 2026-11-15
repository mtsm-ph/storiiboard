import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';
import { closeSettings, openSettings } from './settings';

// Walls stop cones and beams (6.18) in the memory build: a camera on a body with a typed lens, facing a wall drawn
// across its view: its cone's drawn shape ends at the wall's face; a door put in the wall lets it through; Stop at walls
// switched off in the Selection tile draws the whole cone again; undo puts the switch back, and a reload keeps it off.
// The canvas is pixels, so the test reads the shape the canvas draws from the data its tile keeps (data-plan-data, in
// metres: `sight`, the shape's corner count and the box round its corners; 6.18 review: never the corners themselves).
// While a drag is under way, the shapes the canvas has cut live are on data-plan-live, by id, in the same form.

test.use({ viewport: { width: 1440, height: 900 } });
test.use({ deviceScaleFactor: 1 });

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

interface Sight {
  cut: boolean;
  empty: boolean;
  corners: number;
  box: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

interface Item {
  id: string;
  kind: string;
  centre?: { x: number; y: number };
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  height?: number;
  stopAtWalls?: false;
  sight?: Sight | null;
}

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const selectionTile = (page: Page) => page.getByRole('region', { name: 'Selection', exact: true });
const gear = (page: Page) => page.getByRole('region', { name: 'Gear', exact: true });
const editor = (page: Page) => gear(page).locator('[data-gear-editor]');
const canvas = (page: Page) => planTile(page).locator('[data-canvas]');
const planData = async (page: Page): Promise<Item[]> => JSON.parse((await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as Item[];
const ofKind = async (page: Page, kind: string) => (await planData(page)).filter((item) => item.kind === kind);
const camera = async (page: Page) => (await ofKind(page, 'camera'))[0];
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

/** Metres, a camera body (the project's default for every camera), and SC 01's Setup 1 with its room started. */
async function startRoom(page: Page) {
  const app = await openSettings(page, 'App');
  await app.getByRole('combobox', { name: 'Plan units' }).selectOption({ label: 'Metres' });
  await closeSettings(page);
  await toSection(page, 'Production');
  await gear(page).getByRole('button', { name: '+ New item' }).click();
  await expect(editor(page).getByLabel('Name')).toBeFocused();
  await page.keyboard.type('FX3');
  await page.keyboard.press('Enter');
  await editor(page).getByRole('radio', { name: 'Camera body', exact: true }).click();
  await editor(page).getByLabel('Camera and recording mode').selectOption({ label: 'Sony FX3: Full frame 16:9, 35.6 × 20 mm' });
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();
}

/** A camera placed with the C tool in the middle of the view, facing up, a 35 mm lens typed on it; its middle (metres). */
async function placeCamera(page: Page): Promise<{ id: string; x: number; y: number }> {
  await canvas(page).focus();
  await page.keyboard.press('c');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await ofKind(page, 'camera')).length).toBe(1);
  const field = selectionTile(page).getByRole('textbox', { name: 'Focal length (mm)', exact: true });
  await field.fill('35');
  await field.press('Enter');
  await expect.poll(async () => (await camera(page))?.sight?.corners).toBe(3);
  const made = await camera(page);
  if (!made?.centre) throw new Error('no camera');
  return { id: made.id, ...made.centre };
}

test('a camera’s cone ends at the wall it faces, passes the door put in it, and Stop at walls off draws it whole', async ({ page }) => {
  await startRoom(page);
  const cam = await placeCamera(page);
  // Uncut in an open room: its three corners, the far ones 6 m × cos(half its angle) up.
  const open = (await camera(page))?.sight;
  expect(open?.cut).toBe(false);
  const reach = cam.y - (open?.box?.minY ?? cam.y);
  expect(reach).toBeGreaterThan(4);

  // A wall across its view, 2 m up, from 3 m left of it to 3 m right.
  await canvas(page).focus();
  await page.keyboard.press('w');
  await clickAt(page, cam.x * 100 - 300, cam.y * 100 - 200);
  await clickAt(page, cam.x * 100 + 300, cam.y * 100 - 200);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await ofKind(page, 'wall')).length).toBe(1);
  const [wall] = await ofKind(page, 'wall');
  if (!wall?.start || !wall.end || wall.height === undefined) throw new Error('no wall');
  const face = wall.start.y + wall.height / 2;
  // The cone's shape ends at the wall's near face: nothing past it.
  await expect.poll(async () => (await camera(page))?.sight?.cut).toBe(true);
  const cut = (await camera(page))?.sight;
  // Its corners past the apex (the camera's middle, below the face) give its box's top: none above the face, one on it.
  expect(cut?.box?.minY).toBeGreaterThan(face - 0.002);
  expect(Math.abs((cut?.box?.minY ?? Number.NaN) - face)).toBeLessThan(0.002);

  // A door in the middle of the wall: the cone goes through it.
  await page.keyboard.press('v');
  await clickAt(page, ((wall.start.x + wall.end.x) / 2) * 100 + 50, wall.start.y * 100);
  await expect.poll(() => selection(page)).toEqual([wall.id]);
  await page.keyboard.press('d');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await ofKind(page, 'door')).length).toBe(1);
  await expect.poll(async () => (await camera(page))?.sight?.box?.minY ?? Number.NaN).toBeLessThan(wall.start.y - 1);

  // Stop at walls off, on the camera: the whole cone, as in an open room.
  await clickAt(page, cam.x * 100, cam.y * 100);
  await expect.poll(() => selection(page)).toEqual([cam.id]);
  const stop = selectionTile(page).getByRole('switch', { name: 'Stop at walls' });
  await expect(stop).toHaveAttribute('aria-checked', 'true');
  await stop.click();
  await expect(stop).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => (await camera(page))?.stopAtWalls).toBe(false);
  await expect.poll(async () => (await camera(page))?.sight?.cut).toBe(false);
  expect((await camera(page))?.sight).toEqual(open);

  // Undo puts it back: cut again (through the door).
  await canvas(page).focus();
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect.poll(async () => (await camera(page))?.stopAtWalls).toBeUndefined();
  await expect.poll(async () => (await camera(page))?.sight?.cut).toBe(true);

  // Off again, and kept across a reload.
  await page.keyboard.press(`${await mod(page)}+Shift+z`);
  await expect.poll(async () => (await camera(page))?.sight?.cut).toBe(false);
  await page.reload();
  await page.getByRole('list', { name: 'Recent projects' }).getByRole('button', { name: /^Bey County/ }).click();
  await toSection(page, 'Setup');
  await setupsTile(page).locator('[data-setup-select]').first().click();
  await expect.poll(async () => (await camera(page))?.stopAtWalls).toBe(false);
  await expect.poll(async () => (await camera(page))?.sight?.cut).toBe(false);
});

/** The shapes the canvas has cut live during a drag (data-plan-live), by id; none when no drag is under way. */
const live = async (page: Page): Promise<Record<string, Sight> | null> => {
  const text = await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-live');
  return text === null ? null : (JSON.parse(text) as Record<string, Sight>);
};

/** A wall drawn with the W tool from one world point (canvas units: cm) to another; its record as the plan lists it. */
async function drawWall(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<Item> {
  const before = (await ofKind(page, 'wall')).length;
  await canvas(page).focus();
  await page.keyboard.press('w');
  await clickAt(page, from.x, from.y);
  await clickAt(page, to.x, to.y);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await ofKind(page, 'wall')).length).toBe(before + 1);
  const made = (await ofKind(page, 'wall')).at(-1);
  if (!made?.start || !made.end || made.height === undefined) throw new Error('no wall');
  return made;
}

/** A press at one world point and a drag, the button still down, by (dx, dy) canvas units in a few steps. */
async function pressAndDrag(page: Page, at: { x: number; y: number }, dx: number, dy: number) {
  const start = await screen(page, at.x, at.y);
  const end = await screen(page, at.x + dx, at.y + dy);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(start.x + ((end.x - start.x) * step) / 10, start.y + ((end.y - start.y) * step) / 10);
}

test('mid-drag, a camera dragged toward a wall is already cut by it, and Escape puts its cone back', async ({ page }) => {
  await startRoom(page);
  const cam = await placeCamera(page);
  // A 1.8 m wall 1.5 m up, from 1.1 m to 2.9 m right of the camera: past the cone's edge (27° either side of up on a 35 mm
  // lens on the FX3; the wall's nearest corner is atan(1.1 / 1.45) = 37.2° off), so the cone is whole.
  const wall = await drawWall(page, { x: cam.x * 100 + 110, y: cam.y * 100 - 150 }, { x: cam.x * 100 + 290, y: cam.y * 100 - 150 });
  const face = (wall.start?.y ?? Number.NaN) + (wall.height ?? Number.NaN) / 2;
  await expect.poll(async () => (await camera(page))?.sight?.cut).toBe(false);
  const whole = (await camera(page))?.sight;
  // Dragged 2 m right, not let go: the wall runs from 0.9 m left of it to 0.9 m right, across the whole cone (1.45 tan 27°
  // = 0.74 m either side at the face), and the cone already ends at the face, nothing past it.
  await pressAndDrag(page, { x: cam.x * 100, y: cam.y * 100 }, 200, 0);
  await expect.poll(async () => (await live(page))?.[cam.id]?.cut).toBe(true);
  const midDrag = (await live(page))?.[cam.id];
  expect(midDrag?.box?.minY).toBeGreaterThan(face - 0.002);
  expect(Math.abs((midDrag?.box?.minY ?? Number.NaN) - face)).toBeLessThan(0.002);
  // Nothing is written mid-drag: the records still have the camera where it was, its cone whole.
  expect((await camera(page))?.centre).toEqual({ x: cam.x, y: cam.y });
  expect((await camera(page))?.sight).toEqual(whole);
  // Escape: the drag is called off, the live shapes go, and the cone is as it was before it.
  await page.keyboard.press('Escape');
  await expect.poll(() => live(page)).toBeNull();
  await page.mouse.up();
  expect((await camera(page))?.centre).toEqual({ x: cam.x, y: cam.y });
  expect((await camera(page))?.sight).toEqual(whole);
});

test('mid-drag, a wall dragged across a camera’s cone already cuts it, and Escape puts the cone back', async ({ page }) => {
  await startRoom(page);
  const cam = await placeCamera(page);
  // A 1.8 m wall 1.5 m up, wholly to the right of the cone (from 1.1 m to 2.9 m right of the camera): the cone is whole.
  const wall = await drawWall(page, { x: cam.x * 100 + 110, y: cam.y * 100 - 150 }, { x: cam.x * 100 + 290, y: cam.y * 100 - 150 });
  const face = (wall.start?.y ?? Number.NaN) + (wall.height ?? Number.NaN) / 2;
  await expect.poll(async () => (await camera(page))?.sight?.cut).toBe(false);
  const whole = (await camera(page))?.sight;
  // The wall picked, then pressed at its middle and dragged 2 m left, not let go: it lies across the whole cone, which
  // already ends at its face.
  const middle = { x: (((wall.start?.x ?? 0) + (wall.end?.x ?? 0)) / 2) * 100, y: (wall.start?.y ?? 0) * 100 };
  await page.keyboard.press('v');
  await clickAt(page, middle.x, middle.y);
  await expect.poll(() => selection(page)).toEqual([wall.id]);
  await pressAndDrag(page, middle, -200, 0);
  await expect.poll(async () => (await live(page))?.[cam.id]?.cut).toBe(true);
  const midDrag = (await live(page))?.[cam.id];
  expect(midDrag?.box?.minY).toBeGreaterThan(face - 0.002);
  expect(Math.abs((midDrag?.box?.minY ?? Number.NaN) - face)).toBeLessThan(0.002);
  // Nothing is written mid-drag: the records keep the wall where it was, and the camera's cone whole.
  expect((await ofKind(page, 'wall'))[0]?.start).toEqual(wall.start);
  expect((await camera(page))?.sight).toEqual(whole);
  // Escape: the wall stays where it was, and the cone is whole again.
  await page.keyboard.press('Escape');
  await expect.poll(() => live(page)).toBeNull();
  await page.mouse.up();
  expect((await ofKind(page, 'wall'))[0]?.start).toEqual(wall.start);
  expect((await camera(page))?.sight).toEqual(whole);
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { skipOnboarding } from './onboarding';

// Scout photos (6.27) in the memory build, in three tests.
// 1. A photo with EXIF is added to a location: its date, time and place show, and "Use this photo's place and time"
//    moves the pin there and makes it the location's light reference, in one edit, with no request leaving the page.
//    The picture stored in the project carries no EXIF: the test's photo really has an EXIF segment (its date and a
//    GPS position), and the bytes the project keeps, read back from the Project data export, have none of it.
// 2. On a plan of a setup at that location, the sun path's settings name the light reference; "Show the sun at the
//    photo's time" draws the photo's date, marks where the sun stood, and names the photo as the date's source, in the
//    settings and on the compass; off, it is as before. Each is undone.
// 3. The photo removed: the sun is drawn as before and the switch shows off and says why; undone, it is back.
// axe on the new controls, light and dark.
//
// The browser build has no Rust side to read EXIF: the stand-in answers with what the test says each file holds, by
// name (window.__sbdDevPhotoExif, src/app/photoExif.ts). The place is made up: a point at sea, south of Long Island,
// so New York's zone is its own; the browser is set to it, as the other sun tests are.

test.use({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/New_York' });

const errors: string[] = [];

/** The made-up photo's EXIF: taken on 3 November 2026 at 15:20:07, at 40° 12' N, 72° 54' W. */
const TAKEN = '2026:11:03 15:20:07';
const LATITUDE: [number, number][] = [[40, 1], [12, 1], [0, 1]];
const LONGITUDE: [number, number][] = [[72, 1], [54, 1], [0, 1]];
const rationals = (parts: [number, number][]) => Buffer.concat(parts.map(([n, d]) => Buffer.from(new Uint32Array([n, d]).buffer)));

type Entry = { tag: number; type: 2 | 4 | 5; count: number; value: Buffer };
const ascii = (tag: number, text: string): Entry => ({ tag, type: 2, count: text.length + 1, value: Buffer.from(`${text}\0`, 'latin1') });
const rational = (tag: number, parts: [number, number][]): Entry => ({ tag, type: 5, count: parts.length, value: rationals(parts) });
const pointer = (tag: number, to: number): Entry => ({ tag, type: 4, count: 1, value: Buffer.from(new Uint32Array([to]).buffer) });

/** One TIFF directory at `at`: its count, its entries, no next directory, then the values too long for an entry. */
function directory(entries: Entry[], at: number): Buffer {
  const head = Buffer.alloc(2 + 12 * entries.length + 4);
  head.writeUInt16LE(entries.length, 0);
  const tail: Buffer[] = [];
  let tailLength = 0;
  entries.forEach((entry, i) => {
    const o = 2 + 12 * i;
    head.writeUInt16LE(entry.tag, o);
    head.writeUInt16LE(entry.type, o + 2);
    head.writeUInt32LE(entry.count, o + 4);
    if (entry.value.length <= 4) entry.value.copy(head, o + 8);
    else {
      head.writeUInt32LE(at + head.length + tailLength, o + 8);
      const padded = entry.value.length % 2 === 1 ? Buffer.concat([entry.value, Buffer.alloc(1)]) : entry.value;
      tail.push(padded);
      tailLength += padded.length;
    }
  });
  return Buffer.concat([head, ...tail]);
}

/** A real EXIF segment (APP1): the date and time taken and a GPS position, as a camera writes them. */
function exifSegment(): Buffer {
  const exif = [ascii(0x9003, TAKEN)];
  const gps = [ascii(0x1, 'N'), rational(0x2, LATITUDE), ascii(0x3, 'W'), rational(0x4, LONGITUDE)];
  const primary = (exifAt: number, gpsAt: number) => [ascii(0x0132, TAKEN), pointer(0x8769, exifAt), pointer(0x8825, gpsAt)];
  const exifAt = 8 + directory(primary(0, 0), 8).length;
  const gpsAt = exifAt + directory(exif, exifAt).length;
  const tiff = Buffer.concat([Buffer.from('II*\0', 'latin1'), Buffer.from(new Uint32Array([8]).buffer), directory(primary(exifAt, gpsAt), 8), directory(exif, exifAt), directory(gps, gpsAt)]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(2 + 6 + tiff.length, 0);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), length, Buffer.from('Exif\0\0', 'latin1'), tiff]);
}

const fixture = (name: string): Buffer => readFileSync(fileURLToPath(new URL(`./fixtures/images/${name}`, import.meta.url)));

/** A picture from the fixtures with the EXIF segment put in after its first marker, as a camera's file has it. */
function photoWithExif(): Buffer {
  const picture = fixture('photo-a.jpg');
  return Buffer.concat([picture.subarray(0, 2), exifSegment(), picture.subarray(2)]);
}

/** What of the EXIF could survive in a picture's bytes: its marker's name, the date as written, either coordinate. */
const EXIF_TRACES: [string, Buffer][] = [
  ['the Exif header', Buffer.from('Exif\0\0', 'latin1')],
  ['the date taken', Buffer.from(TAKEN, 'latin1')],
  ['the latitude', rationals(LATITUDE)],
  ['the longitude', rationals(LONGITUDE)],
];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?files=memory');
  await page.evaluate(() => {
    window.localStorage.clear();
  });
  await page.reload();
  page.once('dialog', (dialog) => void dialog.accept('Bey County'));
  await page.getByRole('button', { name: 'New project…' }).click();
  await skipOnboarding(page);
  // What the stand-in reads from each file, by its name: the same values the photo's real EXIF holds.
  await page.evaluate(() => {
    (window as unknown as { __sbdDevPhotoExif: Record<string, unknown> }).__sbdDevPhotoExif = {
      'quay-dusk.jpg': { takenAt: '2026-11-03T15:20:07', takenOffset: null, latitude: 40.2, longitude: -72.9 },
    };
  });
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

interface Item {
  id: string;
  kind: string;
  level: string;
  drawn?: boolean;
  says?: string;
  from?: { place: string | null; date: string | null };
  photo?: string;
}

interface Exported {
  tables: Record<string, { columns: string[]; rows: (string | number | null | { base64: string })[][] }>;
}

const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const toSection = (page: Page, name: string) => sections(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const board = (page: Page) => page.getByRole('region', { name: 'Storyboard', exact: true });
const locations = (page: Page) => page.getByRole('region', { name: 'Locations', exact: true });
const days = (page: Page) => page.getByRole('region', { name: 'Shoot days', exact: true });
const setupsTile = (page: Page) => page.getByRole('region', { name: 'Setups', exact: true });
const planTile = (page: Page) => page.getByRole('region', { name: 'Set plan', exact: true });
const selectionTile = (page: Page) => page.getByRole('region', { name: 'Selection', exact: true });
const libraryTile = (page: Page) => page.getByRole('region', { name: 'Library', exact: true });
const canvas = (page: Page) => planTile(page).locator('[data-canvas]');
const compass = (page: Page) => planTile(page).locator('[data-compass-button]');
const items = async (page: Page): Promise<Item[]> => JSON.parse((await planTile(page).locator('[data-plan-data]').getAttribute('data-plan-data')) ?? '[]') as Item[];
const sunItem = async (page: Page) => (await items(page)).find((i) => i.kind === 'sun');
const northItem = async (page: Page) => (await items(page)).find((i) => i.kind === 'north');
const editorOf = (page: Page) => locations(page).locator('[data-location-editor]');
const photosOf = (page: Page) => editorOf(page).locator('[data-location-photos]');
// Each photo's button is named with its photo, so two never share a name; the words on it are the action alone.
const useButton = (page: Page) => photosOf(page).getByRole('button', { name: 'Use this photo’s place and time: Photo 1 of Quay', exact: true });
const atPhotoSwitch = (page: Page) => selectionTile(page).getByRole('switch', { name: 'Show the sun at the photo’s time' });
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const undoKey = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta+z' : 'Control+z');
const redoKey = async (page: Page) => ((await page.evaluate(() => /Mac/i.test(navigator.userAgent))) ? 'Meta+Shift+z' : 'Control+Shift+z');

/** axe on what `include` names, in the app's light and dark themes. */
async function axeBothThemes(page: Page, include: string, what: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.locator('html').evaluate((html, value) => {
      html.setAttribute('data-theme', value);
    }, theme);
    const { violations } = await new AxeBuilder({ page }).include(include).withTags(tags).analyze();
    expect(violations, `${what}, ${theme} theme`).toEqual([]);
  }
  await page.locator('html').evaluate((html) => {
    html.setAttribute('data-theme', 'light');
  });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

/** A scene and its frame at the Quay, the Locations tile open on it, and these photos added to it in one go. */
async function quayWithPhotos(page: Page, files: { name: string; buffer: Buffer }[]) {
  await page.getByRole('region', { name: 'Scenes', exact: true }).getByRole('button', { name: '+ New scene' }).click();
  await board(page).getByRole('button', { name: '+ Frame in SC 01' }).click();
  await expect(board(page).locator('[data-shot-id]').first()).toBeFocused();
  await page.keyboard.press('/');
  await page.keyboard.type('loc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Quay');
  await page.keyboard.press('Enter');
  await toSection(page, 'Production');
  const chooser = page.waitForEvent('filechooser');
  await editorOf(page).getByRole('button', { name: 'Add photos…' }).click();
  await (await chooser).setFiles(files.map((file) => ({ ...file, mimeType: 'image/jpeg' })));
  await expect(photosOf(page).getByRole('img')).toHaveCount(files.length);
}

/**
 * The Quay with its scout photo used for its place and time, its zone set, the frame on a shoot day (21 June 2026), and
 * the plan of the frame's setup with a room, north and a sun path, selected: drawn for the location and the shoot day.
 */
async function planAtTheQuay(page: Page): Promise<Item> {
  await quayWithPhotos(page, [{ name: 'quay-dusk.jpg', buffer: photoWithExif() }]);
  await useButton(page).click();
  // No zone on the location yet: the camera's clock, said so (round 3, L-C).
  await expect(photosOf(page).locator('[data-light-reference-words]')).toHaveText('Light reference: quay-dusk.jpg, Nov 3, 15:20 camera time');
  // Its zone set, so the location's place draws (the browser build looks up no zone for a location).
  await editorOf(page).getByRole('combobox', { name: 'Time zone' }).selectOption('America/New_York');
  await expect(photosOf(page).locator('[data-light-reference-words]')).toHaveText('Light reference: quay-dusk.jpg, Nov 3, 15:20');
  await days(page).getByRole('button', { name: '+ New day' }).click();
  const day = days(page).locator('[data-day-editor]');
  await day.getByLabel('Date').fill('2026-06-21');
  await day.getByLabel('Date').blur();
  await day.getByRole('button', { name: /^Add 1A to Day 1/ }).click();
  await expect(day.getByRole('list', { name: /^Frames on Day 1/ })).toContainText('1A');
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await setupsTile(page).locator('[data-setup-add-frame]').first().click();
  await expect(setupsTile(page).locator('[data-setup-frame]')).toHaveCount(1);
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();
  const northButton = libraryTile(page).locator('[data-library-icon="production/north"]');
  await northButton.scrollIntoViewIfNeeded();
  await northButton.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await northItem(page))?.level).toBe('room');
  await compass(page).click();
  await planTile(page).getByRole('button', { name: 'Add sun path' }).click();
  await expect.poll(async () => (await sunItem(page))?.drawn).toBe(true);
  const sun = await sunItem(page);
  if (!sun) throw new Error('no sun path');
  await expect(selectionTile(page).locator(`[data-sun="${sun.id}"]`)).toBeVisible();
  return sun;
}

test('a scout photo’s date, time and place show; its place and time are used in one edit with no request; what is stored has no EXIF', async ({ page }) => {
  const undo = await undoKey(page);
  const redo = await redoKey(page);
  const withExif = photoWithExif();
  // The file really carries what the stored picture must not.
  for (const [what, trace] of EXIF_TRACES) expect(withExif.includes(trace), what).toBe(true);
  // Two photos added in one go: one with EXIF, one without.
  await quayWithPhotos(page, [
    { name: 'quay-dusk.jpg', buffer: withExif },
    { name: 'no-exif.jpg', buffer: fixture('photo-b.jpg') },
  ]);
  const editor = editorOf(page);
  const photos = photosOf(page);
  await expect(editor.getByRole('img', { name: 'Photo 1 of Quay' })).toBeVisible();
  await expect(editor.getByRole('img', { name: 'Photo 2 of Quay' })).toBeVisible();

  // The photo with EXIF says when and where it was taken, the place to 5 decimals; the other says nothing and offers nothing.
  const told = photos.locator('[data-photo-taken]');
  await expect(told).toHaveCount(1);
  await expect(told.locator('[data-photo-when]')).toHaveText('Taken Nov 3, 2026, 15:20');
  await expect(told.locator('[data-photo-place]')).toHaveText('At 40.20000, -72.90000');
  const use = useButton(page);
  await expect(use).toHaveCount(1);
  await expect(use).toHaveText('Use this photo’s place and time');
  await expect(photos.getByRole('button', { name: /^Use this photo/ })).toHaveCount(1);
  await expect(photos.locator('[data-light-reference]')).toHaveCount(0);
  await expect(editor.getByText('On the map')).toHaveCount(0);

  // "Use this photo's place and time", from the keyboard: the pin moves there and the photo is the light reference.
  // Every request from here to the pin moving, by its address.
  const requests: string[] = [];
  const log = (request: { url: () => string }) => requests.push(request.url());
  page.on('request', log);
  await use.focus();
  await page.keyboard.press('Enter');
  await expect(photos.locator('[data-photo-said]')).toHaveText('Pin placed at 40.20000, -72.90000. This photo is the light reference.');
  await expect(editor.getByText('On the map')).toBeVisible();
  await expect(editor.locator('[data-address-search]')).toContainText('40.20000, -72.90000');
  await expect(editor.locator('[data-location-map]')).toBeVisible();
  await expect(photos.locator('[data-light-reference-words]')).toHaveText('Light reference: quay-dusk.jpg, Nov 3, 15:20 camera time');
  await expect(told.locator('[data-photo-reference]')).toHaveText('Light reference');
  page.off('request', log);
  // No request leaves the page: nothing but the page's own server, and never the address search's stand-in.
  expect(requests.filter((url) => !url.startsWith('http://localhost:1421/'))).toEqual([]);
  expect(requests.filter((url) => /recordedSearch|nominatim/i.test(url))).toEqual([]);
  // The photo's date and place, its button, the light reference and Clear: all the new controls.
  await axeBothThemes(page, '[data-location-photos]', 'a scout photo and the light reference');

  // One undo takes back the place and the light reference together; redo puts both back.
  await use.focus();
  await page.keyboard.press(undo);
  await expect(editor.getByText('On the map')).toHaveCount(0);
  await expect(photos.locator('[data-light-reference]')).toHaveCount(0);
  await expect(told).toHaveCount(1);
  await page.keyboard.press(redo);
  await expect(editor.getByText('On the map')).toBeVisible();
  await expect(photos.locator('[data-light-reference-words]')).toHaveText('Light reference: quay-dusk.jpg, Nov 3, 15:20 camera time');
  // Pressed again, nothing is written: the location already uses it.
  await use.click();
  await expect(photos.locator('[data-photo-said]')).toHaveText('The location already uses this photo.');

  // "Clear" takes the light reference off (the place stays); undone, it is back.
  await photos.getByRole('button', { name: 'Clear light reference' }).click();
  await expect(photos.locator('[data-light-reference]')).toHaveCount(0);
  await expect(photos.locator('[data-photo-said]')).toHaveText('Light reference cleared.');
  await expect(editor.getByRole('button', { name: 'Add photos…' })).toBeFocused();
  await expect(editor.getByText('On the map')).toBeVisible();
  await page.keyboard.press(undo);
  await expect(photos.locator('[data-light-reference-words]')).toHaveText('Light reference: quay-dusk.jpg, Nov 3, 15:20 camera time');

  // What the project keeps of the photo, read from the Project data export (the project itself, as JSON): the record
  // has its props; the stored picture and its thumbnail have no EXIF segment, no date and neither coordinate.
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('button', { name: 'Export Project…', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export' });
  await exportDialog.getByRole('radio', { name: 'Project data (JSON)' }).check();
  const downloaded = page.waitForEvent('download');
  await exportDialog.getByRole('button', { name: 'Save…' }).click();
  const data = JSON.parse(readFileSync(await (await downloaded).path(), 'utf8')) as Exported;
  const records = data.tables.records;
  const propsAt = records?.columns.indexOf('props') ?? -1;
  const typeAt = records?.columns.indexOf('type') ?? -1;
  const media = (records?.rows ?? []).filter((row) => row[typeAt] === 'media').map((row) => {
    const props = row[propsAt];
    return (typeof props === 'string' ? JSON.parse(props) : {}) as Record<string, unknown>;
  });
  expect(media).toHaveLength(2);
  const kept = media.find((props) => props.source_name === 'quay-dusk.jpg');
  expect(kept).toMatchObject({ kind: 'image', taken_at: '2026-11-03T15:20:07', gps_latitude: 40.2, gps_longitude: -72.9 });
  expect(kept).not.toHaveProperty('taken_offset');
  const plain = media.find((props) => props.source_name === 'no-exif.jpg');
  for (const prop of ['taken_at', 'taken_offset', 'gps_latitude', 'gps_longitude']) expect(plain).not.toHaveProperty(prop);
  let pictures = 0;
  for (const table of ['media_files', 'thumbnails']) {
    const bytesAt = data.tables[table]?.columns.indexOf('bytes') ?? -1;
    for (const row of data.tables[table]?.rows ?? []) {
      const cell = row[bytesAt];
      if (cell === null || typeof cell !== 'object') throw new Error(`${table}: a row with no bytes`);
      const bytes = Buffer.from(cell.base64, 'base64');
      // A JPEG, drawn again by the page.
      expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
      for (const [what, trace] of EXIF_TRACES) expect.soft(bytes.includes(trace), `${table}: ${what}`).toBe(false);
      pictures += 1;
    }
  }
  // Both photos' pictures and thumbnails were looked at.
  expect(pictures).toBe(4);
  await expect(page.getByRole('status').getByText('Exported the project data to “Bey County project data.json”.')).toBeVisible();
});

test('on a plan at the location, the sun path names the light reference; the switch draws the photo’s date, marks the sun then and names the photo; off, as before; each undone', async ({ page }) => {
  const undo = await undoKey(page);
  const redo = await redoKey(page);
  const before = await planAtTheQuay(page);

  // As before 6.27: the location's place and the shoot day's date, no mark for a photo.
  expect(before.from).toEqual({ place: 'location', date: 'shootDay' });
  expect(before).not.toHaveProperty('photo');
  const sources = selectionTile(page).locator('[data-sun-sources]');
  await expect(sources.locator('[data-sun-date-from]')).toHaveText(/^Date From the shoot day: Day 1 · Sun, Jun 21$/i);
  const compassBefore = (await compass(page).getAttribute('aria-label')) ?? '';
  expect(compassBefore).toMatch(/^North is 0°\. Sun: \d+° at 12:00, \d+° high$/);

  // The light reference, named, and its switch, off.
  const reference = selectionTile(page).locator('[data-sun-light-reference]');
  await expect(reference).toHaveAttribute('data-sun-light-reference', 'ready');
  await expect(reference.locator('[data-sun-light-reference-words]')).toHaveText('Light reference: quay-dusk.jpg, Nov 3, 15:20');
  const atPhoto = atPhotoSwitch(page);
  await expect(atPhoto).toHaveAttribute('aria-checked', 'false');
  await expect(selectionTile(page).locator('[data-sun-photo-at]')).toHaveCount(0);
  // Its own date typed: not used while the setup has a shoot day (nothing drawn changes).
  const ownDate = selectionTile(page).getByLabel('Its own date', { exact: true });
  await ownDate.fill('2027-01-15');
  await ownDate.press('Enter');
  await expect(sources.locator('[data-sun-own-date-unused]')).toHaveText('Not used while the setup has a shoot day with a date.');

  // On, from the keyboard: the photo's date is drawn, the mark says where the sun stood, and the photo is named as the
  // date's source, in the settings and on the compass.
  await atPhoto.focus();
  await page.keyboard.press('Enter');
  await expect(atPhoto).toHaveAttribute('aria-checked', 'true');
  // Drawn wholly from the photo (round 3): its own GPS is the place, and the mark says so.
  await expect.poll(async () => (await sunItem(page))?.from).toEqual({ place: 'photo', date: 'photo' });
  expect((await sunItem(page))?.photo).toBe('Photo Nov 3, 15:20 · photo’s place');
  expect((await sunItem(page))?.drawn).toBe(true);
  await expect(sources.locator('[data-sun-place-from]')).toHaveText('Place From the photo');
  // The typed date gives way to the photo's, in its own words; the light reference line says the same time as the date.
  await expect(sources.locator('[data-sun-own-date-unused]')).toHaveText('Not used while the sun is shown at the photo’s time.');
  await expect(reference.locator('[data-sun-light-reference-words]')).toHaveText('Light reference: quay-dusk.jpg, Nov 3, 15:20');
  await expect(sources.locator('[data-sun-date-from]')).toHaveText('Date From the photo: Nov 3, 15:20');
  await expect(sources.locator('[data-sun-date-from]')).toHaveAttribute('data-sun-date-from', 'photo');
  await expect(selectionTile(page).locator('[data-sun-photo-at]')).toHaveAttribute('data-sun-photo-at', 'up');
  await expect(selectionTile(page).locator('[data-sun-photo-at]')).toHaveText(/^At the photo’s time 15:20 · \d+° · \d+° high$/i);
  await expect(compass(page)).toHaveAccessibleName(/^North is 0°\. Sun: .+\. From the photo: Nov 3, 15:20$/);
  // The sun at the sun path's own time is another day's now: November's, not June's.
  expect((await sunItem(page))?.says).not.toBe(before.says);
  await axeBothThemes(page, '[data-sun-light-reference]', 'the light reference in the sun path’s settings');

  // Undone: off, and everything as before. Redone, then switched off by hand: as before again.
  await atPhoto.focus();
  await page.keyboard.press(undo);
  await expect(atPhoto).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => await sunItem(page)).toEqual(before);
  await expect(compass(page)).toHaveAccessibleName(compassBefore);
  await page.keyboard.press(redo);
  await expect(atPhoto).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await sunItem(page))?.photo).toBe('Photo Nov 3, 15:20 · photo’s place');
  await atPhoto.click();
  await expect(atPhoto).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => await sunItem(page)).toEqual(before);
  await expect(sources.locator('[data-sun-date-from]')).toHaveText(/^Date From the shoot day: Day 1 · Sun, Jun 21$/i);
  await expect(selectionTile(page).locator('[data-sun-photo-at]')).toHaveCount(0);
  await expect(compass(page)).toHaveAccessibleName(compassBefore);
});

test('the light reference photo removed: the sun is drawn as before, and the switch shows off and says why; undone, it is back', async ({ page }) => {
  const undo = await undoKey(page);
  const before = await planAtTheQuay(page);
  const atPhoto = atPhotoSwitch(page);
  await atPhoto.click();
  await expect.poll(async () => (await sunItem(page))?.from).toEqual({ place: 'photo', date: 'photo' });

  // The photo removed (to the Trash): the Locations tile says what its light reference is now.
  await toSection(page, 'Production');
  const photos = photosOf(page);
  await editorOf(page).getByRole('button', { name: 'Remove Photo 1 of Quay' }).click();
  await expect(photos.locator('[data-light-reference]')).toHaveAttribute('data-light-reference', 'trashed');
  await expect(photos.locator('[data-light-reference-words]')).toHaveText('Light reference: a photo now in the Trash.');
  await axeBothThemes(page, '[data-location-photos]', 'a light reference in the Trash');

  // On the plan: as before, the switch off and unable to turn, with why.
  await toSection(page, 'Setup');
  await expect.poll(async () => await sunItem(page)).toEqual(before);
  await compass(page).click();
  const reference = selectionTile(page).locator('[data-sun-light-reference]');
  await expect(reference).toHaveAttribute('data-sun-light-reference', 'trashed');
  await expect(atPhoto).toHaveAttribute('aria-checked', 'false');
  await expect(atPhoto).toBeDisabled();
  await expect(reference.locator('[data-sun-at-photo-note]')).toHaveText('The light reference photo is in the Trash, so the sun is drawn as before.');
  await axeBothThemes(page, '[data-sun-light-reference]', 'a light reference in the Trash, in the sun path’s settings');

  // The removal undone: the photo is the light reference again, and the sun is drawn for it.
  await canvas(page).focus();
  await page.keyboard.press(undo);
  await expect.poll(async () => (await sunItem(page))?.from).toEqual({ place: 'photo', date: 'photo' });
  await expect(atPhoto).toHaveAttribute('aria-checked', 'true');
});

test('a photo with only a time, or only a place, offers only that', async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as { __sbdDevPhotoExif: Record<string, unknown> }).__sbdDevPhotoExif = {
      'time-only.jpg': { takenAt: '2026-11-03T15:20:07', takenOffset: '+01:00', latitude: null, longitude: null },
      'place-only.jpg': { takenAt: null, takenOffset: null, latitude: 40.2, longitude: -72.9 },
      // An answer that isn't one: read as nothing, the photo imported as before.
      'odd.jpg': { takenAt: 'yesterday', takenOffset: 'east', latitude: 400, longitude: 'far' },
    };
  });
  await toSection(page, 'Production');
  await locations(page).getByRole('button', { name: '+ New location' }).click();
  await page.keyboard.type('Quay');
  await page.keyboard.press('Enter');
  const editor = editorOf(page);
  const picture = fixture('photo-a.jpg');
  const chooser = page.waitForEvent('filechooser');
  await editor.getByRole('button', { name: 'Add photos…' }).click();
  await (await chooser).setFiles(['time-only.jpg', 'place-only.jpg', 'odd.jpg'].map((name) => ({ name, mimeType: 'image/jpeg', buffer: picture })));
  const photos = photosOf(page);
  await expect(photos.getByRole('img')).toHaveCount(3);
  await expect(photos.locator('[data-photo-taken]')).toHaveCount(2);
  await expect(photos.getByRole('button', { name: /^Use this photo’s place and time/ })).toHaveCount(0);

  // Only a time: the light reference, no pin.
  await photos.getByRole('button', { name: 'Use this photo’s time: Photo 1 of Quay', exact: true }).click();
  await expect(photos.locator('[data-photo-said]')).toHaveText('This photo is the light reference.');
  await expect(photos.locator('[data-light-reference-words]')).toHaveText('Light reference: time-only.jpg, Nov 3, 15:20 camera time');
  await expect(editor.getByText('On the map')).toHaveCount(0);

  // Only a place: the pin, and the light reference stays the other photo.
  await photos.getByRole('button', { name: 'Use this photo’s place: Photo 2 of Quay', exact: true }).click();
  await expect(photos.locator('[data-photo-said]')).toHaveText('Pin placed at 40.20000, -72.90000.');
  await expect(editor.getByText('On the map')).toBeVisible();
  await expect(photos.locator('[data-light-reference-words]')).toHaveText('Light reference: time-only.jpg, Nov 3, 15:20 camera time');
  await axeBothThemes(page, '[data-location-photos]', 'photos with a time or a place only');
});

test('a photo whose EXIF was refused, and a HEIC, import and say so in one status line (round 3)', async ({ page }) => {
  await page.evaluate(() => {
    (window as unknown as { __sbdDevPhotoExif: Record<string, unknown> }).__sbdDevPhotoExif = {
      'read.jpg': { takenAt: '2026-11-03T15:20:07', takenOffset: null, latitude: null, longitude: null, reason: 'read' },
      'refused.jpg': { takenAt: null, takenOffset: null, latitude: null, longitude: null, reason: 'refused' },
      'plain.jpg': { takenAt: null, takenOffset: null, latitude: null, longitude: null, reason: 'none' },
      'IMG_0001.jpg': { takenAt: null, takenOffset: null, latitude: null, longitude: null, reason: 'heic' },
    };
  });
  await toSection(page, 'Production');
  await locations(page).getByRole('button', { name: '+ New location' }).click();
  await page.keyboard.type('Quay');
  await page.keyboard.press('Enter');
  const editor = editorOf(page);
  const picture = fixture('photo-a.jpg');
  const chooser = page.waitForEvent('filechooser');
  await editor.getByRole('button', { name: 'Add photos…' }).click();
  // The webview here decodes the stand-in's "HEIC" (a JPEG by its bytes), as Safari decodes a real one.
  await (await chooser).setFiles(['read.jpg', 'refused.jpg', 'plain.jpg', 'IMG_0001.jpg'].map((name) => ({ name, mimeType: 'image/jpeg', buffer: picture })));
  const photos = photosOf(page);
  // Every photo imports, whatever its EXIF.
  await expect(photos.getByRole('img')).toHaveCount(4);
  await expect(photos.locator('[data-photo-said]')).toHaveText('4 photos added. 3 have no date or place: 1 is HEIC, 1 couldn’t be read, 1 had none.');
  await expect(photos.locator('[data-photo-taken]')).toHaveCount(1);
  await axeBothThemes(page, '[data-location-photos]', 'the status line after an import');
});

test('scouting before a schedule: a setup with no shoot day shows the light reference, and the switch draws the sun wholly from the photo (round 3)', async ({ page }) => {
  const undo = await undoKey(page);
  await quayWithPhotos(page, [{ name: 'quay-dusk.jpg', buffer: photoWithExif() }]);
  await useButton(page).click();
  await expect(photosOf(page).locator('[data-light-reference-words]')).toHaveText('Light reference: quay-dusk.jpg, Nov 3, 15:20 camera time');
  // The photo's GPS is now the location's own pin, so its zone is the location's (round 4): typed here, since the
  // browser build looks up no zone for a location.
  await editorOf(page).getByRole('combobox', { name: 'Time zone' }).selectOption('America/New_York');
  await expect(photosOf(page).locator('[data-light-reference-words]')).toHaveText('Light reference: quay-dusk.jpg, Nov 3, 15:20');
  // No shoot day, no own date: only a setup with the frame, a room, north and a sun path.
  await toSection(page, 'Setup');
  await setupsTile(page).getByRole('button', { name: 'Add setup to SC 01' }).click();
  await setupsTile(page).locator('[data-setup-add-frame]').first().click();
  await expect(setupsTile(page).locator('[data-setup-frame]')).toHaveCount(1);
  await planTile(page).getByRole('button', { name: 'New room' }).click();
  await expect(canvas(page)).toBeVisible();
  const northButton = libraryTile(page).locator('[data-library-icon="production/north"]');
  await northButton.scrollIntoViewIfNeeded();
  await northButton.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await northItem(page))?.level).toBe('room');
  await compass(page).click();
  await planTile(page).getByRole('button', { name: 'Add sun path' }).click();
  await expect.poll(async () => (await sunItem(page))?.kind).toBe('sun');
  const before = await sunItem(page);
  if (!before) throw new Error('no sun path');
  // Nothing drawn: there is no shoot day.
  expect(before.drawn).toBe(false);
  await expect(selectionTile(page).locator(`[data-sun="${before.id}"]`)).toBeVisible();
  // The light reference shows all the same, in the zone of the photo's place (the location's, at its own pin).
  const reference = selectionTile(page).locator('[data-sun-light-reference]');
  await expect(reference).toHaveAttribute('data-sun-light-reference', 'ready');
  await expect(reference.locator('[data-sun-light-reference-words]')).toHaveText('Light reference: quay-dusk.jpg, Nov 3, 15:20');
  const atPhoto = atPhotoSwitch(page);
  await expect(atPhoto).toHaveAttribute('aria-checked', 'false');
  await expect(atPhoto).toBeEnabled();

  // On: the photo's date drawn, at the photo's place, and both said.
  await atPhoto.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await sunItem(page))?.drawn).toBe(true);
  expect((await sunItem(page))?.from).toEqual({ place: 'photo', date: 'photo' });
  expect((await sunItem(page))?.photo).toBe('Photo Nov 3, 15:20 · photo’s place');
  const sources = selectionTile(page).locator('[data-sun-sources]');
  await expect(sources.locator('[data-sun-place-from]')).toHaveText('Place From the photo');
  await expect(sources.locator('[data-sun-date-from]')).toHaveText('Date From the photo: Nov 3, 15:20');
  await expect(selectionTile(page).locator('[data-sun-photo-at]')).toHaveAttribute('data-sun-photo-at', 'up');
  await expect(compass(page)).toHaveAccessibleName(/From the photo: Nov 3, 15:20$/);
  await axeBothThemes(page, '[data-sun-light-reference]', 'the light reference with no shoot day');

  // Undone: nothing drawn, as before.
  await atPhoto.focus();
  await page.keyboard.press(undo);
  await expect(atPhoto).toHaveAttribute('aria-checked', 'false');
  await expect.poll(async () => await sunItem(page)).toEqual(before);
});

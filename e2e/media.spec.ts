import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// The picture pipeline (src/core/media/image.ts) in each engine the app ships on: WebKit for the Mac app, Chromium for
// WebView2 on Windows. Colour is the point (Kevin, Nov 2): a P3 photo keeps its colour, sRGB is unchanged, other
// profiles are converted. The fixtures are tiny flat-colour files made with ImageMagick and the system's ICC profiles,
// so any shift in a pixel is the pipeline's doing, not JPEG noise.

type Rgba = [number, number, number, number];
interface Readout {
  mime: string;
  width: number;
  height: number;
  colorSpace: string;
  sha256: string;
  thumbnail: { mime: string; width: number; height: number };
  /** Whether this engine draws into P3 canvases; WebKit on Linux, for one, doesn't, and stores sRGB instead. */
  engineP3: boolean;
  /** The pixels at the given points, read from the source file and from the stored picture, in each colour space. */
  source: { srgb: Rgba[]; p3: Rgba[] };
  stored: { srgb: Rgba[]; p3: Rgba[] };
}

const fixture = (name: string) => [...readFileSync(new URL(`./fixtures/images/${name}`, import.meta.url))];

/** Runs prepareImage on a file in the page and reads back what it stored. Points are fractions of width and height. */
async function prepare(page: Page, name: string, type: string, data: number[], points: [number, number][] = [[0.5, 0.5]]) {
  return page.evaluate(
    async ({ name, type, data, points }) => {
      const url = '/src/core/media/image.ts';
      const { prepareImage } = (await import(/* @vite-ignore */ url)) as typeof import('../src/core/media/image');

      async function read(blob: Blob, space: PredefinedColorSpace): Promise<Rgba[]> {
        const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d', { colorSpace: space });
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(bitmap, 0, 0);
        return points.map(([fx, fy]) => {
          const x = Math.min(bitmap.width - 1, Math.floor(fx * bitmap.width));
          const y = Math.min(bitmap.height - 1, Math.floor(fy * bitmap.height));
          return [...ctx.getImageData(x, y, 1, 1).data] as Rgba;
        });
      }

      // sRGB red drawn into a P3 canvas reads as about (234, 51, 35) there; into an sRGB one, as (255, 0, 0).
      const probe = new OffscreenCanvas(1, 1).getContext('2d', { colorSpace: 'display-p3' });
      if (!probe) throw new Error('no 2d context');
      probe.fillStyle = 'rgb(255, 0, 0)';
      probe.fillRect(0, 0, 1, 1);
      const engineP3 = (probe.getImageData(0, 0, 1, 1).data[1] ?? 0) > 20;

      const file = new File([new Uint8Array(data)], name, { type });
      const { original, thumbnail } = await prepareImage(file);
      const stored = new Blob([original.bytes as Uint8Array<ArrayBuffer>], { type: original.mime });
      return {
        mime: original.mime,
        width: original.width,
        height: original.height,
        colorSpace: original.colorSpace,
        sha256: original.sha256,
        thumbnail: { mime: thumbnail.mime, width: thumbnail.width, height: thumbnail.height },
        engineP3,
        source: { srgb: await read(file, 'srgb'), p3: await read(file, 'display-p3') },
        stored: { srgb: await read(stored, 'srgb'), p3: await read(stored, 'display-p3') },
      } satisfies Readout;
    },
    { name, type, data, points },
  );
}

/** The furthest any channel is from what was expected. */
const distance = (actual: Rgba | undefined, expected: readonly number[]) =>
  Math.max(...expected.map((value, i) => Math.abs((actual?.[i] ?? -999) - value)));

/** Within a few levels per channel: colour conversion rounds, and JPEG moves a flat colour by a level or two. */
function expectClose(actual: Rgba | undefined, expected: readonly number[], tolerance = 4) {
  expect(actual, `expected about ${expected.join(', ')}`).toBeDefined();
  expect(distance(actual, expected), `${String(actual)} is more than ${String(tolerance)} from ${expected.join(', ')}`).toBeLessThanOrEqual(
    tolerance,
  );
}

/**
 * The engines the app ships on manage colour: WebKit on a Mac and Chromium (WebView2 on Windows) apply a picture's
 * profile and draw in P3. WebKit on Linux, which CI also runs, decodes pictures without their profiles; there the
 * colour tests check only that storing a picture adds no shift of its own, read in sRGB.
 */
const ships = (browserName: string) => browserName === 'chromium' || process.platform === 'darwin';

function noteUnmanaged() {
  test.info().annotations.push({ type: 'colour', description: 'This engine ignores colour profiles; checked only that storing adds no shift.' });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('a Display P3 photo keeps its full colour', async ({ page, browserName }) => {
  const result = await prepare(page, 'IMG_P3.jpg', 'image/jpeg', fixture('p3-red.jpg'));
  const managed = result.engineP3 && distance(result.source.p3[0], [255, 0, 0]) <= 4;
  if (ships(browserName)) expect({ engineP3: result.engineP3, managed }).toEqual({ engineP3: true, managed: true });
  expect(result.colorSpace).toBe(result.engineP3 ? 'display-p3' : 'srgb');
  // P3 red stays P3 red. Squeezed into sRGB on the way, it would come back about (234, 51, 35) here.
  if (managed) expectClose(result.stored.p3[0], [255, 0, 0]);
  else noteUnmanaged();
  expectClose(result.stored.srgb[0], result.source.srgb[0] ?? []);
  expect([result.mime, result.width, result.height]).toEqual(['image/jpeg', 64, 48]);
});

test('an sRGB picture comes out the same colour', async ({ page }) => {
  const result = await prepare(page, 'still.jpg', 'image/jpeg', fixture('srgb.jpg'));
  expect(result.colorSpace).toBe(result.engineP3 ? 'display-p3' : 'srgb');
  expectClose(result.stored.srgb[0], [200, 80, 40]);
});

test('an Adobe RGB picture is converted, not read as if it were sRGB', async ({ page, browserName }) => {
  const result = await prepare(page, 'scan.jpg', 'image/jpeg', fixture('adobe-rgb.jpg'));
  // With its profile applied, (60, 170, 90) in Adobe RGB is a different sRGB colour; ignored, it comes through as is.
  const source = result.source.srgb[0] ?? [0, 0, 0, 0];
  const managed = distance(source, [60, 170, 90]) > 4;
  if (ships(browserName)) expect(managed, 'the engine applies the picture’s profile').toBe(true);
  expectClose(result.stored.srgb[0], source);
  // Read in P3 only where the engine manages colour; without it, P3 readings near the edge of the gamut wander.
  if (managed && result.engineP3) expectClose(result.stored.p3[0], result.source.p3[0] ?? []);
  if (!managed) noteUnmanaged();
});

test('a phone photo taken upright stays upright', async ({ page }) => {
  // Stored 80×40, red on the left and blue on the right, with EXIF orientation 6 (turn 90° clockwise).
  const result = await prepare(page, 'IMG_ROT.jpg', 'image/jpeg', fixture('rotated.jpg'), [
    [0.5, 0.1],
    [0.5, 0.9],
  ]);
  expect([result.width, result.height]).toEqual([40, 80]);
  expect([result.thumbnail.width, result.thumbnail.height]).toEqual([40, 80]);
  const [top, bottom] = result.stored.srgb;
  expectClose(top, [220, 30, 30], 8);
  expectClose(bottom, [30, 30, 220], 8);
});

test('a big photo is capped at 2560px on its long edge, with a 640px thumbnail', async ({ page }) => {
  const data = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(4032, 3024);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = 'rgb(90, 120, 150)';
    ctx.fillRect(0, 0, 4032, 3024);
    return [...new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg' })).arrayBuffer())];
  });
  const result = await prepare(page, 'IMG_4012.JPG', 'image/jpeg', data);
  expect([result.mime, result.width, result.height]).toEqual(['image/jpeg', 2560, 1920]);
  expect([result.thumbnail.mime, result.thumbnail.width, result.thumbnail.height]).toEqual(['image/jpeg', 640, 480]);
  expectClose(result.stored.srgb[0], [90, 120, 150]);
});

test('the same picture stored twice has the same address, so the project keeps one copy', async ({ page }) => {
  const first = await prepare(page, 'a.jpg', 'image/jpeg', fixture('srgb.jpg'));
  const second = await prepare(page, 'b.jpg', 'image/jpeg', fixture('srgb.jpg'));
  expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(second.sha256).toBe(first.sha256);
});

test('a logo with a see-through ground stays a PNG and keeps it see-through', async ({ page }) => {
  // Left half blue, right half empty.
  const result = await prepare(page, 'logo.png', 'image/png', fixture('alpha.png'), [
    [0.25, 0.5],
    [0.75, 0.5],
  ]);
  expect([result.mime, result.thumbnail.mime]).toEqual(['image/png', 'image/png']);
  const [solid, clear] = result.stored.srgb;
  expectClose(solid, [0, 128, 255, 255]);
  expect(clear?.[3]).toBe(0);
});

test("a file that isn't a picture says what to do", async ({ page }) => {
  const notes = [...new TextEncoder().encode('INT. CABIN - NIGHT')];
  await expect(prepare(page, 'notes.txt', 'text/plain', notes)).rejects.toThrow('JPEG, PNG and WebP work.');
  await expect(prepare(page, 'IMG_0001.HEIC', '', notes)).rejects.toThrow('Convert it to JPEG first.');
});

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
 * profile and draw in P3. WebKit on Linux, which CI also runs, decodes pictures into sRGB, so a P3 photo's widest
 * colours are clipped before they reach the canvas; there the P3 test checks only that storing adds no shift of its own.
 */
const ships = (browserName: string) => browserName === 'chromium' || process.platform === 'darwin';

function noteClipped() {
  test.info().annotations.push({
    type: 'colour',
    description: 'This engine decodes into sRGB, so P3 colour is clipped before storing; checked only that storing adds no shift.',
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('a Display P3 photo keeps its full colour', async ({ page, browserName }) => {
  const result = await prepare(page, 'IMG_P3.jpg', 'image/jpeg', fixture('p3-red.jpg'));
  const keepsP3 = result.engineP3 && distance(result.source.p3[0], [255, 0, 0]) <= 4;
  if (ships(browserName)) expect({ engineP3: result.engineP3, keepsP3 }).toEqual({ engineP3: true, keepsP3: true });
  expect(result.colorSpace).toBe(result.engineP3 ? 'display-p3' : 'srgb');
  // P3 red stays P3 red. Squeezed into sRGB on the way, it would come back about (234, 51, 35) here.
  if (keepsP3) expectClose(result.stored.p3[0], [255, 0, 0]);
  else noteClipped();
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
  // A muted green, (110, 160, 100) in Adobe RGB, is (78, 161, 96) in sRGB; with the profile ignored, it would come
  // through as (110, 160, 100). It sits well inside sRGB, so no channel clips on the way.
  const source = result.source.srgb[0] ?? [0, 0, 0, 0];
  const managed = distance(source, [110, 160, 100]) > 4;
  if (ships(browserName)) expect(managed, 'the engine applies the picture’s profile').toBe(true);
  if (managed) expectClose(source, [78, 161, 96]);
  expectClose(result.stored.srgb[0], source);
  if (result.engineP3) expectClose(result.stored.p3[0], result.source.p3[0] ?? []);
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

// HEIC on Windows (6.27n): Rust turns a HEIC into a PNG tagged with the file's own colour (src-tauri/src/heic.rs), and
// the page stores that PNG as any picture. The proof is our own drawing (src-tauri/testdata/heic): P3's pure red, green
// and blue, outside sRGB, which must come out of the store unclipped, read back in a Display P3 canvas.

interface Region {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  drawn: [number, number, number];
}

const heicFixture = (name: string) => readFileSync(new URL(`../src-tauri/testdata/heic/${name}`, import.meta.url));
const proofRegions = () => (JSON.parse(heicFixture('heic-proof-regions.json').toString('utf8')) as { regions: Region[] }).regions;

/** Runs prepareImage on a file in the page and reads the stored picture's mean colour in each region, in Display P3. */
async function prepareRegions(page: Page, name: string, type: string, data: number[], regions: Region[]) {
  return page.evaluate(
    async ({ name, type, data, regions }) => {
      const url = '/src/core/media/image.ts';
      const { prepareImage } = (await import(/* @vite-ignore */ url)) as typeof import('../src/core/media/image');
      const { original } = await prepareImage(new File([new Uint8Array(data)], name, { type }));
      const bitmap = await createImageBitmap(new Blob([original.bytes as Uint8Array<ArrayBuffer>], { type: original.mime }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d', { colorSpace: 'display-p3' });
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bitmap, 0, 0);
      const means = regions.map(({ x, y, w, h }) => {
        const { data: pixels } = ctx.getImageData(x, y, w, h, { colorSpace: 'display-p3' });
        const sum = [0, 0, 0];
        for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c += 1) sum[c] = (sum[c] ?? 0) + (pixels[i + c] ?? 0);
        return sum.map((s) => s / (w * h));
      });
      return { colorSpace: original.colorSpace, width: original.width, height: original.height, means };
    },
    { name, type, data, regions },
  );
}

/** Every region within 3 levels of the drawing. */
function expectDrawn(means: number[][], regions: Region[]) {
  regions.forEach((region, i) => {
    const mean = means[i] ?? [];
    expect(distance(mean as unknown as Rgba, region.drawn), `${region.name} reads ${mean.map((v) => v.toFixed(1)).join(', ')}`).toBeLessThanOrEqual(3);
  });
}

// CRC-32 for a rebuilt PNG chunk, by hand (as heic.rs and scripts/heicFixtures.ts do): no tool beyond the test.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The PNG with its iCCP chunk swapped for a cICP chunk of the four numbers: the same pixels, another colour tag. */
function withCicp(png: Buffer, cicp: [number, number, number, number]): number[] {
  const out: Buffer[] = [png.subarray(0, 8)];
  let swapped = false;
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const kind = png.toString('latin1', at + 4, at + 8);
    if (kind === 'iCCP') {
      const body = Buffer.from([...Buffer.from('cICP', 'latin1'), ...cicp]);
      const chunk = Buffer.alloc(4 + body.length + 4);
      chunk.writeUInt32BE(4, 0);
      body.copy(chunk, 4);
      chunk.writeUInt32BE(crc32(body), 4 + body.length);
      out.push(chunk);
      swapped = true;
    } else out.push(png.subarray(at, at + 12 + length));
    at += 12 + length;
  }
  expect(swapped, 'the PNG Rust gave carries an iCCP chunk').toBe(true);
  return [...Buffer.concat(out)];
}

test.describe('a HEIC turned into a PNG by Rust, in WebView2’s engine', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'The Windows path: Chromium, WebView2’s engine');

  test('is stored tagged Display P3 with the drawing’s colours, P3’s pure red unclipped', async ({ page }) => {
    const regions = proofRegions();
    const result = await prepareRegions(page, 'IMG_0001.png', 'image/png', [...heicFixture('heic-proof.from-rust.png')], regions);
    expect([result.colorSpace, result.width, result.height]).toEqual(['display-p3', 1024, 768]);
    expectDrawn(result.means, regions);
  });

  test('reads the same with a cICP of 12/13/0/1 (Display P3) in place of the profile', async ({ page }) => {
    const regions = proofRegions();
    const data = withCicp(heicFixture('heic-proof.from-rust.png'), [12, 13, 0, 1]);
    const result = await prepareRegions(page, 'IMG_0002.png', 'image/png', data, regions);
    expect(result.colorSpace).toBe('display-p3');
    expectDrawn(result.means, regions);
  });

  test('the control: the same pixels tagged sRGB (cICP 1/13/0/1) read P3 red as sRGB red, so the tag keeps the colour', async ({ page }) => {
    const regions = proofRegions().filter((region) => region.name === 'p3-red');
    const data = withCicp(heicFixture('heic-proof.from-rust.png'), [1, 13, 0, 1]);
    const result = await prepareRegions(page, 'IMG_0003.png', 'image/png', data, regions);
    expect(regions).toHaveLength(1);
    expect(distance(result.means[0] as unknown as Rgba, [234, 51, 35]), `p3-red reads ${String(result.means[0])}`).toBeLessThanOrEqual(3);
  });
});

// The fallback itself, in a real engine: Chromium can't decode the HEIC, so the page reads its brand and asks the
// decoder the desktop app hands over. Here the decoder stands in for Rust with the PNG Rust gave for this very file.
test.describe('a HEIC Chromium can’t decode, through the desktop app’s decoder', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'The Windows path: Chromium, WebView2’s engine');

  test('is asked for once per file, and its PNG is stored with the drawing’s colours', async ({ page }) => {
    const regions = proofRegions();
    const heic = [...heicFixture('heic-proof.heic')];
    const png = [...heicFixture('heic-proof.from-rust.png')];
    const result = await page.evaluate(
      async ({ heic, png, regions }) => {
        const heicUrl = '/src/core/media/heic.ts';
        const imageUrl = '/src/core/media/image.ts';
        const { setHeicDecoder } = (await import(/* @vite-ignore */ heicUrl)) as typeof import('../src/core/media/heic');
        const { prepareImage } = (await import(/* @vite-ignore */ imageUrl)) as typeof import('../src/core/media/image');
        const asked: number[] = [];
        setHeicDecoder((photo) => {
          asked.push(photo.size);
          return Promise.resolve(new Uint8Array(png));
        });
        // Chromium's own decode of the HEIC fails for real: what the fallback starts from.
        const own = await createImageBitmap(new Blob([new Uint8Array(heic)])).then(
          () => 'decoded',
          () => 'refused',
        );
        const read = async (name: string) => {
          const before = asked.length;
          const { original } = await prepareImage(new File([new Uint8Array(heic)], name, { type: '' }));
          const bitmap = await createImageBitmap(new Blob([original.bytes as Uint8Array<ArrayBuffer>], { type: original.mime }));
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const ctx = canvas.getContext('2d', { colorSpace: 'display-p3' });
          if (!ctx) throw new Error('no 2d context');
          ctx.drawImage(bitmap, 0, 0);
          const means = regions.map(({ x, y, w, h }) => {
            const { data: pixels } = ctx.getImageData(x, y, w, h, { colorSpace: 'display-p3' });
            const sum = [0, 0, 0];
            for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c += 1) sum[c] = (sum[c] ?? 0) + (pixels[i + c] ?? 0);
            return sum.map((s) => s / (w * h));
          });
          return { asked: asked.slice(before), colorSpace: original.colorSpace, width: original.width, height: original.height, means };
        };
        // By its name, then by its brand alone (no type, no extension).
        return { own, byName: await read('IMG_0005.HEIC'), byBrand: await read('IMG_0005') };
      },
      { heic, png, regions },
    );
    expect(result.own).toBe('refused');
    for (const stored of [result.byName, result.byBrand]) {
      expect(stored.asked, 'the decoder is asked once, with the whole file').toEqual([heic.length]);
      expect([stored.colorSpace, stored.width, stored.height]).toEqual(['display-p3', 1024, 768]);
      expectDrawn(stored.means, regions);
    }
  });
});

// The Mac reads the HEIC itself (WebKit), and must store what it always has: run on GitHub's Mac at a checkpoint.
test.describe('a HEIC read by WebKit on a Mac', () => {
  test.skip(({ browserName }) => browserName !== 'webkit' || process.platform !== 'darwin', 'WebKit on a Mac only: it reads HEIC itself');

  test('is stored with the drawing’s colours, P3’s pure red unclipped', async ({ page }) => {
    const regions = proofRegions();
    const result = await prepareRegions(page, 'IMG_0004.HEIC', 'image/heic', [...heicFixture('heic-proof.heic')], regions);
    expect([result.colorSpace, result.width, result.height]).toEqual(['display-p3', 1024, 768]);
    expectDrawn(result.means, regions);
  });
});

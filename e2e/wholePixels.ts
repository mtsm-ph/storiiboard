import type { Locator, Page } from '@playwright/test';

/** Viewport sizes that put a canvas's centre on whole pixels, by the layout they started from (this worker's). */
const found = new Map<string, { width: number; height: number }>();

/**
 * Puts a canvas's centre on a whole CSS pixel (6.19b). The canvas specs aim at `box.x + box.width / 2 + x`; with an odd
 * width or height that is a half pixel. Chromium delivers the pointer there, Mac WebKit only on whole pixels (its
 * protocol takes integers), so its press lands up to a pixel off and the world position the app records is off by as
 * much. The app reads the pointer right either way: it is the arrangement that changes, never the assertions. The
 * viewport grows by one pixel in each direction that is off until the centre is whole. Call it once the canvas is on
 * screen, before working out any position from its box (a reload keeps the viewport; a layout change may not).
 *
 * A board fills its tile's whole pixels, so a try or two is enough there, and its corner must be whole as well. A plan
 * sits in the Setup workspace beside other tiles, which the dock sizes by flex ratios (0.585227 of the row…), so its box
 * falls on sixty-fourths of a pixel and moves by about half a pixel per pixel of viewport: its corner can't be made
 * whole, and its centre takes a longer walk (Chromium: 56 px across, 70 down from 1440 × 900). A plan spec aims from
 * the centre alone and the view the canvas reports, so `corner: false` with a longer `tries`; the size found is
 * remembered for the worker's next test that starts from the same layout.
 */
export async function wholePixelCentre(page: Page, canvas: Locator, options: { corner?: boolean; tries?: number } = {}): Promise<void> {
  const corner = options.corner ?? true;
  const tries = options.tries ?? 4;
  const half = (value: number) => !Number.isInteger(value);
  const measure = async () => {
    const box = await canvas.boundingBox();
    if (!box) throw new Error('wholePixelCentre: the canvas is not on screen');
    return box;
  };
  const settle = () =>
    page.evaluate(
      () =>
        new Promise<void>((done) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              done();
            });
          });
        }),
    );
  const start = page.viewportSize();
  if (!start) throw new Error('wholePixelCentre: the page has no fixed viewport');
  const first = await measure();
  const key = `${String(start.width)}x${String(start.height)} ${String(first.x)},${String(first.y)},${String(first.width)},${String(first.height)}`;
  const known = found.get(key);
  if (known) {
    await page.setViewportSize(known);
    await settle();
  }
  for (let attempt = 0; attempt <= tries; attempt += 1) {
    const box = attempt === 0 && !known ? first : await measure();
    const offX = half(box.x + box.width / 2);
    const offY = half(box.y + box.height / 2);
    if (!offX && !offY) {
      if (corner && (half(box.x) || half(box.y))) {
        throw new Error(`wholePixelCentre: the canvas's corner is not on a whole pixel (${String(box.x)}, ${String(box.y)})`);
      }
      const size = page.viewportSize();
      if (size) found.set(key, size);
      return;
    }
    if (attempt === tries) break;
    const size = page.viewportSize() ?? start;
    await page.setViewportSize({ width: size.width + (offX ? 1 : 0), height: size.height + (offY ? 1 : 0) });
    // The canvas follows its box through a ResizeObserver: let it lay out and draw before measuring again.
    await settle();
  }
  const box = await measure();
  throw new Error(`wholePixelCentre: the canvas's centre stayed off a whole pixel (box ${JSON.stringify(box)}, viewport ${JSON.stringify(page.viewportSize())})`);
}

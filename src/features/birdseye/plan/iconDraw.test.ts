import { describe, expect, it } from 'vitest';
import { PLAN_ICONS, type PlanIcon } from '../../../ui/icons/plan/planIcons';
import { createIconRasters, createRasterCache, croppedIconSvg, iconContentBox, RASTER_MAX, rasterKey, rasterSpec, type RasterSpec } from './iconDraw';
import { ICON_BOXES } from './iconBoxes';

// How a plan icon is drawn (6.3 review): its SVG cut to the committed box, its lines counted in the raster's pixels so
// they stay at the kit's weight however large the item is; rasters sized to the screen in powers of two, made in the
// background, kept in a cache bounded by pixels; an icon the engine can't decode drawn as the "?" outline.

const iconOf = (id: string): PlanIcon => {
  const icon = PLAN_ICONS.find((i) => i.id === id);
  if (!icon) throw new Error(id);
  return icon;
};
const shapes = (svg: string) => [...svg.matchAll(/<(rect|circle|ellipse|line|polyline|polygon|path)\b[^>]*>/g)].map((m) => m[0]);

describe('the SVG an icon is rasterised from', () => {
  it('is cut to the table’s box, at the raster’s size, every shape non-scaling with the kit’s stroke widths', () => {
    const sofa = iconOf('set-art/sofa');
    const svg = croppedIconSvg(sofa, { width: 64, height: 32, strokeScale: 1 });
    const box = ICON_BOXES['set-art/sofa'];
    expect(iconContentBox(sofa)).toEqual(box);
    expect(svg).toContain(`viewBox="${String(box?.x)} ${String(box?.y)} ${String(box?.width)} ${String(box?.height)}"`);
    expect(svg).toMatch(/<svg[^>]* width="64" height="32" [^>]*preserveAspectRatio="none"/);
    // Only once each.
    expect(svg.match(/\swidth="64"/g)).toHaveLength(1);
    const drawn = shapes(svg);
    expect(drawn).toHaveLength(3);
    for (const shape of drawn) expect(shape).toContain('vector-effect="non-scaling-stroke"');
    // The root's 1.5 and the back's 3, as the kit has them; the colours too.
    expect(svg).toMatch(/<svg[^>]*stroke-width="1.5"/);
    expect(svg).toContain('<path vector-effect="non-scaling-stroke" d="M3 8h26" stroke-width="3"/>');
    expect(svg).toContain('fill="#8FA38E"');
  });

  it('scales stroke widths and dashes for a raster that is shrunk onto the screen', () => {
    const svg = croppedIconSvg(iconOf('production/zone'), { width: 256, height: 256, strokeScale: 2 });
    expect(svg).toMatch(/<svg[^>]*stroke-width="3"/);
    expect(svg).toContain('stroke-dasharray="6 6"');
  });

  it('for the Library’s buttons keeps the kit’s strokes in its grid', () => {
    const svg = croppedIconSvg(iconOf('set-art/sofa'));
    expect(svg).not.toContain('vector-effect');
    expect(svg).toMatch(/<svg[^>]* width="29" height="19"/);
  });
});

describe('a raster’s size', () => {
  it('is the screen size rounded up to powers of two, at most 1024 px and the window on its long side', () => {
    expect(rasterSpec(300, 100, 1, 2000)).toMatchObject({ width: 512, height: 128 });
    expect(rasterSpec(3, 2, 1, 2000)).toMatchObject({ width: 8, height: 8 });
    // A 6 m basecamp up close: capped, its proportions kept.
    expect(rasterSpec(6000, 3000, 2, 4000)).toMatchObject({ width: RASTER_MAX, height: RASTER_MAX / 2 });
    // A small window caps it sooner.
    expect(rasterSpec(900, 300, 1, 500)).toMatchObject({ width: 512, height: 256 });
  });

  it('keeps a line within a fifth of the kit’s weight on screen at any size, on any display', () => {
    for (const ratio of [1, 1.25, 2]) {
      for (let px = 4; px < 20000; px *= 1.37) {
        const spec = rasterSpec(px, px / 2, ratio, 3000 * ratio);
        const shrink = Math.sqrt((spec.width / px) * (spec.height / (px / 2)));
        const onScreen = spec.strokeScale / shrink / ratio;
        expect(onScreen).toBeGreaterThan(0.84);
        expect(onScreen).toBeLessThan(1.19);
      }
    }
  });
});

describe('the raster cache', () => {
  it('stays inside its pixel budget, the least recently used out first', () => {
    const cache = createRasterCache<string>(1000);
    cache.put('a', 'A', 400);
    cache.put('b', 'B', 400);
    expect(cache.get('a')).toBe('A');
    cache.put('c', 'C', 400);
    // b was used least recently.
    expect(cache.keys()).toEqual(['a', 'c']);
    expect(cache.pixels()).toBe(800);
    cache.put('d', 'D', 900);
    expect(cache.keys()).toEqual(['d']);
    expect(cache.pixels()).toBe(900);
    // One larger than the budget is still kept alone, so the item that asked for it draws.
    cache.put('e', 'E', 5000);
    expect(cache.keys()).toEqual(['e']);
  });
});

/** Rasters with the page's work run by hand: `idle()` runs what waits for an idle moment. */
function harness(fail: ReadonlySet<string> = new Set(), maxPixels?: number) {
  const waiting: (() => void)[] = [];
  const made: string[] = [];
  const rasters = createIconRasters<string>(
    {
      make: (svg, width, height) => {
        const id = /<title>([^<]+)<\/title>/.exec(svg)?.[1] ?? '';
        made.push(`${id} ${String(width)}x${String(height)}`);
        return fail.has(id) ? Promise.reject(new Error('bad')) : Promise.resolve(`${id}@${String(width)}`);
      },
      schedule: (run) => waiting.push(run),
    },
    maxPixels,
  );
  /** One idle moment: what waits for it now, and nothing it schedules. */
  const step = () => {
    for (const run of waiting.splice(0)) run();
  };
  /** Every idle moment until nothing more waits, rasters underway finished in between. */
  const idle = async () => {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (waiting.length === 0) return;
      step();
    }
  };
  return { rasters, made, idle, step };
}

describe('rasters for the plan', () => {
  const sofa = iconOf('set-art/sofa');
  const small: RasterSpec = { width: 64, height: 32, strokeScale: 1 };
  const large: RasterSpec = { width: 256, height: 128, strokeScale: 1 };

  it('are made in the background, a few at a time; the last one drawn stands in while a new size is made', async () => {
    const { rasters, made, idle } = harness();
    rasters.want(sofa, small, 1, true);
    // Nothing is made while asking.
    expect(made).toEqual([]);
    expect(rasters.best(sofa.id, rasterKey(sofa.id, small))).toBeNull();
    await idle();
    expect(rasters.best(sofa.id, rasterKey(sofa.id, small))?.value).toBe('Sofa@64');
    const release = rasters.hold(rasterKey(sofa.id, small));
    rasters.want(sofa, large, 4, true);
    // Until the larger one is made, the smaller one is drawn.
    expect(rasters.best(sofa.id, rasterKey(sofa.id, large))?.value).toBe('Sofa@64');
    await idle();
    expect(rasters.best(sofa.id, rasterKey(sofa.id, large))?.value).toBe('Sofa@256');
    // Kept while drawn; let go, a size no item wants at this zoom goes.
    expect(rasters.keys()).toContain(rasterKey(sofa.id, small));
    release();
    expect(rasters.keys()).toEqual([rasterKey(sofa.id, large)]);
  });

  it('let go of sizes no item wants once the zoom settles, and ask for nothing out of view', async () => {
    const { rasters, made, idle } = harness();
    rasters.want(sofa, small, 1, true);
    await idle();
    rasters.want(sofa, large, 2, true);
    await idle();
    expect(rasters.keys()).toEqual([rasterKey(sofa.id, large)]);
    rasters.want(iconOf('set-art/table'), small, 2, false);
    await idle();
    expect(made).toEqual(['Sofa 64x32', 'Sofa 256x128']);
  });

  it('start at most three each idle moment, and four at once', async () => {
    const { rasters, made, step, idle } = harness();
    const ids = ['set-art/sofa', 'set-art/table', 'set-art/chair', 'set-art/bed', 'set-art/car'];
    for (const id of ids) rasters.want(iconOf(id), small, 1, true);
    expect(made).toHaveLength(0);
    step();
    expect(made).toHaveLength(3);
    step();
    // Four are underway: the fifth waits for one of them.
    expect(made).toHaveLength(4);
    await idle();
    expect(made).toHaveLength(5);
  });

  it('keep to their pixel budget', async () => {
    const { rasters, idle } = harness(new Set(), 64 * 32 * 2);
    for (const id of ['set-art/sofa', 'set-art/table', 'set-art/chair']) rasters.want(iconOf(id), small, 1, true);
    await idle();
    expect(rasters.pixels()).toBeLessThanOrEqual(64 * 32 * 2);
    expect(rasters.keys()).toHaveLength(2);
  });

  it('mark an icon the engine can’t decode, so it is drawn as the “?” outline, never as nothing', async () => {
    const { rasters, idle } = harness(new Set(['Sofa']));
    expect(rasters.failed(sofa.id)).toBe(false);
    rasters.want(sofa, small, 1, true);
    await idle();
    expect(rasters.failed(sofa.id)).toBe(true);
    expect(rasters.best(sofa.id, rasterKey(sofa.id, small))).toBeNull();
  });
});

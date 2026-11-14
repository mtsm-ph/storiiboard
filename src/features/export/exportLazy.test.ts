import { describe, expect, it, vi } from 'vitest';

// The export registry loads with the app (AppShell → ExportHost → registry), so nothing heavy may come with it: fontkit,
// which measures and embeds fonts, loads only when a PDF is made (6.10 review: planPages.ts had imported it statically).
// The mock's factory runs only if something imports fontkit, so it records whether importing the registry did.

const loaded = vi.hoisted(() => ({ fontkit: false }));

vi.mock('@pdf-lib/fontkit', () => {
  loaded.fontkit = true;
  return { default: { create: () => ({ layout: () => ({ glyphs: [] }), unitsPerEm: 1000 }) } };
});

describe('the export registry (6.10 review)', () => {
  it('loads without fontkit', async () => {
    const registry = await import('./registry');
    expect(registry.PLAN_FORMATS.length).toBeGreaterThan(0);
    expect(loaded.fontkit).toBe(false);
    // And fontkit does load when a plan's page is measured: the mock above is the module the registry would have pulled in.
    const { fontMeasure } = await import('./planPages');
    await fontMeasure({});
    expect(loaded.fontkit).toBe(true);
  });
});

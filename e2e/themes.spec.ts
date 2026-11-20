import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { skipOnboarding } from './onboarding';

// The theme generator (1.14) in the engines the app ships on: an image's accents are read in a Web Worker, and every
// family's theme, light and dark, passes axe on a real board. Switching themes in the UI arrives in 1.15; here the
// tokens are set on <html> the way it will set them.

/** One accent per family, plus the hard cases: no image (the kit), grey and neon. */
const FIXTURES: (string | null)[] = [
  null, // Paper, the kit
  '#C2185B', // Rose
  '#B5472B', // Clay
  '#C98A1B', // Ochre
  '#B79A55', // Sand
  '#7F8F1F', // Olive
  '#2E8B57', // Sage
  '#0F8C8C', // Teal
  '#2E6A8A', // Slate, by its hue
  '#1E6BD6', // Navy
  '#7A3FB5', // Violet
  '#9C2F7A', // Plum
  '#8C8F94', // grey: Slate, by the grey rule
  '#39FF14', // neon
];

test.beforeEach(async ({ page }) => {
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
  const board = page.getByRole('region', { name: 'Storyboard', exact: true });
  for (let i = 0; i < 2; i += 1) await board.getByRole('button', { name: '+ Frame in SC 01' }).click();
});

/** Sets a theme's tokens for one mode on <html>, as the app will. */
function applyTheme(page: Page, accent: string | null, mode: 'light' | 'dark') {
  return page.evaluate(
    async ({ accent, mode }) => {
      const url = '/src/ui/theme/generator/generate.ts';
      const { themeFor, cssVariables } = (await import(/* @vite-ignore */ url)) as typeof import('../src/ui/theme/generator/generate');
      const theme = themeFor(accent);
      document.documentElement.setAttribute('data-theme', mode);
      for (const [name, value] of Object.entries(cssVariables(theme[mode]))) document.documentElement.style.setProperty(name, value);
      return theme.family;
    },
    { accent, mode },
  );
}

test('reads a logo’s accent in a Web Worker', async ({ page }) => {
  const { accents, workers, answers } = await page.evaluate(async () => {
    // Counted, so the test fails if the page's own fallback did the work instead of the worker.
    const Real = window.Worker;
    const seen = { workers: 0, answers: 0 };
    window.Worker = class extends Real {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        seen.workers += 1;
        this.addEventListener('message', () => {
          seen.answers += 1;
        });
      }
    };
    const canvas = new OffscreenCanvas(120, 120);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 120, 120);
    ctx.fillStyle = 'rgb(200, 30, 40)';
    ctx.beginPath();
    ctx.arc(60, 60, 30, 0, Math.PI * 2);
    ctx.fill();
    const url = '/src/ui/theme/generator/extract.ts';
    const { extractAccents } = (await import(/* @vite-ignore */ url)) as typeof import('../src/ui/theme/generator/extract');
    try {
      return { accents: await extractAccents(await canvas.convertToBlob({ type: 'image/png' })), ...seen };
    } finally {
      window.Worker = Real;
    }
  });
  expect({ workers, answers }).toEqual({ workers: 1, answers: 1 });
  expect(accents).toHaveLength(1);
  // A red, as drawn.
  expect(accents[0]).toMatch(/^#[C-F][0-9A-F]/);
});

test('reads a logo’s accent on the page when the worker reports an error and there is no OffscreenCanvas (macOS 13.0 to 13.2)', async ({ page }) => {
  const { accents, asked, hadOffscreen } = await page.evaluate(async () => {
    const Real = window.Worker;
    const RealOffscreen = window.OffscreenCanvas;
    let asked = 0;
    // A worker as macOS 13.0's would answer: it has no OffscreenCanvas either, so it fails at its canvas stage.
    class FailingWorker extends EventTarget {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onmessageerror: ((event: MessageEvent) => void) | null = null;
      postMessage(): void {
        asked += 1;
        setTimeout(() => {
          this.onmessage?.(new MessageEvent('message', { data: { error: 'Can’t find variable: OffscreenCanvas', stage: 'canvas' } }));
        }, 0);
      }
      terminate(): void {}
    }
    window.Worker = FailingWorker;
    Reflect.deleteProperty(window, 'OffscreenCanvas');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 120;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 120, 120);
      ctx.fillStyle = 'rgb(200, 30, 40)';
      ctx.beginPath();
      ctx.arc(60, 60, 30, 0, Math.PI * 2);
      ctx.fill();
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((made) => {
          if (made) resolve(made);
          else reject(new Error('no blob'));
        }, 'image/png');
      });
      const url = '/src/ui/theme/generator/extract.ts';
      const { extractAccents } = (await import(/* @vite-ignore */ url)) as typeof import('../src/ui/theme/generator/extract');
      return { accents: await extractAccents(blob), asked, hadOffscreen: 'OffscreenCanvas' in window };
    } finally {
      window.Worker = Real;
      Object.defineProperty(window, 'OffscreenCanvas', { value: RealOffscreen, configurable: true, writable: true });
    }
  });
  // The worker was asked and failed; the page read the picture with a <canvas> of its own.
  expect(asked).toBe(1);
  expect(hadOffscreen).toBe(false);
  expect(accents).toHaveLength(1);
  // A red, as drawn.
  expect(accents[0]).toMatch(/^#[C-F][0-9A-F]/);
});

test('every family’s theme passes axe on the board, light and dark', async ({ page }) => {
  test.setTimeout(120_000);
  await page.evaluate(() => document.fonts.ready.then(() => true));
  const failures: { accent: string | null; mode: string; family: string; rules: string[] }[] = [];
  for (const accent of FIXTURES) {
    for (const mode of ['light', 'dark'] as const) {
      const family = await applyTheme(page, accent, mode);
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      if (violations.length > 0) {
        failures.push({ accent, mode, family, rules: violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`) });
      }
    }
  }
  expect(failures).toEqual([]);
});

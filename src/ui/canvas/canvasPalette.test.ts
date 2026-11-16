import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANVAS_VIEW_KEY, canvasViewsOf, loadCanvasViews, loadSettings, saveCanvasViews, saveSettings } from '../../core/storage/settings';
import { canvasPalette, contrastRatio, DARK_COLOURS, inkOn, isDark, kitStroke, mutedIn } from './canvasPalette';
import { INK, PAPER, PAPER_COLOURS, RAISED } from './paperColours';

// Paper or Dark (6.5.1): the setting read defensively, each kind on its own; the palette the hosts pass, its dark values
// the design kit's own tokens; and the kit icons' neutrals swapped only in Dark.

const tokens = join(import.meta.dirname, '../../../design/tokens');

const memory = () => {
  const kept = new Map<string, string>();
  return { kept, storage: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) } };
};

describe('the canvas view setting', () => {
  it('starts on paper for plans and boards alike', () => {
    const { storage } = memory();
    expect(loadCanvasViews(storage)).toEqual({ plan: 'paper', board: 'paper' });
    expect(loadCanvasViews(undefined)).toEqual({ plan: 'paper', board: 'paper' });
  });

  it('reads anything but dark as paper, each kind on its own', () => {
    expect(canvasViewsOf(undefined)).toEqual({ plan: 'paper', board: 'paper' });
    expect(canvasViewsOf(null)).toEqual({ plan: 'paper', board: 'paper' });
    expect(canvasViewsOf('dark')).toEqual({ plan: 'paper', board: 'paper' });
    expect(canvasViewsOf(['dark', 'dark'])).toEqual({ plan: 'paper', board: 'paper' });
    expect(canvasViewsOf({ plan: 'Dark', board: 1 })).toEqual({ plan: 'paper', board: 'paper' });
    expect(canvasViewsOf({ plan: 'dark', board: 'night' })).toEqual({ plan: 'dark', board: 'paper' });
    expect(canvasViewsOf({ board: 'dark' })).toEqual({ plan: 'paper', board: 'dark' });
    const { kept, storage } = memory();
    kept.set(CANVAS_VIEW_KEY, JSON.stringify({ plan: 'sepia', board: 'dark' }));
    expect(loadCanvasViews(storage)).toEqual({ plan: 'paper', board: 'dark' });
    kept.set(CANVAS_VIEW_KEY, '{not json');
    expect(loadCanvasViews(storage)).toEqual({ plan: 'paper', board: 'paper' });
    kept.set(CANVAS_VIEW_KEY, '"dark"');
    expect(loadCanvasViews(storage)).toEqual({ plan: 'paper', board: 'paper' });
  });

  it('is kept on this computer, one kind changed leaving the other as it was, apart from the other settings', () => {
    const { kept, storage } = memory();
    saveCanvasViews({ plan: 'dark', board: 'paper' }, storage);
    expect(loadCanvasViews(storage)).toEqual({ plan: 'dark', board: 'paper' });
    saveCanvasViews({ ...loadCanvasViews(storage), board: 'dark' }, storage);
    expect(loadCanvasViews(storage)).toEqual({ plan: 'dark', board: 'dark' });
    // Other settings saved later leave it, and it is never among them.
    saveSettings({ planUnits: 'feet' }, storage);
    expect(loadCanvasViews(storage)).toEqual({ plan: 'dark', board: 'dark' });
    expect(kept.get('storiiboard.settings')).not.toContain('dark');
    expect(loadSettings(storage)).not.toHaveProperty('canvasView');
  });
});

describe('the palette', () => {
  it('is the fixed paper one for Paper, and the same object every time for each view', () => {
    expect(canvasPalette('paper')).toBe(PAPER_COLOURS);
    expect(canvasPalette('dark')).toBe(DARK_COLOURS);
    expect(canvasPalette('dark')).toBe(canvasPalette('dark'));
  });

  it('takes Dark’s values from the design kit’s dark tokens: the abyssal page, paper ink, the dark well', () => {
    const json = JSON.parse(readFileSync(join(tokens, 'tokens.json'), 'utf8')) as { color: { dark: Record<string, string> } };
    expect(DARK_COLOURS).toEqual({ paper: json.color.dark.paper, ink: json.color.dark.ink, raised: json.color.dark.oatmeal, dark: true, halo: json.color.dark.paper });
    expect(DARK_COLOURS).toEqual({ paper: '#1B2632', ink: '#EEE9DF', raised: '#3A4B60', dark: true, halo: '#1B2632' });
    const css = readFileSync(join(tokens, 'tokens.css'), 'utf8');
    // The abyssal page and the paper ink are the kit's own values in its CSS too.
    expect(css.toUpperCase()).toContain(DARK_COLOURS.paper.toUpperCase());
    expect(css.toUpperCase()).toContain(DARK_COLOURS.ink.toUpperCase());
  });

  it('gives a muted ink readable on its page: the dark theme’s in Dark, the host’s own on Paper', () => {
    expect(mutedIn(DARK_COLOURS, '#5E5A52')).toBe('#A9B2BC');
    expect(mutedIn(PAPER_COLOURS, '#5E5A52')).toBe('#5E5A52');
  });
});

describe('the ink on a fill underneath (round 2)', () => {
  it('works out WCAG’s contrast ratio', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 6);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 6);
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 6);
    expect(contrastRatio(INK, PAPER)).toBeGreaterThan(15);
    expect(contrastRatio('red', '#FFFFFF')).toBeNull();
  });

  it('is the palette’s ink on paper, on the bare canvas and for a fill it can’t read', () => {
    expect(inkOn(PAPER_COLOURS, '#1F2F4D')).toBe(INK);
    expect(inkOn(PAPER_COLOURS, null)).toBe(INK);
    expect(inkOn(DARK_COLOURS, null)).toBe(DARK_COLOURS.ink);
    expect(inkOn(DARK_COLOURS, 'rgba(0, 0, 0, 0.5)')).toBe(DARK_COLOURS.ink);
  });

  it('is, in Dark, whichever of the light ink and the paper ink reads better on the fill', () => {
    expect(inkOn(DARK_COLOURS, '#FFFFFF')).toBe(INK);
    expect(inkOn(DARK_COLOURS, '#FFE97A')).toBe(INK);
    expect(inkOn(DARK_COLOURS, '#E4E8D2')).toBe(INK);
    expect(inkOn(DARK_COLOURS, '#1F2F4D')).toBe(DARK_COLOURS.ink);
    expect(inkOn(DARK_COLOURS, '#16150F')).toBe(DARK_COLOURS.ink);
    expect(inkOn(DARK_COLOURS, DARK_COLOURS.paper)).toBe(DARK_COLOURS.ink);
  });
});

describe('a kit icon’s lines', () => {
  it('are exactly the kit’s on paper and for any other palette (a print’s)', () => {
    for (const hex of [INK, '#FFFFFF', RAISED, '#D9A23D', '#1F2F4D', '#E0612B', '#A35139', '#16150f']) {
      expect(kitStroke(hex, PAPER_COLOURS)).toBe(hex);
      expect(kitStroke(hex, { ink: INK, paper: '#FFFFFF', raised: RAISED })).toBe(hex);
    }
  });

  it('turn light in Dark where they are the kit’s ink, and keep every colour of their own (round 3: only lines change)', () => {
    expect(kitStroke(INK, DARK_COLOURS)).toBe(DARK_COLOURS.ink);
    expect(kitStroke('#16150f', DARK_COLOURS)).toBe(DARK_COLOURS.ink);
    for (const hex of ['#FFFFFF', RAISED, PAPER, '#D9A23D', '#1F2F4D', '#8FA38E', '#A8482F', '#E9B8A6', '#FFB162', '#A35139', '#E0612B']) expect(kitStroke(hex, DARK_COLOURS)).toBe(hex);
    // A copy of the Dark palette (a wrapped context) still draws as Dark: the palette says what it is.
    expect(kitStroke(INK, { ...DARK_COLOURS, ink: '#EEE9DF' })).toBe('#EEE9DF');
    expect(isDark({ ...DARK_COLOURS })).toBe(true);
    expect(isDark(PAPER_COLOURS)).toBe(false);
    expect(inkOn({ ...DARK_COLOURS, ink: INK }, null)).toBe(INK);
    expect(inkOn({ ...DARK_COLOURS, ink: INK }, '#1F2F4D')).toBe(DARK_COLOURS.ink);
  });
});

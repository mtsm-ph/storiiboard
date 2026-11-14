import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageSize } from '../moodboards/pageFormats';
import { displayOps, type PrintNode } from './deckDisplay';
import { writeDeckPdf, type FontLoader } from './deckPdfWriter';

// Decks print exactly as they did before 6.10 taught the print path arcs, rgba paint, text halos and plans' drawings past
// their boxes (brief 6.10): a deck page with an ellipse, a translucent shape, a dashed fixed-width line, a path and a text
// gives the same display list and the same PDF bytes as it did before that change. The digests below were taken from the
// code as it was before 6.10's first edit; a change here is a change to every deck PDF, for Kevin to look at.

const file = (name: string) => new Uint8Array(readFileSync(new URL(`./fonts/${name}.ttf`, import.meta.url)));
const REGULAR = file('InterTight-Regular');
const MONO = file('JetBrainsMono-Regular');
const fonts: FontLoader = (family) => {
  const bytes = family === 'Inter Tight' ? REGULAR : family === 'JetBrains Mono' ? MONO : null;
  return Promise.resolve(bytes ? { key: family, bytes, synthBold: false, synthItalic: false } : null);
};

const node = (kind: PrintNode['kind'], attrs: Record<string, unknown>, extra: Partial<PrintNode> = {}): PrintNode => ({
  kind,
  matrix: [1, 0, 0, 1, 0, 0],
  opacity: 1,
  visible: true,
  attrs,
  children: [],
  ...extra,
});

/** A deck page's drawing as the snapshot reads it: a page, an ellipse, a translucent shape, a dashed line, a path and a text. */
const DECK_PAGE: PrintNode = node('group', {}, {
  children: [
    node('rect', { width: 1920, height: 1080, fill: '#EEE9DF' }),
    node('ellipse', { radiusX: 200, radiusY: 120, fill: '#DF5E27', stroke: '#16150F', strokeWidth: 4 }, { matrix: [1, 0, 0, 1, 400, 300] }),
    node('rect', { width: 300, height: 200, fill: '#16150F' }, { matrix: [0.87, 0.5, -0.5, 0.87, 900, 200], opacity: 0.5 }),
    node('line', { points: [100, 900, 1800, 900], stroke: '#16150F', strokeWidth: 1.5, strokeScaleEnabled: false, dash: [6, 4] }),
    node('path', { data: 'M 10 10 L 200 10 C 250 10 250 100 200 100 Z', fill: '#C9C1B1', stroke: '#16150F' }, { matrix: [1, 0, 0, 1, 1200, 600] }),
    node(
      'text',
      { text: 'Scene one', fontSize: 48, fontFamily: '"Inter Tight"', fill: '#16150F', width: 600 },
      { matrix: [1, 0, 0, 1, 100, 700], layout: { lines: [{ text: 'Scene one' }], width: 600, height: 48, baselineShift: 16.8 } },
    ),
  ],
});

const digest = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

describe('a deck page through the print path', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives the display list and the PDF bytes it gave before 6.10', async () => {
    const ops = displayOps(DECK_PAGE);
    const size = pageSize('16:9', 'landscape');
    const pdf = await writeDeckPdf({
      title: 'Pitch deck',
      pageCount: 1,
      page: () => Promise.resolve({ format: '16:9', orientation: 'landscape', ...size, background: '#FFFFFF', ops }),
      fonts,
      pictures: () => Promise.resolve(null),
      watermark: null,
    });
    expect({ ops: digest(JSON.stringify(ops)), pdf: digest(pdf.bytes) }).toEqual({ ops: OPS_BEFORE, pdf: PDF_BEFORE });
  });
});

const OPS_BEFORE = '232c06cb568721446e593ced0c21a49e18f1a8cc830a687e1cc0834ce55adcb9';
const PDF_BEFORE = 'c172f53c838e14fb2e9dcad17e19e54dd6cd009435019154f4aaa5027ed9e91a';

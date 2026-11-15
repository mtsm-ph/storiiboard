import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageSize } from '../moodboards/pageFormats';
import { displayOps, type PrintNode } from './deckDisplay';
import { writeDeckPdf, type FontLoader, type PictureLoader } from './deckPdfWriter';

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

const SHA = 'c'.repeat(64);
const JPEG = new Uint8Array(readFileSync(new URL('../../../e2e/fixtures/images/srgb.jpg', import.meta.url)));
const pictures: PictureLoader = (sha) => Promise.resolve(sha === SHA ? { bytes: JPEG, kind: 'jpeg', original: true } : null);
const turn = (degrees: number, x: number, y: number): [number, number, number, number, number, number] => {
  const r = (degrees * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), x, y];
};

/**
 * A second deck page with what the first lacks: a picture, a link card (a rect with its URL), an arrowhead (a closed,
 * filled line), a turned group with children, a centred text of two lines, and a text in a font this computer lacks
 * (the loader has none for Archivo, so the PDF sets it in the fallback).
 */
const DECK_PAGE_TWO: PrintNode = node('group', {}, {
  children: [
    node('rect', { width: 1920, height: 1080, fill: '#EEE9DF' }),
    node('image', { sbSha: SHA, width: 640, height: 400 }, { matrix: [1, 0, 0, 1, 80, 80] }),
    node('rect', { width: 520, height: 120, fill: '#C9C1B1', stroke: '#16150F', strokeWidth: 1.5, sbUrl: 'https://example.com/look' }, { matrix: [1, 0, 0, 1, 800, 80] }),
    node('line', { points: [0, 0, 24, 9, 0, 18], closed: true, fill: '#16150F', stroke: '#16150F', strokeWidth: 1 }, { matrix: [1, 0, 0, 1, 1400, 600] }),
    node('group', {}, {
      matrix: turn(30, 1200, 300),
      children: [
        node('rect', { width: 200, height: 100, fill: '#DF5E27' }),
        node('ellipse', { radiusX: 40, radiusY: 40, fill: '#16150F' }, { matrix: [1, 0, 0, 1, 100, 50] }),
      ],
    }),
    node(
      'text',
      { text: 'Two lines\ncentred', fontSize: 40, lineHeight: 1.2, align: 'center', fontFamily: '"Inter Tight"', fill: '#16150F', width: 500 },
      { matrix: [1, 0, 0, 1, 100, 700], layout: { lines: [{ text: 'Two lines' }, { text: 'centred' }], width: 500, height: 96, baselineShift: 14 } },
    ),
    node(
      'text',
      { text: 'Fallback face', fontSize: 36, fontFamily: '"Archivo"', fill: '#16150F', width: 600 },
      { matrix: [1, 0, 0, 1, 800, 900], layout: { lines: [{ text: 'Fallback face' }], width: 600, height: 36, baselineShift: 12.6 } },
    ),
  ],
});

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

  // This page's digests pin the print path as it is at 6.10's review (Nov 14), not before 6.10: the code before 6.10 is no
  // longer in the tree to take them from. The first page's predate 6.10 (the main session ran it against the pre-6.10
  // print code on Nov 14 and it passed). A change here is a change to every deck PDF with these, for Kevin to look at.
  it('gives the display list and the PDF bytes it gave at 6.10’s review for a picture, a link, an arrowhead, a turned group, centred lines and a fallback font', async () => {
    const ops = displayOps(DECK_PAGE_TWO);
    const size = pageSize('16:9', 'landscape');
    const pdf = await writeDeckPdf({
      title: 'Pitch deck',
      pageCount: 1,
      page: () => Promise.resolve({ format: '16:9', orientation: 'landscape', ...size, background: '#FFFFFF', ops }),
      fonts,
      pictures,
      watermark: null,
    });
    // What it printed, so the digests are of a page that drew what it holds: the picture embedded, the link made, Archivo noted.
    expect(pdf.unprintable).toBe(0);
    expect(pdf.fontNotes.map((note) => note.family)).toContain('Archivo');
    expect(ops.some((op) => op.op === 'link' && op.url === 'https://example.com/look')).toBe(true);
    expect({ ops: digest(JSON.stringify(ops)), pdf: digest(pdf.bytes) }).toEqual({ ops: OPS_TWO_AT_REVIEW, pdf: PDF_TWO_AT_REVIEW });
  });
});

const OPS_BEFORE = '232c06cb568721446e593ced0c21a49e18f1a8cc830a687e1cc0834ce55adcb9';
const PDF_BEFORE = 'c172f53c838e14fb2e9dcad17e19e54dd6cd009435019154f4aaa5027ed9e91a';
const OPS_TWO_AT_REVIEW = '0a859842d61f21ffebfd6d436b259686b459363dfb99cc567dd4c6d784176cde';
const PDF_TWO_AT_REVIEW = 'e0462150dc1b665755206f17794e308d9cea460bf5f391ceba4b2527d6c6c4e0';

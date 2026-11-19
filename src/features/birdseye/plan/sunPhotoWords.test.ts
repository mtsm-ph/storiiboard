import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { PAPER_COLOURS } from '../../../ui/canvas/paperColours';
import { SUN_RADIUS_M } from '../../../core/model/sunPath';
import { toCanvas } from './planScale';
import { boxesMeet, photoLabelLines, SunBeyond, sunWords, wordsFrom, type SunLook } from './sunDraw';

// The light reference photo's words on the plan (6.27 round 3, L-B): wrapped by the sun's own label's rule, at most two
// lines with the place cut to fit, and never over the icon, the sun's line label or "shadows" (nor, for a photo taken
// after dark, the sun's own label under the icon), at the zoom where words first appear, the tightest, with the mark
// at an east and a west bearing and the sun at the item's time all the way round.

const ICON = 80;
const radius = toCanvas(SUN_RADIUS_M);
const zoom = wordsFrom(radius, Math.hypot(ICON, ICON) / 2);

const unit = (degrees: number) => ({ x: Math.cos((degrees * Math.PI) / 180), y: Math.sin((degrees * Math.PI) / 180) });

function lookWith(sunAt: number, sunUp: boolean, photo: { x: number; y: number; up: boolean }, label = 'Photo Nov 3, 16:42 · Quay'): Extract<SunLook, { kind: 'drawn' }> {
  return {
    kind: 'drawn',
    radius,
    segments: [],
    hours: [],
    rise: null,
    set: null,
    sun: { ...unit(sunAt), up: sunUp },
    label: sunUp ? '13:00 · 212° · 38° high' : '21:10 · the sun is down',
    shadows: 'shadows',
    selected: false,
    photo: { ...photo, label },
  };
}

/** Every Text a drawing holds, with where it is drawn (its middle, as MonoText places it). */
function textsOf(node: ReactNode): { text: string; x: number; y: number; width: number }[] {
  if (Array.isArray(node)) return node.flatMap((n: ReactNode) => textsOf(n));
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  if (typeof el.type === 'function') return textsOf((el.type as (p: unknown) => ReactNode)(el.props));
  const own = typeof el.props.text === 'string' ? [{ text: el.props.text, x: Number(el.props.x), y: Number(el.props.y), width: Number(el.props.width) }] : [];
  return [...own, ...textsOf(el.props.children as ReactNode)];
}

describe('the light reference photo’s words on the plan (6.27 round 3)', () => {
  it('never sit on the icon, the sun’s label or “shadows”, east or west, at the zoom where words first appear', () => {
    for (const [name, photo] of [['east', unit(0)], ['west', unit(180)]] as const) {
      for (let sunAt = 0; sunAt < 360; sunAt += 15) {
        for (const photoUp of [true, false]) {
          for (const sunUp of [true, false]) {
            const look = lookWith(sunAt, sunUp, { ...photo, up: photoUp });
            const words = sunWords(look, ICON, ICON, zoom);
            const said = `${name}, sun at ${String(sunAt)}°, photo ${photoUp ? 'up' : 'down'}, sun ${sunUp ? 'up' : 'down'}`;
            expect(words.wordless, said).toBe(false);
            const box = words.photo;
            if (!box) throw new Error(said);
            expect(boxesMeet(box, words.icon), said).toBe(false);
            for (const other of [words.sun, words.shadows, words.down]) if (other) expect(boxesMeet(box, other), `${said}: ${other.text}`).toBe(false);
            // Two lines at most: the date and time, then the place.
            expect(box.text.split('\n').length, said).toBeLessThanOrEqual(2);
          }
        }
      }
    }
  });

  it('are drawn where they are worked out', () => {
    const look = lookWith(0, true, { ...unit(0), up: true });
    const { photo } = sunWords(look, ICON, ICON, zoom);
    if (!photo) throw new Error('no words');
    const drawn = textsOf(SunBeyond({ width: ICON, height: ICON, zoom, rotation: 0, colours: PAPER_COLOURS, look })).find((text) => text.text === photo.text);
    expect(drawn).toBeDefined();
    expect((drawn?.x ?? 0) + (drawn?.width ?? 0) / 2).toBeCloseTo(photo.x, 6);
    // Zoomed out too far for words: the ring alone.
    const far = textsOf(SunBeyond({ width: ICON, height: ICON, zoom: zoom / 4, rotation: 0, colours: PAPER_COLOURS, look }));
    expect(far.some((text) => text.text.startsWith('Photo'))).toBe(false);
  });

  it('wrap as the sun’s label does, to two lines at most, the place cut with “…” to fit', () => {
    const size = 11;
    // Room for it all: one line.
    expect(photoLabelLines('Photo Nov 3, 16:42 · Quay', 1000, size)).toBe('Photo Nov 3, 16:42 · Quay');
    // Too little: the date and time, then the place.
    expect(photoLabelLines('Photo Nov 3, 16:42 · Quay', 20, size)).toBe('Photo Nov 3, 16:42\nQuay');
    expect(photoLabelLines('Photo Nov 3, 16:42 · photo’s place', 20, size)).toBe('Photo Nov 3, 16:42\nphoto’s place');
    // A long name, or one with the separator in it: still two lines, cut to the first line's length.
    const long = photoLabelLines('Photo Nov 3, 16:42 · The Old Harbour Master’s House', 20, size);
    expect(long).toBe('Photo Nov 3, 16:42\nThe Old Harbour M…');
    expect(long.split('\n')[1]?.length).toBe('Photo Nov 3, 16:42'.length);
    expect(photoLabelLines('Photo Nov 3, 16:42 · Pier · North', 20, size)).toBe('Photo Nov 3, 16:42\nPier · North');
  });
});

import { describe, expect, it } from 'vitest';
import { distinctHex, framePixels, insideBars, paletteFromFrames, type Pixels } from './extract';

/** A frame of `width` by `height`, filled by `colour(x, y)` as [r, g, b]. */
function frame(width: number, height: number, colour: (x: number, y: number) => readonly [number, number, number]): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colour(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

const BLACK = [4, 4, 4] as const;
const BRICK = [163, 81, 57] as const;
const NAVY = [31, 47, 77] as const;

describe('scene palettes from frames (polish PP)', () => {
  it('finds letterbox bars top and bottom, and pillarbox bars at the sides', () => {
    const letterbox = frame(40, 30, (_, y) => (y < 5 || y >= 25 ? BLACK : BRICK));
    expect(insideBars(letterbox)).toEqual({ x0: 0, y0: 5, x1: 40, y1: 25 });
    const pillarbox = frame(40, 30, (x) => (x < 6 || x >= 34 ? BLACK : NAVY));
    expect(insideBars(pillarbox)).toEqual({ x0: 6, y0: 0, x1: 34, y1: 30 });
  });

  it('leaves a black frame, and a night shot dark at the top, whole', () => {
    expect(insideBars(frame(20, 10, () => BLACK))).toEqual({ x0: 0, y0: 0, x1: 20, y1: 10 });
    // Dark sky over half the frame isn't a bar: bars come in matching pairs.
    const night = frame(20, 20, (_, y) => (y < 12 ? BLACK : BRICK));
    expect(insideBars(night).y0).toBeLessThan(8);
  });

  it('leaves one-sided dark alone: night sky above, dark ground below, a wall at one side', () => {
    expect(insideBars(frame(96, 54, (_, y) => (y < 16 ? BLACK : BRICK)))).toEqual({ x0: 0, y0: 0, x1: 96, y1: 54 });
    expect(insideBars(frame(96, 54, (_, y) => (y >= 34 ? BLACK : BRICK)))).toEqual({ x0: 0, y0: 0, x1: 96, y1: 54 });
    expect(insideBars(frame(96, 54, (x) => (x >= 70 ? BLACK : NAVY)))).toEqual({ x0: 0, y0: 0, x1: 96, y1: 54 });
    // A wide picture in a tall frame: bars of 40% each, still bars.
    const tall = frame(54, 96, (_, y) => (y < 38 || y >= 58 ? BLACK : BRICK));
    expect(insideBars(tall)).toEqual({ x0: 0, y0: 38, x1: 54, y1: 58 });
  });

  it('leaves see-through pixels out, and finds no colours in a picture that is all see-through', () => {
    const clear = { data: new Uint8ClampedArray(10 * 10 * 4), width: 10, height: 10 };
    expect(framePixels(clear)).toEqual([]);
    expect(paletteFromFrames([framePixels(clear)], 8)).toEqual([]);
  });

  it('reads the picture inside the bars only, so black bars never make the palette', () => {
    const letterbox = frame(40, 30, (_, y) => (y < 5 || y >= 25 ? BLACK : BRICK));
    expect(paletteFromFrames([framePixels(letterbox)], 4)).toEqual(['#A35139']);
  });

  it('weighs every frame the same, most of the scene first, and keeps colours apart', () => {
    const big = frame(80, 45, () => BRICK);
    const small = frame(16, 9, () => NAVY);
    // Mostly brick by area, but two frames of navy to one of brick: navy covers more of the scene.
    expect(paletteFromFrames([framePixels(big), framePixels(small), framePixels(small)], 8)).toEqual(['#1F2F4D', '#A35139']);
    // Nearly the same brick twice is one colour.
    const close = frame(20, 10, (x) => (x < 10 ? BRICK : [165, 82, 58]));
    expect(paletteFromFrames([framePixels(close)], 8)).toHaveLength(1);
    expect(paletteFromFrames([], 8)).toEqual([]);
    expect(distinctHex('#A35139', '#A5523A')).toBe(false);
    expect(distinctHex('#A35139', '#1F2F4D')).toBe(true);
  });
});

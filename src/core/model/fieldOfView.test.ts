import { describe, expect, it } from 'vitest';
import { aspectValue, fieldOfView, oneDecimal } from './fieldOfView';

// The field of view (6.1, decision 6): what the project's frame sees, not the whole sensor. Kevin's cases, on a
// 35.6 × 20.0 mm mode.

const mode = { sensorWidthMm: 35.6, sensorHeightMm: 20.0 };

describe('the field of view', () => {
  it('50 mm, 2× squeeze, 2.39:1 frame: 47.8 mm wide, 51.1°, not the whole de-squeezed sensor’s 70.9°', () => {
    const fov = fieldOfView({ ...mode, squeeze: 2, focalMm: 50, aspect: 2.39 });
    expect(fov?.widthMm).toBeCloseTo(47.8, 1);
    expect(fov?.degrees).toBeCloseTo(51.1, 1);
    expect(Math.abs((fov?.degrees ?? 0) - 70.9)).toBeGreaterThan(1);
    expect(oneDecimal(fov?.degrees ?? 0)).toBe('51.1');
  });

  it('24 mm, no squeeze, 9:16 frame: 11.25 mm, 26.4°', () => {
    const fov = fieldOfView({ ...mode, focalMm: 24, aspect: 9 / 16 });
    expect(Math.abs((fov?.widthMm ?? 0) - 11.25)).toBeLessThan(0.05);
    expect(Math.abs((fov?.degrees ?? 0) - 26.4)).toBeLessThan(0.05);
  });

  it('the same on its side: 20.0 mm, 45.2°', () => {
    const fov = fieldOfView({ ...mode, focalMm: 24, aspect: 9 / 16, onSide: true });
    expect(Math.abs((fov?.widthMm ?? 0) - 20)).toBeLessThan(0.05);
    expect(Math.abs((fov?.degrees ?? 0) - 45.2)).toBeLessThan(0.05);
  });

  it('fits a frame wider than the area by the area’s width, and a taller one by its height', () => {
    // 4:3 area, 2.39:1 frame: the frame is wider, so all the width is used.
    expect(fieldOfView({ sensorWidthMm: 24, sensorHeightMm: 18, focalMm: 24, aspect: 2.39 })?.widthMm).toBeCloseTo(24, 5);
    // 2.39:1 frame on a 2:1 squeezed 4:3 area (48 × 18): taller than the area, so the height decides.
    expect(fieldOfView({ sensorWidthMm: 24, sensorHeightMm: 18, squeeze: 2, focalMm: 50, aspect: 2.39 })?.widthMm).toBeCloseTo(43.02, 2);
    // The same shape as the area: the whole width.
    expect(fieldOfView({ ...mode, focalMm: 35, aspect: 35.6 / 20 })?.widthMm).toBeCloseTo(35.6, 5);
  });

  it('is 1 squeeze when left out, and null on missing or non-positive inputs, never NaN', () => {
    expect(fieldOfView({ ...mode, focalMm: 50, aspect: 16 / 9 })).toEqual(fieldOfView({ ...mode, squeeze: 1, focalMm: 50, aspect: 16 / 9 }));
    expect(fieldOfView({ ...mode, squeeze: null, focalMm: 50, aspect: 16 / 9 })).toEqual(fieldOfView({ ...mode, squeeze: 1, focalMm: 50, aspect: 16 / 9 }));
    const bad = [
      { ...mode, focalMm: null, aspect: 2 },
      { ...mode, focalMm: 0, aspect: 2 },
      { ...mode, focalMm: -35, aspect: 2 },
      { ...mode, focalMm: Number.NaN, aspect: 2 },
      { ...mode, focalMm: 35, aspect: null },
      { ...mode, focalMm: 35, aspect: 0 },
      { ...mode, focalMm: 35, aspect: 2, squeeze: 0 },
      { sensorWidthMm: undefined, sensorHeightMm: 20, focalMm: 35, aspect: 2 },
      { sensorWidthMm: 35.6, sensorHeightMm: 0, focalMm: 35, aspect: 2 },
      { sensorWidthMm: Number.POSITIVE_INFINITY, sensorHeightMm: 20, focalMm: 35, aspect: 2 },
    ];
    for (const input of bad) expect(fieldOfView(input)).toBeNull();
  });
});

describe('the project’s frame shape', () => {
  it('reads ratios and decimals', () => {
    expect(aspectValue('2.39:1')).toBeCloseTo(2.39, 5);
    expect(aspectValue('16:9')).toBeCloseTo(16 / 9, 5);
    expect(aspectValue('9:16')).toBeCloseTo(9 / 16, 5);
    expect(aspectValue('1.85')).toBeCloseTo(1.85, 5);
    expect(aspectValue(' 4:3 ')).toBeCloseTo(4 / 3, 5);
    expect(aspectValue(2)).toBe(2);
  });

  it('is null for anything else', () => {
    for (const value of ['', 'wide', '16:0', '0:9', '-2', ':', '1:1:1', null, undefined, 0, -1, Number.NaN, {}, []]) expect(aspectValue(value)).toBeNull();
  });
});

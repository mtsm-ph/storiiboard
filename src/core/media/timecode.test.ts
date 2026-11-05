import { describe, expect, it } from 'vitest';
import { formatTimecode, frameAt, frameSeconds, frameTimecode, parseTimecode, timecodeBase, type Rational } from './timecode';

const r23976: Rational = { num: 24000, den: 1001 };
const r24: Rational = { num: 24, den: 1 };
const r25: Rational = { num: 25, den: 1 };
const r2997: Rational = { num: 30000, den: 1001 };
const r5994: Rational = { num: 60000, den: 1001 };

describe('timecode', () => {
  it('counts 23.976 and 25 without dropping labels', () => {
    expect(timecodeBase(r23976)).toBe(24);
    expect(frameTimecode(24, r23976, '01:00:00:00')).toBe('01:00:01:00');
    expect(frameTimecode(23, r23976, '01:00:00:00')).toBe('01:00:00:23');
    expect(frameTimecode(25 * 3600, r25, '10:00:00:00')).toBe('11:00:00:00');
    expect(parseTimecode('01:00:00:00', r24)).toEqual({ frames: 24 * 3600, dropFrame: false });
  });

  it('skips the first two labels of each minute at 29.97 drop-frame, but not every tenth minute', () => {
    expect(frameTimecode(1799, r2997, '00:00:00;00')).toBe('00:00:59;29');
    expect(frameTimecode(1800, r2997, '00:00:00;00')).toBe('00:01:00;02');
    expect(frameTimecode(17982, r2997, '00:00:00;00')).toBe('00:10:00;00');
    expect(frameTimecode(17981, r2997, '00:00:00;00')).toBe('00:09:59;29');
    // An hour of 29.97 drop-frame is 107892 frames: the clock and real time agree on the hour.
    expect(frameTimecode(107892, r2997, '00:00:00;00')).toBe('01:00:00;00');
    expect(parseTimecode('00:01:00;02', r2997)).toEqual({ frames: 1800, dropFrame: true });
    // A label drop-frame skips isn't a timecode.
    expect(parseTimecode('00:01:00;01', r2997)).toBeNull();
    expect(parseTimecode('00:10:00;00', r2997)).toEqual({ frames: 17982, dropFrame: true });
  });

  it('drops four labels a minute at 59.94', () => {
    expect(frameTimecode(3599, r5994, '00:00:00;00')).toBe('00:00:59;59');
    expect(frameTimecode(3600, r5994, '00:00:00;00')).toBe('00:01:00;04');
    expect(frameTimecode(35964, r5994, '00:00:00;00')).toBe('00:10:00;00');
  });

  it('keeps a 29.97 non-drop source as the camera wrote it', () => {
    expect(frameTimecode(1800, r2997, '00:00:00:00')).toBe('00:01:00:00');
  });

  it('round-trips every label it writes, across a day', () => {
    for (const rate of [r23976, r25, r2997, r5994]) {
      for (const frames of [0, 1, 1799, 1800, 1801, 17982, 107891, 2_000_000]) {
        const text = formatTimecode(frames, rate, rate.den === 1001 && timecodeBase(rate) !== 24);
        expect(parseTimecode(text, rate)?.frames).toBe(frames);
      }
    }
  });

  it('starts at 00:00:00:00 without a source timecode, drop-frame where the rate usually is', () => {
    expect(frameTimecode(0, r2997, null)).toBe('00:00:00;00');
    expect(frameTimecode(30, r25, null)).toBe('00:00:01:05');
  });

  it('refuses text that is not a timecode at the rate', () => {
    expect(parseTimecode('01:00:00:24', r23976)).toBeNull();
    expect(parseTimecode('25:00:00:00', r25)).toBeNull();
    expect(parseTimecode('1:2:3:4', r25)).toBeNull();
  });

  it('turns frames into seconds and back without drifting a frame', () => {
    for (const rate of [r23976, r24, r25, r2997, r5994]) {
      for (let index = 0; index < 5000; index += 37) {
        expect(frameAt(frameSeconds(index, rate), rate)).toBe(index);
      }
    }
    expect(frameSeconds(24000, r23976)).toBeCloseTo(1001, 9);
  });
});

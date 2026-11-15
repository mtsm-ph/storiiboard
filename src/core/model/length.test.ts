import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { formatLength, hasGroupingComma, parseLength, roundLengthLabel } from './length';

// Lengths on a plan (6.2a): every form a length can be typed in, in both units, what's refused, and how they're shown.

afterEach(() => {
  setLocale('en');
});

describe('parseLength', () => {
  it('reads metres, centimetres and millimetres, with a point or a comma', () => {
    expect(parseLength('3.5m', 'feet')).toBe(3.5);
    expect(parseLength('3,5 m', 'feet')).toBe(3.5);
    expect(parseLength('350cm', 'feet')).toBe(3.5);
    expect(parseLength('3500 mm', 'metres')).toBe(3.5);
    expect(parseLength(' 2 metres ', 'feet')).toBe(2);
  });

  it('reads feet, inches, and feet and inches', () => {
    expect(parseLength('12ft', 'metres')).toBe(3.6576);
    expect(parseLength("12'", 'metres')).toBe(3.6576);
    expect(parseLength('12\' 6"', 'metres')).toBe(3.81);
    expect(parseLength("12'6", 'metres')).toBe(3.81);
    expect(parseLength('12ft 6in', 'metres')).toBe(3.81);
    expect(parseLength('6"', 'metres')).toBe(0.1524);
    expect(parseLength('6in', 'metres')).toBe(0.1524);
    // Smart quotes, as a Mac types them, and two single quotes for inches.
    expect(parseLength('12’ 6”', 'metres')).toBe(3.81);
    expect(parseLength("6''", 'metres')).toBe(0.1524);
  });

  it('reads a bare number in the unit shown', () => {
    expect(parseLength('3.5', 'metres')).toBe(3.5);
    expect(parseLength('10', 'feet')).toBe(3.048);
    expect(parseLength('.5', 'metres')).toBe(0.5);
  });

  it('reads the US architectural forms, and 12-6 only while the screen shows feet', () => {
    expect(parseLength('12\'-6"', 'metres')).toBe(3.81);
    expect(parseLength("12'-6", 'metres')).toBe(3.81);
    expect(parseLength('12\' 6 1/2"', 'metres')).toBe(3.8227);
    expect(parseLength('6 1/2"', 'metres')).toBe(0.1651);
    expect(parseLength('1/2"', 'metres')).toBe(0.0127);
    expect(parseLength('12-6', 'feet')).toBe(3.81);
    expect(parseLength('12-6 1/2', 'feet')).toBe(3.8227);
    expect(parseLength('12-6', 'metres')).toBeNull();
    expect(parseLength('6 1/0"', 'metres')).toBeNull();
  });

  it('takes 12-6 with whole inches before a fraction, and refuses a fraction straight after the dash', () => {
    expect(parseLength('12-6 1/2', 'feet')).toBe(3.8227);
    expect(parseLength('12-0 1/2', 'feet')).toBe(3.6703);
    // 4-1/2 reads as four and a half, never as 4' 0½": refused, nothing saved.
    expect(parseLength('4-1/2', 'feet')).toBeNull();
    expect(parseLength('4 - 1/2', 'feet')).toBeNull();
  });

  it('refuses a grouping comma rather than guess it, and anything over a kilometre', () => {
    expect(parseLength('1,500 mm', 'metres')).toBeNull();
    expect(parseLength('1,500', 'metres')).toBeNull();
    expect(parseLength('2,000 m', 'feet')).toBeNull();
    expect(hasGroupingComma('1,500 mm')).toBe(true);
    expect(hasGroupingComma('3,5 m')).toBe(false);
    // A decimal comma is still read; after a 0 it can only be one.
    expect(parseLength('0,125 m', 'metres')).toBe(0.125);
    expect(parseLength('0,125', 'feet')).toBe(0.0381);
    expect(hasGroupingComma('0,125 m')).toBe(false);
    expect(parseLength('10,125 m', 'metres')).toBeNull();
    expect(parseLength('3,5 m', 'metres')).toBe(3.5);
    expect(parseLength('3,50 m', 'metres')).toBe(3.5);
    expect(parseLength('1000 m', 'metres')).toBe(1000);
    expect(parseLength('1001 m', 'metres')).toBeNull();
    expect(parseLength('5000', 'feet')).toBeNull();
    expect(parseLength('-1001 m', 'metres', true)).toBeNull();
    expect(parseLength('-0.5 m', 'metres')).toBeNull();
  });

  it('refuses anything else, and a minus unless it is a position', () => {
    for (const text of ['', 'abc', '3.5 km', '12 yards', '3..5', '1/2', 'm', "'"]) expect(parseLength(text, 'metres')).toBeNull();
    expect(parseLength('-2 m', 'metres')).toBeNull();
    expect(parseLength('-2 m', 'metres', true)).toBe(-2);
    expect(parseLength('−1.20 m', 'metres', true)).toBe(-1.2);
  });
});

describe('formatLength', () => {
  it('shows metres to the centimetre', () => {
    expect(formatLength(3.5, 'metres')).toBe('3.50 m');
    expect(formatLength(3.814, 'metres')).toBe('3.81 m');
    expect(formatLength(0, 'metres')).toBe('0.00 m');
    expect(formatLength(-1.2, 'metres')).toBe('−1.20 m');
  });

  it('shows feet and inches to the nearest half inch', () => {
    expect(formatLength(3.81, 'feet')).toBe('12\' 6"');
    expect(formatLength(3.6576, 'feet')).toBe('12\' 0"');
    expect(formatLength(3.81 + 0.0254 * 0.5, 'feet')).toBe('12\' 6.5"');
    // 6.3 inches rounds to 6.5; 6.2 to 6.
    expect(formatLength(0.0254 * 6.3, 'feet')).toBe('6.5"');
    expect(formatLength(0.0254 * 6.2, 'feet')).toBe('6"');
    // 11.8 inches rounds up to a whole foot.
    expect(formatLength(0.0254 * 11.8, 'feet')).toBe('1\' 0"');
  });

  it('round trips: what is shown reads back to the same length, in both units', () => {
    for (const m of [0.1, 0.5, 1, 2.47, 3.5, 3.81, 12.34, 60]) {
      expect(parseLength(formatLength(m, 'metres'), 'metres')).toBeCloseTo(m, 2);
      expect(Math.abs((parseLength(formatLength(m, 'feet'), 'feet') ?? 0) - m)).toBeLessThanOrEqual(0.0064);
    }
  });

  it('labels round lengths for the rulers and the scale bar', () => {
    expect(roundLengthLabel(1, 'metres')).toBe('1 m');
    expect(roundLengthLabel(0.5, 'metres')).toBe('0.5 m');
    expect(roundLengthLabel(3.048, 'feet')).toBe('10 ft');
    // Under a foot, inches; a centimetre in metres.
    expect(roundLengthLabel(0.0508, 'feet')).toBe('2 in');
    expect(roundLengthLabel(0.3048, 'feet')).toBe('1 ft');
    expect(roundLengthLabel(0.01, 'metres')).toBe('0.01 m');
  });
});

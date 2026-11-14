import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { cameraLabel, EQUIVALENT_MODE, matchingMode, modeLabel, SENSOR_MODES } from './sensorModes';

// The bodies and modes the Gear tile offers (6.1): short, each from the maker's own page.

afterEach(() => {
  setLocale('en');
});

describe('the sensor modes table', () => {
  it('has positive sizes, a source and a unique id on every entry', () => {
    expect(SENSOR_MODES.length).toBeGreaterThan(0);
    for (const entry of SENSOR_MODES) {
      expect(entry.widthMm, entry.id).toBeGreaterThan(0);
      expect(entry.heightMm, entry.id).toBeGreaterThan(0);
      expect(Number.isFinite(entry.widthMm) && Number.isFinite(entry.heightMm), entry.id).toBe(true);
      expect(entry.source.trim(), entry.id).not.toBe('');
      expect(entry.mode.trim(), entry.id).not.toBe('');
    }
    expect(new Set(SENSOR_MODES.map((e) => e.id)).size).toBe(SENSOR_MODES.length);
  });

  it('holds exactly the brief’s table, entry by entry (a golden list: a change here is a change to Kevin’s table)', () => {
    expect(SENSOR_MODES.map((e) => [e.camera, e.mode, e.widthMm, e.heightMm, e.unchecked === true])).toEqual([
      ['ARRI ALEXA 35', '4.6K 3:2 Open Gate', 27.99, 19.22, false],
      ['ARRI ALEXA 35', '4.6K 16:9', 28.0, 15.7, false],
      ['ARRI ALEXA 35', '4K 16:9', 24.9, 14.0, false],
      ['ARRI ALEXA Mini LF', '4.5K LF 3:2 Open Gate', 36.7, 25.54, false],
      ['ARRI ALEXA Mini LF', '4.3K LF 16:9', 35.64, 20.05, false],
      ['ARRI ALEXA Mini LF', '3.8K LF 16:9', 31.68, 17.82, false],
      ['RED KOMODO 6K', '6K 17:9', 27.03, 14.26, false],
      ['Blackmagic Pocket Cinema Camera 6K', '6K (Super 35)', 23.1, 12.99, false],
      ['Blackmagic Pocket Cinema Camera 4K', '4K (Four Thirds)', 18.96, 10, false],
      ['Sony FX3', 'Full frame 16:9', 35.6, 20.0, true],
      [null, EQUIVALENT_MODE, 36, 24, false],
    ]);
    expect(SENSOR_MODES).toHaveLength(11);
  });

  it('cites the maker’s own page for every camera but the two that say otherwise', () => {
    for (const entry of SENSOR_MODES.filter((e) => !e.unchecked && !e.focalEquivalent)) expect(entry.source, entry.id).toMatch(/^https:\/\/(www\.arri\.com|docs\.red\.com|www\.blackmagicdesign\.com)\//);
    expect(SENSOR_MODES.filter((e) => e.unchecked).map((e) => e.camera)).toEqual(['Sony FX3']);
  });

  it('ends with the phones entry: 36 × 24, focal lengths as full-frame equivalents, in the app’s language', () => {
    const phone = SENSOR_MODES.at(-1);
    expect(phone).toMatchObject({ widthMm: 36, heightMm: 24, focalEquivalent: true, mode: EQUIVALENT_MODE, camera: null });
    expect(SENSOR_MODES.filter((e) => e.focalEquivalent)).toHaveLength(1);
    expect(modeLabel(EQUIVALENT_MODE)).toBe('Focal lengths as full-frame equivalents');
    setLocale('es');
    expect(modeLabel(EQUIVALENT_MODE)).toBe('Distancias focales equivalentes a fotograma completo');
    if (phone) expect(cameraLabel(phone)).not.toBe('');
    // Proper names never change with the language.
    expect(modeLabel('4.3K LF 16:9')).toBe('4.3K LF 16:9');
  });

  it('matches a body only while its mode, width and height are all the entry’s', () => {
    expect(matchingMode('Full frame 16:9', 35.6, 20)?.id).toBe('fx3-ff-169');
    expect(matchingMode('Full frame 16:9', 35.7, 20)).toBeNull();
    expect(matchingMode('My mode', 35.6, 20)).toBeNull();
  });
});

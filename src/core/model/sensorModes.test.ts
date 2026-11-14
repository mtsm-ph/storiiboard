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

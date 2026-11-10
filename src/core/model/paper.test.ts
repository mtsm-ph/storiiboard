import { describe, expect, it } from 'vitest';
import { loadSettings, saveSettings } from '../storage/settings';
import { isLetterLocale, PAPER_SIZES, paperFor } from './paper';

// The call sheet's paper (4.6): Letter in the regions that use it, A4 elsewhere, unless the tile's choice says otherwise.

describe('paper by region', () => {
  it('is Letter in the US, Canada, Mexico and the other Letter countries', () => {
    for (const locale of ['en-US', 'en-CA', 'es-MX', 'es-CL', 'es-CO', 'es-PR', 'en-PH', 'es-DO', 'es-BO']) {
      expect(paperFor('region', locale), locale).toBe('letter');
    }
  });

  it('is A4 in Spain, the UK, Japan and everywhere else, and for a region it does not know', () => {
    for (const locale of ['es-ES', 'en-GB', 'de-DE', 'ja-JP', 'es-AR', 'pt-BR']) {
      expect(paperFor('region', locale), locale).toBe('a4');
    }
    expect(paperFor('region', null)).toBe('a4');
    expect(paperFor('region', 'not a locale')).toBe('a4');
    expect(paperFor('region', 'xx-ZZ')).toBe('a4');
  });

  it('reads a bare language as its likeliest region', () => {
    expect(isLetterLocale('en')).toBe(true);
    expect(isLetterLocale('es')).toBe(false);
  });

  it('the choice wins over the region', () => {
    expect(paperFor('a4', 'en-US')).toBe('a4');
    expect(paperFor('letter', 'es-ES')).toBe('letter');
  });

  it('Letter is 612 by 792 points and A4 595.28 by 841.89', () => {
    expect(PAPER_SIZES.letter).toEqual({ width: 612, height: 792 });
    expect(PAPER_SIZES.a4.width).toBeCloseTo(595.28, 2);
    expect(PAPER_SIZES.a4.height).toBeCloseTo(841.89, 2);
  });
});

describe('the paper and directions settings', () => {
  const store = () => {
    const kept = new Map<string, string>();
    return { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  };

  it('start on the region and Google Maps, keep what is chosen, and read an odd value as the default', () => {
    const storage = store();
    expect(loadSettings(storage)).toMatchObject({ callSheetPaper: 'region', directionsApp: 'google' });
    saveSettings({ callSheetPaper: 'a4', directionsApp: 'apple' }, storage);
    expect(loadSettings(storage)).toMatchObject({ callSheetPaper: 'a4', directionsApp: 'apple' });
    storage.setItem('storiiboard.settings', JSON.stringify({ callSheetPaper: 'tabloid', directionsApp: 'bing' }));
    expect(loadSettings(storage)).toMatchObject({ callSheetPaper: 'region', directionsApp: 'google' });
  });
});

import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../core/i18n';
import { measurementOf } from '../../core/model/measurementSystem';
import { loadSettings, saveSettings } from '../../core/storage/settings';
import { setPlanUnitsChoice } from '../../app/planUnits';
import { setWeatherUnitsChoice } from '../../app/weatherUnits';
import { ScaleUnits } from './ScaleUnits';

// The m | ft switch by a plan's scale bar (Kevin, Nov 18): plans only and this computer's. It sets Plan units, so the
// Measurement system may then read Mixed; flipping a plan to feet never changes the forecast.

let kept: Map<string, string>;

beforeEach(() => {
  setLocale('en');
  kept = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  });
});

afterEach(() => {
  setPlanUnitsChoice('region');
  setWeatherUnitsChoice('region');
  vi.unstubAllGlobals();
  setLocale('en');
});

const render = (value: 'metres' | 'feet') =>
  renderToString(<ScaleUnits value={value} onChange={() => undefined} button="b" pressed="p" />).replaceAll('<!-- -->', '');

describe('the m | ft switch', () => {
  it('shows m and ft, the unit in use pressed, each named in full', () => {
    const html = render('feet');
    expect(html).toContain('aria-label="Plan units"');
    expect(html).toContain('data-scale-units="feet"');
    // Named by what each shows, the word in full after it for a reader: "m (metres)", "ft (feet)".
    expect(html).toMatch(/aria-pressed="false"[^>]*>m<span class="sr-only"> \(metres\)<\/span>/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>ft<span class="sr-only"> \(feet\)<\/span>/);
  });

  it('in Spanish', () => {
    setLocale('es');
    const html = render('metres');
    expect(html).toContain('aria-label="Unidades de la planta"');
    expect(html).toContain('> (metros)</span>');
    expect(html).toContain('> (pies)</span>');
  });

  it('sets Plan units at once and never the forecast’s: Measurement system then reads Mixed', () => {
    saveSettings({ weatherUnits: 'metric', planUnits: 'metres' });
    setWeatherUnitsChoice('metric');
    setPlanUnitsChoice('metres');
    expect(measurementOf(loadSettings().weatherUnits, loadSettings().planUnits)).toBe('metric');
    // What the plan's switch hands to: the plan's setter alone.
    setPlanUnitsChoice('feet');
    expect(loadSettings().planUnits).toBe('feet');
    expect(loadSettings().weatherUnits).toBe('metric');
    expect(measurementOf(loadSettings().weatherUnits, loadSettings().planUnits)).toBe('mixed');
  });
});

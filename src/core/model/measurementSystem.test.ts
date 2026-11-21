import { describe, expect, it } from 'vitest';
import { loadSettings, saveSettings, SETTINGS_KEY, type PlanUnitsChoice, type WeatherUnitsChoice } from '../storage/settings';
import { isMeasurementSystem, measurementOf, unitsOfSystem } from './measurementSystem';

// The Measurement system (Kevin, Nov 18): one choice over Weather units and Plan units, read from them and never stored,
// so a computer upgraded shows what it showed before.

const WEATHER: readonly WeatherUnitsChoice[] = ['region', 'metric', 'us'];
const PLAN: readonly PlanUnitsChoice[] = ['region', 'metres', 'feet'];

/** A computer's storage, kept in a map. */
function storage(saved?: Record<string, unknown>) {
  const kept = new Map<string, string>(saved ? [[SETTINGS_KEY, JSON.stringify(saved)]] : []);
  return { kept, getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
}

describe('reading the Measurement system', () => {
  it('reads By region, Metric or US when the two agree, and Mixed for every other pair', () => {
    const read: Record<string, string> = {};
    for (const weather of WEATHER) for (const plan of PLAN) read[`${weather}+${plan}`] = measurementOf(weather, plan);
    expect(read).toEqual({
      'region+region': 'region',
      'region+metres': 'mixed',
      'region+feet': 'mixed',
      'metric+region': 'mixed',
      'metric+metres': 'metric',
      'metric+feet': 'mixed',
      'us+region': 'mixed',
      'us+metres': 'mixed',
      'us+feet': 'us',
    });
  });

  it('sets both settings together, and reads back as what was set', () => {
    expect(unitsOfSystem('region')).toEqual({ weatherUnits: 'region', planUnits: 'region' });
    expect(unitsOfSystem('metric')).toEqual({ weatherUnits: 'metric', planUnits: 'metres' });
    expect(unitsOfSystem('us')).toEqual({ weatherUnits: 'us', planUnits: 'feet' });
    for (const system of ['region', 'metric', 'us'] as const) {
      const units = unitsOfSystem(system);
      expect(measurementOf(units.weatherUnits, units.planUnits)).toBe(system);
    }
  });

  it('takes only a system as a choice: Mixed is a reading, never picked', () => {
    expect(isMeasurementSystem('metric')).toBe(true);
    expect(isMeasurementSystem('mixed')).toBe(false);
    expect(isMeasurementSystem('imperial')).toBe(false);
  });
});

describe('upgrading changes nothing anyone sees', () => {
  it('a computer with saved Weather and Plan units keeps them, and reads Mixed from them', () => {
    const before = storage({ weatherUnits: 'metric', planUnits: 'feet', language: 'en' });
    const raw = before.kept.get(SETTINGS_KEY);
    const settings = loadSettings(before);
    expect(settings.weatherUnits).toBe('metric');
    expect(settings.planUnits).toBe('feet');
    expect(measurementOf(settings.weatherUnits, settings.planUnits)).toBe('mixed');
    // Reading wrote nothing.
    expect(before.kept.get(SETTINGS_KEY)).toBe(raw);
  });

  it('a computer with only one unit saved (Plan units, feet) reads Mixed and shows what it showed (round 2)', () => {
    const before = storage({ planUnits: 'feet' });
    const raw = before.kept.get(SETTINGS_KEY);
    const settings = loadSettings(before);
    // Plans in feet, as chosen; the weather by this computer's region, as it never chose.
    expect(settings.planUnits).toBe('feet');
    expect(settings.weatherUnits).toBe('region');
    expect(measurementOf(settings.weatherUnits, settings.planUnits)).toBe('mixed');
    expect(before.kept.get(SETTINGS_KEY)).toBe(raw);
  });

  it('a computer that never chose either reads By region, as it showed', () => {
    const settings = loadSettings(storage({ language: 'en' }));
    expect(measurementOf(settings.weatherUnits, settings.planUnits)).toBe('region');
  });

  it('the system is never stored: saving any setting writes no measurementSystem key, and one found is ignored', () => {
    const computer = storage({ weatherUnits: 'us', planUnits: 'feet', measurementSystem: 'metric' });
    const settings = loadSettings(computer);
    expect(Object.keys(settings)).not.toContain('measurementSystem');
    expect(measurementOf(settings.weatherUnits, settings.planUnits)).toBe('us');
    saveSettings({ weekStart: 'monday' }, computer);
    expect(JSON.parse(computer.kept.get(SETTINGS_KEY) ?? '{}')).not.toHaveProperty('measurementSystem');
  });
});

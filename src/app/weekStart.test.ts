import { describe, expect, it } from 'vitest';
import { loadSettings, saveSettings } from '../core/storage/settings';
import { firstDayOf, regionFirstDay } from './weekStart';

// The week's first day (3.17): the region's, in every language, unless Settings says Sunday or Monday.

describe('the week’s first day', () => {
  it('is the region’s, whatever the language: Sunday in the US and Mexico, Monday in Spain and Britain, Saturday in Egypt', () => {
    expect(regionFirstDay('en-US')).toBe(0);
    expect(regionFirstDay('es-MX')).toBe(0);
    expect(regionFirstDay('en-MX')).toBe(0);
    expect(regionFirstDay('es-ES')).toBe(1);
    expect(regionFirstDay('en-GB')).toBe(1);
    expect(regionFirstDay('ar-EG')).toBe(6);
    expect(regionFirstDay('zh-CN')).toBe(1);
    expect(regionFirstDay('dv-MV')).toBe(5);
    expect(regionFirstDay('not a locale')).toBeNull();
  });

  it('follows Settings over the region, and the computer’s own setting over its region', () => {
    expect(firstDayOf('sunday', { firstDay: 1, locale: 'es-ES' }, 'es-ES')).toBe(0);
    expect(firstDayOf('monday', null, 'en-US')).toBe(1);
    // A Mac in English set to start on Monday; Windows in English with Mexico's formats.
    expect(firstDayOf('region', { firstDay: 1, locale: 'en-US' }, 'en-US')).toBe(1);
    expect(firstDayOf('region', { firstDay: null, locale: 'es-MX' }, 'en-GB')).toBe(0);
    // In a browser, the language's region; with nothing to go on, Sunday.
    expect(firstDayOf('region', null, 'en-GB')).toBe(1);
    expect(firstDayOf('region', { firstDay: 9, locale: null }, '??')).toBe(0);
  });

  it('is kept in this computer’s settings, a value this version doesn’t know read as the region’s', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(loadSettings(storage).weekStart).toBe('region');
    saveSettings({ weekStart: 'monday' }, storage);
    expect(loadSettings(storage).weekStart).toBe('monday');
    store.set('storiiboard.settings', JSON.stringify({ weekStart: 'friday' }));
    expect(loadSettings(storage).weekStart).toBe('region');
  });
});

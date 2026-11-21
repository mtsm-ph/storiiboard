import { afterEach, describe, expect, it } from 'vitest';
import { allChecks, type CheckFinding } from '../../core/checks';
import { setLocale } from '../../core/i18n';
import type { WeatherUnits } from '../../core/net/weather';
import type { Props, SbdRecord } from '../../core/model/record';
import { checkSentence, sentenceText, skipWords } from './checkWords';

// The Checks tile's words (7.4) in English and Spanish: the gear and lens checks, which the call sheet strip doesn't
// show, with their day and place; a call sheet finding as its strip says it; and what was skipped.

type Records = Record<string, SbdRecord>;

const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: id,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: '',
  updatedAt: '',
});
const recordsOf = (...list: SbdRecord[]): Records => Object.fromEntries(list.map((r) => [r.id, r]));

/** "Harbor Lights": 1A on Day 1 (Tue, Nov 17, 2026) needs a slider the day lacks; Camera on Setup 1 was planned at 50 mm. */
const project = (): Records =>
  recordsOf(
    record('p', 'project', null, { title: 'Harbor Lights' }),
    record('d', 'shoot_day', 'p', { date: '2026-11-17', call_time: '07:00', people_ids: ['robin'], gear_ids: [] }),
    record('robin', 'person', 'p', { name: 'Robin Vale', departments: ['direction', 'camera'] }),
    record('slider', 'gear_item', 'p', { name: 'Slider' }),
    record('pier', 'location', 'p', { name: 'Harbor Pier', address: '1 Pier Road', contact_name: 'Sam Ortiz', parking: 'Lot A', latitude: 40.7128, longitude: -74.006, time_zone: 'America/New_York' }),
    record('s1', 'scene', 'p', { number: '1', int_ext: 'EXT', day_night: 'DAY', location_id: 'pier' }),
    record('u1', 'setup', 's1', { name: '' }),
    record('own', 'plan', 'u1', { kind: 'setup', name: '' }),
    record('cam', 'plan_item', 'own', { kind: 'camera', icon: 'camera/camera', name: 'Camera', x: 0, y: 0, width: 0.4, height: 0.4, rotation: 0, shot_ids: ['a'], lens_mm: 50 }),
    record('a', 'shot', 's1', { number: '1A', status: 'need', shoot_day_id: 'd', gear_ids: ['slider'], setup_id: 'u1', lens_mm: 35 }),
    record('away', 'availability', 'robin', { from: '2026-11-17', to: '2026-11-17', state: 'unavailable', note: '' }),
  );

const units: WeatherUnits = 'metric';

afterEach(() => {
  setLocale('en');
});

describe('the Checks tile’s words (7.4)', () => {
  const words = (records: Records) => {
    const { findings, skipped } = allChecks(records, 'p');
    const of = (kind: CheckFinding['kind']) => {
      const found = findings.find((f) => f.kind === kind);
      if (!found) throw new Error(`no ${kind}`);
      return sentenceText(checkSentence(found, records, 'p', units));
    };
    return { of, skipped: skipped.map((s) => skipWords(s, records, 'p')) };
  };

  it('say the gear, the lens and a call sheet finding (as its strip says it), and what was skipped, in English', () => {
    setLocale('en');
    const { of, skipped } = words(project());
    expect(of('gear-not-on-day')).toBe('1A needs Slider, not on Day 1 · Tue, Nov 17’s list');
    expect(of('plan-lens-differs')).toBe('1A is at 35 mm, but Camera on Setup 1’s plan was planned at 50 mm');
    expect(of('unavailable-on-day')).toBe('Robin Vale (Direction) is called on Tue, Nov 17 but marked unavailable Nov 17');
    expect(skipped).toEqual(['No forecast held for Harbor Pier on Tue, Nov 17: rain wasn’t checked']);
  });

  it('and in Spanish', () => {
    setLocale('es');
    const { of, skipped } = words(project());
    expect(of('gear-not-on-day')).toBe('1A necesita Slider, que no está en la lista de Día 1 · mar, 17 nov');
    expect(of('plan-lens-differs')).toBe('1A está a 35 mm, pero Camera, en la planta de Emplazamiento 1, se planificó con 50 mm');
    expect(skipped).toEqual(['No hay pronóstico guardado para Harbor Pier el mar, 17 nov: no se revisó la lluvia']);
  });

  it('name a day with no date by its number', () => {
    setLocale('en');
    const records = { ...project(), d2: record('d2', 'shoot_day', 'p', {}) };
    expect(words(records).skipped).toContain('Day 2 has no date: unavailable dates, golden hour and rain weren’t checked');
  });
});

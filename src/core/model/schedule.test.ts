import { describe, expect, it } from 'vitest';
import { addDays, addMonths, monthGrid, weekOf, weekStart } from '../../features/schedule/calendarDates';
import type { Props, SbdRecord } from './record';
import { confirmedCrew, crewChange, dayCrew, dayLocations, dayScenes } from './schedule';

// The Calendar's reads (3.8): a day's scenes, locations with their status and crew confirmed; and its date arithmetic.

const at = '2026-11-09T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id, trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));

const base = () =>
  recordsOf(
    record('p', 'project', null, {}),
    record('diner', 'location', 'p', { name: 'Bey County Diner', status: 'confirmed' }),
    record('dock', 'location', 'p', { name: 'Dock', status: 'tbd' }),
    record('gone', 'location', 'p', { name: 'Old mill' }, 'gone', at),
    record('s1', 'scene', 'p', { number: '1', location_id: 'diner' }, 'a'),
    record('s2', 'scene', 'p', { number: '2', location_id: 'gone' }, 'b'),
    record('a', 'shot', 's1', { number: '1A', status: 'need', shoot_day_id: 'd' }, 'a'),
    record('b', 'shot', 's1', { number: '1B', status: 'need', shoot_day_id: 'd', location_id: 'dock' }, 'b'),
    record('c', 'shot', 's2', { number: '2A', status: 'need', shoot_day_id: 'd' }, 'a'),
    record('d', 'shoot_day', 'p', { date: '2026-11-16', crew: { sam: 'confirmed', ana: 'pending', left: 'confirmed', x: 7 } }),
    record('sam', 'person', 'p', { name: 'Sam Ortiz' }),
    record('ana', 'person', 'p', { name: 'Ana Ruiz' }),
    record('left', 'person', 'p', { name: 'Lee' }, 'left', at),
  );

describe('a shoot day for the Calendar', () => {
  it('has its scenes in board order, once each', () => {
    expect(dayScenes(base(), 'p', 'd').map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('is at the live locations its frames are shot at, a frame’s own over its scene’s, with their status', () => {
    expect(dayLocations(base(), 'p', 'd').map((l) => [l.name, l.status])).toEqual([
      ['Bey County Diner', 'confirmed'],
      ['Dock', 'tbd'],
    ]);
  });

  it('counts its crew (everyone live in Cast and crew) and who has confirmed', () => {
    const records = base();
    expect(confirmedCrew(records.d?.props ?? {})).toEqual(new Set(['sam', 'left']));
    expect(dayCrew(records, 'p', records.d as SbdRecord)).toEqual({ people: 2, confirmed: 1 });
  });

  it('confirms someone or puts them back to pending, keeping what else the prop holds', () => {
    const records = base();
    expect(crewChange(records, 'd', 'ana', true)).toEqual([{ kind: 'update', id: 'd', set: { crew: { sam: 'confirmed', left: 'confirmed', x: 7, ana: 'confirmed' } } }]);
    expect(crewChange(records, 'd', 'sam', false)).toEqual([{ kind: 'update', id: 'd', set: { crew: { ana: 'pending', left: 'confirmed', x: 7 } } }]);
    expect(crewChange(records, 'd', 'sam', true)).toEqual([]);
    expect(crewChange(records, 'nothing', 'sam', true)).toEqual([]);
    // A value this version can't read as a list of people (a newer one's) is never written over.
    const odd = { ...records, d: { ...(records.d as SbdRecord), props: { crew: 'all' } } };
    expect(crewChange(odd, 'd', 'ana', true)).toEqual([]);
  });
});

describe('calendar dates', () => {
  it('step by day and month across years, never moved by a time zone', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
  });

  it('start a week on the language’s first day, and lay a month out in whole weeks', () => {
    // Nov 16, 2026 is a Monday.
    expect(weekStart('2026-11-18', 0)).toBe('2026-11-15');
    expect(weekStart('2026-11-18', 1)).toBe('2026-11-16');
    expect(weekOf('2026-11-16', 1)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
    const november = monthGrid('2026-11-09', 0);
    expect(november[0]?.[0]).toBe('2026-11-01');
    expect(november.at(-1)?.at(-1)).toBe('2026-12-05');
    expect(november).toHaveLength(5);
    // February 2026 starts on a Sunday: four whole weeks, Sunday first.
    expect(monthGrid('2026-02-10', 0)).toHaveLength(4);
    // August 2026 starts on a Saturday: six weeks. November from Monday: six too.
    const august = monthGrid('2026-08-10', 0);
    expect([august.length, august.at(-1)?.at(-1)]).toEqual([6, '2026-09-05']);
    const novemberFromMonday = monthGrid('2026-11-09', 1);
    expect([novemberFromMonday.length, novemberFromMonday[0]?.[0], novemberFromMonday.at(-1)?.at(-1)]).toEqual([6, '2026-10-26', '2026-12-06']);
  });
});

import { describe, expect, it } from 'vitest';
import { dayChange, newDay, nextDate, scheduleFrames, setupMinutesChange, trashDay } from '../../features/schedule/dayEdits';
import type { Props, SbdRecord } from './record';
import {
  dayFrames,
  dayLabel,
  dayTotals,
  durationLabel,
  frameDayId,
  projectShootDays,
  setupMinutes,
  shootDayFields,
  unscheduledFrames,
} from './shootDay';

// Shoot days (3.7): days numbered by date, a frame in at most one, the totals worked out, and the edits the Days tile
// makes.

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
    record('s1', 'scene', 'p', { number: '1' }, 'a'),
    record('s2', 'scene', 'p', { number: '2' }, 'b'),
    record('a', 'shot', 's1', { number: '1A', status: 'need', shoot_day_id: 'd2' }, 'a'),
    record('b', 'shot', 's1', { number: '1B', status: 'need', setup_id: 'x', shoot_day_id: 'd2' }, 'b'),
    record('c', 'shot', 's1', { number: '1C', status: 'need', setup_id: 'x', shoot_day_id: 'd2' }, 'c'),
    record('e', 'shot', 's2', { number: '2A', status: 'need' }, 'a'),
    record('f', 'shot', 's2', { number: '2B', status: 'have' }, 'b'),
    record('g', 'shot', 's2', { number: '2C', status: 'need', shoot_day_id: 'gone' }, 'c'),
    record('d1', 'shoot_day', 'p', { date: '2026-11-18', call_time: '07:00' }, 'a'),
    record('d2', 'shoot_day', 'p', { date: '2026-11-16' }, 'b'),
    record('d3', 'shoot_day', 'p', {}, 'c'),
    record('gone', 'shoot_day', 'p', { date: '2026-11-17' }, 'd', at),
  );

describe('shoot days', () => {
  it('are numbered by date, undated last, those in the Trash left out', () => {
    const days = projectShootDays(base(), 'p');
    expect(days.map((d) => [d.record.id, d.number])).toEqual([
      ['d2', 1],
      ['d1', 2],
      ['d3', 3],
    ]);
    expect(dayLabel(days[0] ?? { number: 0, fields: shootDayFields({}) })).toBe('Day 1 · Mon, Nov 16');
    expect(dayLabel({ number: 3, fields: shootDayFields({}) })).toBe('Day 3');
  });

  it('read only valid dates and times', () => {
    expect(shootDayFields({ date: '2026-02-30', call_time: '25:00', wrap_time: '19:30', notes: 'Rain cover' })).toEqual({
      date: '',
      callTime: '',
      wrapTime: '19:30',
      notes: 'Rain cover',
    });
  });

  it('hold their frames in board order; a frame whose day is in the Trash is unscheduled', () => {
    const records = base();
    expect(dayFrames(records, 'p', 'd2').map(({ shot }) => shot.id)).toEqual(['a', 'b', 'c']);
    expect(frameDayId(records, records.g as SbdRecord)).toBeNull();
    // Only "Need to shoot" frames wait for a day: Have and Source aren't shot.
    expect(unscheduledFrames(records, 'p').map(({ shot }) => shot.id)).toEqual(['e', 'g']);
  });

  it('add up their frames, setups (frames sharing one count once) and hours at the minutes per setup', () => {
    const records = base();
    const totals = dayTotals(dayFrames(records, 'p', 'd2'), setupMinutes(records.p?.props));
    expect(totals).toEqual({ frames: 3, setups: 2, minutes: 60 });
    // A frame marked Have since it was put in the day isn't left to shoot: it stays listed, but doesn't count.
    const shot = { ...records, a: { ...(records.a as SbdRecord), props: { ...records.a?.props, status: 'have' } } };
    expect(dayFrames(shot, 'p', 'd2')).toHaveLength(3);
    expect(dayTotals(dayFrames(shot, 'p', 'd2'), 30)).toEqual({ frames: 2, setups: 1, minutes: 30 });
    expect(setupMinutes({ setup_minutes: 45 })).toBe(45);
    expect(setupMinutes({ setup_minutes: 0 })).toBe(30);
    expect(durationLabel(90)).toBe('1 h 30 min');
    expect(durationLabel(45)).toBe('45 min');
    expect(durationLabel(120)).toBe('2 h');
  });
});

describe('the Days tile’s edits', () => {
  it('make a new day the day after the latest, or today when there are none', () => {
    expect(newDay(base(), 'p', '2026-11-09', 'n').record.props).toEqual({ date: '2026-11-19', people_ids: [] });
    expect(newDay(recordsOf(record('p', 'project', null, {})), 'p', '2026-11-09', 'n').record.props).toEqual({ date: '2026-11-09', people_ids: [] });
    expect(nextDate('2026-12-31')).toBe('2027-01-01');
  });

  it('change a field only to a valid value, and take it off when emptied', () => {
    const records = base();
    expect(dayChange(records, 'd1', 'call_time', '06:30')).toEqual([{ kind: 'update', id: 'd1', set: { call_time: '06:30' } }]);
    expect(dayChange(records, 'd1', 'call_time', '6:30 am')).toEqual([]);
    expect(dayChange(records, 'd1', 'call_time', '')).toEqual([{ kind: 'update', id: 'd1', unset: ['call_time'] }]);
    expect(dayChange(records, 'd1', 'date', '2026-11-18')).toEqual([]);
    expect(dayChange(records, 'gone', 'notes', 'x')).toEqual([]);
  });

  it('move frames into a day, between days and out, in one edit; never into a day in the Trash', () => {
    const records = base();
    expect(scheduleFrames(records, ['a', 'e'], 'd1')).toEqual([
      { kind: 'update', id: 'a', set: { shoot_day_id: 'd1' } },
      { kind: 'update', id: 'e', set: { shoot_day_id: 'd1' } },
    ]);
    expect(scheduleFrames(records, ['a', 'e'], null)).toEqual([{ kind: 'update', id: 'a', unset: ['shoot_day_id'] }]);
    expect(scheduleFrames(records, ['e'], 'gone')).toEqual([]);
  });

  it('send a day to the Trash, and set the minutes per setup in range', () => {
    const records = base();
    expect(trashDay(records, 'd1')).toEqual([{ kind: 'trash', id: 'd1' }]);
    expect(trashDay(records, 'gone')).toEqual([]);
    expect(setupMinutesChange(records, 'p', 45)).toEqual([{ kind: 'update', id: 'p', set: { setup_minutes: 45 } }]);
    expect(setupMinutesChange(records, 'p', 0)).toEqual([]);
  });
});

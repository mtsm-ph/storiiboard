import { describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from '../../core/model/record';
import { projectShootDays } from '../../core/model/shootDay';
import { awayShown } from './calendarAway';

// Who the Calendar marks as away on a date (7.3): on a shoot date, only the people on its days; on any other date,
// anyone away; in Cast and crew's order.

const at = '2026-11-21T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: id,
  props,
  trashedAt,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const away = (id: string, personId: string, from: string, to: string) => record(id, 'availability', personId, { from, to, state: 'unavailable', note: '' });
const records = Object.fromEntries(
  [
    record('p', 'project', null, { title: 'Harbor Lights' }),
    record('d', 'shoot_day', 'p', { date: '2026-11-26', people_ids: ['robin'] }),
    record('robin', 'person', 'p', { name: 'Robin Vale', role: 'gaffer' }),
    record('sam', 'person', 'p', { name: 'Sam Ortiz' }),
    away('a', 'robin', '2026-11-24', '2026-11-28'),
    away('b', 'sam', '2026-11-25', '2026-11-26'),
  ].map((r) => [r.id, r]),
);
const shootsOn = (date: string) => projectShootDays(records, 'p').filter((d) => d.fields.date === date);
const names = (date: string) => awayShown(records, 'p', date, shootsOn(date)).map((p) => p.fields.name);

describe('who the Calendar marks as away', () => {
  it('counts everyone away on a date with no shoot, in Cast and crew’s order', () => {
    expect(names('2026-11-25')).toEqual(['Robin Vale', 'Sam Ortiz']);
    expect(names('2026-11-24')).toEqual(['Robin Vale']);
    expect(names('2026-11-29')).toEqual([]);
  });

  it('counts only the people on the day on a shoot date', () => {
    expect(names('2026-11-26')).toEqual(['Robin Vale']);
    const open = { ...records, d: { ...(records.d as SbdRecord), props: { date: '2026-11-26' } } };
    const all = awayShown(open, 'p', '2026-11-26', projectShootDays(open, 'p'));
    expect(all.map((p) => [p.fields.name, p.stretches.map((s) => s.record.id)])).toEqual([
      ['Robin Vale', ['a']],
      ['Sam Ortiz', ['b']],
    ]);
  });
});

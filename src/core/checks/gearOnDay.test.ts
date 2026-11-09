import { describe, expect, it } from 'vitest';
import { gearListChange } from '../../features/gear/gearEdits';
import { gearIdsOf } from '../model/gear';
import type { Props, SbdRecord } from '../model/record';
import { gearNotOnDay, runChecks } from '.';

// The first consistency check (3.9b): a frame needs gear that isn't on its shoot day's list. And the edit that puts
// items on or off a frame's gear or a day's list.

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
    record('fx3', 'gear_item', 'p', { name: 'FX3 package' }),
    record('slider', 'gear_item', 'p', { name: 'Slider' }),
    record('old', 'gear_item', 'p', { name: 'Old dolly' }, 'old', at),
    record('s1', 'scene', 'p', { number: '1' }),
    record('a', 'shot', 's1', { number: '1A', status: 'need', shoot_day_id: 'd', gear_ids: ['fx3', 'slider', 'old'] }, 'a'),
    record('b', 'shot', 's1', { number: '1B', status: 'need', shoot_day_id: 'd', gear_ids: ['fx3'] }, 'b'),
    record('c', 'shot', 's1', { number: '1C', status: 'need', gear_ids: ['slider'] }, 'c'),
    record('d', 'shoot_day', 'p', { date: '2026-11-16', gear_ids: ['fx3', 7] }),
  );

describe('gear not on the day’s list', () => {
  it('finds each frame in a day needing live gear its list lacks; one in no day, and gear in the Trash, aren’t mistakes', () => {
    expect(gearNotOnDay(base(), 'p')).toEqual([{ kind: 'gear-not-on-day', shotId: 'a', dayId: 'd', gearIds: ['slider'] }]);
    expect(runChecks(base(), 'p')).toHaveLength(1);
  });

  it('leaves out frames already shot, and frames in a scene in the Trash', () => {
    const records = base();
    const shot = { ...records, a: { ...(records.a as SbdRecord), props: { ...records.a?.props, status: 'have' } } };
    expect(gearNotOnDay(shot, 'p')).toEqual([]);
    const gone = { ...records, s1: { ...(records.s1 as SbdRecord), trashedAt: at } };
    expect(gearNotOnDay(gone, 'p')).toEqual([]);
  });

  it('finds nothing once the day has it, or the day is in the Trash', () => {
    const records = base();
    const added = { ...records, d: { ...(records.d as SbdRecord), props: { gear_ids: ['fx3', 'slider'] } } };
    expect(gearNotOnDay(added, 'p')).toEqual([]);
    const trashed = { ...records, d: { ...(records.d as SbdRecord), trashedAt: at } };
    expect(gearNotOnDay(trashed, 'p')).toEqual([]);
  });

  it('reads a list as item ids, each once', () => {
    expect(gearIdsOf({ gear_ids: ['a', 'a', 3, '', 'b'] })).toEqual(['a', 'b']);
    expect(gearIdsOf({ gear_ids: 'a' })).toEqual([]);
  });
});

describe('putting gear on a list', () => {
  it('adds and takes off items as one edit, keeping what else the list holds', () => {
    const records = base();
    expect(gearListChange(records, 'd', ['slider'], true)).toEqual([{ kind: 'update', id: 'd', set: { gear_ids: ['fx3', 7, 'slider'] } }]);
    expect(gearListChange(records, 'd', ['fx3'], false)).toEqual([{ kind: 'update', id: 'd', set: { gear_ids: [7] } }]);
    expect(gearListChange(records, 'b', ['fx3'], false)).toEqual([{ kind: 'update', id: 'b', unset: ['gear_ids'] }]);
    expect(gearListChange(records, 'c', ['fx3', 'slider'], true)).toEqual([{ kind: 'update', id: 'c', set: { gear_ids: ['slider', 'fx3'] } }]);
  });

  it('never adds gear in the Trash, never writes over a list it can’t read, and changes only shots and days', () => {
    const records = base();
    expect(gearListChange(records, 'c', ['old'], true)).toEqual([]);
    expect(gearListChange(records, 'c', ['slider'], true)).toEqual([]);
    const odd = { ...records, c: { ...(records.c as SbdRecord), props: { gear_ids: 'all' } } };
    expect(gearListChange(odd, 'c', ['fx3'], true)).toEqual([]);
    expect(gearListChange(records, 's1', ['fx3'], true)).toEqual([]);
    // Asked twice, put on once; a day in the Trash takes nothing.
    expect(gearListChange(records, 'c', ['fx3', 'fx3'], true)).toEqual([{ kind: 'update', id: 'c', set: { gear_ids: ['slider', 'fx3'] } }]);
    const trashedDay = { ...records, d: { ...(records.d as SbdRecord), trashedAt: at } };
    expect(gearListChange(trashedDay, 'd', ['slider'], true)).toEqual([]);
  });
});

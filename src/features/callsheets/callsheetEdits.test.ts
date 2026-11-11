import { describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from '../../core/model/record';
import { callsheetNoteChange } from './callsheetEdits';

const at = '2026-11-10T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, trashedAt: string | null = null, sortKey = 'm'): SbdRecord => ({
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

describe('the call sheet’s note edits', () => {
  const day = record('d', 'shoot_day', 'p', { date: '2026-11-16' });

  it('makes the call sheet with the first note, in one change list', () => {
    const changes = callsheetNoteChange(recordsOf(day), 'd', 'notes', 'Park behind the diner', 'cs');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'create', record: { id: 'cs', type: 'callsheet', parentId: 'd', props: { notes: 'Park behind the diner' } } });
  });

  it('makes nothing for an empty first note, and nothing for a day in the Trash or gone', () => {
    expect(callsheetNoteChange(recordsOf(day), 'd', 'notes', '')).toEqual([]);
    expect(callsheetNoteChange(recordsOf(record('d', 'shoot_day', 'p', {}, at)), 'd', 'notes', 'x')).toEqual([]);
    expect(callsheetNoteChange(recordsOf(day), 'nothing', 'notes', 'x')).toEqual([]);
  });

  it('only updates once the call sheet is there; an empty value unsets; an unchanged one is no change', () => {
    const records = recordsOf(day, record('cs', 'callsheet', 'd', { notes: 'a' }));
    expect(callsheetNoteChange(records, 'd', 'notes', 'b')).toEqual([{ kind: 'update', id: 'cs', set: { notes: 'b' } }]);
    expect(callsheetNoteChange(records, 'd', 'safety_notes', 'Hard hats')).toEqual([{ kind: 'update', id: 'cs', set: { safety_notes: 'Hard hats' } }]);
    expect(callsheetNoteChange(records, 'd', 'notes', '')).toEqual([{ kind: 'update', id: 'cs', unset: ['notes'] }]);
    expect(callsheetNoteChange(records, 'd', 'notes', 'a')).toEqual([]);
    expect(callsheetNoteChange(records, 'd', 'safety_notes', '')).toEqual([]);
  });

  it('makes a new call sheet after one in the Trash, with a key past it', () => {
    const records = recordsOf(day, record('old', 'callsheet', 'd', { notes: 'a' }, at, 'm'));
    const [change] = callsheetNoteChange(records, 'd', 'notes', 'b', 'new');
    expect(change).toMatchObject({ kind: 'create', record: { id: 'new' } });
    expect(change?.kind === 'create' && change.record.sortKey > 'm').toBe(true);
  });
});

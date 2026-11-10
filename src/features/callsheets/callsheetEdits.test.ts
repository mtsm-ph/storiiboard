import { describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from '../../core/model/record';
import { callsheetNoteChange, departmentCallChange, hmuMinutesChange, personTimeChange } from './callsheetEdits';

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

describe('the call sheet’s time edits (4.2)', () => {
  const day = record('d', 'shoot_day', 'p', { date: '2026-11-16' });

  it('make the call sheet with the first time, in one change list', () => {
    expect(departmentCallChange(recordsOf(day), 'd', 'camera', '06:30', 'cs')).toMatchObject([
      { kind: 'create', record: { id: 'cs', type: 'callsheet', parentId: 'd', props: { department_calls: { camera: '06:30' } } } },
    ]);
    expect(personTimeChange(recordsOf(day), 'd', 'ana', 'hmu_ready', '08:00', 'cs')).toMatchObject([
      { kind: 'create', record: { props: { person_times: { ana: { hmu_ready: '08:00' } } } } },
    ]);
  });

  it('make nothing for an empty first time, a time that is not one, or a day in the Trash or gone', () => {
    expect(departmentCallChange(recordsOf(day), 'd', 'camera', '')).toEqual([]);
    expect(departmentCallChange(recordsOf(day), 'd', 'camera', '6:30')).toEqual([]);
    expect(personTimeChange(recordsOf(day), 'd', 'ana', 'call', '25:00')).toEqual([]);
    expect(personTimeChange(recordsOf(record('d', 'shoot_day', 'p', {}, at)), 'd', 'ana', 'call', '09:00')).toEqual([]);
    expect(personTimeChange(recordsOf(day), 'nothing', 'ana', 'call', '09:00')).toEqual([]);
  });

  it('set a department’s call, keeping the others and what this version does not understand', () => {
    const records = recordsOf(day, record('cs', 'callsheet', 'd', { department_calls: { camera: '06:30', hmu: 'late', future: 5 } }));
    expect(departmentCallChange(records, 'd', 'sound', '07:30')).toEqual([
      { kind: 'update', id: 'cs', set: { department_calls: { camera: '06:30', hmu: 'late', future: 5, sound: '07:30' } } },
    ]);
    expect(departmentCallChange(records, 'd', 'camera', '06:00')).toEqual([
      { kind: 'update', id: 'cs', set: { department_calls: { hmu: 'late', future: 5, camera: '06:00' } } },
    ]);
    expect(departmentCallChange(records, 'd', 'camera', '06:30')).toEqual([]);
    expect(departmentCallChange(records, 'd', 'camera', '')).toEqual([
      { kind: 'update', id: 'cs', set: { department_calls: { hmu: 'late', future: 5 } } },
    ]);
  });

  it('take the prop off with its last key, and never write over a prop that is not an object', () => {
    const records = recordsOf(day, record('cs', 'callsheet', 'd', { department_calls: { camera: '06:30' } }));
    expect(departmentCallChange(records, 'd', 'camera', '')).toEqual([{ kind: 'update', id: 'cs', unset: ['department_calls'] }]);
    const odd = recordsOf(day, record('cs', 'callsheet', 'd', { department_calls: 'camera 6:30', person_times: [1] }));
    expect(departmentCallChange(odd, 'd', 'camera', '06:30')).toEqual([]);
    expect(personTimeChange(odd, 'd', 'ana', 'call', '09:00')).toEqual([]);
  });

  it('set a person’s time, keeping their other times, other people, and keys this version does not know', () => {
    const records = recordsOf(
      day,
      record('cs', 'callsheet', 'd', { person_times: { ana: { call: '09:00', wrap: '18:00' }, kev: { call: '06:00' }, odd: 'x' }, notes: 'Hi' }),
    );
    expect(personTimeChange(records, 'd', 'ana', 'on_set', '10:30')).toEqual([
      { kind: 'update', id: 'cs', set: { person_times: { kev: { call: '06:00' }, odd: 'x', ana: { call: '09:00', wrap: '18:00', on_set: '10:30' } } } },
    ]);
    expect(personTimeChange(records, 'd', 'ana', 'call', '09:00')).toEqual([]);
    // Someone new, and someone whose entry is not an object (left as it is).
    expect(personTimeChange(records, 'd', 'bo', 'call', '08:00')).toEqual([
      { kind: 'update', id: 'cs', set: { person_times: { ana: { call: '09:00', wrap: '18:00' }, kev: { call: '06:00' }, odd: 'x', bo: { call: '08:00' } } } },
    ]);
    expect(personTimeChange(records, 'd', 'odd', 'call', '08:00')).toEqual([]);
  });

  it('take a time off, then the person, then the prop, as each is left empty', () => {
    const records = recordsOf(day, record('cs', 'callsheet', 'd', { person_times: { ana: { call: '09:00', on_set: '10:30' }, kev: { call: '06:00', wrap: '18:00' } } }));
    expect(personTimeChange(records, 'd', 'ana', 'call', '')).toEqual([
      { kind: 'update', id: 'cs', set: { person_times: { kev: { call: '06:00', wrap: '18:00' }, ana: { on_set: '10:30' } } } },
    ]);
    // A person with an unknown key left keeps their entry; with nothing left, they go.
    expect(personTimeChange(records, 'd', 'kev', 'call', '')).toEqual([
      { kind: 'update', id: 'cs', set: { person_times: { ana: { call: '09:00', on_set: '10:30' }, kev: { wrap: '18:00' } } } },
    ]);
    const one = recordsOf(day, record('cs', 'callsheet', 'd', { person_times: { ana: { call: '09:00' } }, notes: 'Hi' }));
    expect(personTimeChange(one, 'd', 'ana', 'call', '')).toEqual([{ kind: 'update', id: 'cs', unset: ['person_times'] }]);
    expect(personTimeChange(one, 'd', 'ana', 'on_set', '')).toEqual([]);
  });
});

describe('the HMU minimum edit', () => {
  const project = record('p', 'project', null, {});

  it('sets hmu_minutes on the project in one change, and nothing when unchanged or out of range', () => {
    expect(hmuMinutesChange(recordsOf(project), 'p', 60)).toEqual([{ kind: 'update', id: 'p', set: { hmu_minutes: 60 } }]);
    expect(hmuMinutesChange(recordsOf(record('p', 'project', null, { hmu_minutes: 60 })), 'p', 60)).toEqual([]);
    expect(hmuMinutesChange(recordsOf(project), 'p', 0)).toHaveLength(1);
    expect(hmuMinutesChange(recordsOf(project), 'p', 601)).toEqual([]);
    expect(hmuMinutesChange(recordsOf(project), 'p', -1)).toEqual([]);
    expect(hmuMinutesChange(recordsOf(project), 'p', 20.5)).toEqual([]);
    expect(hmuMinutesChange(recordsOf(), 'p', 30)).toEqual([]);
  });
});

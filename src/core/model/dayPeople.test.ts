import { describe, expect, it } from 'vitest';
import { dayPeopleAdd, dayPeopleAddEveryone, dayPeopleChoose, dayPeopleRemove, newDay } from '../../features/schedule/dayEdits';
import type { Props, SbdRecord } from './record';
import { dayCrew, dayPeople, dayPeopleChosen, dayPeopleIds } from './schedule';

// Who is on a shoot day (4.2): `people_ids` on the day, read and edited. A day without the prop is everyone live.

const at = '2026-11-10T10:00:00.000Z';
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
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));

const people = () => [
  record('ana', 'person', 'p', { name: 'Ana Ruiz' }),
  record('bo', 'person', 'p', { name: 'Bo Diaz' }),
  record('cy', 'person', 'p', { name: 'Cy Lee' }),
  record('gone', 'person', 'p', { name: 'Gone' }, at),
];
const withDay = (props: Props, trashedAt: string | null = null) => recordsOf(record('p', 'project', null, {}), ...people(), record('d', 'shoot_day', 'p', props, trashedAt));
const names = (records: Record<string, SbdRecord>, day = 'd') => dayPeople(records, 'p', records[day] as SbdRecord).map((p) => p.fields.name);

describe('the people on a day', () => {
  it('are everyone live in Cast and crew while the prop is missing, and nobody for an empty list', () => {
    expect(names(withDay({}))).toEqual(['Ana Ruiz', 'Bo Diaz', 'Cy Lee']);
    expect(names(withDay({ people_ids: [] }))).toEqual([]);
    expect(dayPeopleChosen(withDay({}).d as SbdRecord)).toBe(false);
    expect(dayPeopleChosen(withDay({ people_ids: [] }).d as SbdRecord)).toBe(true);
  });

  it('keep the order they were added in and skip people in the Trash, gone or from elsewhere', () => {
    const records = withDay({ people_ids: ['cy', 'gone', 'nobody', 'ana'] });
    expect(names(records)).toEqual(['Cy Lee', 'Ana Ruiz']);
    // The ids stay in the list for a restore to bring back.
    expect(dayPeopleIds(records.d?.props ?? {})).toEqual(['cy', 'gone', 'nobody', 'ana']);
    const other = { ...records, ana: record('ana', 'person', 'other', { name: 'Ana Ruiz' }) };
    expect(names(other)).toEqual(['Cy Lee']);
  });

  it('read an odd value as the prop missing, and a repeated id once', () => {
    expect(names(withDay({ people_ids: 'ana' }))).toEqual(['Ana Ruiz', 'Bo Diaz', 'Cy Lee']);
    expect(names(withDay({ people_ids: ['ana', 7] }))).toEqual(['Ana Ruiz', 'Bo Diaz', 'Cy Lee']);
    expect(names(withDay({ people_ids: ['bo', 'bo', 'ana'] }))).toEqual(['Bo Diaz', 'Ana Ruiz']);
  });

  it('are who the day’s crew count and the confirmed count read', () => {
    const records = withDay({ people_ids: ['ana', 'bo'], crew: { ana: 'confirmed', cy: 'confirmed' } });
    expect(dayCrew(records, 'p', records.d as SbdRecord)).toEqual({ people: 2, confirmed: 1 });
    const unchosen = withDay({ crew: { ana: 'confirmed', cy: 'confirmed' } });
    expect(dayCrew(unchosen, 'p', unchosen.d as SbdRecord)).toEqual({ people: 3, confirmed: 2 });
    const nobody = withDay({ people_ids: [], crew: { ana: 'confirmed' } });
    expect(dayCrew(nobody, 'p', nobody.d as SbdRecord)).toEqual({ people: 0, confirmed: 0 });
  });
});

describe('the edits to who is on a day', () => {
  it('start a new day with nobody', () => {
    expect(newDay(recordsOf(record('p', 'project', null, {})), 'p', '2026-11-16', 'n').record.props).toEqual({ date: '2026-11-16', people_ids: [] });
  });

  it('add a person after those there, once', () => {
    const records = withDay({ people_ids: ['cy'] });
    expect(dayPeopleAdd(records, 'd', 'ana')).toEqual([{ kind: 'update', id: 'd', set: { people_ids: ['cy', 'ana'] } }]);
    expect(dayPeopleAdd(records, 'd', 'cy')).toEqual([]);
    // Not someone in the Trash, gone, or not a person.
    expect(dayPeopleAdd(records, 'd', 'gone')).toEqual([]);
    expect(dayPeopleAdd(records, 'd', 'nobody')).toEqual([]);
    expect(dayPeopleAdd(records, 'd', 'p')).toEqual([]);
  });

  it('write the stored list as it was, adding only the new id and taking off every copy of the one removed', () => {
    const records = withDay({ people_ids: ['bo', 'bo', 'ana'] });
    expect(dayPeopleAdd(records, 'd', 'cy')).toEqual([{ kind: 'update', id: 'd', set: { people_ids: ['bo', 'bo', 'ana', 'cy'] } }]);
    expect(dayPeopleRemove(records, 'd', 'bo')).toEqual([{ kind: 'update', id: 'd', set: { people_ids: ['ana'] } }]);
    expect(dayPeopleAddEveryone(records, 'p', 'd')).toEqual([{ kind: 'update', id: 'd', set: { people_ids: ['bo', 'bo', 'ana', 'cy'] } }]);
  });

  it('take a person off, leaving their confirmation, their times and ids that are not live', () => {
    const records = withDay({ people_ids: ['cy', 'gone', 'ana'], crew: { ana: 'confirmed' } });
    const [change] = dayPeopleRemove(records, 'd', 'ana');
    expect(change).toEqual({ kind: 'update', id: 'd', set: { people_ids: ['cy', 'gone'] } });
    expect(JSON.stringify(change)).not.toContain('crew');
    expect(dayPeopleRemove(records, 'd', 'bo')).toEqual([]);
  });

  it('add everyone in Cast and crew’s order, only those missing, after those already there', () => {
    const records = withDay({ people_ids: ['cy'] });
    expect(dayPeopleAddEveryone(records, 'p', 'd')).toEqual([{ kind: 'update', id: 'd', set: { people_ids: ['cy', 'ana', 'bo'] } }]);
    const all = withDay({ people_ids: ['cy', 'ana', 'bo', 'gone'] });
    expect(dayPeopleAddEveryone(all, 'p', 'd')).toEqual([]);
  });

  it('choose who is on a day made before, as everyone live now in one edit', () => {
    const records = withDay({});
    expect(dayPeopleChoose(records, 'p', 'd')).toEqual([{ kind: 'update', id: 'd', set: { people_ids: ['ana', 'bo', 'cy'] } }]);
    // Only for a day with no list: a chosen one, even an empty one, is left to Add everyone.
    expect(dayPeopleChoose(withDay({ people_ids: [] }), 'p', 'd')).toEqual([]);
    // Adding or taking off on a day nobody chose for changes nothing.
    expect(dayPeopleAdd(records, 'd', 'ana')).toEqual([]);
    expect(dayPeopleRemove(records, 'd', 'ana')).toEqual([]);
  });

  it('refuse a day whose prop is odd, and a day in the Trash or gone', () => {
    const odd = withDay({ people_ids: 'ana' });
    expect(dayPeopleAdd(odd, 'd', 'ana')).toEqual([]);
    expect(dayPeopleRemove(odd, 'd', 'ana')).toEqual([]);
    expect(dayPeopleAddEveryone(odd, 'p', 'd')).toEqual([]);
    expect(dayPeopleChoose(odd, 'p', 'd')).toEqual([]);
    const trashed = withDay({ people_ids: [] }, at);
    expect(dayPeopleAdd(trashed, 'd', 'ana')).toEqual([]);
    expect(dayPeopleAddEveryone(trashed, 'p', 'd')).toEqual([]);
    expect(dayPeopleRemove(withDay({ people_ids: ['ana'] }, at), 'd', 'ana')).toEqual([]);
    expect(dayPeopleChoose(withDay({}, at), 'p', 'd')).toEqual([]);
    expect(dayPeopleAdd(withDay({ people_ids: [] }), 'nothing', 'ana')).toEqual([]);
  });
});

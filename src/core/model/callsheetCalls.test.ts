import { describe, expect, it } from 'vitest';
import { callSheet, departmentCalls, personCall, personTimesOf } from './callsheet';
import { contactOnSheet, personFields } from './person';
import type { Props, SbdRecord } from './record';

// Who is called when, and whose contact prints (4.2): calls on the `callsheet` record, contacts by the person's prop.

const at = '2026-11-10T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));

const project = (day: Props, sheet: Props | null, ...more: SbdRecord[]) =>
  recordsOf(
    record('p', 'project', null, { title: 'Bey County' }),
    record('d', 'shoot_day', 'p', day),
    ...(sheet ? [record('cs', 'callsheet', 'd', sheet)] : []),
    record('mary', 'character', 'p', { name: 'MARY', cast_id: 'ana' }),
    record('kid', 'character', 'p', { name: 'KID', cast_id: 'zed' }),
    record('s1', 'scene', 'p', { number: '1', character_ids: ['mary', 'kid'] }),
    record('a', 'shot', 's1', { number: '1A', shoot_day_id: 'd' }),
    record('ana', 'person', 'p', { name: 'Ana Ruiz', role: 'cast', departments: ['cast'], phone: '555 0101', email: 'ana@example.com' }),
    record('zed', 'person', 'p', { name: 'Zed Extra', role: 'cast', departments: ['cast'] }),
    record('kev', 'person', 'p', { name: 'Kevin Matos', role: 'dp', departments: ['camera', 'grip-electric'], phone: '555 0102', email: 'kev@example.com' }),
    record('sam', 'person', 'p', { name: 'Sam Ortiz', role: 'producer', phone: '555 0103' }),
    ...more,
  );

const everyone = ['ana', 'zed', 'kev', 'sam'];

describe('a person’s call on the sheet', () => {
  it('is their own, else the earliest override among their departments, else the day’s crew call, else none', () => {
    const calls = new Map([['camera', '06:30'], ['grip-electric', '06:00']]);
    expect(personCall('08:15', ['camera'], calls, '07:00')).toBe('08:15');
    expect(personCall('', ['camera', 'grip-electric'], calls, '07:00')).toBe('06:00');
    expect(personCall('', ['sound'], calls, '07:00')).toBe('07:00');
    expect(personCall('', [], calls, '')).toBe('');
  });

  it('reads department calls and person times, odd values as unset', () => {
    const props = { department_calls: { camera: '06:30', sound: 'late', hmu: 5 }, person_times: { ana: { call: '09:00', hmu_ready: 'x', on_set: '11:15' }, kev: 'odd' } };
    expect([...departmentCalls(props)]).toEqual([['camera', '06:30']]);
    expect(personTimesOf(props, 'ana')).toEqual({ call: '09:00', hmuReady: '', onSet: '11:15' });
    expect(personTimesOf(props, 'kev')).toEqual({ call: '', hmuReady: '', onSet: '' });
    expect(personTimesOf(undefined, 'ana')).toEqual({ call: '', hmuReady: '', onSet: '' });
    expect([...departmentCalls({ department_calls: [1] })]).toEqual([]);
  });

  it('shows on the sheet: a department’s call (override or the day’s), each person’s, and a cast member’s three times', () => {
    const records = project(
      { date: '2026-11-16', call_time: '07:00', people_ids: everyone },
      { department_calls: { camera: '06:30' }, person_times: { sam: { call: '08:00' }, ana: { call: '09:00', hmu_ready: '08:00', on_set: '10:30' } } },
    );
    const sheet = callSheet(records, 'p', 'd');
    expect(sheet?.crew.map((g) => [g.department, g.call, g.people.map((p) => [p.fields.name, p.call])])).toEqual([
      ['camera', '06:30', [['Kevin Matos', '06:30']]],
      ['grip-electric', '07:00', [['Kevin Matos', '06:30']]],
      [null, null, [['Sam Ortiz', '08:00']]],
    ]);
    expect(sheet?.cast.map((c) => [c.person.fields.name, c.times])).toEqual([
      ['Ana Ruiz', { call: '09:00', hmuReady: '08:00', onSet: '10:30' }],
      ['Zed Extra', { call: '07:00', hmuReady: '', onSet: '' }],
    ]);
  });

  it('has no call at all when neither the day nor anything on the sheet sets one', () => {
    const sheet = callSheet(project({ date: '2026-11-16', people_ids: everyone }, null), 'p', 'd');
    expect(sheet?.crew.flatMap((g) => g.people.map((p) => p.call))).toEqual(['', '', '']);
  });
});

describe('who is on the sheet', () => {
  it('lists only the people on the day, and an actor not on it is marked beside their character', () => {
    const sheet = callSheet(project({ date: '2026-11-16', people_ids: ['ana', 'sam'] }, null), 'p', 'd');
    expect(sheet?.peopleChosen).toBe(true);
    expect(sheet?.people.map((p) => p.fields.name)).toEqual(['Ana Ruiz', 'Sam Ortiz']);
    expect(sheet?.notOnDay.map((p) => p.fields.name)).toEqual(['Kevin Matos', 'Zed Extra']);
    expect(sheet?.crew.flatMap((g) => g.people.map((p) => p.fields.name))).toEqual(['Sam Ortiz']);
    expect(sheet?.cast.map((c) => c.person.fields.name)).toEqual(['Ana Ruiz']);
    expect(sheet?.scenes[0]?.characters.map((c) => [c.name, c.onDay])).toEqual([['MARY', true], ['KID', false]]);
  });

  it('lists a cast member on the day whose characters are not in its scenes, with no character', () => {
    const records = project({ date: '2026-11-16', people_ids: ['ana', 'late'] }, null, record('late', 'person', 'p', { name: 'Lee Late', role: 'cast', departments: ['cast'] }));
    const sheet = callSheet(records, 'p', 'd');
    expect(sheet?.cast.map((c) => [c.person.fields.name, c.characters])).toEqual([['Ana Ruiz', ['MARY']], ['Lee Late', []]]);
  });

  it('says nobody on a new day, and reads everyone for a day made before, marking nobody', () => {
    const none = callSheet(project({ date: '2026-11-16', people_ids: [] }, null), 'p', 'd');
    expect([none?.people, none?.cast, none?.crew]).toEqual([[], [], []]);
    expect(none?.scenes[0]?.characters.map((c) => c.onDay)).toEqual([false, false]);
    const old = callSheet(project({ date: '2026-11-16' }, null), 'p', 'd');
    expect(old?.peopleChosen).toBe(false);
    expect(old?.people).toHaveLength(4);
    expect(old?.notOnDay).toEqual([]);
    expect(old?.scenes[0]?.characters.map((c) => c.onDay)).toEqual([true, true]);
    // The sheet of a day made before keeps its 4.1 cast: only those playing in its scenes.
    expect(old?.cast.map((c) => c.person.fields.name)).toEqual(['Ana Ruiz', 'Zed Extra']);
  });
});

describe('phone and email on the sheet', () => {
  it('default to on for crew and off for cast, and follow what is set on the person either way', () => {
    expect(contactOnSheet(personFields({ role: 'producer' }))).toBe(true);
    expect(contactOnSheet(personFields({ role: 'cast', departments: ['cast'] }))).toBe(false);
    expect(contactOnSheet(personFields({ role: 'cast' }))).toBe(false);
    expect(contactOnSheet(personFields({ departments: ['cast', 'camera'] }))).toBe(true);
    expect(contactOnSheet(personFields({ departments: ['cast'], contact_on_sheet: true }))).toBe(true);
    expect(contactOnSheet(personFields({ departments: ['camera'], contact_on_sheet: false }))).toBe(false);
    // Odd values are the default.
    expect(contactOnSheet(personFields({ departments: ['cast'], contact_on_sheet: 'yes' }))).toBe(false);
  });

  it('leave a contact out of the sheet when it is off, and print it when it is on', () => {
    const sheet = callSheet(project({ date: '2026-11-16', people_ids: everyone }, null), 'p', 'd');
    expect(sheet?.cast.map((c) => c.contact)).toEqual([null, null]);
    expect(sheet?.crew[0]?.people[0]?.contact).toEqual({ phone: '555 0102', email: 'kev@example.com' });
    const on = project({ date: '2026-11-16', people_ids: everyone }, null);
    const flipped = callSheet({ ...on, ana: record('ana', 'person', 'p', { name: 'Ana Ruiz', role: 'cast', departments: ['cast'], phone: '555 0101', contact_on_sheet: true }), kev: record('kev', 'person', 'p', { name: 'Kevin Matos', departments: ['camera'], phone: '555 0102', contact_on_sheet: false }) }, 'p', 'd');
    expect(flipped?.cast[0]?.contact).toEqual({ phone: '555 0101', email: '' });
    expect(flipped?.crew[0]?.people[0]?.contact).toBeNull();
    // Nobody off the day has a contact on the sheet at all.
    const off = callSheet(project({ date: '2026-11-16', people_ids: ['ana'] }, null), 'p', 'd');
    expect(JSON.stringify([off?.crew, off?.cast])).not.toContain('555 0102');
  });
});

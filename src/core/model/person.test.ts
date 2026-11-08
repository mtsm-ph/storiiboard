import { describe, expect, it } from 'vitest';
import { newPerson, personChange, personDepartment, personRole, trashPerson } from '../../features/people/personEdits';
import { personFields, projectPeople } from './person';
import type { SbdRecord } from './record';

// Cast and crew (3.5): people read from their records, listed by name, and changed one field at a time; their phone
// and email never shown in History.

const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: SbdRecord['props'], trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: id,
  props,
  trashedAt,
  trashedBy: null,
  createdAt: '2026-11-07T12:00:00.000Z',
  updatedAt: '2026-11-07T12:00:00.000Z',
});

const records = () => ({
  p: record('p', 'project', null, {}),
  a: record('a', 'person', 'p', { name: 'Kevin Matos', role: 'dp', departments: ['grip-electric', 'camera'] }),
  b: record('b', 'person', 'p', { name: 'Ana Ruiz', role: 'hmu?', departments: ['hmu', 'nope'] }),
  c: record('c', 'person', 'p', { name: '' }),
  d: record('d', 'person', 'p', { name: 'Gone' }, '2026-11-07T12:00:00.000Z'),
});

describe('cast and crew (3.5)', () => {
  it('reads a person: departments in the call sheet’s order, odd ones and an odd role left out', () => {
    expect(personFields(records().a.props)).toMatchObject({ name: 'Kevin Matos', role: 'dp', departments: ['camera', 'grip-electric'] });
    expect(personFields(records().b.props)).toMatchObject({ role: null, departments: ['hmu'] });
  });

  it('lists the live people by name, an unnamed one last', () => {
    expect(projectPeople(records(), 'p').map((p) => p.record.id)).toEqual(['b', 'a', 'c']);
  });

  it('makes, changes and trashes a person, one edit each, nothing when nothing changes', () => {
    const made = newPerson(records(), 'p', 'n');
    expect(made.record).toMatchObject({ id: 'n', type: 'person', parentId: 'p', props: { name: '' } });
    // After every other person, the trashed one too.
    expect(made.record.sortKey > 'd').toBe(true);
    expect(personChange(records(), 'a', 'title', '1st AC')).toEqual([{ kind: 'update', id: 'a', set: { title: '1st AC' } }]);
    expect(personChange(records(), 'a', 'name', 'Kevin Matos')).toEqual([]);
    expect(personChange(records(), 'd', 'name', 'Back')).toEqual([]);
    expect(personRole(records(), 'a', 'director')).toEqual([{ kind: 'update', id: 'a', set: { role: 'director' } }]);
    expect(personRole(records(), 'a', 'dp')).toEqual([]);
    expect(personRole(records(), 'a', null)).toEqual([{ kind: 'update', id: 'a', unset: ['role'] }]);
    expect(personRole(records(), 'a', 'astronaut')).toEqual([]);
    expect(personDepartment(records(), 'a', 'direction', true)).toEqual([{ kind: 'update', id: 'a', set: { departments: ['direction', 'camera', 'grip-electric'] } }]);
    expect(personDepartment(records(), 'a', 'camera', false)).toEqual([{ kind: 'update', id: 'a', set: { departments: ['grip-electric'] } }]);
    expect(personDepartment(records(), 'a', 'camera', true)).toEqual([]);
    expect(trashPerson(records(), 'a')).toEqual([{ kind: 'trash', id: 'a' }]);
    expect(trashPerson(records(), 'd')).toEqual([]);
  });

  it('lists a trashed person in the Trash by name and restores them', async () => {
    const { restoreChanges, trashItems } = await import('../../features/trash/trash');
    expect(trashItems(records(), 'p').find((i) => i.id === 'd')).toMatchObject({ kind: 'person', name: 'Gone' });
    expect(restoreChanges(records(), 'p', 'd')).toEqual([{ kind: 'restore', id: 'd' }]);
  });

  it('History names the role and departments in words, never a phone or email', async () => {
    const { changeLabel, changeValue, fieldChanges, describeEdit, lineText } = await import('../../features/history/summary');
    const before = record('a', 'person', 'p', { name: 'Kevin Matos', phone: '' });
    const after = record('a', 'person', 'p', { name: 'Kevin Matos', phone: '+1 212 555 0100', email: 'kevin@example.com', role: 'dp', departments: ['camera'] });
    const lines = fieldChanges(before, after).map((c) => `${changeLabel(c)}: ${changeValue(c, c.before)} → ${changeValue(c, c.after)}`);
    expect(lines.join(' | ')).not.toMatch(/555|example\.com/);
    expect(lines).toContain('phone: — → not shown');
    expect(lines).toContain('role: — → Director of photography');
    expect(lines).toContain('departments: — → Camera');
    const made = describeEdit(
      [{ id: 'o', seq: 1, groupId: 'g', groupKind: 'edit', recordId: 'a', kind: 'create', before: null, after: before, author: 'Kevin', timestamp: '2026-11-07T12:00:00.000Z' }],
      new Set(),
    );
    expect(lineText(made)).toBe('Added Kevin Matos to cast and crew');
  });

  it('History says a person’s phone, notes and own fields only as set or changed, in the step’s line too', async () => {
    const { describeEdit, fieldChanges, changeValue, lineText } = await import('../../features/history/summary');
    const before = record('a', 'person', 'p', { name: 'Kevin Matos', notes: '', custom: { Agent: '' } });
    const after = record('a', 'person', 'p', { name: 'Kevin Matos', notes: 'Allergic to latex', custom: { Agent: '+1 212 555 0199' } });
    const values = fieldChanges(before, after).map((c) => changeValue(c, c.after));
    expect(values.join(' | ')).not.toMatch(/latex|555/);
    const step = (b: SbdRecord, a: SbdRecord) =>
      lineText(describeEdit([{ id: 'o', seq: 1, groupId: 'g', groupKind: 'edit', recordId: 'a', kind: 'update', before: b, after: a, author: 'Kevin', timestamp: '2026-11-07T12:00:00.000Z' }], new Set()));
    const phoned = record('a', 'person', 'p', { name: 'Kevin Matos', phone: '+1 212 555 0100' });
    expect(step(record('a', 'person', 'p', { name: 'Kevin Matos' }), phoned)).not.toMatch(/555/);
    expect(step(record('a', 'person', 'p', { name: 'Kevin Matos', notes: 'a' }), record('a', 'person', 'p', { name: 'Kevin Matos', notes: 'Allergic to latex' }))).not.toMatch(/latex/);
    // A frame's notes still read as written.
    expect(step(record('a', 'shot', 'sc1', { notes: 'a' }), record('a', 'shot', 'sc1', { notes: 'Dolly in' }))).toMatch(/Dolly in/);
  });

  it('keeps department ids this version doesn’t know, and never writes over a field that isn’t text', () => {
    const all = { ...records(), e: record('e', 'person', 'p', { name: 'Lou', departments: ['camera', 'vfx'], title: { long: 'x' } }) };
    expect(personDepartment(all, 'e', 'sound', true)).toEqual([{ kind: 'update', id: 'e', set: { departments: ['camera', 'sound', 'vfx'] } }]);
    expect(personChange(all, 'e', 'title', '2nd AC')).toEqual([]);
  });

  it('a person’s own fields: their labels are reserved, a frame’s aren’t', async () => {
    const { fieldName } = await import('./customFields');
    expect(fieldName('Phone', [], [], 'person')).toMatchObject({ ok: false });
    expect(fieldName('Title', [], [], 'person')).toMatchObject({ ok: false });
    expect(fieldName('Lens', [], [], 'person')).toEqual({ ok: true, name: 'Lens' });
    expect(fieldName('Agent', [], [], 'person')).toEqual({ ok: true, name: 'Agent' });
  });
});

describe('characters cast, and the team by department (3.5b)', () => {
  const cast = () => ({
    ...records(),
    joe: record('joe', 'character', 'p', { name: 'JOE', cast_id: 'a' }),
    mae: record('mae', 'character', 'p', { name: 'MAE', cast_id: 'd' }),
    ned: record('ned', 'character', 'p', { name: 'NED' }),
    gone: record('gone', 'character', 'p', { name: 'GONE' }, '2026-11-07T12:00:00.000Z'),
  });

  it('reads who plays each character; a cast member in the Trash reads as none', async () => {
    const { castOf, charactersPlayedBy, projectCharacters } = await import('./person');
    const all = cast();
    expect(projectCharacters(all, 'p').map((c) => c.id)).toEqual(['joe', 'mae', 'ned']);
    expect(castOf(all, all.joe)?.id).toBe('a');
    expect(castOf(all, all.mae)).toBeNull();
    expect(charactersPlayedBy(all, 'p', 'a').map((c) => c.id)).toEqual(['joe']);
  });

  it('casts a character, one edit; casting another moves it; nothing when it’s already so or isn’t live', async () => {
    const { castCharacter } = await import('../../features/people/personEdits');
    const all = cast();
    expect(castCharacter(all, 'ned', 'b')).toEqual([{ kind: 'update', id: 'ned', set: { cast_id: 'b' } }]);
    expect(castCharacter(all, 'joe', 'b')).toEqual([{ kind: 'update', id: 'joe', set: { cast_id: 'b' } }]);
    expect(castCharacter(all, 'joe', null)).toEqual([{ kind: 'update', id: 'joe', unset: ['cast_id'] }]);
    expect(castCharacter(all, 'joe', 'a')).toEqual([]);
    expect(castCharacter(all, 'ned', 'd')).toEqual([]);
    expect(castCharacter(all, 'gone', 'a')).toEqual([]);
    expect(castCharacter(all, 'a', 'b')).toEqual([]);
  });

  it('groups the team by department in the call sheet’s order, someone in two in both, none last', async () => {
    const { peopleByDepartment } = await import('./person');
    const groups = peopleByDepartment(projectPeople(records(), 'p'));
    expect(groups.map((g) => [g.department, g.people.map((p) => p.record.id)])).toEqual([
      ['camera', ['a']],
      ['grip-electric', ['a']],
      ['hmu', ['b']],
      [null, ['c']],
    ]);
  });

  it('History names the person cast, as the step left them, never their id', async () => {
    const { describeEdit, lineText } = await import('../../features/history/summary');
    const before = record('ned', 'character', 'p', { name: 'NED' });
    const after = record('ned', 'character', 'p', { name: 'NED', cast_id: 'a' });
    const step = describeEdit(
      [{ id: 'o', seq: 1, groupId: 'g', groupKind: 'edit', recordId: 'ned', kind: 'update', before, after, author: 'Kevin', timestamp: '2026-11-07T12:00:00.000Z' }],
      new Set(),
      new Map([['a', records().a]]),
    );
    expect(lineText(step)).toMatch(/NED.*cast.*Kevin Matos/);
    expect(lineText(step)).not.toContain('a →');
  });
});

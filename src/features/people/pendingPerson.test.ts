import { describe, expect, it } from 'vitest';
import { personFields, projectPeople } from '../../core/model/person';
import type { Props, SbdRecord } from '../../core/model/record';
import { newPerson, pendingIn, withPendingPerson } from './personEdits';

// The person "+ New person" is making, listed while its save is on its way so its name field has focus at once (Kevin,
// Nov 20), and left out once the record with its id is there.

const at = '2026-11-20T10:00:00.000Z';
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
const project = record('p', 'project', null, { name: 'Bey County' });

describe('withPendingPerson', () => {
  it('lists the people as they are when nothing is being made', () => {
    const records = recordsOf(project, record('a', 'person', 'p', { name: 'Ana' }));
    const people = projectPeople(records, 'p');
    expect(withPendingPerson(people, records, 'p', null)).toEqual(people);
  });

  it('adds the one being made last, unnamed, with its id and the key the create gives it', () => {
    const records = recordsOf(project, record('a', 'person', 'p', { name: 'Ana' }, 'a0'));
    const listed = withPendingPerson(projectPeople(records, 'p'), records, 'p', 'new');
    expect(listed.map((p) => p.record.id)).toEqual(['a', 'new']);
    const [, made] = listed;
    expect(made?.record).toMatchObject({ id: 'new', type: 'person', parentId: 'p', trashedAt: null, sortKey: newPerson(records, 'p', 'new').record.sortKey });
    expect(made?.fields).toEqual(personFields({ name: '' }));
  });

  it('leaves it out once its record is there, live or trashed, so the real one takes its place', () => {
    const live = recordsOf(project, record('new', 'person', 'p', { name: '' }));
    expect(withPendingPerson(projectPeople(live, 'p'), live, 'p', 'new').map((p) => p.record.id)).toEqual(['new']);
    const trashed = recordsOf(project, { ...record('new', 'person', 'p', { name: '' }), trashedAt: at, trashedBy: 'local' });
    expect(withPendingPerson(projectPeople(trashed, 'p'), trashed, 'p', 'new')).toEqual([]);
  });

  it('never changes the list it was given', () => {
    const records = recordsOf(project);
    const people = projectPeople(records, 'p');
    withPendingPerson(people, records, 'p', 'new');
    expect(people).toEqual([]);
  });
});

describe('pendingIn', () => {
  // Projects as the store holds them: one object per opening, so a copy of the same project is another one.
  const first = { name: 'Bey County' };
  const second = { name: 'Harbour Lights' };
  const reopened = { name: 'Bey County' };

  it('gives the id being made in the project open now', () => {
    expect(pendingIn({ id: 'new', project: first }, first)).toBe('new');
  });

  it('gives none in a project switched to while the create is on its way, even another opening of the same one', () => {
    expect(pendingIn({ id: 'new', project: first }, second)).toBeNull();
    expect(pendingIn({ id: 'new', project: first }, reopened)).toBeNull();
  });

  it('gives none when nothing is being made, or no project is open', () => {
    expect(pendingIn(null, first)).toBeNull();
    expect(pendingIn({ id: 'new', project: first }, null)).toBeNull();
  });
});

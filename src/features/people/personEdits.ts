import { DEPARTMENTS, type Department } from '../../core/model/department';
import type { SbdRecord } from '../../core/model/record';
import { isRole } from '../../core/model/role';
import { keyBetween } from '../../core/ops/order';
import type { Change } from '../../core/ops/ops';
import { personDepartments } from '../../core/model/person';

// The edits the Cast & crew tile makes (3.5): a new person, one field changed, a department on or off, one sent to the
// Trash. Each is one op group, so one ⌘Z, built from the person as they are at the edit's turn.

type Records = Readonly<Record<string, SbdRecord>>;

const live = (records: Records, id: string): SbdRecord | null => {
  const person = records[id];
  return person?.type === 'person' && person.trashedAt === null ? person : null;
};

/** A new, empty person after the project's others (in the Trash too, so a restored one never shares a key). */
export function newPerson(records: Records, projectId: string, id: string = crypto.randomUUID()): Extract<Change, { kind: 'create' }> {
  const last = Object.values(records)
    .filter((r) => r.type === 'person' && r.parentId === projectId)
    .reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);
  return { kind: 'create', record: { id, type: 'person', parentId: projectId, sortKey: keyBetween(last, null), props: { name: '' } } };
}

/** One text field of a person; nothing when it's already that, or they're gone. */
export function personChange(records: Records, id: string, prop: string, value: string): Change[] {
  const person = live(records, id);
  if (!person) return [];
  const stored = person.props[prop];
  // Something other than text there (a later version's, or a hand edit) is never written over from here.
  if (stored !== undefined && stored !== null && typeof stored !== 'string') return [];
  return (stored ?? '') === value ? [] : [{ kind: 'update', id, set: { [prop]: value } }];
}

/** Their main role, or none; nothing when it's already that. */
export function personRole(records: Records, id: string, role: string | null): Change[] {
  const person = live(records, id);
  if (!person || (role !== null && !isRole(role))) return [];
  const current = isRole(person.props.role) ? person.props.role : null;
  if (current === role) return [];
  return role === null ? [{ kind: 'update', id, unset: ['role'] }] : [{ kind: 'update', id, set: { role } }];
}

/** A department on or off, kept in the call sheet's order; nothing when it's already so. */
export function personDepartment(records: Records, id: string, department: Department, on: boolean): Change[] {
  const person = live(records, id);
  if (!person) return [];
  const current = personDepartments(person.props.departments);
  if (current.includes(department) === on) return [];
  const known = DEPARTMENTS.filter((d) => (d === department ? on : current.includes(d)));
  // Ids this version doesn't know (a later version's departments) stay as they are, after the known ones.
  const stored = Array.isArray(person.props.departments) ? person.props.departments : [];
  const unknown = stored.filter((d) => !(typeof d === 'string' && (DEPARTMENTS as readonly string[]).includes(d)));
  return [{ kind: 'update', id, set: { departments: [...known, ...unknown] } }];
}

/** Full view on or off (3.6c), set on the person from then on, whatever their role; nothing when it's already so. */
export function personFullViewChange(records: Records, id: string, on: boolean): Change[] {
  const person = live(records, id);
  if (!person || person.props.full_view === on) return [];
  return [{ kind: 'update', id, set: { full_view: on } }];
}

/**
 * Whether their phone and email print on call sheets (4.2), set on the person from then on; the default (off for cast,
 * on for crew) is only what's shown until it is. Nothing when it's already so.
 */
export function personContactOnSheetChange(records: Records, id: string, on: boolean): Change[] {
  const person = live(records, id);
  if (!person || person.props.contact_on_sheet === on) return [];
  return [{ kind: 'update', id, set: { contact_on_sheet: on } }];
}

/** A person to the Trash. */
export function trashPerson(records: Records, id: string): Change[] {
  return live(records, id) ? [{ kind: 'trash', id }] : [];
}

/**
 * A character cast (3.5b): played by this person, or by no one. One cast member per character, so casting someone
 * else moves it. Nothing when it's already so, or either isn't live.
 */
export function castCharacter(records: Records, characterId: string, personId: string | null, from?: string): Change[] {
  const character = records[characterId];
  if (character?.type !== 'character' || character.trashedAt !== null) return [];
  if (personId !== null && !live(records, personId)) return [];
  const current = typeof character.props.cast_id === 'string' ? character.props.cast_id : null;
  if (current === personId) return [];
  // Uncasting `from`: only while they still play it, so a press made before another edit landed never takes the part
  // from whoever has it now.
  if (personId === null && from !== undefined && current !== from) return [];
  return personId === null ? [{ kind: 'update', id: characterId, unset: ['cast_id'] }] : [{ kind: 'update', id: characterId, set: { cast_id: personId } }];
}

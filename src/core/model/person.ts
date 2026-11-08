import { DEPARTMENTS, type Department } from './department';
import type { JsonValue, Props, SbdRecord } from './record';
import { isRole, type Role } from './role';

// A person on the production (3.5): cast or crew, named once and, from 3.7 on, called on shoot days and listed on call
// sheets. Several departments (a DP is camera and grip and electric) and one main role from the app's list of 14, plus
// a free-text title for the call sheet ("2nd AC", "Best boy") (docs/PHASE3_DECISIONS.md 3). Their phone and email
// are private, as every contact is: shown where the person asks, never logged, never named in History.

/** The text fields a person's editor shows after the name, in its order: each is a prop of the same name. */
export const PERSON_TEXT_FIELDS = ['title', 'phone', 'email', 'notes'] as const;
export type PersonTextField = (typeof PERSON_TEXT_FIELDS)[number];

export interface PersonFields {
  name: string;
  /** Null until one is picked; an odd value reads as none. */
  role: Role | null;
  /** In the call sheet's order, whatever order they were picked in; unknown ids are left out. */
  departments: Department[];
  title: string;
  phone: string;
  email: string;
  notes: string;
}

const text = (value: JsonValue | undefined): string => (typeof value === 'string' ? value : '');

export function personDepartments(value: JsonValue | undefined): Department[] {
  const picked = new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  return DEPARTMENTS.filter((d) => picked.has(d));
}

export function personFields(props: Props): PersonFields {
  return {
    name: text(props.name),
    role: isRole(props.role) ? props.role : null,
    departments: personDepartments(props.departments),
    title: text(props.title),
    phone: text(props.phone),
    email: text(props.email),
    notes: text(props.notes),
  };
}

/** The live people in the project, by name (an unnamed one last). */
export function projectPeople(records: Readonly<Record<string, SbdRecord>>, projectId: string): { record: SbdRecord; fields: PersonFields }[] {
  return Object.values(records)
    .filter((r) => r.type === 'person' && r.parentId === projectId && r.trashedAt === null)
    .map((record) => ({ record, fields: personFields(record.props) }))
    .sort((a, b) => (a.fields.name === '' ? 1 : b.fields.name === '' ? -1 : a.fields.name.localeCompare(b.fields.name)));
}

/** The custom field names the project's live people use (3.5), as frames' and locations' are worked out. */
export function personFieldRecords(records: Readonly<Record<string, SbdRecord>>): SbdRecord[] {
  return Object.values(records).filter((r) => r.type === 'person' && r.trashedAt === null);
}

type Records = Readonly<Record<string, SbdRecord>>;

/** A character's name, as the script spells it; '' for none. */
export const characterName = (character: SbdRecord): string => (typeof character.props.name === 'string' ? character.props.name.trim() : '');

/** The project's live, named characters by name (3.5b): from the script import, or typed on a scene. */
export function projectCharacters(records: Records, projectId: string): SbdRecord[] {
  return Object.values(records)
    .filter((r) => r.type === 'character' && r.parentId === projectId && r.trashedAt === null && characterName(r) !== '')
    .sort((a, b) => characterName(a).localeCompare(characterName(b)));
}

/**
 * Who plays a character (3.5b, docs/PHASE3_DECISIONS.md 6a): the live person its `cast_id` names, or null. A cast
 * member in the Trash reads as none, and their character comes back to them with a restore.
 */
export function castOf(records: Records, character: SbdRecord): SbdRecord | null {
  const id = character.props.cast_id;
  const person = typeof id === 'string' ? records[id] : undefined;
  return person?.type === 'person' && person.trashedAt === null ? person : null;
}

/** The live characters a person plays, by name. */
export function charactersPlayedBy(records: Records, projectId: string, personId: string): SbdRecord[] {
  return projectCharacters(records, projectId).filter((c) => castOf(records, c)?.id === personId);
}

/**
 * The people of each department, in the call sheet's order; someone in several is in each. Those in none come last,
 * under null. The Team section's roster (3.5b), and from Phase 4 the call sheet's crew list.
 */
export function peopleByDepartment<T extends { fields: PersonFields }>(people: readonly T[]): { department: Department | null; people: T[] }[] {
  const groups: { department: Department | null; people: T[] }[] = DEPARTMENTS.map((department) => ({
    department,
    people: people.filter((p) => p.fields.departments.includes(department)),
  }));
  groups.push({ department: null, people: people.filter((p) => p.fields.departments.length === 0) });
  return groups.filter((g) => g.people.length > 0);
}

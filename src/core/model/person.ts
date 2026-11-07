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

import { DEPARTMENTS, type Department } from './department';
import { approverRoles, ROLE_DEPARTMENTS, type ProjectRole } from './departmentStatus';
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
  /** Full view (3.6c) as set on the person; null when it never was, and it follows their role (personFullView). */
  fullView: boolean | null;
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
    fullView: typeof props.full_view === 'boolean' ? props.full_view : null,
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

/**
 * A scene's characters (3.13): its `character_ids`, read as the live character records they name, in its order. One
 * in the Trash, or gone for good, reads as none. A scene still in the shape from before schema 12 (put back by Restore
 * to here, or in a version opened from before the upgrade, which nothing converts again) reads its `characters` names
 * as the upgrade matched them: the project's live characters by name, trimmed and in any case, the first by place.
 */
export function sceneCharacters(records: Records, scene: SbdRecord): SbdRecord[] {
  const live = (record: SbdRecord | undefined): record is SbdRecord => record?.type === 'character' && record.trashedAt === null;
  if (Array.isArray(scene.props.character_ids)) {
    return scene.props.character_ids.flatMap((id) => {
      const character = typeof id === 'string' ? records[id] : undefined;
      return live(character) ? [character] : [];
    });
  }
  if (!Array.isArray(scene.props.characters)) return [];
  const key = (name: string) => name.trim().toLowerCase();
  const byName = new Map<string, SbdRecord>();
  const characters = Object.values(records).filter((r) => live(r) && r.parentId === scene.parentId && characterName(r) !== '');
  for (const character of characters.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))) {
    if (!byName.has(key(characterName(character)))) byName.set(key(characterName(character)), character);
  }
  const found: SbdRecord[] = [];
  for (const name of scene.props.characters) {
    const character = typeof name === 'string' && key(name) !== '' ? byName.get(key(name)) : undefined;
    if (character && !found.includes(character)) found.push(character);
  }
  return found;
}

/** The project's live, named characters by name (3.5b): the speaking characters a script import made. */
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

/**
 * What a person in Cast and crew stands for when they're you (3.5c, docs/PHASE3_DECISIONS.md 4): the roles you sign
 * off as, and the departments opening a frame marks Seen. One main role and several departments, so a Director in
 * Camera, or a DP in Direction, is the Director and DP the local setting offers (approved by Kevin, Nov 8). Seen goes by
 * the departments the role stands for and the ones picked, together, so the departments you approve for are always
 * among those you've seen for: a DP who ticks only Grip & electric still marks Camera.
 */
export function personPart(fields: PersonFields): { role: ProjectRole | null; departments: readonly Department[] } {
  const both = (fields.role === 'director' && fields.departments.includes('camera')) || (fields.role === 'dp' && fields.departments.includes('direction'));
  const role: ProjectRole | null = both ? 'director-dp' : fields.role;
  const seen = new Set<Department>([...(role ? ROLE_DEPARTMENTS[role] : []), ...fields.departments]);
  return { role, departments: DEPARTMENTS.filter((d) => seen.has(d)) };
}

/**
 * Whether someone sees every department first (3.6c): as set on them in Cast and crew, else on for the director and
 * the DP (those who approve) and off for everyone else, who sees their own departments first. A focus view, never
 * access: anyone with the .sbd can open everything (docs/PLAN.md, 3.6c).
 */
export function personFullView(fields: PersonFields): boolean {
  return fields.fullView ?? approverRoles(personPart(fields).role).length > 0;
}

/** Who you are on a project, and what that gives you: from Cast and crew once you've picked yourself, else the setting. */
export interface MyPart {
  role: ProjectRole | null;
  departments: readonly Department[];
  /** Every department first (3.6c), or your own first with the rest folded under Rest of crew. */
  fullView: boolean;
  /** The live person you picked; null while the setting applies (none picked, or they're in the Trash). */
  person: SbdRecord | null;
}

/**
 * Your part on a project: the person you picked in its Cast and crew, while they're live and in this project; else
 * `fallback`, the role kept on this computer (or the profile's usual one). A person in the Trash gives way to the
 * fallback, and a restore brings them back, since the pick itself stays.
 */
export function myPart(records: Records, projectId: string, selfId: string | null, fallback: ProjectRole | null): MyPart {
  const person = selfId ? records[selfId] : undefined;
  if (person?.type === 'person' && person.trashedAt === null && person.parentId === projectId) {
    const fields = personFields(person.props);
    return { ...personPart(fields), fullView: personFullView(fields), person };
  }
  // Without a person picked, the role on this computer decides as a person's would: the director and the DP see
  // everything, and so does anyone whose role stands for no department (nothing to put first).
  const departments = fallback ? ROLE_DEPARTMENTS[fallback] : [];
  return { role: fallback, departments, fullView: approverRoles(fallback).length > 0 || departments.length === 0, person: null };
}

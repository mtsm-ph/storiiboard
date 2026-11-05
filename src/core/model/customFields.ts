import { en } from '../i18n/locales/en';
import type { JsonValue, Props, SbdRecord } from './record';
import { t, type MessageKey } from '../i18n';

// Custom fields on shots (1.19, CLAUDE.md: users add their own props to shots): drone, VFX, budget, anything the
// built-in specs don't cover. A shot keeps its own as one prop, `custom`, of text by field name. The project's list of
// field names is worked out from its shots, never stored (CLAUDE.md: rollups are computed), so a field exists as long
// as one shot has it. Names match whatever their case, as people type them: `vfx` and `VFX` are one field.

/** Longer names don't fit the inspector's label or a CSV header people can read. */
export const MAX_FIELD_NAME = 40;

/**
 * The names the board, the shot list and the exports already give a frame's own fields. A custom field can't take
 * one, so no column or label is ever there twice.
 */
export const BUILT_IN_FIELDS = [
  'field.scene',
  'field.heading',
  'field.length',
  'field.location',
  'field.shot',
  'field.number',
  'field.name',
  'field.title',
  'field.size',
  'field.lens',
  'field.lensMm',
  'field.tStop',
  'field.support',
  'field.height',
  'field.move',
  'field.status',
  'field.action',
  'field.dialogue',
  'field.departments',
  'field.departmentsThisFrameNeeds',
  'field.picture',
  'field.intExt',
  'field.time',
  'field.newField',
] as const satisfies readonly MessageKey[];

/**
 * The reserved names, lower-cased: in English, so a field named in one language never collides when the project is
 * opened in another, and in the app's language, the words its columns and labels show now.
 */
function builtIn(): Set<string> {
  return new Set(BUILT_IN_FIELDS.flatMap((key) => [en[key].toLowerCase(), t(key).toLowerCase()]));
}

/** The `custom` prop as stored, anything in it kept: a later version or a hand edit may hold more than text. */
function storedCustom(props: Props): Record<string, JsonValue> {
  const custom = props.custom;
  return typeof custom === 'object' && custom !== null && !Array.isArray(custom) ? custom : {};
}

/** A shot's custom fields, by name, in the order they were added. */
export function customFieldsOf(props: Props): Record<string, string> {
  return Object.fromEntries(Object.entries(storedCustom(props)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

/** Names in a shot's `custom` holding something other than text (a later version's, a hand edit): never written over. */
export function hiddenFieldNames(props: Props): string[] {
  return Object.entries(storedCustom(props)).flatMap(([name, value]) => (typeof value === 'string' ? [] : [name]));
}

/** The name `fields` has for `name`, whatever its case; null when it has none. */
export function fieldKey(fields: Readonly<Record<string, unknown>>, name: string): string | null {
  const lower = name.toLowerCase();
  return Object.keys(fields).find((key) => key.toLowerCase() === lower) ?? null;
}

/** A frame's value for the project's field `name`, whatever case the frame spells it in; '' when it has none. */
export function customValue(fields: Readonly<Record<string, string>>, name: string): string {
  const key = fieldKey(fields, name);
  return key === null ? '' : (fields[key] ?? '');
}

/**
 * Every field name the project's live shots use, once whatever the case, sorted by name. Where shots spell a name
 * differently, the spelling most of them use wins (ties to the first in code order), so editing a frame never flips
 * a column's heading.
 */
export function customFieldNames(records: Readonly<Record<string, SbdRecord>>): string[] {
  return fieldNamesOf(Object.values(records).filter((record) => record.type === 'shot' && record.trashedAt === null));
}

/**
 * The same, from just these shots: an export's frames in scope, so a field only frames in a trashed scene (or another
 * scene) use never becomes a column.
 */
export function fieldNamesOf(shots: Iterable<SbdRecord>): string[] {
  const spellings = new Map<string, Map<string, number>>();
  for (const record of shots) {
    for (const name of Object.keys(customFieldsOf(record.props))) {
      const counts = spellings.get(name.toLowerCase()) ?? new Map<string, number>();
      counts.set(name, (counts.get(name) ?? 0) + 1);
      spellings.set(name.toLowerCase(), counts);
    }
  }
  const names = [...spellings.values()].map((counts) => [...counts].sort(([a, m], [b, n]) => n - m || (a < b ? -1 : a > b ? 1 : 0))[0]?.[0] ?? '');
  return names.sort((a, b) => a.localeCompare(b));
}

export type FieldName = { ok: true; name: string } | { ok: false; problem: string };

/**
 * A field name as typed, tidied: trimmed, spaces run together, and the project's own spelling when the name is
 * already in use (`vfx` becomes `VFX`). Refused when empty, too long, one of the frame's built-in fields, or a name the
 * frame keeps something other than text under (`hidden`).
 */
export function fieldName(typed: string, known: readonly string[], hidden: readonly string[] = []): FieldName {
  const name = typed.trim().replace(/\s+/g, ' ');
  if (name === '' || name.length > MAX_FIELD_NAME) return { ok: false, problem: t('field.nameLength', { max: MAX_FIELD_NAME }) };
  // A name the project already uses stays usable, even one that became a built-in field later ("Title", Nov 5).
  const already = known.some((k) => k.toLowerCase() === name.toLowerCase());
  if (!already && builtIn().has(name.toLowerCase())) return { ok: false, problem: t('field.builtIn', { name }) };
  if (hidden.some((h) => h.toLowerCase() === name.toLowerCase())) {
    return { ok: false, problem: t('field.hidden', { name }) };
  }
  return { ok: true, name: known.find((k) => k.toLowerCase() === name.toLowerCase()) ?? name };
}

/** The update that sets one field on a shot, in the shot's own spelling of it, keeping everything else in `custom`. */
export function withField(props: Props, name: string, value: string): { set: Record<string, JsonValue> } {
  const stored = storedCustom(props);
  // Matched in another case only to a text field: an entry this version can't show is never written over.
  const key = Object.hasOwn(stored, name) ? name : (fieldKey(customFieldsOf(props), name) ?? name);
  return { set: { custom: { ...stored, [key]: value } } };
}

/** The update that takes one field off a shot; with nothing left, the prop goes too. */
export function withoutField(props: Props, name: string): { set: Record<string, JsonValue> } | { unset: string[] } {
  const rest = Object.fromEntries(Object.entries(storedCustom(props)).filter(([key]) => key !== name));
  return Object.keys(rest).length === 0 ? { unset: ['custom'] } : { set: { custom: rest } };
}

import type { JsonValue, Props, SbdRecord } from './record';

// Custom fields on shots (1.19, CLAUDE.md: users add their own props to shots): drone, VFX, budget, anything the
// built-in specs don't cover. A shot keeps its own as one prop, `custom`, of text by field name. The project's list of
// field names is worked out from its shots, never stored (CLAUDE.md: rollups are computed), so a field exists as long
// as one shot has it.

/** Longer names don't fit the inspector's label or a CSV header people can read. */
export const MAX_FIELD_NAME = 40;

/** A shot's custom fields, by name, in the order they were added. */
export function customFieldsOf(props: Props): Record<string, string> {
  const custom = props.custom;
  if (typeof custom !== 'object' || custom === null || Array.isArray(custom)) return {};
  return Object.fromEntries(Object.entries(custom).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

/** Every field name the project's live shots use, as first written, sorted by name. */
export function customFieldNames(records: Readonly<Record<string, SbdRecord>>): string[] {
  const seen = new Map<string, string>();
  for (const record of Object.values(records)) {
    if (record.type !== 'shot' || record.trashedAt !== null) continue;
    for (const name of Object.keys(customFieldsOf(record.props))) if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * A field name as typed, tidied: trimmed, spaces run together, and the project's own spelling when the name is
 * already in use (`vfx` becomes `VFX`). Null when it can't be a name.
 */
export function fieldName(typed: string, known: readonly string[]): string | null {
  const name = typed.trim().replace(/\s+/g, ' ');
  if (name === '' || name.length > MAX_FIELD_NAME) return null;
  return known.find((k) => k.toLowerCase() === name.toLowerCase()) ?? name;
}

/** The update that sets one field on a shot, keeping the rest. */
export function withField(props: Props, name: string, value: string): { set: Record<string, JsonValue> } {
  return { set: { custom: { ...customFieldsOf(props), [name]: value } } };
}

/** The update that takes one field off a shot; with none left, the prop goes too. */
export function withoutField(props: Props, name: string): { set: Record<string, JsonValue> } | { unset: string[] } {
  const rest = Object.fromEntries(Object.entries(customFieldsOf(props)).filter(([key]) => key !== name));
  return Object.keys(rest).length === 0 ? { unset: ['custom'] } : { set: { custom: rest } };
}

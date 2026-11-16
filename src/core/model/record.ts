// Every item in a project is a record with the same shape (CLAUDE.md, Data model). Prop schemas per type arrive with
// each type's phase; until then props are open JSON, which is also how users' custom props are kept.

export const RECORD_TYPES = [
  'project',
  'scene',
  'shot',
  'setup',
  'media',
  'location',
  'person',
  'department',
  'gear_item',
  'shoot_day',
  'callsheet',
  'plan',
  'plan_item',
  'board',
  'board_item',
  'design',
  'comment',
  'suggestion',
  'availability',
  // Schema 3 (1.10): a note card among a scene's frames, a character from the script (not a person: cast play
  // characters), and one stroke of a frame's sketch, its own record so History doesn't copy every earlier stroke.
  'note',
  'character',
  'stroke',
  // Schema 15 (6.5.8, made ready in 6.5.5): a named set of canvas settings under the project (`name`, `settings`). Its
  // type is listed ahead of its UI so the schema version of 6.5 covers it: nothing else in the file has to change for it.
  'settings_preset',
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type Props = Record<string, JsonValue>;

export interface SbdRecord {
  id: string;
  type: RecordType;
  /** Null only for the project record. */
  parentId: string | null;
  /** Orders siblings (src/core/ops/order.ts). */
  sortKey: string;
  props: Props;
  /** Set while the record is in the Trash. */
  trashedAt: string | null;
  trashedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export function isRecordType(value: unknown): value is RecordType {
  return typeof value === 'string' && (RECORD_TYPES as readonly string[]).includes(value);
}

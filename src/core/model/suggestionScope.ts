import { list, t, type MessageKey } from '../i18n';
import { frameLens } from './cameraGear';
import { isDepartment } from './department';
import type { JsonValue, RecordType, SbdRecord } from './record';
import { dayPeopleIds } from './schedule';
import { isClockTime } from './shootDay';
import { SHOT_STATUSES } from './shotStatus';
import { DAY_NIGHT, HEIGHTS, INT_EXT, MOVES, SHOT_SIZES, SUPPORTS, T_STOPS } from './storyboard';

// What a suggestion may touch (7.0, Kevin, Nov 16: Phase 7 decision 4, departments decision 5): ONE table, rows of
// record type → kinds → fields, each field with the check its values pass. Phase 7 fills the assistant's row; the
// departments' "changes" body adds rows of its own later, read by the same engine (src/core/ops/suggestions.ts). The
// words a person reads about a row ("What the assistant can suggest", Settings in 7.6) are made from the table itself
// (scopeWords), so they can't drift from the rule.
//
// Left out of every row on purpose: shot and scene numbers and their locks (the project's own rule gives them, and
// slates hold them), approvals, department status and Seen, pictures, sketches and other media, `trashed_*`, custom
// fields, a frame's setup and lens pick (Phase 6's plans, with `suggest_room` in 7.6), a scene's characters (no hand
// edit sets them: 7.7's breakdown brings them back with one, 7.0 round 3), project settings, and anything that holds a
// person's contact details. A field not in a row is refused, never applied "for review".

/** The kinds format version 1 knows (docs/SBD_FORMAT.md, Change files). */
export const SUGGESTION_KINDS = ['trash', 'update', 'create', 'reorder'] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];
export const isSuggestionKind = (value: unknown): value is SuggestionKind => typeof value === 'string' && (SUGGESTION_KINDS as readonly string[]).includes(value);

type Records = Readonly<Record<string, SbdRecord>>;

/** Why a value can't be written: the suggestion is kept, flagged "can't be applied", naming the field. */
export type ValueProblem =
  /** Not the kind of value the field holds (text, a number, a list, an object). */
  | 'type'
  /** Text past the field's length. */
  | 'too_long'
  /** A number outside the field's own range, or not a finite number. */
  | 'range'
  /** Not one of the field's choices. */
  | 'choice'
  /** An id that names no live record of the field's type. */
  | 'not_found'
  /** A list or a map past the field's size. */
  | 'too_many'
  /** The same id twice in a list. */
  | 'repeated'
  /** Taken off, where the field can't be empty. */
  | 'empty'
  /** The project holds something there this version can't read (a newer one's): never written over. */
  | 'unreadable'
  /** A frame's focal length outside the range of the lens picked for it, or taken off while one is picked. */
  | 'lens_range'
  /** A call sheet's times for someone who isn't on its day: the sheet shows only the day's people (4.2). */
  | 'not_on_day';

/**
 * What a check reads besides the value: the project's records, the record the value would go on (null for one being
 * made, or a call sheet not made yet), and for a call sheet, its day.
 */
export interface FieldContext {
  records: Records;
  record: SbdRecord | null;
  day?: SbdRecord | null;
}

export interface ScopeField {
  /** Its name in the words (History's names for fields). */
  label: MessageKey;
  /** Null when the value can be written; else why not. */
  check: (value: JsonValue, context: FieldContext) => ValueProblem | null;
  /** Whether this (checked) value takes the prop off rather than being written: null, and what the field's edit reads as empty. */
  takesOff: (value: JsonValue) => boolean;
  /**
   * For a list of ids: the type its ids name. What the stored list holds that isn't a live record of it (one in the
   * Trash, one gone, something that isn't an id) is what a person can't see: Apply keeps it where it is, and changed
   * since leaves it out (7.0 round 2).
   */
  listOf?: RecordType;
  /** For a map a call sheet edits key by key (its calls and times): only the keys named are set or taken off. */
  byKey?: true;
}

export interface ScopeType {
  /** The type's name in the words: "Frames". */
  label: MessageKey;
  kinds: readonly SuggestionKind[];
  /** The fields an `update` may change and a `create` may give. */
  fields: Readonly<Record<string, ScopeField>>;
  /** The types a `create` or a `reorder` may place it under. */
  parents: readonly RecordType[];
}

export interface ScopeRow {
  id: string;
  /** The words' heading: "What the assistant can suggest". */
  label: MessageKey;
  /** By the target's record type. A call sheet (`callsheet`) is named by its day's id: a day has none until its first note. */
  types: Readonly<Partial<Record<RecordType, ScopeType>>>;
}

/** Longest text a field takes: a title or a name, and an action, a dialogue, a note or a call sheet's notes. */
export const SHORT_TEXT = 200;
export const LONG_TEXT = 10_000;
/** Longest id a check reads: a UUID is 36. */
const MAX_ID = 100;
/** Longest list of ids, and most people one call sheet times. */
const MAX_IDS = 500;

const isObject = (value: JsonValue | undefined): value is { [key: string]: JsonValue } => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A live record of `type` by id; never a key of Object's own (`__proto__`, `constructor`). */
const liveOf = (records: Records, id: string, type: RecordType): boolean => {
  if (id.length > MAX_ID || !Object.hasOwn(records, id)) return false;
  const record = records[id];
  return record?.type === type && record.trashedAt === null;
};

const isNull = (value: JsonValue): boolean => value === null;

/** Text up to `max`; with `emptyOff`, '' and null take it off (a title), else null is refused (an action is '' when empty). */
function text(label: MessageKey, max: number, emptyOff = false): ScopeField {
  return {
    label,
    check: (value) => (value === null ? (emptyOff ? null : 'empty') : typeof value !== 'string' ? 'type' : value.length > max ? 'too_long' : null),
    takesOff: (value) => value === null || (emptyOff && value === ''),
  };
}

/** One of `choices`; with `nullable`, null takes it off. */
function choice(label: MessageKey, choices: readonly (string | number)[], nullable: boolean): ScopeField {
  return {
    label,
    check: (value) => (value === null ? (nullable ? null : 'empty') : typeof value !== 'string' && typeof value !== 'number' ? 'type' : choices.includes(value) ? null : 'choice'),
    takesOff: isNull,
  };
}

/** A live record's id; with `nullable`, null takes it off. */
function idOf(label: MessageKey, type: RecordType, nullable: boolean): ScopeField {
  return {
    label,
    check: (value, { records }) => (value === null ? (nullable ? null : 'empty') : typeof value !== 'string' ? 'type' : liveOf(records, value, type) ? null : 'not_found'),
    takesOff: isNull,
  };
}

/**
 * A list of live records' ids, each once, in order. Something other than a list where the record keeps it (a newer
 * version's) is never written over, as the edits that keep these lists refuse it. With `emptyOff`, [] takes it off.
 */
function idsOf(label: MessageKey, type: RecordType, prop: string, emptyOff: boolean): ScopeField {
  return {
    label,
    check: (value, { records, record }) => {
      const stored = record?.props[prop];
      if (stored !== undefined && !Array.isArray(stored)) return 'unreadable';
      if (value === null) return emptyOff ? null : 'empty';
      if (!Array.isArray(value)) return 'type';
      if (value.length > MAX_IDS) return 'too_many';
      if (value.some((id) => typeof id !== 'string')) return 'type';
      if (new Set(value).size !== value.length) return 'repeated';
      return value.every((id) => typeof id === 'string' && liveOf(records, id, type)) ? null : 'not_found';
    },
    takesOff: (value) => value === null || (emptyOff && Array.isArray(value) && value.length === 0),
    listOf: type,
  };
}

/** A whole number from `min` to `max`, or null to take it off. */
function wholeNumber(label: MessageKey, min: number, max: number): ScopeField {
  return {
    label,
    check: (value) => (value === null ? null : typeof value !== 'number' ? 'type' : Number.isInteger(value) && value >= min && value <= max ? null : 'range'),
    takesOff: isNull,
  };
}

/** A frame's focal length, as the Inspector takes one: above 0 to 2000 mm, inside a picked lens's range; null takes it off, unless a lens is picked. */
const lensMm: ScopeField = {
  label: 'history.field.lensMm',
  check: (value, { records, record }) => {
    const range = record ? (frameLens(records, record)?.fields.range ?? null) : null;
    if (value === null) return range ? 'lens_range' : null;
    if (typeof value !== 'number') return 'type';
    if (!Number.isFinite(value) || value <= 0 || value > 2000) return 'range';
    return range && (value < range.min || value > range.max) ? 'lens_range' : null;
  },
  takesOff: isNull,
};

/** A map whose stored value isn't an object is never written over (the call sheet's own edits refuse it too). */
const storedMap = (record: SbdRecord | null, prop: string): 'unreadable' | null => {
  const stored = record?.props[prop];
  return stored !== undefined && !isObject(stored) ? 'unreadable' : null;
};

/** A time on the sheet's or the day's own field: `HH:MM`, or '' and null to take it off, as the field's edit takes ''. */
const clockOrOff = (time: JsonValue | undefined): boolean => time === null || time === '' || (typeof time === 'string' && isClockTime(time));

/**
 * A call sheet's department calls, key by key as the sheet's own edit writes them (departmentCallChange):
 * `{ department id: "HH:MM" }`, where '' or null takes that department's call off. Departments not named stay as they are,
 * one this version can't read included, so the field itself is never taken off whole.
 */
const departmentCalls: ScopeField = {
  label: 'history.field.departmentCalls',
  check: (value, { record }) => {
    const stored = storedMap(record, 'department_calls');
    if (stored) return stored;
    if (!isObject(value)) return 'type';
    const entries = Object.entries(value);
    if (entries.length > 50) return 'too_many';
    for (const [department, time] of entries) {
      if (!isDepartment(department)) return 'not_found';
      if (!clockOrOff(time)) return 'type';
    }
    return null;
  },
  takesOff: () => false,
  byKey: true,
};

export const PERSON_TIME_KEYS = ['call', 'hmu_ready', 'on_set'] as const;
export type PersonTimeKey = (typeof PERSON_TIME_KEYS)[number];
export const isPersonTimeKey = (key: string): key is PersonTimeKey => (PERSON_TIME_KEYS as readonly string[]).includes(key);

/**
 * A call sheet's person times, key by key as the sheet's own edit writes them (personTimeChange):
 * `{ person id: { call?, hmu_ready?, on_set? } }`, each "HH:MM", or '' and null to take that one off; a person given
 * null has all three taken off. People and keys not named stay as they are, those this version can't read included.
 * Only the day's people (7.0 round 3): when the day has a list (`people_ids`), someone not on it is refused, since the
 * sheet shows only them (4.2); a day without the list (everyone) takes any live person.
 */
const personTimes: ScopeField = {
  label: 'history.field.personTimes',
  check: (value, { records, record, day }) => {
    const stored = storedMap(record, 'person_times');
    if (stored) return stored;
    if (!isObject(value)) return 'type';
    const entries = Object.entries(value);
    if (entries.length > MAX_IDS) return 'too_many';
    const was = record?.props.person_times;
    const onDay = day ? dayPeopleIds(day.props) : null;
    for (const [personId, times] of entries) {
      if (!liveOf(records, personId, 'person')) return 'not_found';
      if (onDay && !onDay.includes(personId)) return 'not_on_day';
      // A person's entry that isn't an object (a newer version's) is never written over, as the sheet's edit refuses it.
      if (isObject(was) && Object.hasOwn(was, personId) && !isObject(was[personId])) return 'unreadable';
      if (times === null) continue;
      if (!isObject(times) || Object.keys(times).length === 0) return 'type';
      for (const [key, time] of Object.entries(times)) if (!isPersonTimeKey(key) || !clockOrOff(time)) return 'type';
    }
    return null;
  },
  takesOff: () => false,
  byKey: true,
};

/** A day's crew call or wrap (3.7), as the Days tile edits one (dayChange): `HH:MM`, or '' and null to take it off. */
function dayTime(label: MessageKey): ScopeField {
  return {
    label,
    check: (value) => (clockOrOff(value) ? null : 'type'),
    takesOff: (value) => value === null || value === '',
  };
}

/**
 * The assistant's row (Phase 7 decision 4): frames, scenes and notes; a day's frames (a frame's `shoot_day_id`), the
 * board's order of frames and notes and a day's gear list; a call sheet's notes and calls, the day's crew call and wrap
 * among them. Plan items join it in 7.6 with `suggest_room`. Each field can be emptied by a suggestion only where a
 * person can empty it by hand (the Inspector, the Days tile, the call sheet).
 */
export const ASSISTANT_SCOPE: ScopeRow = {
  id: 'assistant',
  label: 'suggestionScope.assistant',
  types: {
    shot: {
      label: 'suggestionScope.type.shot',
      kinds: ['trash', 'update', 'create', 'reorder'],
      parents: ['scene'],
      fields: {
        title: text('history.field.title', SHORT_TEXT, true),
        size: choice('history.field.size', SHOT_SIZES, false),
        lens_mm: lensMm,
        t_stop: choice('history.field.tStop', T_STOPS, true),
        support: choice('history.field.support', SUPPORTS, true),
        height: choice('history.field.height', HEIGHTS, true),
        move: choice('history.field.move', MOVES, true),
        status: choice('history.field.status', SHOT_STATUSES, false),
        action: text('history.field.action', LONG_TEXT),
        dialogue: text('history.field.dialogue', LONG_TEXT),
        location_id: idOf('history.field.locationId', 'location', true),
        shoot_day_id: idOf('history.field.shootDay', 'shoot_day', true),
        gear_ids: idsOf('history.field.gearIds', 'gear_item', 'gear_ids', true),
      },
    },
    scene: {
      label: 'suggestionScope.type.scene',
      // No reorder: a person can't move a scene on the board today, so neither can a suggestion (7.0 round 2).
      kinds: ['trash', 'update', 'create'],
      parents: ['project'],
      fields: {
        name: text('history.field.name', SHORT_TEXT),
        int_ext: choice('history.field.intExt', INT_EXT, false),
        // The Inspector's Time can be set back to none; INT/EXT can't.
        day_night: choice('history.field.dayNight', DAY_NIGHT, true),
        location_id: idOf('history.field.locationId', 'location', false),
        page_eighths: wholeNumber('history.field.pageEighths', 1, 8 * 999),
      },
    },
    note: {
      label: 'suggestionScope.type.note',
      kinds: ['trash', 'update', 'create', 'reorder'],
      parents: ['scene'],
      fields: { text: text('history.field.text', LONG_TEXT) },
    },
    shoot_day: {
      label: 'suggestionScope.type.shootDay',
      kinds: ['update'],
      parents: [],
      // The day's gear list, and its crew call and wrap: the call sheet's calls (4.2).
      fields: {
        gear_ids: idsOf('history.field.gearIds', 'gear_item', 'gear_ids', true),
        call_time: dayTime('history.field.callTime'),
        wrap_time: dayTime('history.field.wrapTime'),
      },
    },
    callsheet: {
      label: 'suggestionScope.type.callsheet',
      kinds: ['update'],
      parents: [],
      fields: {
        notes: text('history.field.callsheetNotes', LONG_TEXT, true),
        safety_notes: text('history.field.callsheetSafety', LONG_TEXT, true),
        department_calls: departmentCalls,
        person_times: personTimes,
      },
    },
  },
};

/** Every row by id. One table: the departments' rows join it here. */
export const SCOPE_ROWS: Readonly<Record<string, ScopeRow>> = { assistant: ASSISTANT_SCOPE };

/** The row's entry for a type, or null: never one of Object's own keys. */
export const scopeType = (row: ScopeRow, type: string): ScopeType | null => (Object.hasOwn(row.types, type) ? (row.types[type as RecordType] ?? null) : null);

/** A field of a type's entry, or null: never one of Object's own keys (`__proto__`, `constructor`). */
export const scopeField = (entry: ScopeType, field: string): ScopeField | null => (Object.hasOwn(entry.fields, field) ? (entry.fields[field] ?? null) : null);

const KIND_WORD: Readonly<Record<SuggestionKind, MessageKey>> = {
  trash: 'suggestionScope.kind.trash',
  update: 'suggestionScope.kind.update',
  create: 'suggestionScope.kind.create',
  reorder: 'suggestionScope.kind.reorder',
};

/**
 * A row in words, made from the table so it says exactly what the rule allows: its heading, then a line a type,
 * "Frames: move to the Trash, change, add and move. Fields: title, size, lens…". For Settings (7.6).
 */
export function scopeWords(row: ScopeRow): { title: string; lines: string[] } {
  const lines = Object.values(row.types).map((entry) =>
    t('suggestionScope.line', {
      type: t(entry.label),
      kinds: list(entry.kinds.map((kind) => t(KIND_WORD[kind]))),
      fields: list(Object.values(entry.fields).map((field) => t(field.label))),
    }),
  );
  return { title: t(row.label), lines };
}

import { t, type MessageKey } from '../i18n';
import { callsheetNoteChange, departmentCallChange, personTimeChange } from '../ops/callsheetEdits';
import { dayChange, scheduleFrames } from '../ops/dayEdits';
import { gearListChange } from '../ops/gearEdits';
import type { Change } from '../ops/ops';
import {
  addNoteChanges,
  addSceneChanges,
  addShot,
  beforeIdAfter,
  boardScene,
  leavesLockedScene,
  moveItem,
  START_OF_SCENE,
  trashScene,
  trashShot,
} from '../ops/storyboardEdits';
import { dayCallsheet } from './callsheet';
import type { JsonValue, SbdRecord } from './record';
import { isClockTime } from './shootDay';
import { NO_SLATE_NUMBERS, type SlateNumbers } from './shotNumbers';
import { shotFields } from './storyboard';
import {
  ASSISTANT_SCOPE,
  isPersonTimeKey,
  isSuggestionKind,
  PERSON_TIME_KEYS,
  scopeField,
  scopeType,
  type PersonTimeKey,
  type ScopeField,
  type ScopeRow,
  type ScopeType,
  type SuggestionKind,
  type ValueProblem,
} from './suggestionScope';

// A suggestion (7.0, docs/SBD_FORMAT.md "Change files"): what one would do to the project and whether it still can.
// A `suggestion` record comes from a change file or the assistant, so everything in it is untrusted: it is read here
// bounded and rebuilt clean, as a settings preset is, before anything is shown or written. Pure (no page, no storage),
// so 7.5's server reads suggestions with the same code.
//
// Apply only does what a person could do by hand, with the same edit the UI makes (src/core/ops: storyboardEdits,
// dayEdits, gearEdits, callsheetEdits), never a copy of one: a frame added by a suggestion is numbered, placed and keyed
// exactly as one added on the board; a gear list changes by the Gear picker's adds and removes; a call sheet by its own
// per-key edits. Where a suggestion names several fields, the edits a person would make one after another are folded
// into one op on the record (foldEdits). A placement the app can't make by hand (a scene before the board's first) is
// flagged "can't be applied", never made by an edit of its own. The engine (src/core/ops/suggestions.ts) adds the
// suggestion's own update and writes the group.
//
// The engine's core, proposedChange, takes a proposal (kind, target, data) and a scope row, so the departments'
// "changes" body can use it later with rows of its own.

type Records = Readonly<Record<string, SbdRecord>>;

export const SUGGESTION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

/** Who made it, copied from the change file's `people`: never contact details. */
export interface SuggestionAuthor {
  name: string;
  role: string;
  personId: string | null;
}

/** A suggestion's `data`, read for its kind. Field maps are Maps, so no key (`__proto__`) can reach an object's prototype. */
export type SuggestionData =
  | { kind: 'trash' }
  | { kind: 'update'; props: ReadonlyMap<string, JsonValue>; before: ReadonlyMap<string, JsonValue> }
  | { kind: 'create'; type: string; parentId: string | null; afterId: string | null; props: ReadonlyMap<string, JsonValue> }
  | { kind: 'reorder'; parentId: string | null; afterId: string | null };

export interface Suggestion {
  id: string;
  /** Null for a kind this version doesn't know: `kindName` says which. */
  kind: SuggestionKind | null;
  kindName: string;
  /** Null for a status this version doesn't know. */
  status: SuggestionStatus | null;
  /** The record it acts on; for a call sheet, its day; null for a `create`. */
  targetId: string | null;
  targetType: string;
  /** As the suggester saw it: "SC 04 · 4B". Text to show as text. */
  targetLabel: string;
  targetUpdatedAt: string | null;
  source: string;
  changeFileId: string | null;
  author: SuggestionAuthor;
  note: string;
  suggestedAt: string | null;
  decidedBy: string;
  decidedAt: string | null;
  /** For an applied `create`: the record it made. */
  createdId: string | null;
  /** For a `create` whose parent is another `create` of the same file: that suggestion's id. */
  afterSuggestion: string | null;
  /** Null when `data` can't be read for its kind (`dataProblem` names the field). */
  data: SuggestionData | null;
  dataProblem: string | null;
  /** Props of the record, or keys of its data, this version doesn't know: kept as they are, never applied. */
  unknown: string[];
}

/** Every flag a suggestion can carry. Only `changed_since`, `no_change` and an `after` that's gone leave Apply open. */
export type SuggestionFlag =
  /** Applied or rejected already. */
  | { kind: 'decided'; status: SuggestionStatus }
  /** A kind or a field this version doesn't know: kept as it is, never applied or dropped. */
  | { kind: 'newer'; what: 'kind' | 'field'; name: string }
  /** A kind, type or field the scope row doesn't allow: kept, listed as refused, never applied. */
  | { kind: 'outside_scope'; what: 'kind' | 'type' | 'field'; name: string }
  /** A value that fails its field's check, or data that can't be read: "can't be applied", naming the field. */
  | { kind: 'invalid'; field: string; problem: ValueProblem }
  /** The target or the parent is no longer in the project; for `after` alone, it goes at the end instead. */
  | { kind: 'gone'; what: 'target' | 'parent' | 'after' }
  /** The target or the parent is in the Trash. */
  | { kind: 'trashed'; what: 'target' | 'parent' }
  /** A `create` under another suggestion's new scene, which hasn't been applied yet. */
  | { kind: 'waiting'; on: string }
  /** A `create` or `reorder` placed after what another suggestion of the same file adds, not applied yet (7.0 round 2). */
  | { kind: 'waiting_after'; on: string }
  /** Something the app can't do by hand (7.0 round 2), with its own words (flagWords). */
  | { kind: 'cant_apply'; why: CantApply }
  /** A frame can't leave a scene whose shot numbers are locked (unlocking it first frees it). */
  | { kind: 'locked' }
  /** Changed since it was suggested: for an update, field by field with the three values; else the target's time. */
  | { kind: 'changed_since'; fields: readonly ChangedField[] }
  /** The project already reads as suggested: Apply writes only the decision. */
  | { kind: 'no_change' };

/**
 * Why the app can't apply it by hand: a scene before the first live scene on the board (a person adds one after a
 * scene or at the end), a frame on no day onto one while it isn't Need to shoot (the Days tile offers only those, 4.11).
 */
export type CantApply = 'scene_first' | 'not_need';

export interface ChangedField {
  field: string;
  /** What the suggester saw. */
  then: JsonValue;
  suggested: JsonValue;
  now: JsonValue;
}

const OPEN_FLAGS: ReadonlySet<SuggestionFlag['kind']> = new Set(['changed_since', 'no_change']);

/** Whether a flag leaves Apply open: changed since (a person may still apply it), nothing to change, an `after` gone. */
export const flagAllowsApply = (flag: SuggestionFlag): boolean => OPEN_FLAGS.has(flag.kind) || (flag.kind === 'gone' && flag.what === 'after');

// Bounds on what a record's text can be once read: what's shown is cut to these, never the stored value.
const MAX_ID = 100;
const MAX_NAME = 100;
const MAX_LABEL = 200;
const MAX_NOTE = 2000;
const MAX_WORD = 40;
const MAX_TIME = 40;
/** At most this many unknown names are listed, each cut to MAX_WORD. */
const MAX_UNKNOWN = 20;
/** Most fields one update or create may name. */
export const MAX_FIELDS = 50;
/** The bounds above, for the change file's reader (7.1, src/core/storage/changeFile.ts), which refuses a file past them. */
export const SUGGESTION_BOUNDS = { id: MAX_ID, name: MAX_NAME, label: MAX_LABEL, note: MAX_NOTE, word: MAX_WORD, time: MAX_TIME } as const;

const isObject = (value: JsonValue | undefined): value is { [key: string]: JsonValue } => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Text to show: control characters out (line breaks kept with `lines`), and every format character (`\p{Cf}`: bidi
 * overrides and marks, zero-width ones, U+FEFF, tag characters) and the line and paragraph separators U+2028 and U+2029
 * (7.1 round 2), so "Robin\u200BVale" shows as "RobinVale", never as a lookalike of it; trimmed, at most `max` characters.
 */
export function cleanText(value: JsonValue | undefined, max: number, lines = false): string {
  if (typeof value !== 'string') return '';
  // Cut first, so a 10 MB text is never walked whole: room for every character as a surrogate pair, and some to strip.
  const head = value.length > max * 4 ? value.slice(0, max * 4) : value;
  const kept = lines ? head.replace(/[^\P{Cc}\n\t]|[\p{Cf}\u2028\u2029]/gu, '') : head.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '');
  return Array.from(kept.trim()).slice(0, max).join('').trim();
}

/** An id as stored, or null: text of an id's length, nothing else. */
const idText = (value: JsonValue | undefined): string | null => (typeof value === 'string' && value !== '' && value.length <= MAX_ID ? value : null);
const timeText = (value: JsonValue | undefined): string | null => (typeof value === 'string' && value.length <= MAX_TIME && !Number.isNaN(Date.parse(value)) ? value : null);

/** A suggestion record's props, every one this version reads; the change file's reader (7.1) maps a file onto them. */
export const KNOWN_PROPS: ReadonlySet<string> = new Set([
  'kind',
  'target_id',
  'target_type',
  'target_label',
  'target_updated_at',
  'status',
  'source',
  'change_file_id',
  'author',
  'note',
  'data',
  'suggested_at',
  'decided_by',
  'decided_at',
  'created_id',
  'after_suggestion',
]);

const DATA_KEYS: Readonly<Record<SuggestionKind, readonly string[]>> = {
  trash: [],
  update: ['props', 'before'],
  create: ['type', 'parent_id', 'after_id', 'props'],
  reorder: ['parent_id', 'after_id'],
};

/** A map of fields, or null past MAX_FIELDS or when it isn't an object. */
function fieldMap(value: JsonValue | undefined): Map<string, JsonValue> | null {
  if (!isObject(value)) return null;
  const entries = Object.entries(value);
  return entries.length > MAX_FIELDS ? null : new Map(entries);
}

/** `null`, or an id: what `parent_id` and `after_id` hold. Undefined when it's something else. */
const placeId = (value: JsonValue | undefined): string | null | undefined => (value === null ? null : (idText(value) ?? undefined));

function readData(kind: SuggestionKind, value: JsonValue | undefined, unknown: string[]): { data: SuggestionData | null; problem: string | null } {
  if (!isObject(value)) return { data: null, problem: 'data' };
  for (const key of Object.keys(value)) if (!DATA_KEYS[kind].includes(key)) unknown.push(`data.${key}`);
  switch (kind) {
    case 'trash':
      return { data: { kind }, problem: null };
    case 'update': {
      const props = fieldMap(value.props);
      const before = value.before === undefined ? new Map<string, JsonValue>() : fieldMap(value.before);
      if (!props || props.size === 0) return { data: null, problem: 'props' };
      if (!before) return { data: null, problem: 'before' };
      return { data: { kind, props, before }, problem: null };
    }
    case 'create': {
      const props = value.props === undefined ? new Map<string, JsonValue>() : fieldMap(value.props);
      const parentId = placeId(value.parent_id);
      const afterId = value.after_id === undefined ? null : placeId(value.after_id);
      if (typeof value.type !== 'string' || value.type.length > MAX_WORD) return { data: null, problem: 'type' };
      if (parentId === undefined || parentId === null) return { data: null, problem: 'parent_id' };
      if (afterId === undefined) return { data: null, problem: 'after_id' };
      if (!props) return { data: null, problem: 'props' };
      return { data: { kind, type: value.type, parentId, afterId, props }, problem: null };
    }
    case 'reorder': {
      const parentId = placeId(value.parent_id);
      const afterId = value.after_id === undefined ? null : placeId(value.after_id);
      if (parentId === undefined || parentId === null) return { data: null, problem: 'parent_id' };
      if (afterId === undefined) return { data: null, problem: 'after_id' };
      return { data: { kind, parentId, afterId }, problem: null };
    }
  }
}

/** A `suggestion` record as this version reads it: bounded and rebuilt clean. Nothing in the record is changed. */
export function readSuggestion(record: SbdRecord): Suggestion {
  const { props } = record;
  const unknown: string[] = Object.keys(props).filter((key) => !KNOWN_PROPS.has(key));
  const kind = isSuggestionKind(props.kind) ? props.kind : null;
  const author = isObject(props.author) ? props.author : {};
  const read = kind ? readData(kind, props.data, unknown) : { data: null, problem: null };
  const status = SUGGESTION_STATUSES.find((s) => s === props.status) ?? null;
  return {
    id: record.id,
    kind,
    kindName: cleanText(props.kind, MAX_WORD),
    status,
    targetId: idText(props.target_id),
    targetType: cleanText(props.target_type, MAX_WORD),
    targetLabel: cleanText(props.target_label, MAX_LABEL),
    targetUpdatedAt: timeText(props.target_updated_at),
    source: cleanText(props.source, MAX_WORD),
    changeFileId: idText(props.change_file_id),
    author: { name: cleanText(author.name, MAX_NAME), role: cleanText(author.role, MAX_WORD), personId: idText(author.person_id) },
    note: cleanText(props.note, MAX_NOTE, true),
    suggestedAt: timeText(props.suggested_at),
    decidedBy: cleanText(props.decided_by, MAX_NAME),
    decidedAt: timeText(props.decided_at),
    createdId: idText(props.created_id),
    afterSuggestion: idText(props.after_suggestion),
    data: read.data,
    dataProblem: read.problem,
    unknown: [...new Set(unknown)].slice(0, MAX_UNKNOWN).map((name) => cleanText(name, MAX_WORD) || '?'),
  };
}

// A record read once per record object (7.2): records are never changed in place (each edit makes new ones), so a read
// is good for as long as its record lives. Reviewing a chain of N creates reads each link again for every create after
// it (loopsBack, about N²/2 reads); kept, a read after the first is a lookup. What it hands out is shared: its readers
// never change it.
const kept = new WeakMap<SbdRecord, Suggestion>();

/** readSuggestion, kept per record object: the same Suggestion for the same record. Shared, so never changed by its readers. */
export function keptSuggestion(record: SbdRecord): Suggestion {
  let read = kept.get(record);
  if (!read) {
    read = readSuggestion(record);
    kept.set(record, read);
  }
  return read;
}

/**
 * The authors' name when every suggestion shares one (read clean, as text), else null: what a change file brought in is
 * named by (7.1: the status line and History).
 */
export function sharedAuthor(records: readonly SbdRecord[]): string | null {
  const names = new Set(records.map((record) => readSuggestion(record).author.name));
  const [name] = names;
  return names.size === 1 && name !== undefined && name !== '' ? name : null;
}

/** A record by an id from a suggestion: never one of Object's own keys. */
const recordOf = (records: Records, id: string | null): SbdRecord | null => (id !== null && Object.hasOwn(records, id) ? (records[id] ?? null) : null);

/** A live record of `type`. */
const liveOf = (records: Records, id: JsonValue | undefined, type: string): boolean => {
  const record = typeof id === 'string' ? recordOf(records, id) : null;
  return record?.type === type && record.trashedAt === null;
};

/**
 * A value as it reads, for comparing (7.0 round 2): what reads as empty ('', [], {}, null, a missing prop) is null,
 * and a map's keys are sorted, so two values that read the same are the same whatever their key order.
 */
function normal(value: JsonValue | undefined): JsonValue {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) return value.length === 0 ? null : value.map((v) => normal(v));
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return keys.length === 0 ? null : Object.fromEntries(keys.map((key) => [key, normal(value[key])]));
  }
  return value;
}

/** Whether two values read the same (normal). */
const same = (a: JsonValue | undefined, b: JsonValue | undefined): boolean => JSON.stringify(normal(a)) === JSON.stringify(normal(b));

/** A value with its maps' keys sorted and nothing else changed: two stored values the same but for key order are one. */
function sorted(value: JsonValue | undefined): JsonValue | undefined {
  if (Array.isArray(value)) return value.map((v) => sorted(v) ?? null);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key]) ?? null]));
  return value;
}
const sameStored = (a: JsonValue | undefined, b: JsonValue | undefined): boolean => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** Whether the target was written after the suggester saw it; a time that can't be read counts as changed. */
const newerThan = (updatedAt: string, seen: string | null): boolean => {
  const at = seen === null ? Number.NaN : Date.parse(seen);
  return Number.isNaN(at) || Date.parse(updatedAt) > at;
};

/**
 * When a target was last written, as a `trash` or `reorder` compares it (7.0 round 2): a scene's is the newest of its
 * own and of what trashing it takes with it (its live frames, notes and setups), so a frame added since counts.
 */
function lastWritten(records: Records, target: SbdRecord): string {
  if (target.type !== 'scene') return target.updatedAt;
  let newest = target.updatedAt;
  for (const record of Object.values(records)) {
    if (record.parentId !== target.id || record.trashedAt !== null || (record.type !== 'shot' && record.type !== 'note' && record.type !== 'setup')) continue;
    if (Date.parse(record.updatedAt) > Date.parse(newest)) newest = record.updatedAt;
  }
  return newest;
}

/** What a suggestion asks, as the engine takes it: from a suggestion, or (later) a department's change. */
export interface Proposal {
  kind: SuggestionKind;
  targetId: string | null;
  targetType: string;
  targetUpdatedAt: string | null;
  data: SuggestionData;
}

/** What a proposal would write, its flags, and for a `create` the id of the record it would make. */
export interface ProposedChange {
  flags: SuggestionFlag[];
  /** What Apply writes to the project; [] while a flag blocks it. */
  writes: Change[];
  createdId: string | null;
}

/** Each field's check, as flags: outside the row, or a value that fails. */
function checkFields(
  entry: ScopeType,
  props: ReadonlyMap<string, JsonValue>,
  records: Records,
  record: SbdRecord | null,
  flags: SuggestionFlag[],
  day: SbdRecord | null = null,
): void {
  for (const [field, value] of props) {
    const rule = scopeField(entry, field);
    if (!rule) {
      flags.push({ kind: 'outside_scope', what: 'field', name: cleanText(field, MAX_WORD) || '?' });
      continue;
    }
    const problem = rule.check(value, { records, record, day });
    if (problem) flags.push({ kind: 'invalid', field, problem });
  }
}

/** A time as a call sheet reads it: "HH:MM", else none. */
const sheetTime = (value: JsonValue | undefined): JsonValue => (typeof value === 'string' && isClockTime(value) ? value : null);

/**
 * What a person sees of a field, for changed since (7.0 round 2): a list's live records of its type, in order (what it
 * keeps that isn't one is left out); a call sheet's map, only the keys the suggestion names, each read as the sheet
 * reads it; any other field as stored. `named` is the suggested value.
 */
function seen(records: Records, field: string, rule: ScopeField, value: JsonValue | undefined, named: JsonValue): JsonValue {
  const type = rule.listOf;
  if (type !== undefined) return Array.isArray(value) ? value.filter((id) => liveOf(records, id, type)) : [];
  if (rule.byKey && isObject(named)) {
    const map = isObject(value) ? value : {};
    return Object.fromEntries(
      Object.entries(named).map(([key, asked]): [string, JsonValue] => {
        const stored = Object.hasOwn(map, key) ? map[key] : undefined;
        // A department's call is a time; a person's entry is their times, the ones named (all three for null).
        if (field !== 'person_times') return [key, sheetTime(stored)];
        const entry = isObject(stored) ? stored : {};
        const keys: readonly string[] = isObject(asked) ? Object.keys(asked) : PERSON_TIME_KEYS;
        return [key, Object.fromEntries(keys.map((k) => [k, sheetTime(Object.hasOwn(entry, k) ? entry[k] : undefined)]))];
      }),
    );
  }
  return value ?? null;
}

/** One edit, worked out from the records as the edits before it in the same Apply left them. */
export type Step = (now: Records) => Change[];

/** A record into the working copy as data, never assigned: an id can't reach the object's prototype, however it is spelled. */
const put = (records: Record<string, SbdRecord>, id: string, record: SbdRecord): void => {
  Object.defineProperty(records, id, { value: record, enumerable: true, writable: true, configurable: true });
};

/**
 * The edits a person would make one by one, folded into one op per record they write (7.0 round 2): each is the app's
 * own edit (the Inspector's set, the Days tile's, the Gear picker's, the call sheet's per key), run on the records the
 * edits before it left, so what they write together is exactly what they'd write in turn; then each record gets one
 * op, its create or its update. Nothing is written for a record that reads as it was but for key order. A change of
 * any other kind (a move, a trash) throws (7.0 round 3): folding it would lose it, so a step that makes one can't be
 * added here without folding it first. So does a create with no id, a stamped update and an update to a record that
 * isn't there (7.0 round 4): nothing a step writes is lost without a word.
 */
export function foldEdits(records: Records, steps: readonly Step[]): Change[] {
  const now: Record<string, SbdRecord> = { ...records };
  const order: string[] = [];
  const made = new Map<string, Extract<Change, { kind: 'create' }>>();
  for (const step of steps) {
    for (const change of step(now)) {
      if (change.kind === 'create') {
        const id = change.record.id;
        // Every edit names the record it makes; one that doesn't would be folded away unseen (7.0 round 4).
        if (id === undefined) throw new Error('foldEdits can’t fold a create with no id.');
        made.set(id, change);
        const { type, parentId, sortKey, props = {} } = change.record;
        put(now, id, { id, type, parentId, sortKey, props, trashedAt: null, trashedBy: null, createdAt: '', updatedAt: '' });
        if (!order.includes(id)) order.push(id);
      } else if (change.kind === 'update') {
        // A stamp is the step's own time, which the folded op would drop; an update to a record that isn't there would
        // be dropped too. Neither is an edit a step makes, so either throws rather than lose a write (7.0 round 4).
        if (change.stamp !== undefined) throw new Error(`foldEdits can’t fold a stamped update to ${change.id}.`);
        const record = recordOf(now, change.id);
        if (!record) throw new Error(`foldEdits can’t fold an update to ${change.id}: no such record.`);
        const gone = new Set(change.unset);
        const props = Object.fromEntries(Object.entries({ ...record.props, ...change.set }).filter(([key]) => !gone.has(key)));
        put(now, change.id, { ...record, props });
        if (!order.includes(change.id)) order.push(change.id);
      } else {
        throw new Error(`foldEdits can't fold a ${change.kind} change.`);
      }
    }
  }
  return order.flatMap((id): Change[] => {
    const final = now[id];
    if (!final) return [];
    const create = made.get(id);
    if (create) return [{ ...create, record: { ...create.record, props: final.props } }];
    const was = recordOf(records, id)?.props ?? {};
    const set = Object.fromEntries(Object.entries(final.props).filter(([key, value]) => !Object.hasOwn(was, key) || !sameStored(value, was[key])));
    const unset = Object.keys(was).filter((key) => !Object.hasOwn(final.props, key));
    if (Object.keys(set).length === 0 && unset.length === 0) return [];
    return [{ kind: 'update', id, ...(Object.keys(set).length > 0 ? { set } : {}), ...(unset.length > 0 ? { unset } : {}) }];
  });
}

/** A field set as data, never assigned: a field named __proto__ can't reach here (no row has one), and this keeps it so. */
const define = (props: Record<string, JsonValue>, field: string, value: JsonValue): void => {
  Object.defineProperty(props, field, { value, enumerable: true, writable: true, configurable: true });
};

/**
 * The edits an `update` makes on a frame, scene, note or day, each the app's own: a frame's day as the Days tile
 * schedules it (scheduleFrames), a gear list as the Gear picker adds and removes (gearListChange, the suggested list
 * diffed into what a person would tick on and off), a day's crew call and wrap as the Days tile sets them (dayChange),
 * and every other field as the Inspector sets it, in one update. Fields already as suggested are left out.
 */
function updateSteps(entry: ScopeType, props: ReadonlyMap<string, JsonValue>, records: Records, target: SbdRecord): Step[] {
  const steps: Step[] = [];
  const set: Record<string, JsonValue> = {};
  const unset: string[] = [];
  for (const [field, value] of props) {
    const rule = scopeField(entry, field);
    if (!rule) continue;
    const stored = target.props[field];
    const off = rule.takesOff(value);
    if (field === 'shoot_day_id' && target.type === 'shot') {
      const day = off || typeof value !== 'string' ? null : value;
      steps.push((now) => scheduleFrames(now, [target.id], day));
    } else if (field === 'gear_ids') {
      const wanted = off || !Array.isArray(value) ? [] : value.filter((id): id is string => typeof id === 'string');
      const storedIds = Array.isArray(stored) ? stored : [];
      const removes = storedIds.filter((id): id is string => liveOf(records, id, 'gear_item') && typeof id === 'string' && !wanted.includes(id));
      const adds = wanted.filter((id) => !storedIds.includes(id));
      if (removes.length > 0) steps.push((now) => gearListChange(now, target.id, removes, false));
      if (adds.length > 0) steps.push((now) => gearListChange(now, target.id, adds, true));
    } else if ((field === 'call_time' || field === 'wrap_time') && target.type === 'shoot_day') {
      const prop = field;
      const time = off || typeof value !== 'string' ? '' : value;
      steps.push((now) => dayChange(now, target.id, prop, time));
    } else if (rule.listOf !== undefined) {
      // Every list in the row is a gear list (7.0 round 3: a scene's characters left it): a new one needs the edit a
      // person makes for it, which keeps what they can't see, never a whole list written over.
      throw new Error(`No edit for the list ${field}.`);
    } else if (!same(value, stored)) {
      if (!off) define(set, field, value);
      else if (stored !== undefined) unset.push(field);
    }
  }
  if (Object.keys(set).length > 0 || unset.length > 0) {
    steps.unshift(() => [{ kind: 'update', id: target.id, ...(Object.keys(set).length > 0 ? { set } : {}), ...(unset.length > 0 ? { unset } : {}) }]);
  }
  return steps;
}

/**
 * The edits an `update` makes on a call sheet, each the sheet's own, key by key (7.0 round 2): its notes
 * (callsheetNoteChange), each department's call named (departmentCallChange) and each person's time named
 * (personTimeChange). What isn't named stays, keys this version can't read included. The sheet is made by the first,
 * as the first note typed makes it.
 */
function sheetSteps(props: ReadonlyMap<string, JsonValue>, dayId: string): Step[] {
  // One id for the sheet, as each of the sheet's edits makes one: used only if the day has none yet.
  const id = crypto.randomUUID();
  const steps: Step[] = [];
  for (const [field, value] of props) {
    if (field === 'notes' || field === 'safety_notes') {
      const note = field;
      const text = typeof value === 'string' ? value : '';
      steps.push((now) => callsheetNoteChange(now, dayId, note, text, id));
    } else if (field === 'department_calls' && isObject(value)) {
      for (const [department, time] of Object.entries(value)) {
        steps.push((now) => departmentCallChange(now, dayId, department, typeof time === 'string' ? time : '', id));
      }
    } else if (field === 'person_times' && isObject(value)) {
      for (const [personId, times] of Object.entries(value)) {
        const named: [PersonTimeKey, JsonValue][] = isObject(times)
          ? Object.entries(times).flatMap(([key, time]): [PersonTimeKey, JsonValue][] => (isPersonTimeKey(key) ? [[key, time]] : []))
          : PERSON_TIME_KEYS.map((key): [PersonTimeKey, JsonValue] => [key, null]);
        for (const [key, time] of named) steps.push((now) => personTimeChange(now, dayId, personId, key, typeof time === 'string' ? time : '', id));
      }
    }
  }
  return steps;
}

/** The fields a `create` gives the new record: those it names, but none taken off or empty (the record has none yet). */
function createdProps(entry: ScopeType, props: ReadonlyMap<string, JsonValue>): Record<string, JsonValue> {
  const set: Record<string, JsonValue> = {};
  for (const [field, value] of props) {
    const rule = scopeField(entry, field);
    if (!rule || rule.takesOff(value) || same(value, undefined)) continue;
    define(set, field, value);
  }
  return set;
}

/**
 * A frame goes onto a day only while it is Need to shoot, as the Days tile offers it (4.11): the status it would have
 * once the suggestion is applied, so one that sets Need to shoot too may. A frame already on a live day moves to
 * another whatever its status, as the Days tile's Move to does (MoveFrame, 7.0 round 3), so only a frame on no day is held.
 */
function offDayStatus(records: Records, wasDay: JsonValue | undefined, day: JsonValue | undefined, status: JsonValue | undefined): boolean {
  return typeof day === 'string' && !liveOf(records, wasDay, 'shoot_day') && (status ?? 'need') !== 'need';
}

/** Whether the project has a live scene: with none, a scene added first is where + Add Scene puts one (7.0 round 3). */
const hasLiveScene = (records: Records, projectId: string): boolean =>
  Object.values(records).some((record) => record.type === 'scene' && record.parentId === projectId && record.trashedAt === null);

/** Whether these flags leave Apply open. */
const open = (flags: readonly SuggestionFlag[]): boolean => flags.every(flagAllowsApply);

/** A live child of `parentId` that a frame, note or scene can be placed after: the scene's frames and notes, the project's scenes. */
function liveSibling(records: Records, parentId: string, id: string | null, except: string | null): boolean {
  const record = recordOf(records, id);
  if (!record || record.id === except || record.parentId !== parentId || record.trashedAt !== null) return false;
  return records[parentId]?.type === 'project' ? record.type === 'scene' : record.type === 'shot' || record.type === 'note';
}

/**
 * What a proposal would write under a scope row, and every flag on it, from the records as they are now. The writes
 * are the UI's own edits; nothing here writes. `slate` is the project's slate numbers (1.26), as the board passes them.
 */
export function proposedChange(records: Records, projectId: string, proposal: Proposal, row: ScopeRow, slate: SlateNumbers = NO_SLATE_NUMBERS): ProposedChange {
  const flags: SuggestionFlag[] = [];
  const none = (): ProposedChange => ({ flags, writes: [], createdId: null });
  const entry = scopeType(row, proposal.targetType);
  if (!entry) {
    flags.push({ kind: 'outside_scope', what: 'type', name: cleanText(proposal.targetType, MAX_WORD) || '?' });
    return none();
  }
  if (!entry.kinds.includes(proposal.kind)) {
    flags.push({ kind: 'outside_scope', what: 'kind', name: proposal.kind });
    return none();
  }
  const { data } = proposal;
  if (data.kind !== proposal.kind) {
    flags.push({ kind: 'invalid', field: 'data', problem: 'type' });
    return none();
  }

  if (data.kind === 'create') {
    if (data.type !== proposal.targetType) flags.push({ kind: 'invalid', field: 'type', problem: 'type' });
    const parent = recordOf(records, data.parentId);
    if (!parent) flags.push({ kind: 'gone', what: 'parent' });
    else if (!entry.parents.includes(parent.type) || (parent.type === 'project' && parent.id !== projectId)) flags.push({ kind: 'invalid', field: 'parent_id', problem: 'type' });
    else if (parent.trashedAt !== null) flags.push({ kind: 'trashed', what: 'parent' });
    checkFields(entry, data.props, records, null, flags);
    if (proposal.targetType === 'shot' && offDayStatus(records, undefined, data.props.get('shoot_day_id'), data.props.get('status'))) flags.push({ kind: 'cant_apply', why: 'not_need' });
    // A person adds a scene at the end of the board or after a scene ("/" menu), never before the first: neither does
    // Apply. On a board with no live scene, first and last are one place, where + Add Scene puts it (7.0 round 3).
    if (proposal.targetType === 'scene' && data.afterId === null && hasLiveScene(records, projectId)) flags.push({ kind: 'cant_apply', why: 'scene_first' });
    if (!parent || !open(flags)) return none();
    const afterGone = data.afterId !== null && !liveSibling(records, parent.id, data.afterId, null);
    if (afterGone) flags.push({ kind: 'gone', what: 'after' });
    const set = createdProps(entry, data.props);
    if (proposal.targetType === 'shot') {
      // Its number comes from the scene's own rule: no row lets a suggestion give one.
      const at = afterGone ? null : (data.afterId ?? START_OF_SCENE);
      const made = addShot(records, projectId, parent.id, at, set, slate);
      return { flags, writes: made.changes, createdId: made.shotId };
    }
    if (proposal.targetType === 'note') {
      const at = afterGone ? null : (data.afterId ?? START_OF_SCENE);
      const made = addNoteChanges(records, parent.id, at, typeof set.text === 'string' ? set.text : '');
      return { flags, writes: made.changes, createdId: made.id };
    }
    // After a live scene, or (its after_id gone) at the end, as + Add Scene puts one.
    const made = addSceneChanges(records, projectId, afterGone ? null : data.afterId);
    // The scene's number is the board's (addSceneChanges's); its other fields join the create, so it's made whole.
    const writes = made.changes.map((change): Change =>
      change.kind === 'create' && change.record.id === made.id ? { ...change, record: { ...change.record, props: { ...change.record.props, ...set } } } : change,
    );
    return { flags, writes, createdId: made.id };
  }

  // Every other kind acts on a record that's there: a call sheet through its day.
  const isSheet = proposal.targetType === 'callsheet';
  const target = recordOf(records, proposal.targetId);
  if (!target) flags.push({ kind: 'gone', what: 'target' });
  else if (target.type !== (isSheet ? 'shoot_day' : proposal.targetType)) flags.push({ kind: 'invalid', field: 'target_type', problem: 'type' });
  else if (target.trashedAt !== null) flags.push({ kind: 'trashed', what: 'target' });
  if (!target || !open(flags)) return none();

  if (data.kind === 'update') {
    const record = isSheet ? dayCallsheet(records, target.id) : target;
    checkFields(entry, data.props, records, record, flags, isSheet ? target : null);
    if (target.type === 'shot' && data.props.has('shoot_day_id') && !same(data.props.get('shoot_day_id'), target.props.shoot_day_id)) {
      const status = data.props.has('status') ? data.props.get('status') : shotFields(target.props).status;
      if (offDayStatus(records, target.props.shoot_day_id, data.props.get('shoot_day_id'), status)) flags.push({ kind: 'cant_apply', why: 'not_need' });
    }
    const changed: ChangedField[] = [];
    for (const [field, value] of data.props) {
      const rule = scopeField(entry, field);
      if (!rule) continue;
      const now = seen(records, field, rule, record?.props[field], value);
      const then = seen(records, field, rule, data.before.get(field), value);
      if (!same(now, then)) changed.push({ field, then, suggested: value, now });
    }
    if (changed.length > 0) flags.push({ kind: 'changed_since', fields: changed });
    if (!open(flags)) return none();
    const writes = foldEdits(records, isSheet ? sheetSteps(data.props, target.id) : updateSteps(entry, data.props, records, target));
    if (writes.length === 0) flags.push({ kind: 'no_change' });
    return { flags, writes, createdId: null };
  }

  if (newerThan(lastWritten(records, target), proposal.targetUpdatedAt)) flags.push({ kind: 'changed_since', fields: [] });

  if (data.kind === 'trash') {
    const writes = target.type === 'shot' ? trashShot(records, projectId, target.id, slate) : target.type === 'scene' ? trashScene(records, target.id) : [{ kind: 'trash' as const, id: target.id }];
    return { flags, writes, createdId: null };
  }

  // reorder: a frame or a note, as a drag on the board moves it (scenes don't move by hand, so the row has no reorder for them).
  const parent = recordOf(records, data.parentId);
  if (!parent) flags.push({ kind: 'gone', what: 'parent' });
  else if (!entry.parents.includes(parent.type)) flags.push({ kind: 'invalid', field: 'parent_id', problem: 'type' });
  // A note moves within its own scene only.
  else if (target.type === 'note' && parent.id !== target.parentId) flags.push({ kind: 'invalid', field: 'parent_id', problem: 'not_found' });
  else if (parent.trashedAt !== null) flags.push({ kind: 'trashed', what: 'parent' });
  if (data.afterId === target.id) flags.push({ kind: 'invalid', field: 'after_id', problem: 'not_found' });
  if (parent && target.type === 'shot' && leavesLockedScene(records, target.id, parent.id)) flags.push({ kind: 'locked' });
  if (!parent || !open(flags)) return none();
  const afterGone = data.afterId !== null && !liveSibling(records, parent.id, data.afterId, target.id);
  if (afterGone) flags.push({ kind: 'gone', what: 'after' });
  // Already right after it among the scene's live frames and notes (or first, or last for an after_id gone): no move.
  if (target.parentId === parent.id) {
    const items = boardScene(records, parent).items.map((item) => (item.kind === 'shot' ? item.shot.record.id : item.note.record.id));
    const others = items.filter((id) => id !== target.id);
    const wanted = afterGone ? (others.at(-1) ?? null) : data.afterId;
    if ((items[items.indexOf(target.id) - 1] ?? null) === wanted) {
      flags.push({ kind: 'no_change' });
      return { flags, writes: [], createdId: null };
    }
  }
  const beforeId = afterGone ? null : beforeIdAfter(records, parent.id, data.afterId, target.id);
  const writes = beforeId === undefined ? [] : moveItem(records, projectId, target.id, parent.id, beforeId, slate);
  if (writes.length === 0) flags.push({ kind: 'no_change' });
  return { flags, writes, createdId: null };
}

/**
 * The scope row a suggestion is read under: the assistant's, for every source, until the departments add rows of
 * their own (a web reviewer's row comes with Phase 9).
 */
export const scopeRowFor = (): ScopeRow => ASSISTANT_SCOPE;

export interface SuggestionReview {
  suggestion: Suggestion;
  flags: SuggestionFlag[];
  /** Whether Apply may write it: pending, readable, in scope, and every flag one a person may apply over. */
  canApply: boolean;
  /** What Apply writes to the project, the suggestion's own update aside; [] when it can't be applied. */
  writes: Change[];
  /** For a `create`: the id of the record Apply would make. */
  createdId: string | null;
}

/**
 * A create's parent or after_id, or a reorder's after_id, may name another create suggestion of the same change file:
 * once that one is applied, it reads as the record it made. Undefined when it names no such suggestion.
 */
function madeBy(records: Records, id: string, changeFileId: string | null): { suggestion: Suggestion } | undefined {
  const record = recordOf(records, id);
  if (record?.type !== 'suggestion') return undefined;
  const other = keptSuggestion(record);
  if (other.kind !== 'create' || other.changeFileId === null || other.changeFileId !== changeFileId) return undefined;
  return { suggestion: other };
}

/** Most links a chain of places is followed through; a longer one is left to wait, as one that doesn't loop. */
const MAX_CHAIN = 500;

/** The two links a create waits on: the parent its after_suggestion names, and its after_id. */
const waitLinks = (suggestion: Suggestion): string[] => {
  const links: string[] = [];
  if (suggestion.afterSuggestion !== null) links.push(suggestion.afterSuggestion);
  if (suggestion.data?.kind === 'create' && suggestion.data.afterId !== null) links.push(suggestion.data.afterId);
  return links;
};

/**
 * Whether the link `first` (one of the start's two) leads back to the start through pending creates of the same file
 * (7.0 rounds 3 and 4): naming itself, or a chain that comes back round, each create followed by both of its links
 * (its after_id and its after_suggestion), so a loop that mixes them is found too. Such a create would wait on itself
 * for ever, so it is flagged invalid instead. One visited set, at most MAX_CHAIN creates passed: a longer chain reads
 * as waiting. Each review walks the chain from scratch, so reviewing N chained creates costs about N²/2 reads; fine
 * for a change file's size, and 7.2's screen, which reviews them all, can keep it so.
 */
function loopsBack(records: Records, start: Suggestion, first: string): boolean {
  const passed = new Set<string>();
  const ahead = [first];
  while (passed.size < MAX_CHAIN) {
    const id = ahead.pop();
    if (id === undefined) return false;
    if (id === start.id) return true;
    if (passed.has(id)) continue;
    passed.add(id);
    const other = madeBy(records, id, start.changeFileId);
    if (other?.suggestion.status !== 'pending') continue;
    ahead.push(...waitLinks(other.suggestion));
  }
  return false;
}

/** One suggestion against the project as it is now: what Apply would write, and every flag. Null for a record that isn't one. */
export function reviewSuggestion(records: Records, projectId: string, suggestionId: string, slate: SlateNumbers = NO_SLATE_NUMBERS): SuggestionReview | null {
  const record = recordOf(records, suggestionId);
  if (record?.type !== 'suggestion') return null;
  const suggestion = readSuggestion(record);
  const flags: SuggestionFlag[] = [];
  if (suggestion.status === null) flags.push({ kind: 'newer', what: 'field', name: 'status' });
  else if (suggestion.status !== 'pending') flags.push({ kind: 'decided', status: suggestion.status });
  if (suggestion.kind === null) flags.push({ kind: 'newer', what: 'kind', name: suggestion.kindName || '?' });
  for (const name of suggestion.unknown) flags.push({ kind: 'newer', what: 'field', name });
  if (suggestion.kind !== null && suggestion.data === null) flags.push({ kind: 'invalid', field: suggestion.dataProblem ?? 'data', problem: 'type' });

  let proposed: ProposedChange = { flags: [], writes: [], createdId: null };
  let { data } = suggestion;
  if (suggestion.kind !== null && data !== null) {
    if (data.kind === 'create') {
      const parentBy = suggestion.afterSuggestion;
      // A parent chain that comes back round would wait for ever: it can't be applied (7.0 round 3).
      if (parentBy !== null && loopsBack(records, suggestion, parentBy)) flags.push({ kind: 'invalid', field: 'after_suggestion', problem: 'loop' });
      else if (parentBy !== null) {
        const parent = data.parentId === parentBy ? madeBy(records, parentBy, suggestion.changeFileId) : undefined;
        if (!parent) flags.push({ kind: 'invalid', field: 'after_suggestion', problem: 'not_found' });
        else if (parent.suggestion.status === 'approved' && parent.suggestion.createdId !== null) data = { ...data, parentId: parent.suggestion.createdId };
        else if (parent.suggestion.status === 'rejected') flags.push({ kind: 'gone', what: 'parent' });
        else flags.push({ kind: 'waiting', on: parentBy });
      }
    }
    if (data.kind === 'create' || data.kind === 'reorder') {
      // A sibling made by another suggestion of the same file reads as the record it made, once applied; until then it
      // waits for it (a rejected one made nothing, so the place reads as gone: at the end).
      const afterId = data.afterId;
      const after = afterId === null ? undefined : madeBy(records, afterId, suggestion.changeFileId);
      // After itself, or after a chain of creates that comes back to it: it would wait for ever (7.0 round 3).
      if (data.kind === 'create' && afterId !== null && loopsBack(records, suggestion, afterId)) {
        flags.push({ kind: 'invalid', field: 'after_id', problem: 'loop' });
      } else if (after?.suggestion.status === 'approved' && after.suggestion.createdId !== null) data = { ...data, afterId: after.suggestion.createdId };
      else if (afterId !== null && after?.suggestion.status === 'pending') flags.push({ kind: 'waiting_after', on: afterId });
    }
    const waiting = flags.some((f) => f.kind === 'waiting' || f.kind === 'waiting_after' || (f.kind === 'gone' && f.what === 'parent') || f.kind === 'invalid');
    if (!waiting) {
      proposed = proposedChange(
        records,
        projectId,
        { kind: suggestion.kind, targetId: suggestion.targetId, targetType: suggestion.targetType, targetUpdatedAt: suggestion.targetUpdatedAt, data },
        scopeRowFor(),
        slate,
      );
    }
  }
  const all = [...flags, ...proposed.flags];
  const canApply = suggestion.status === 'pending' && open(all) && (proposed.writes.length > 0 || all.some((f) => f.kind === 'no_change'));
  return { suggestion, flags: all, canApply, writes: canApply ? proposed.writes : [], createdId: canApply ? proposed.createdId : null };
}

const CANT_APPLY_WORDS: Readonly<Record<CantApply, MessageKey>> = {
  scene_first: 'suggestion.flag.sceneFirst',
  not_need: 'suggestion.flag.notNeed',
};

/**
 * The words for the flags round 2 added (7.0): a placement or a day the app can't make by hand, and a place that waits
 * for another suggestion; and round 4's loop, a create that would wait on itself. The other flags get their words with
 * the review screen (7.2). Null for those.
 */
export function flagWords(flag: SuggestionFlag): string | null {
  if (flag.kind === 'cant_apply') return t(CANT_APPLY_WORDS[flag.why]);
  if (flag.kind === 'waiting_after') return t('suggestion.flag.waitingAfter');
  if (flag.kind === 'invalid' && flag.problem === 'loop') return t('suggestion.flag.loop');
  return null;
}

const PROBLEM_WORDS: Readonly<Record<Exclude<ValueProblem, 'loop'>, MessageKey>> = {
  type: 'suggestion.problem.type',
  too_long: 'suggestion.problem.tooLong',
  range: 'suggestion.problem.range',
  choice: 'suggestion.problem.choice',
  not_found: 'suggestion.problem.notFound',
  too_many: 'suggestion.problem.tooMany',
  repeated: 'suggestion.problem.repeated',
  empty: 'suggestion.problem.empty',
  unreadable: 'suggestion.problem.unreadable',
  lens_range: 'suggestion.problem.lensRange',
  not_on_day: 'suggestion.problem.notOnDay',
};

/** Fields of the suggestion itself, not of the record it acts on: named as what they are, never by their key. */
const PLACE_FIELDS: ReadonlySet<string> = new Set(['parent_id', 'after_id', 'after_suggestion']);

/** A field's name in the words: its name in the scope row for the target's type, its place, or else the suggestion's data. */
function fieldName(field: string, targetType: string): string {
  if (PLACE_FIELDS.has(field)) return t('suggestion.field.place');
  const entry = scopeType(ASSISTANT_SCOPE, targetType);
  const rule = entry ? scopeField(entry, field) : null;
  return rule ? t(rule.label) : t('suggestion.field.data');
}

/**
 * Every flag in words (7.2's review screen; 7.5's server can say the same): flagWords's own, and the words of every
 * other flag, which flagWords leaves null. `targetType` names an invalid value's field as the scope row names it.
 */
export function reviewFlagWords(flag: SuggestionFlag, targetType = ''): string {
  const own = flagWords(flag);
  if (own !== null) return own;
  switch (flag.kind) {
    case 'decided':
      return t(flag.status === 'rejected' ? 'suggestion.flag.rejected' : 'suggestion.flag.applied');
    case 'newer':
      return t(flag.what === 'kind' ? 'suggestion.flag.newerKind' : 'suggestion.flag.newerField', { name: flag.name });
    case 'outside_scope':
      return t(flag.what === 'kind' ? 'suggestion.flag.outsideKind' : flag.what === 'type' ? 'suggestion.flag.outsideType' : 'suggestion.flag.outsideField', { name: flag.name });
    case 'invalid':
      return flag.problem === 'loop' ? t('suggestion.flag.loop') : t(PROBLEM_WORDS[flag.problem], { field: fieldName(flag.field, targetType) });
    case 'gone':
      return t(flag.what === 'target' ? 'suggestion.flag.goneTarget' : flag.what === 'parent' ? 'suggestion.flag.goneParent' : 'suggestion.flag.goneAfter');
    case 'trashed':
      return t(flag.what === 'target' ? 'suggestion.flag.trashedTarget' : 'suggestion.flag.trashedParent');
    case 'waiting':
      return t('suggestion.flag.waiting');
    case 'locked':
      return t('suggestion.flag.locked');
    case 'changed_since':
      return t('suggestion.flag.changedSince');
    case 'no_change':
      return t('suggestion.flag.noChange');
    // flagWords has words for these; kept here so a new flag is a type error until it has its own.
    case 'cant_apply':
    case 'waiting_after':
      return '';
  }
}

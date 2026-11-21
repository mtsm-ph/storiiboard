import { dayCallsheet } from './callsheet';
import type { JsonValue, SbdRecord } from './record';
import { isClockTime } from './shootDay';
import { NO_SLATE_NUMBERS, type SlateNumbers } from './shotNumbers';
import {
  ASSISTANT_SCOPE,
  isSuggestionKind,
  scopeField,
  scopeType,
  type ScopeRow,
  type ScopeType,
  type SuggestionKind,
  type ValueProblem,
} from './suggestionScope';
import { callsheetPropsChange } from '../ops/callsheetEdits';
import type { Change } from '../ops/ops';
import {
  addNoteChanges,
  addSceneChanges,
  addSceneFirstChanges,
  addShot,
  beforeIdAfter,
  leavesLockedScene,
  moveItem,
  moveSceneChanges,
  START_OF_SCENE,
  trashScene,
  trashShot,
} from '../ops/storyboardEdits';

// A suggestion (7.0, docs/SBD_FORMAT.md "Change files"): what one would do to the project and whether it still can.
// A `suggestion` record comes from a change file or the assistant, so everything in it is untrusted: it is read here
// bounded and rebuilt clean, as a settings preset is, before anything is shown or written. Pure (no page, no storage),
// so 7.5's server reads suggestions with the same code.
//
// What Apply writes is made by the edits the UI itself makes (src/core/ops: storyboardEdits, dayEdits, gearEdits,
// callsheetEdits), never a copy of them: a frame added by a suggestion is numbered, placed and keyed exactly as one
// added on the board. The engine (src/core/ops/suggestions.ts) adds the suggestion's own update and writes the group.
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
  /** A frame can't leave a scene whose shot numbers are locked (unlocking it first frees it). */
  | { kind: 'locked' }
  /** Changed since it was suggested: for an update, field by field with the three values; else the target's time. */
  | { kind: 'changed_since'; fields: readonly ChangedField[] }
  /** The project already reads as suggested: Apply writes only the decision. */
  | { kind: 'no_change' };

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

const isObject = (value: JsonValue | undefined): value is { [key: string]: JsonValue } => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Text to show: control characters and bidi overrides out (line breaks kept with `lines`), trimmed, at most `max` characters. */
function cleanText(value: JsonValue | undefined, max: number, lines = false): string {
  if (typeof value !== 'string') return '';
  // Cut first, so a 10 MB text is never walked whole: room for every character as a surrogate pair, and some to strip.
  const head = value.length > max * 4 ? value.slice(0, max * 4) : value;
  const kept = lines ? head.replace(/[^\P{Cc}\n\t]|[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/gu, '') : head.replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/gu, '');
  return Array.from(kept.trim()).slice(0, max).join('').trim();
}

/** An id as stored, or null: text of an id's length, nothing else. */
const idText = (value: JsonValue | undefined): string | null => (typeof value === 'string' && value !== '' && value.length <= MAX_ID ? value : null);
const timeText = (value: JsonValue | undefined): string | null => (typeof value === 'string' && value.length <= MAX_TIME && !Number.isNaN(Date.parse(value)) ? value : null);

const KNOWN_PROPS: ReadonlySet<string> = new Set([
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

/** A record by an id from a suggestion: never one of Object's own keys. */
const recordOf = (records: Records, id: string | null): SbdRecord | null => (id !== null && Object.hasOwn(records, id) ? (records[id] ?? null) : null);

const same = (a: JsonValue | undefined, b: JsonValue | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Whether the target was written after the suggester saw it; a time that can't be read counts as changed. */
const newerThan = (record: SbdRecord, seen: string | null): boolean => {
  const at = seen === null ? Number.NaN : Date.parse(seen);
  return Number.isNaN(at) || Date.parse(record.updatedAt) > at;
};

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

/**
 * The value written for a field: the suggested one, with what the record keeps there that this version can't read
 * written back as it was, as the field's own edit does (a day's gear list, a call sheet's calls and times).
 */
function writtenValue(field: string, value: JsonValue, stored: JsonValue | undefined): JsonValue {
  if (field === 'gear_ids' && Array.isArray(value) && Array.isArray(stored)) return [...value, ...stored.filter((v) => typeof v !== 'string')];
  if (field === 'department_calls' && isObject(value) && isObject(stored)) {
    const kept = Object.entries(stored).filter(([key, time]) => !Object.hasOwn(value, key) && (typeof time !== 'string' || !isClockTime(time)));
    return Object.fromEntries([...kept, ...Object.entries(value)]);
  }
  if (field === 'person_times' && isObject(value) && isObject(stored)) {
    const kept = Object.entries(stored).filter(([key, entry]) => !Object.hasOwn(value, key) && !isObject(entry));
    const merged = Object.entries(value).map(([key, entry]): [string, JsonValue] => {
      const was = stored[key];
      if (!isObject(entry) || !isObject(was)) return [key, entry];
      const unread = Object.entries(was).filter(([k]) => !['call', 'hmu_ready', 'on_set'].includes(k));
      return [key, Object.fromEntries([...unread, ...Object.entries(entry)])];
    });
    return Object.fromEntries([...kept, ...merged]);
  }
  return value;
}

/** Each field's check, as flags: outside the row, or a value that fails. */
function checkFields(entry: ScopeType, props: ReadonlyMap<string, JsonValue>, records: Records, record: SbdRecord | null, flags: SuggestionFlag[]): void {
  for (const [field, value] of props) {
    const rule = scopeField(entry, field);
    if (!rule) {
      flags.push({ kind: 'outside_scope', what: 'field', name: cleanText(field, MAX_WORD) || '?' });
      continue;
    }
    const problem = rule.check(value, { records, record });
    if (problem) flags.push({ kind: 'invalid', field, problem });
  }
}

/** The set and unset that bring a record's named fields to the suggested values; fields already so are left out. */
function setAndUnset(entry: ScopeType, props: ReadonlyMap<string, JsonValue>, record: SbdRecord | null): { set: Record<string, JsonValue>; unset: string[] } {
  const set: Record<string, JsonValue> = {};
  const unset: string[] = [];
  for (const [field, value] of props) {
    const rule = scopeField(entry, field);
    if (!rule) continue;
    const stored = record?.props[field];
    if (rule.takesOff(value)) {
      // Emptied, a list or a map still keeps what this version can't read in it, as its own edit does.
      const empty: JsonValue | null = field === 'gear_ids' ? [] : field === 'department_calls' || field === 'person_times' ? {} : null;
      const kept = empty === null ? null : writtenValue(field, empty, stored);
      const keepsSome = kept !== null && (Array.isArray(kept) ? kept.length > 0 : isObject(kept) && Object.keys(kept).length > 0);
      if (keepsSome) {
        if (!same(kept, stored)) Object.defineProperty(set, field, { value: kept, enumerable: true, writable: true, configurable: true });
      } else if (stored !== undefined) unset.push(field);
      continue;
    }
    const written = writtenValue(field, value, stored);
    // Defined as data, never assigned: a field named __proto__ can't reach here (no row has one), and this keeps it so.
    if (!same(written, stored)) Object.defineProperty(set, field, { value: written, enumerable: true, writable: true, configurable: true });
  }
  return { set, unset };
}

/** Whether these flags leave Apply open. */
const open = (flags: readonly SuggestionFlag[]): boolean => flags.every(flagAllowsApply);

/** A live child of `parentId` that a frame, note or scene can be placed after: the scene's frames and notes, the project's scenes. */
function liveSibling(records: Records, parentId: string, id: string | null, except: string | null): boolean {
  const record = recordOf(records, id);
  if (!record || record.id === except || record.parentId !== parentId || record.trashedAt !== null) return false;
  return records[parentId]?.type === 'project' ? record.type === 'scene' : record.type === 'shot' || record.type === 'note';
}

/** The last live scene on the board but `except`, or null. */
function lastScene(records: Records, projectId: string, except: string | null): string | null {
  const scenes = Object.values(records)
    .filter((r) => r.type === 'scene' && r.parentId === projectId && r.trashedAt === null && r.id !== except)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  return scenes.at(-1)?.id ?? null;
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
    if (!parent || !open(flags)) return none();
    const afterGone = data.afterId !== null && !liveSibling(records, parent.id, data.afterId, null);
    if (afterGone) flags.push({ kind: 'gone', what: 'after' });
    const { set } = setAndUnset(entry, data.props, null);
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
    const made = data.afterId === null ? addSceneFirstChanges(records, projectId) : addSceneChanges(records, projectId, afterGone ? null : data.afterId);
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
    checkFields(entry, data.props, records, record, flags);
    const changed: ChangedField[] = [];
    for (const [field, value] of data.props) {
      if (!scopeField(entry, field)) continue;
      const now = record?.props[field] ?? null;
      const then = data.before.get(field) ?? null;
      if (!same(now, then)) changed.push({ field, then, suggested: value, now });
    }
    if (changed.length > 0) flags.push({ kind: 'changed_since', fields: changed });
    if (!open(flags)) return none();
    const { set, unset } = setAndUnset(entry, data.props, record);
    const writes: Change[] = isSheet
      ? callsheetPropsChange(records, target.id, set, unset)
      : Object.keys(set).length > 0 || unset.length > 0
        ? [{ kind: 'update', id: target.id, ...(Object.keys(set).length > 0 ? { set } : {}), ...(unset.length > 0 ? { unset } : {}) }]
        : [];
    if (writes.length === 0) flags.push({ kind: 'no_change' });
    return { flags, writes, createdId: null };
  }

  if (newerThan(target, proposal.targetUpdatedAt)) flags.push({ kind: 'changed_since', fields: [] });

  if (data.kind === 'trash') {
    const writes = target.type === 'shot' ? trashShot(records, projectId, target.id, slate) : target.type === 'scene' ? trashScene(records, target.id) : [{ kind: 'trash' as const, id: target.id }];
    return { flags, writes, createdId: null };
  }

  // reorder
  const parent = recordOf(records, data.parentId);
  if (!parent) flags.push({ kind: 'gone', what: 'parent' });
  else if (!entry.parents.includes(parent.type) || (parent.type === 'project' && parent.id !== projectId)) flags.push({ kind: 'invalid', field: 'parent_id', problem: 'type' });
  // A note moves within its own scene only.
  else if (target.type === 'note' && parent.id !== target.parentId) flags.push({ kind: 'invalid', field: 'parent_id', problem: 'not_found' });
  else if (parent.trashedAt !== null) flags.push({ kind: 'trashed', what: 'parent' });
  if (data.afterId === target.id) flags.push({ kind: 'invalid', field: 'after_id', problem: 'not_found' });
  if (parent && target.type === 'shot' && leavesLockedScene(records, target.id, parent.id)) flags.push({ kind: 'locked' });
  if (!parent || !open(flags)) return none();
  const afterGone = data.afterId !== null && !liveSibling(records, parent.id, data.afterId, target.id);
  if (afterGone) flags.push({ kind: 'gone', what: 'after' });
  let writes: Change[];
  if (target.type === 'scene') {
    writes = moveSceneChanges(records, projectId, target.id, afterGone ? lastScene(records, projectId, target.id) : data.afterId);
  } else {
    const beforeId = afterGone ? null : beforeIdAfter(records, parent.id, data.afterId, target.id);
    writes = beforeId === undefined ? [] : moveItem(records, projectId, target.id, parent.id, beforeId, slate);
  }
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
 * A create's parent or after_id may name another create suggestion of the same change file: once that one is applied,
 * it reads as the record it made. Undefined when it names no such suggestion.
 */
function madeBy(records: Records, id: string, changeFileId: string | null): { suggestion: Suggestion } | undefined {
  const record = recordOf(records, id);
  if (record?.type !== 'suggestion') return undefined;
  const other = readSuggestion(record);
  if (other.kind !== 'create' || other.changeFileId === null || other.changeFileId !== changeFileId) return undefined;
  return { suggestion: other };
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
      if (parentBy !== null) {
        const parent = data.parentId === parentBy ? madeBy(records, parentBy, suggestion.changeFileId) : undefined;
        if (!parent) flags.push({ kind: 'invalid', field: 'after_suggestion', problem: 'not_found' });
        else if (parent.suggestion.status === 'approved' && parent.suggestion.createdId !== null) data = { ...data, parentId: parent.suggestion.createdId };
        else if (parent.suggestion.status === 'rejected') flags.push({ kind: 'gone', what: 'parent' });
        else flags.push({ kind: 'waiting', on: parentBy });
      }
      // A sibling made by an earlier suggestion of the same file reads as the record it made, once applied.
      const after = data.afterId === null ? undefined : madeBy(records, data.afterId, suggestion.changeFileId);
      if (after?.suggestion.status === 'approved' && after.suggestion.createdId !== null) data = { ...data, afterId: after.suggestion.createdId };
    }
    const waiting = flags.some((f) => f.kind === 'waiting' || (f.kind === 'gone' && f.what === 'parent') || f.kind === 'invalid');
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

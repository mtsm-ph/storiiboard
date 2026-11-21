import { t } from '../i18n';
import type { JsonValue, Props } from '../model/record';
import { cleanText, KNOWN_PROPS, SUGGESTION_BOUNDS } from '../model/suggestion';

// The reader of a change file (7.1, docs/SBD_FORMAT.md "Change files", Importing): bytes in, a checked file or a refusal
// out. A change file is untrusted input (Kevin, Nov 21): anyone can write one by hand, so everything in it is checked
// here before anything is stored, and what comes out is only the props of `suggestion` records, built key by key as
// data, never assigned, so no key in the file (`__proto__` among them) reaches anything. Pure (no page, no storage, no
// disk), so 7.5's server shares it to write files of the same shape. Rust caps the bytes before the page sees one
// (src-tauri/src/changes.rs); the cap is checked here again.

export const CHANGE_FILE_FORMAT = 'storiiboard.changes';
/** The newest format version this app reads; a newer one is refused whole. */
export const CHANGE_FILE_VERSION = 1;
/** 5 MB, as Rust caps it. */
export const MAX_CHANGE_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_SUGGESTIONS = 2000;
export const MAX_PEOPLE = 50;
/** Arrays and objects inside each other, the file's own object counted: a sound file needs 7 (a call sheet's times). */
export const MAX_DEPTH = 16;
/** Any string the format gives no bound of its own: the largest a field can take (an action, a call sheet's notes). */
export const MAX_TEXT = 10_000;
/** Any key: a field's name, a person's or a department's id. */
export const MAX_KEY = 100;

/**
 * The largest one suggestion may be, as JSON in UTF-8 (7.1 round 3): a bound chosen, not one 7.0 implies, to fit two
 * full 10,000-character fields with their `before` in any script (four such strings take at most 120,000 bytes).
 */
export const MAX_SUGGESTION_BYTES = 256 * 1024;

/** The format's own fields of the file, the only names a refusal ever says: never a key the file itself wrote. */
export type ChangeFileField = 'version' | 'id' | 'project_id' | 'project_name' | 'created_by' | 'created_at' | 'people' | 'suggestions';
const FILE_FIELDS: ReadonlySet<string> = new Set<ChangeFileField>(['version', 'id', 'project_id', 'project_name', 'created_by', 'created_at', 'people', 'suggestions']);

/**
 * Where in the file a refused field is (7.1 round 2): a field of the file by the format's name (null for one the format
 * doesn't name), or a suggestion or a person by its position, counted from 1. Never by the file's own key text.
 */
export type ChangeFileAt = { in: 'file'; field: ChangeFileField | null } | { in: 'suggestion' | 'person'; position: number };

/** Why a file was refused whole. */
export type ChangeFileRefusal =
  | { kind: 'too_large' }
  | { kind: 'not_text' }
  | { kind: 'too_deep' }
  | { kind: 'not_json' }
  | { kind: 'not_change_file' }
  | { kind: 'newer_version' }
  | { kind: 'other_project'; projectName: string }
  | { kind: 'too_many'; what: 'suggestions' | 'people' }
  | { kind: 'too_long'; at: ChangeFileAt }
  | { kind: 'bad_field'; at: ChangeFileAt }
  | { kind: 'suggestion_too_large'; position: number };

const fileField = (field: ChangeFileField): ChangeFileAt => ({ in: 'file', field });
const inSuggestion = (index: number): ChangeFileAt => ({ in: 'suggestion', position: index + 1 });
const inPerson = (index: number): ChangeFileAt => ({ in: 'person', position: index + 1 });

/** One suggestion, ready to be a `suggestion` record: its id and its props, with `status: pending`. */
export interface ChangeFileSuggestion {
  id: string;
  props: Props;
}

export interface ChangeFile {
  id: string;
  projectId: string;
  /** What wrote it, as text (`mcp`, `web`, or anything a person typed). */
  createdBy: string;
  suggestions: ChangeFileSuggestion[];
}

export type ChangeFileRead = { ok: true; file: ChangeFile } | { ok: false; refusal: ChangeFileRefusal };

type JsonObject = { [key: string]: JsonValue };

const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A lowercase UUID: a record's id (every table's id is a UUID), one spelling only. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The record's own props, which only the app sets: a suggestion field by one of these names is refused, never copied
 * over what the app writes (a file can't arrive `approved`). `kind`, `note`, `data` and `author` are the file's own.
 */
const RECORD_ONLY: ReadonlySet<string> = new Set([...KNOWN_PROPS].filter((name) => !['kind', 'note', 'data', 'author'].includes(name)));

/** A suggestion's fields the reader maps; any other is kept under its own name. */
const MAPPED: ReadonlySet<string> = new Set(['id', 'kind', 'target', 'author', 'created_at', 'note', 'data']);
/** A target's fields mapped onto the record's target_* props; any other is kept as `target_<name>`. */
const TARGET_MAPPED: Readonly<Record<string, string>> = { id: 'target_id', type: 'target_type', label: 'target_label', updated_at: 'target_updated_at' };

const refuse = (refusal: ChangeFileRefusal): ChangeFileRead => ({ ok: false, refusal });

/** A key set as data, never assigned: `__proto__` and `constructor` are plain keys here, reaching no prototype. */
const define = (target: Props, key: string, value: JsonValue): void => {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
};

/**
 * Whether the text nests arrays and objects deeper than `max`, read before it's parsed, so a file of a million `[`
 * never reaches JSON.parse's own recursion. Brackets inside strings don't count.
 */
function nestsDeeper(text: string, max: number): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i += 1;
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) inString = true;
    else if (c === 0x5b || c === 0x7b) {
      depth += 1;
      if (depth > max) return true;
    } else if (c === 0x5d || c === 0x7d) depth -= 1;
  }
  return false;
}

/** Whether any string or key anywhere in `value` is past the general bounds. */
function overlong(value: JsonValue): boolean {
  if (typeof value === 'string') return value.length > MAX_TEXT;
  if (Array.isArray(value)) return value.some((inner) => overlong(inner));
  if (isObject(value)) return Object.entries(value).some(([key, inner]) => key.length > MAX_KEY || overlong(inner));
  return false;
}

/** Where the first string or key past the general bounds is, by position; null when every one is within. */
function overlongAt(parsed: JsonObject): ChangeFileAt | null {
  for (const [key, value] of Object.entries(parsed)) {
    if (key.length > MAX_KEY) return { in: 'file', field: null };
    if ((key === 'people' || key === 'suggestions') && Array.isArray(value)) {
      const index = value.findIndex((inner) => overlong(inner));
      if (index >= 0) return key === 'people' ? inPerson(index) : inSuggestion(index);
    } else if (overlong(value)) {
      return { in: 'file', field: FILE_FIELDS.has(key) ? (key as ChangeFileField) : null };
    }
  }
  return null;
}

/** Whether a field that, when it's a string, has a bound of its own is over it. */
const overBound = (value: JsonValue | undefined, max: number): boolean => typeof value === 'string' && value.length > max;

/** Whether an optional field that must be text when it's there is something else. */
const notText = (value: JsonValue | undefined, nullable = false): boolean => !(value === undefined || typeof value === 'string' || (nullable && value === null));

/** A suggestion's size as JSON in UTF-8, counted no further than the bound. */
const overSize = (value: JsonValue): boolean => {
  const text = JSON.stringify(value);
  // Each UTF-16 unit is at most 3 bytes in UTF-8: a text short enough can't be over, and needs no encoding.
  return text.length * 3 > MAX_SUGGESTION_BYTES && new TextEncoder().encode(text).byteLength > MAX_SUGGESTION_BYTES;
};

/** Reads a change file for the project `projectId`: the suggestions it would bring in, or why it can't be. */
export function readChangeFile(bytes: Uint8Array, projectId: string): ChangeFileRead {
  if (bytes.byteLength > MAX_CHANGE_FILE_BYTES) return refuse({ kind: 'too_large' });
  let text: string;
  try {
    // Fatal, so a file that isn't UTF-8 is refused rather than read with replacement characters; a BOM is dropped.
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return refuse({ kind: 'not_text' });
  }
  if (nestsDeeper(text, MAX_DEPTH)) return refuse({ kind: 'too_deep' });
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text) as JsonValue;
  } catch {
    return refuse({ kind: 'not_json' });
  }
  if (!isObject(parsed) || parsed.format !== CHANGE_FILE_FORMAT) return refuse({ kind: 'not_change_file' });
  const { version } = parsed;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return refuse({ kind: 'bad_field', at: fileField('version') });
  if (version > CHANGE_FILE_VERSION) return refuse({ kind: 'newer_version' });
  const fileId = parsed.id;
  if (typeof fileId !== 'string' || !UUID.test(fileId)) return refuse({ kind: 'bad_field', at: fileField('id') });
  if (typeof parsed.project_id !== 'string' || parsed.project_id.length > SUGGESTION_BOUNDS.id) return refuse({ kind: 'bad_field', at: fileField('project_id') });
  if (parsed.project_id !== projectId) return refuse({ kind: 'other_project', projectName: cleanText(parsed.project_name, SUGGESTION_BOUNDS.name) });

  const people = parsed.people ?? [];
  const suggestions = parsed.suggestions;
  if (!Array.isArray(people)) return refuse({ kind: 'bad_field', at: fileField('people') });
  if (!Array.isArray(suggestions)) return refuse({ kind: 'bad_field', at: fileField('suggestions') });
  if (suggestions.length > MAX_SUGGESTIONS) return refuse({ kind: 'too_many', what: 'suggestions' });
  if (people.length > MAX_PEOPLE) return refuse({ kind: 'too_many', what: 'people' });

  // Every string within its bound: the format's own first, then any string and key anywhere.
  const personOver = people.findIndex(
    (person) =>
      isObject(person) &&
      (overBound(person.id, SUGGESTION_BOUNDS.id) ||
        overBound(person.name, SUGGESTION_BOUNDS.name) ||
        overBound(person.role, SUGGESTION_BOUNDS.word) ||
        overBound(person.person_id, SUGGESTION_BOUNDS.id)),
  );
  const suggestionOver = suggestions.findIndex((suggestion) => {
    if (!isObject(suggestion)) return false;
    const target = isObject(suggestion.target) ? suggestion.target : {};
    return (
      overBound(suggestion.kind, SUGGESTION_BOUNDS.word) ||
      overBound(suggestion.author, SUGGESTION_BOUNDS.id) ||
      overBound(suggestion.created_at, SUGGESTION_BOUNDS.time) ||
      overBound(suggestion.note, SUGGESTION_BOUNDS.note) ||
      overBound(target.id, SUGGESTION_BOUNDS.id) ||
      overBound(target.type, SUGGESTION_BOUNDS.word) ||
      overBound(target.label, SUGGESTION_BOUNDS.label) ||
      overBound(target.updated_at, SUGGESTION_BOUNDS.time)
    );
  });
  const bounded: ChangeFileAt | null = overBound(parsed.created_by, SUGGESTION_BOUNDS.name)
    ? fileField('created_by')
    : overBound(parsed.project_name, SUGGESTION_BOUNDS.name)
      ? fileField('project_name')
      : overBound(parsed.created_at, SUGGESTION_BOUNDS.time)
        ? fileField('created_at')
        : personOver >= 0
          ? inPerson(personOver)
          : suggestionOver >= 0
            ? inSuggestion(suggestionOver)
            : overlongAt(parsed);
  if (bounded !== null) return refuse({ kind: 'too_long', at: bounded });

  // Who made them: only an id, a name, a role and a person record, so no contact detail is ever copied.
  const authors = new Map<string, JsonObject>();
  for (const [i, person] of people.entries()) {
    if (!isObject(person) || typeof person.id !== 'string' || person.id === '' || authors.has(person.id)) return refuse({ kind: 'bad_field', at: inPerson(i) });
    if (notText(person.name) || notText(person.role) || notText(person.person_id, true)) return refuse({ kind: 'bad_field', at: inPerson(i) });
    const author: Props = {};
    define(author, 'name', person.name ?? '');
    define(author, 'role', person.role ?? '');
    if (typeof person.person_id === 'string' && person.person_id !== '') define(author, 'person_id', person.person_id);
    authors.set(person.id, author);
  }

  // The file's creates, by id, so a create under another one names it in after_suggestion.
  const ids = new Set<string>();
  const creates = new Set<string>();
  for (const [i, suggestion] of suggestions.entries()) {
    if (!isObject(suggestion)) return refuse({ kind: 'bad_field', at: inSuggestion(i) });
    if (typeof suggestion.id !== 'string' || !UUID.test(suggestion.id) || ids.has(suggestion.id)) return refuse({ kind: 'bad_field', at: inSuggestion(i) });
    if (overSize(suggestion)) return refuse({ kind: 'suggestion_too_large', position: i + 1 });
    ids.add(suggestion.id);
    if (suggestion.kind === 'create') creates.add(suggestion.id);
  }

  const createdBy = typeof parsed.created_by === 'string' ? parsed.created_by : '';
  const out: ChangeFileSuggestion[] = [];
  for (const [i, raw] of suggestions.entries()) {
    // Checked above: an object with a UUID id.
    if (!isObject(raw) || typeof raw.id !== 'string') return refuse({ kind: 'bad_field', at: inSuggestion(i) });
    const props: Props = {};
    for (const key of Object.keys(raw)) {
      if (RECORD_ONLY.has(key)) return refuse({ kind: 'bad_field', at: inSuggestion(i) });
    }
    if (raw.kind !== undefined) define(props, 'kind', raw.kind);
    if (isObject(raw.target)) {
      for (const [key, value] of Object.entries(raw.target)) {
        const prop = Object.hasOwn(TARGET_MAPPED, key) ? (TARGET_MAPPED[key] ?? '') : `target_${key}`;
        // `target_<name>` for a field this version doesn't know, kept and flagged; one already a field of the
        // suggestion's own can't be both, so the file is refused.
        if (!Object.hasOwn(TARGET_MAPPED, key) && (Object.hasOwn(raw, prop) || RECORD_ONLY.has(prop) || KNOWN_PROPS.has(prop))) {
          return refuse({ kind: 'bad_field', at: inSuggestion(i) });
        }
        define(props, prop, value);
      }
    } else if (raw.target !== undefined) {
      return refuse({ kind: 'bad_field', at: inSuggestion(i) });
    }
    const author = typeof raw.author === 'string' ? authors.get(raw.author) : undefined;
    define(props, 'author', author ?? { name: '', role: '' });
    if (raw.created_at !== undefined) define(props, 'suggested_at', raw.created_at);
    if (raw.note !== undefined) define(props, 'note', raw.note);
    if (raw.data !== undefined) define(props, 'data', raw.data);
    define(props, 'status', 'pending');
    define(props, 'source', createdBy === 'mcp' ? 'mcp' : 'change_file');
    define(props, 'change_file_id', fileId);
    const data = raw.data;
    if (raw.kind === 'create' && isObject(data) && typeof data.parent_id === 'string' && data.parent_id !== raw.id && creates.has(data.parent_id)) {
      define(props, 'after_suggestion', data.parent_id);
    }
    for (const [key, value] of Object.entries(raw)) {
      // `__proto__` is the one name whose assignment anywhere could reach a prototype: it is left out, never copied.
      if (MAPPED.has(key) || key === '__proto__') continue;
      define(props, key, value);
    }
    out.push({ id: raw.id, props });
  }
  return { ok: true, file: { id: fileId, projectId, createdBy, suggestions: out } };
}

/** Where a refused field is, in words: a suggestion or a person by its position. */
const atWords = (at: { in: 'suggestion' | 'person'; position: number }): string =>
  at.in === 'suggestion' ? t('changes.at.suggestion', { n: at.position }) : t('changes.at.person', { n: at.position });

/** What a refusal says, in the app's language. A name from the file is shown as text; a field only by position. */
export function refusalWords(refusal: ChangeFileRefusal): string {
  switch (refusal.kind) {
    case 'too_large':
      return t('changes.refused.tooLarge');
    case 'not_text':
      return t('changes.refused.notText');
    case 'too_deep':
      return t('changes.refused.tooDeep');
    case 'not_json':
      return t('changes.refused.notJson');
    case 'not_change_file':
      return t('changes.refused.notChangeFile');
    case 'newer_version':
      return t('changes.refused.newer');
    case 'other_project':
      return refusal.projectName === '' ? t('changes.refused.otherProject') : t('changes.refused.otherProjectNamed', { name: refusal.projectName });
    case 'too_many':
      return refusal.what === 'suggestions' ? t('changes.refused.tooManySuggestions') : t('changes.refused.tooManyPeople');
    case 'too_long':
      if (refusal.at.in !== 'file') return t('changes.refused.tooLongAt', { at: atWords(refusal.at) });
      return refusal.at.field === null ? t('changes.refused.tooLongField') : t('changes.refused.tooLong', { field: refusal.at.field });
    case 'bad_field':
      if (refusal.at.in !== 'file') return t('changes.refused.badFieldAt', { at: atWords(refusal.at) });
      return refusal.at.field === null ? t('changes.refused.badFieldField') : t('changes.refused.badField', { field: refusal.at.field });
    case 'suggestion_too_large':
      return t('changes.refused.suggestionTooLarge', { n: refusal.position });
  }
}

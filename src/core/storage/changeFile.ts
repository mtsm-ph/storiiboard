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

/** Why a file was refused whole. `field` is a path in the file (`suggestions[3].note`), shown as text. */
export type ChangeFileRefusal =
  | { kind: 'too_large' }
  | { kind: 'not_text' }
  | { kind: 'too_deep' }
  | { kind: 'not_json' }
  | { kind: 'not_change_file' }
  | { kind: 'newer_version' }
  | { kind: 'other_project'; projectName: string }
  | { kind: 'too_many'; what: 'suggestions' | 'people' }
  | { kind: 'too_long'; field: string }
  | { kind: 'bad_field'; field: string };

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

/** The first string or key anywhere in `value` past the general bounds, as a path; null when every one is within. */
function overlong(value: JsonValue, path: string): string | null {
  if (typeof value === 'string') return value.length > MAX_TEXT ? path : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = overlong(value[i] ?? null, `${path}[${String(i)}]`);
      if (found) return found;
    }
    return null;
  }
  if (isObject(value)) {
    for (const [key, inner] of Object.entries(value)) {
      const at = `${path}.${key.length > MAX_KEY ? `${key.slice(0, 20)}…` : key}`;
      if (key.length > MAX_KEY) return at;
      const found = overlong(inner, at);
      if (found) return found;
    }
  }
  return null;
}

/** A field that, when it's a string, has a bound of its own: the path when it's over it. */
const overBound = (value: JsonValue | undefined, max: number, path: string): string | null => (typeof value === 'string' && value.length > max ? path : null);

/** An optional field that must be text when it's there: a path when it's something else. */
const notText = (value: JsonValue | undefined, path: string, nullable = false): string | null =>
  value === undefined || typeof value === 'string' || (nullable && value === null) ? null : path;

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
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return refuse({ kind: 'bad_field', field: 'version' });
  if (version > CHANGE_FILE_VERSION) return refuse({ kind: 'newer_version' });
  const fileId = parsed.id;
  if (typeof fileId !== 'string' || !UUID.test(fileId)) return refuse({ kind: 'bad_field', field: 'id' });
  if (typeof parsed.project_id !== 'string' || parsed.project_id.length > SUGGESTION_BOUNDS.id) return refuse({ kind: 'bad_field', field: 'project_id' });
  if (parsed.project_id !== projectId) return refuse({ kind: 'other_project', projectName: cleanText(parsed.project_name, SUGGESTION_BOUNDS.name) });

  const people = parsed.people ?? [];
  const suggestions = parsed.suggestions;
  if (!Array.isArray(people)) return refuse({ kind: 'bad_field', field: 'people' });
  if (!Array.isArray(suggestions)) return refuse({ kind: 'bad_field', field: 'suggestions' });
  if (suggestions.length > MAX_SUGGESTIONS) return refuse({ kind: 'too_many', what: 'suggestions' });
  if (people.length > MAX_PEOPLE) return refuse({ kind: 'too_many', what: 'people' });

  // Every string within its bound: the format's own first, then any string and key anywhere.
  const bounded =
    overBound(parsed.created_by, SUGGESTION_BOUNDS.name, 'created_by') ??
    overBound(parsed.project_name, SUGGESTION_BOUNDS.name, 'project_name') ??
    overBound(parsed.created_at, SUGGESTION_BOUNDS.time, 'created_at') ??
    people.reduce<string | null>((found, person, i) => {
      if (found || !isObject(person)) return found;
      const at = `people[${String(i)}]`;
      return (
        overBound(person.id, SUGGESTION_BOUNDS.id, `${at}.id`) ??
        overBound(person.name, SUGGESTION_BOUNDS.name, `${at}.name`) ??
        overBound(person.role, SUGGESTION_BOUNDS.word, `${at}.role`) ??
        overBound(person.person_id, SUGGESTION_BOUNDS.id, `${at}.person_id`)
      );
    }, null) ??
    suggestions.reduce<string | null>((found, suggestion, i) => {
      if (found || !isObject(suggestion)) return found;
      const at = `suggestions[${String(i)}]`;
      const target = isObject(suggestion.target) ? suggestion.target : {};
      return (
        overBound(suggestion.kind, SUGGESTION_BOUNDS.word, `${at}.kind`) ??
        overBound(suggestion.author, SUGGESTION_BOUNDS.id, `${at}.author`) ??
        overBound(suggestion.created_at, SUGGESTION_BOUNDS.time, `${at}.created_at`) ??
        overBound(suggestion.note, SUGGESTION_BOUNDS.note, `${at}.note`) ??
        overBound(target.id, SUGGESTION_BOUNDS.id, `${at}.target.id`) ??
        overBound(target.type, SUGGESTION_BOUNDS.word, `${at}.target.type`) ??
        overBound(target.label, SUGGESTION_BOUNDS.label, `${at}.target.label`) ??
        overBound(target.updated_at, SUGGESTION_BOUNDS.time, `${at}.target.updated_at`)
      );
    }, null) ??
    overlong(parsed, '');
  if (bounded !== null) return refuse({ kind: 'too_long', field: bounded.replace(/^\./, '') });

  // Who made them: only an id, a name, a role and a person record, so no contact detail is ever copied.
  const authors = new Map<string, JsonObject>();
  for (const [i, person] of people.entries()) {
    const at = `people[${String(i)}]`;
    if (!isObject(person) || typeof person.id !== 'string' || person.id === '' || authors.has(person.id)) return refuse({ kind: 'bad_field', field: `${at}.id` });
    const wrong = notText(person.name, `${at}.name`) ?? notText(person.role, `${at}.role`) ?? notText(person.person_id, `${at}.person_id`, true);
    if (wrong) return refuse({ kind: 'bad_field', field: wrong });
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
    const at = `suggestions[${String(i)}]`;
    if (!isObject(suggestion)) return refuse({ kind: 'bad_field', field: at });
    if (typeof suggestion.id !== 'string' || !UUID.test(suggestion.id) || ids.has(suggestion.id)) return refuse({ kind: 'bad_field', field: `${at}.id` });
    ids.add(suggestion.id);
    if (suggestion.kind === 'create') creates.add(suggestion.id);
  }

  const createdBy = typeof parsed.created_by === 'string' ? parsed.created_by : '';
  const out: ChangeFileSuggestion[] = [];
  for (const [i, raw] of suggestions.entries()) {
    const at = `suggestions[${String(i)}]`;
    // Checked above: an object with a UUID id.
    if (!isObject(raw) || typeof raw.id !== 'string') return refuse({ kind: 'bad_field', field: at });
    const props: Props = {};
    for (const key of Object.keys(raw)) {
      if (RECORD_ONLY.has(key)) return refuse({ kind: 'bad_field', field: `${at}.${key}` });
    }
    if (raw.kind !== undefined) define(props, 'kind', raw.kind);
    if (isObject(raw.target)) {
      for (const [key, value] of Object.entries(raw.target)) {
        const prop = Object.hasOwn(TARGET_MAPPED, key) ? (TARGET_MAPPED[key] ?? '') : `target_${key}`;
        // `target_<name>` for a field this version doesn't know, kept and flagged; one already a field of the
        // suggestion's own can't be both, so the file is refused.
        if (!Object.hasOwn(TARGET_MAPPED, key) && (Object.hasOwn(raw, prop) || RECORD_ONLY.has(prop) || KNOWN_PROPS.has(prop))) {
          return refuse({ kind: 'bad_field', field: `${at}.target.${key}` });
        }
        define(props, prop, value);
      }
    } else if (raw.target !== undefined) {
      return refuse({ kind: 'bad_field', field: `${at}.target` });
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

/** What a refusal says, in the app's language. A path or a name from the file is shown as text. */
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
      return t('changes.refused.tooLong', { field: cleanText(refusal.field, 120) });
    case 'bad_field':
      return t('changes.refused.badField', { field: cleanText(refusal.field, 120) });
  }
}

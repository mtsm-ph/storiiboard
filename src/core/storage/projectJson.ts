import { version as appVersion } from '../../../package.json';
import { loadRecords, purgeIds } from '../ops/ops';
import type { ProjectFile, Row, SqlDriver, SqlValue, Statement } from './driver';
import { migrate, NewerProjectError } from './migrate';
import { MIGRATIONS } from './migrations';

// The project as JSON (2.9, CLAUDE.md: JSON export must round-trip without data loss): the .sbd, table by table and
// row by row, as one JSON file anyone can read. It's the project, not a view of it, and importing it makes a new
// project that holds exactly what the file did. docs/SBD_FORMAT.md, "Project data as JSON", has the layout.
//
// Two choices (3.14, Kevin Nov 9). Full archive carries everything: every record, live and in the Trash, the History
// (every op and op group), named versions, pictures and their thumbnails, LUTs, slate numbers and what each
// department has seen. Project data, the default, leaves out the Trash and History, since they can hold deleted
// material and everyone's names: no record in the Trash (what Empty Trash deletes, purgeIds, and every other record
// trashed too, an erased sketch stroke among them) nor anything under one; no History, no named versions (points in
// History), no read state (it reads History) and no cached lookups (which can hold a deleted location's address); and
// only the pictures what's left shows. Both write every table, the left-out ones empty, so both import with the same
// checks; each imports back as exactly what it holds. Slate numbers stay in both: a number once on a slate is never
// given again.
//
// Generic on purpose: it reads the tables the file has, so a table a later schema adds is carried without a change
// here (an ordinary rowid table; a WITHOUT ROWID or full-text table would need one), and an import checks every table
// and column against the schema the file says it's at.

export const PROJECT_JSON_FORMAT = 'storiiboard-project';
export const PROJECT_JSON_VERSION = 1;

/** A blob in the JSON: its bytes as base64, in an object so it can't be mistaken for text. */
export interface JsonBlob {
  base64: string;
}

export type JsonValue = string | number | null | JsonBlob;

export interface JsonTable {
  columns: string[];
  rows: JsonValue[][];
}

/** Project data leaves out the Trash and History; Full archive is everything. */
export type ProjectJsonContents = 'project_data' | 'full_archive';

/** The tables Project data writes with no rows: History, what only means something with it, and caches. */
const LEFT_OUT_OF_PROJECT_DATA: ReadonlySet<string> = new Set(['op_groups', 'ops', 'versions', 'notification_cursors', 'notification_reads', 'lookups']);

export interface ProjectJson {
  format: typeof PROJECT_JSON_FORMAT;
  format_version: number;
  /** The .sbd schema the rows are in; an import builds that schema, puts the rows in, then upgrades as on open. */
  schema_version: number;
  /** The app that wrote it, for anyone reading a file sent from another machine. */
  app_version: string;
  exported_at: string;
  /** What it holds; a file from before 3.14 (no field) is a full archive. */
  contents: ProjectJsonContents;
  tables: Record<string, JsonTable>;
}

/** Why a file can't be imported; each has words in the translation files (`projectJson.<problem>`). */
export type ProjectJsonProblem = 'notJson' | 'notProject' | 'formatNewer' | 'schemaNewer' | 'tables' | 'tooLarge';

export class ProjectJsonError extends Error {
  constructor(readonly problem: ProjectJsonProblem) {
    super(problem);
    this.name = 'ProjectJsonError';
  }
}

/**
 * Tables in the order they're written and put back: a table before those that refer to it (pictures before their
 * thumbnails, op groups before their ops and the versions that name them). Any table not named here follows, by name.
 */
const TABLE_ORDER = ['meta', 'media_files', 'thumbnails', 'luts', 'records', 'op_groups', 'ops', 'versions', 'slate_numbers', 'shot_seen'];

/** A table or column name, quoted for SQL. Only names read from the file's own schema are ever quoted. */
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

interface Column {
  name: string;
  blob: boolean;
}

/** The file's tables, in TABLE_ORDER, with their columns as the schema declares them. */
async function schemaOf(file: ProjectFile): Promise<Map<string, Column[]>> {
  const rows = await file.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  const names = rows.map((row) => String(row.name));
  const rank = (name: string) => {
    const at = TABLE_ORDER.indexOf(name);
    return at === -1 ? TABLE_ORDER.length : at;
  };
  names.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  const schema = new Map<string, Column[]>();
  for (const name of names) {
    const columns = await file.query('SELECT name, type FROM pragma_table_info(?) ORDER BY cid', [name]);
    schema.set(
      name,
      columns.map((column) => ({ name: String(column.name), blob: String(column.type).toUpperCase() === 'BLOB' })),
    );
  }
  return schema;
}

function toBase64(bytes: Uint8Array): string {
  let text = '';
  // In slices, so a large picture never makes one huge argument list.
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * About how many characters the project's JSON would be: its text as it is, its blobs as base64. Read before an
 * export, so a project too large to import back is said before anything is written.
 */
export async function projectJsonSize(file: ProjectFile, contents: ProjectJsonContents = 'full_archive'): Promise<number> {
  let size = 0;
  // Project data counts only what it writes: the records left and the pictures they show, so a project whose Trash
  // holds many replaced pictures isn't refused for them.
  const data = contents === 'project_data' ? await projectData(file) : null;
  const gone = JSON.stringify([...(data?.gone ?? [])]);
  const named = JSON.stringify([...(data?.named ?? [])]);
  for (const [table, columns] of await schemaOf(file)) {
    if (data && LEFT_OUT_OF_PROJECT_DATA.has(table)) continue;
    const where = !data
      ? { sql: '', params: [] }
      : table === 'records'
        ? { sql: ' WHERE id NOT IN (SELECT value FROM json_each(?))', params: [gone] }
        : table === 'shot_seen'
          ? { sql: ' WHERE shot_id NOT IN (SELECT value FROM json_each(?))', params: [gone] }
          : table === 'media_files' || table === 'thumbnails'
            ? { sql: ' WHERE sha256 IN (SELECT value FROM json_each(?))', params: [named] }
            : { sql: '', params: [] };
    const sums = columns.map((c) => `coalesce(sum(length(${quote(c.name)})), 0) AS ${quote(c.name)}`).join(', ');
    const [row] = await file.query(`SELECT count(*) AS "__rows", ${sums} FROM ${quote(table)}${where.sql}`, where.params);
    if (!row) continue;
    size += Number(row.__rows) * (columns.length * 4 + 4);
    for (const column of columns) size += Number(row[column.name]) * (column.blob ? 4 / 3 : 1.1);
  }
  return Math.ceil(size);
}

/** How many times an export reads the project again when an edit landed while it read (a still being grabbed). */
const READ_TRIES = 3;

/** An edit landed on every try: the export couldn't read one consistent project. */
export class ProjectJsonChangedError extends Error {
  constructor() {
    super('projectJsonChanged');
    this.name = 'ProjectJsonChangedError';
  }
}

/**
 * The project as JSON text, in pieces: the header, then one line per row, so the file reads (and diffs) a row at a
 * time and no one string has to hold a project's every picture. Rows are in the order SQLite stored them.
 *
 * One consistent project: the tables are read one after another, and a still or a picture being prepared can land
 * an edit in between (the export dialog stops typing, not work already under way), which would give a thumbnail
 * without its picture or a step without its frame. So the connection's change count is read before and after, and
 * if anything was written meanwhile the whole read starts again. `signal` stops it between rows.
 */
export async function projectJsonChunks(
  file: ProjectFile,
  now = new Date(),
  progress?: (table: string) => void,
  signal?: AbortSignal,
  contents: ProjectJsonContents = 'full_archive',
): Promise<string[]> {
  for (let attempt = 0; attempt < READ_TRIES; attempt += 1) {
    const before = await changes(file);
    const chunks = await readChunks(file, now, progress, signal, contents);
    if ((await changes(file)) === before) return chunks;
  }
  throw new ProjectJsonChangedError();
}

/** Rows this connection has written since it opened: the same before and after a read means nothing landed between. */
async function changes(file: ProjectFile): Promise<number> {
  const [row] = await file.query('SELECT total_changes() AS changes');
  return Number(row?.changes);
}

/**
 * What Project data leaves out: every record in the Trash and everything under it (what Empty Trash deletes, and the
 * kinds it doesn't, an erased sketch stroke with who erased it); and which pictures it keeps, those a record left names.
 */
async function projectData(file: ProjectFile): Promise<{ gone: ReadonlySet<string>; named: ReadonlySet<string> }> {
  const records = await loadRecords(file);
  const gone = new Set(purgeIds(records));
  const children = new Map<string, string[]>();
  for (const record of records) {
    if (!record.parentId) continue;
    const list = children.get(record.parentId);
    if (list) list.push(record.id);
    else children.set(record.parentId, [record.id]);
  }
  const leave = (id: string) => {
    if (gone.has(id)) return;
    gone.add(id);
    for (const child of children.get(id) ?? []) leave(child);
  };
  for (const record of records) {
    if (record.trashedAt !== null) {
      gone.delete(record.id);
      leave(record.id);
    }
  }
  // A picture is named by its SHA-256 in its media record's props (`file`; a video's poster is an image media record of
  // its own, named the same way): any one a record left names is kept, so none is ever left out from under something
  // that shows it.
  const named = new Set<string>();
  for (const record of records) {
    if (gone.has(record.id)) continue;
    for (const match of JSON.stringify(record.props).matchAll(/[0-9a-f]{64}/g)) named.add(match[0]);
  }
  return { gone, named };
}

/** Which rows Project data keeps: none of History's tables; none in the Trash, nor a frame's Seen with it; only the pictures what's left shows. */
async function projectDataRows(file: ProjectFile): Promise<(table: string, row: Row) => boolean> {
  const { gone, named } = await projectData(file);
  return (table, row) => {
    if (LEFT_OUT_OF_PROJECT_DATA.has(table)) return false;
    if (table === 'records') return !gone.has(String(row.id));
    if (table === 'shot_seen') return !gone.has(String(row.shot_id));
    if (table === 'media_files' || table === 'thumbnails') return named.has(String(row.sha256));
    return true;
  };
}

async function readChunks(
  file: ProjectFile,
  now: Date,
  progress: ((table: string) => void) | undefined,
  signal: AbortSignal | undefined,
  contents: ProjectJsonContents,
): Promise<string[]> {
  const schema = await schemaOf(file);
  const [version] = await file.query("SELECT value FROM meta WHERE key = 'schema_version'");
  const keep = contents === 'project_data' ? await projectDataRows(file) : () => true;
  const header = {
    format: PROJECT_JSON_FORMAT,
    format_version: PROJECT_JSON_VERSION,
    schema_version: Number(version?.value),
    app_version: appVersion,
    exported_at: now.toISOString(),
    contents,
  };
  const chunks = [`${JSON.stringify(header).slice(0, -1)},"tables":{`];
  let firstTable = true;
  for (const [table, columns] of schema) {
    progress?.(table);
    const plain = columns.filter((column) => !column.blob);
    const selected = ['rowid AS "__rowid"', ...plain.map((column) => quote(column.name))].join(', ');
    // Blob columns are read one value at a time: query rows can't carry bytes in the desktop app (driver.ts).
    const rows = (await file.query(`SELECT ${selected} FROM ${quote(table)} ORDER BY rowid`)).filter((row) => keep(table, row));
    chunks.push(`${firstTable ? '' : ','}\n${JSON.stringify(table)}:{"columns":${JSON.stringify(columns.map((c) => c.name))},"rows":[`);
    firstTable = false;
    for (const [index, row] of rows.entries()) {
      signal?.throwIfAborted();
      const values: JsonValue[] = [];
      for (const column of columns) {
        if (column.blob) {
          const bytes = await file.readBlob(`SELECT ${quote(column.name)} FROM ${quote(table)} WHERE rowid = ?`, [row.__rowid ?? null]);
          values.push(bytes === null ? null : { base64: toBase64(bytes) });
        } else {
          const value = row[column.name] ?? null;
          values.push(value instanceof Uint8Array ? { base64: toBase64(value) } : value);
        }
      }
      chunks.push(`${index === 0 ? '' : ','}\n${JSON.stringify(values)}`);
    }
    chunks.push(rows.length === 0 ? ']}' : '\n]}');
  }
  chunks.push('\n}}\n');
  return chunks;
}

/** The project as one JSON file's bytes. */
export async function projectJsonBytes(
  file: ProjectFile,
  now = new Date(),
  progress?: (table: string) => void,
  signal?: AbortSignal,
  contents: ProjectJsonContents = 'full_archive',
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = await projectJsonChunks(file, now, progress, signal, contents);
  // Each piece's text let go as it's encoded, so the text and its bytes aren't all held at once.
  const parts: Uint8Array[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    parts.push(encoder.encode(chunks[i]));
    chunks[i] = '';
  }
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

/**
 * The most text an import reads in one piece: well inside the longest string a webview holds (about 512 million
 * characters in Chrome's engine), with room for the parse. A project with more pictures than that says so.
 */
export const MAX_IMPORT_CHARS = 400_000_000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function isValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value);
  return isRecord(value) && typeof value.base64 === 'string' && Object.keys(value).length === 1;
}

/**
 * A project JSON file's bytes as text: refused as too large before it's decoded (its UTF-8 is at least as many bytes
 * as characters), and as not JSON if it isn't UTF-8, rather than read with replacement characters.
 */
export function projectJsonText(bytes: ArrayBuffer, limit = MAX_IMPORT_CHARS): string {
  if (bytes.byteLength > limit) throw new ProjectJsonError('tooLarge');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ProjectJsonError('notJson');
  }
}

/** Reads a project JSON file's text, checking its shape (not yet its tables, which need the schema it names). */
export function readProjectJson(text: string, limit = MAX_IMPORT_CHARS): ProjectJson {
  if (text.length > limit) throw new ProjectJsonError('tooLarge');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProjectJsonError('notJson');
  }
  if (!isRecord(parsed) || parsed.format !== PROJECT_JSON_FORMAT) throw new ProjectJsonError('notProject');
  const { format_version: formatVersion, schema_version: schemaVersion, tables } = parsed;
  if (typeof formatVersion !== 'number' || !Number.isInteger(formatVersion) || formatVersion < 1) throw new ProjectJsonError('notProject');
  if (formatVersion > PROJECT_JSON_VERSION) throw new ProjectJsonError('formatNewer');
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) throw new ProjectJsonError('notProject');
  if (schemaVersion > MIGRATIONS.length) throw new ProjectJsonError('schemaNewer');
  if (!isRecord(tables)) throw new ProjectJsonError('tables');
  const read: Record<string, JsonTable> = {};
  for (const [name, table] of Object.entries(tables)) {
    if (!isRecord(table) || !Array.isArray(table.columns) || !Array.isArray(table.rows)) throw new ProjectJsonError('tables');
    const columns = table.columns as unknown[];
    if (!columns.every((column): column is string => typeof column === 'string')) throw new ProjectJsonError('tables');
    const rows = table.rows as unknown[];
    if (!rows.every((row): row is JsonValue[] => Array.isArray(row) && row.length === columns.length && row.every(isValue))) {
      throw new ProjectJsonError('tables');
    }
    read[name] = { columns, rows };
  }
  // The rows' own schema version must be the one the header names: the file is built at that one, then upgraded from
  // what meta says, and the two disagreeing would skip a migration or label a file wrongly.
  const meta = read.meta;
  const key = meta?.columns.indexOf('key') ?? -1;
  const value = meta?.columns.indexOf('value') ?? -1;
  const versions = meta?.rows.filter((row) => row[key] === 'schema_version') ?? [];
  if (versions.length !== 1 || versions[0]?.[value] !== String(schemaVersion)) throw new ProjectJsonError('tables');
  return {
    format: PROJECT_JSON_FORMAT,
    format_version: formatVersion,
    schema_version: schemaVersion,
    app_version: typeof parsed.app_version === 'string' ? parsed.app_version : '',
    exported_at: typeof parsed.exported_at === 'string' ? parsed.exported_at : '',
    contents: parsed.contents === 'project_data' ? 'project_data' : 'full_archive',
    tables: read,
  };
}

/** The project's title as the JSON holds it, for the new file's suggested name; null when it has none. */
export function projectJsonTitle(data: ProjectJson): string | null {
  const records = data.tables.records;
  if (!records) return null;
  const type = records.columns.indexOf('type');
  const parent = records.columns.indexOf('parent_id');
  const props = records.columns.indexOf('props');
  const row = records.rows.find((r) => r[type] === 'project' && r[parent] === null);
  const text = row?.[props];
  if (typeof text !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(text);
    const title = isRecord(parsed) ? parsed.title : null;
    return typeof title === 'string' && title.trim() !== '' ? title.trim() : null;
  } catch {
    return null;
  }
}

/** The statements that put the JSON's rows into a file built at its schema: every table emptied first, then filled. */
function fillStatements(data: ProjectJson, schema: Map<string, Column[]>): Statement[] {
  for (const [name, table] of Object.entries(data.tables)) {
    const columns = schema.get(name);
    // Exactly the table's columns, each once: a file at this schema holds nothing else.
    if (!columns || table.columns.length !== columns.length || new Set(table.columns).size !== columns.length) throw new ProjectJsonError('tables');
    if (!table.columns.every((column) => columns.some((c) => c.name === column))) throw new ProjectJsonError('tables');
  }
  if (!data.tables.meta || !data.tables.records) throw new ProjectJsonError('tables');
  // Rows refer to rows of other tables, and op groups to earlier op groups: checked once, at commit.
  const statements: Statement[] = [{ sql: 'PRAGMA defer_foreign_keys = ON' }];
  for (const name of schema.keys()) statements.push({ sql: `DELETE FROM ${quote(name)}` });
  for (const name of schema.keys()) {
    const table = data.tables[name];
    if (!table) continue;
    const blobs = new Set((schema.get(name) ?? []).filter((c) => c.blob).map((c) => c.name));
    const sql = `INSERT INTO ${quote(name)} (${table.columns.map(quote).join(', ')}) VALUES (${table.columns.map(() => '?').join(', ')})`;
    const key = table.columns.indexOf('key');
    const value = table.columns.indexOf('value');
    for (const row of table.rows) {
      const params: SqlValue[] = row.map((cell, i) => {
        const column = table.columns[i] ?? '';
        if (cell !== null && typeof cell === 'object') {
          if (!blobs.has(column)) throw new ProjectJsonError('tables');
          try {
            return fromBase64(cell.base64);
          } catch {
            throw new ProjectJsonError('tables');
          }
        }
        if (blobs.has(column) && cell !== null) throw new ProjectJsonError('tables');
        return cell;
      });
      // A new file is never the old one: its own id, so its backups on this computer are its own (project.ts).
      if (name === 'meta' && row[key] === 'file_id') params[value] = crypto.randomUUID();
      statements.push({ sql, params });
    }
  }
  return statements;
}

/** Whether a failed transaction was SQLite refusing the rows themselves, not the disk or the app failing. */
function refusesData(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /constraint failed|cannot store|data ?type mismatch/i.test(message);
}

/**
 * Makes a new .sbd at `path` holding exactly the JSON's project, at the JSON's schema; opening it then upgrades it as
 * any older file is (project.ts). Refuses a path that's taken. The rows go in in one transaction, so none or all of
 * them land. Its tables and columns can only be checked against the schema once the new file has it; a JSON whose
 * don't match (hand-edited, or not one Storiiboard wrote) leaves the new file empty, which opens as an empty project.
 */
export async function importProjectJson(driver: SqlDriver, path: string, data: ProjectJson, now = new Date()): Promise<void> {
  if (data.schema_version > MIGRATIONS.length) throw new NewerProjectError(data.schema_version, MIGRATIONS.length);
  const file = await driver.create(path);
  try {
    await migrate(file, { isNew: true, migrations: MIGRATIONS.slice(0, data.schema_version), now: () => now });
    const statements = fillStatements(data, await schemaOf(file));
    try {
      await file.tx(statements);
    } catch (error) {
      // SQLite's own refusal of the rows (a thumbnail of a picture that isn't there, a value of the wrong kind): the
      // data doesn't fit. Anything else (a full disk, a sync, memory) is said as it is.
      if (refusesData(error)) throw new ProjectJsonError('tables');
      throw error;
    }
  } finally {
    await file.close();
  }
}

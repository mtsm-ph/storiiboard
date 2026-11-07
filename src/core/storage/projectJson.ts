import { version as appVersion } from '../../../package.json';
import type { ProjectFile, SqlDriver, SqlValue, Statement } from './driver';
import { migrate, NewerProjectError } from './migrate';
import { MIGRATIONS } from './migrations';

// Project data as JSON (2.9, CLAUDE.md: JSON export must round-trip without data loss). The whole .sbd, table by
// table and row by row, as one JSON file anyone can read: every record, live and in the Trash, the History (every op
// and op group), named versions, pictures and their thumbnails, LUTs, slate numbers and what each department has
// seen. It's the project, not a view of it, so unlike the other exports it leaves nothing out; importing it makes a new
// project that holds exactly what the old one did. docs/SBD_FORMAT.md, "Project data as JSON", has the layout.
//
// Generic on purpose: it reads the tables the file has, so a table a later schema adds is carried without a change
// here, and an import checks every table and column against the schema the file says it's at.

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

export interface ProjectJson {
  format: typeof PROJECT_JSON_FORMAT;
  format_version: number;
  /** The .sbd schema the rows are in; an import builds that schema, puts the rows in, then upgrades as on open. */
  schema_version: number;
  /** The app that wrote it, for anyone reading a file sent from another machine. */
  app_version: string;
  exported_at: string;
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
 * The project as JSON text, in pieces: the header, then one line per row, so the file reads (and diffs) a row at a
 * time and no one string has to hold a project's every picture. Rows are in the order SQLite stored them.
 * `progress` hears each table as it's read.
 */
export async function projectJsonChunks(file: ProjectFile, now = new Date(), progress?: (table: string) => void): Promise<string[]> {
  const schema = await schemaOf(file);
  const [version] = await file.query("SELECT value FROM meta WHERE key = 'schema_version'");
  const header = {
    format: PROJECT_JSON_FORMAT,
    format_version: PROJECT_JSON_VERSION,
    schema_version: Number(version?.value),
    app_version: appVersion,
    exported_at: now.toISOString(),
  };
  const chunks = [`${JSON.stringify(header).slice(0, -1)},"tables":{`];
  let firstTable = true;
  for (const [table, columns] of schema) {
    progress?.(table);
    const plain = columns.filter((column) => !column.blob);
    const selected = ['rowid AS "__rowid"', ...plain.map((column) => quote(column.name))].join(', ');
    // Blob columns are read one value at a time: query rows can't carry bytes in the desktop app (driver.ts).
    const rows = await file.query(`SELECT ${selected} FROM ${quote(table)} ORDER BY rowid`);
    chunks.push(`${firstTable ? '' : ','}\n${JSON.stringify(table)}:{"columns":${JSON.stringify(columns.map((c) => c.name))},"rows":[`);
    firstTable = false;
    for (const [index, row] of rows.entries()) {
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
export async function projectJsonBytes(file: ProjectFile, now = new Date(), progress?: (table: string) => void): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const parts = (await projectJsonChunks(file, now, progress)).map((chunk) => encoder.encode(chunk));
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

/** Reads a project JSON file's text, checking its shape (not yet its tables, which need the schema it names). */
export function readProjectJson(text: string): ProjectJson {
  if (text.length > MAX_IMPORT_CHARS) throw new ProjectJsonError('tooLarge');
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
  return {
    format: PROJECT_JSON_FORMAT,
    format_version: formatVersion,
    schema_version: schemaVersion,
    app_version: typeof parsed.app_version === 'string' ? parsed.app_version : '',
    exported_at: typeof parsed.exported_at === 'string' ? parsed.exported_at : '',
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
    await file.tx(statements);
  } finally {
    await file.close();
  }
}

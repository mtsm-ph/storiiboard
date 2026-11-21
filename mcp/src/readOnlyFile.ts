import { existsSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { blobOf, refuseBytes, type ProjectFile, type Row, type SqlValue } from '../../src/core/storage/driver';
import { SCHEMA_VERSION } from '../../src/core/storage/migrations';
import { NewerProjectError } from '../../src/core/storage/migrate';

// The project file, opened for reading only (7.5, Phase 7 decision 3: the assistant never writes the .sbd). Not
// nodeDriver.ts, which writes a lock file and sets the journal: this opens the file with SQLite's read-only flag
// (`readOnly`, SQLITE_OPEN_READONLY) and `query_only` on, and nothing else. Read-only rather than `immutable`, since the
// app may be saving to it meanwhile: a read-only connection still takes SQLite's shared lock, so a read never sees half a
// save, and in the app's journal mode (DELETE) it makes no file beside the project. A file:// URI with `mode=ro` would
// say the same, but Node 22's constructor doesn't document URIs, so the flag is used. No lock file is read or written,
// no migration runs: a file of another schema is refused in words. Every write the ProjectFile contract has is refused.

/** Refused for every write: the assistant never writes the project. */
export const READ_ONLY = 'The assistant tools only read the project.';

export class ProjectRefused extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProjectRefused';
  }
}

function toValue(value: unknown): SqlValue {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' || typeof value === 'number' || value === null || value instanceof Uint8Array) return value;
  throw new Error('Unexpected value in a column.');
}

/** A query's rows, every value checked by its position first, as nodeDriver.ts and sbd.rs read them. */
function queryRows(db: DatabaseSync, sql: string, params: readonly SqlValue[]): Row[] {
  const statement = db.prepare(sql);
  statement.setReturnArrays(true);
  const names = statement.columns().map((column) => column.name);
  const rows = statement.all(...params) as unknown as unknown[][];
  refuseBytes(rows);
  return rows.map((values) => {
    const row: Row = {};
    values.forEach((value, i) => {
      row[names[i] ?? String(i)] = toValue(value);
    });
    return row;
  });
}

const refuse = (): Promise<never> => Promise.reject(new Error(READ_ONLY));

function settle<T>(run: () => T): Promise<T> {
  try {
    return Promise.resolve(run());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/** Opens a .sbd read-only; refused, in words, when it isn't one this version reads as it is. */
export function openReadOnly(path: string): ProjectFile {
  if (!/\.sbd$/i.test(path)) throw new ProjectRefused('A Storiiboard project file ends in .sbd.');
  if (!existsSync(path) || !statSync(path).isFile()) throw new ProjectRefused("There's no project file at that path.");
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec('PRAGMA query_only = ON');
    // A save under way holds the file for a moment: wait for it, at most 2 s, rather than fail.
    db.exec('PRAGMA busy_timeout = 2000');
  } catch (error) {
    throw new ProjectRefused("The project file couldn't be opened for reading.", { cause: error });
  }
  try {
    checkSchema(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return {
    path,
    tx: refuse,
    query: (sql, params) => settle(() => queryRows(db, sql, params ?? [])),
    readBlob: (sql, params) =>
      settle(() => {
        const statement = db.prepare(sql);
        statement.setReturnArrays(true);
        const row = statement.get(...(params ?? [])) as unknown as unknown[] | undefined;
        return blobOf(row?.[0]);
      }),
    backup: refuse,
    compact: refuse,
    listBackups: refuse,
    deleteBackup: refuse,
    placeBackups: refuse,
    backupsFolder: refuse,
    showBackups: refuse,
    saveCopy: refuse,
    refreshLock: refuse,
    close: () =>
      settle(() => {
        db.close();
      }),
  };
}

/**
 * The file's schema, exactly this version's: a newer one is refused as the app refuses it, an older one is never
 * upgraded here (the app upgrades it, with its backup first, the next time it opens it).
 */
function checkSchema(db: DatabaseSync): void {
  let version: number;
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").all();
    if (tables.length === 0) throw new ProjectRefused("This file isn't a Storiiboard project.");
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
    version = Number(row?.value);
  } catch (error) {
    if (error instanceof ProjectRefused) throw error;
    if (error instanceof Error && /busy|locked/i.test(error.message)) throw new ProjectRefused('Storiiboard is saving the project right now. Try again in a moment.', { cause: error });
    throw new ProjectRefused("This file isn't a Storiiboard project.", { cause: error });
  }
  if (!Number.isInteger(version) || version < 1) throw new ProjectRefused("This file isn't a Storiiboard project.");
  if (version > SCHEMA_VERSION) throw new ProjectRefused(new NewerProjectError(version, SCHEMA_VERSION).message);
  if (version < SCHEMA_VERSION) {
    throw new ProjectRefused(
      `This project was saved by an older version of Storiiboard (file format ${String(version)}; these tools read ${String(SCHEMA_VERSION)}). ` +
        'Open it in Storiiboard once to bring it up to date; the assistant tools never change the file.',
    );
  }
}

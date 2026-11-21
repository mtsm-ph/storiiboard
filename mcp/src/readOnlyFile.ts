import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { blobOf, refuseBytes, type ProjectFile, type Row, type SqlValue } from '../../src/core/storage/driver';
import { SCHEMA_VERSION } from '../../src/core/storage/migrations';

// The project file, opened for reading only (7.5, Phase 7 decision 3: the assistant never writes the .sbd). Not
// nodeDriver.ts, which writes a lock file and sets the journal: this opens the file with SQLite's read-only flag
// (`readOnly`, SQLITE_OPEN_READONLY) and `query_only` on, and nothing else. Read-only rather than `immutable`, since the
// app may be saving to it meanwhile: a read-only connection still takes SQLite's shared lock, so a read never sees half a
// save, and in the app's journal mode (DELETE) it makes no file beside the project. A file:// URI with `mode=ro` would
// say the same, but Node 22's constructor doesn't document URIs, so the flag is used. No lock file is read or written,
// no migration runs: a file of another schema is refused in words. Every write the ProjectFile contract has is refused.
//
// Round 2: a file in WAL mode is refused before SQLite opens it (a read-only connection to one would make its -wal and
// -shm files beside it, or fail); one call's reads run in one transaction, so they are one snapshot of the file; and
// SQLite's busy and hot-journal errors are said in words.

/** Refused for every write: the assistant never writes the project. */
export const READ_ONLY = 'The assistant tools only read the project.';

export const SAVING = 'Storiiboard is saving the project right now. Try again in a moment.';
export const OPEN_ONCE =
  "This project file was left mid-save or in another journal mode. Open it in Storiiboard once (it puts the file right); the assistant tools never change the file.";

export class ProjectRefused extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProjectRefused';
  }
}

// SQLite's result codes (sqlite.org/rescode.html): the primary code is the low byte of an extended one.
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
/** SQLITE_READONLY_ROLLBACK: a hot journal a read-only connection can't roll back. */
const SQLITE_READONLY_ROLLBACK = 776;

/** SQLite's extended result code on a node:sqlite error, or null. */
function sqliteCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('errcode' in error)) return null;
  const code = error.errcode;
  return typeof code === 'number' ? code : null;
}

/** An SQLite error said in words, when it is one this file's state explains; else null. */
export function sqliteRefusal(error: unknown): ProjectRefused | null {
  if (error instanceof ProjectRefused) return error;
  const code = sqliteCode(error);
  if (code === SQLITE_READONLY_ROLLBACK) return new ProjectRefused(OPEN_ONCE, { cause: error });
  if (code !== null && ((code & 0xff) === SQLITE_BUSY || (code & 0xff) === SQLITE_LOCKED)) return new ProjectRefused(SAVING, { cause: error });
  return null;
}

/**
 * Bytes 18 and 19 of an SQLite file's header are its write and read versions: 1 for the rollback journal (the app's
 * DELETE mode), 2 for WAL. Read with fs alone, before SQLite sees the file.
 */
function refuseWal(path: string): void {
  const header = Buffer.alloc(20);
  const fd = openSync(path, 'r');
  let read: number;
  try {
    read = readSync(fd, header, 0, 20, 0);
  } finally {
    closeSync(fd);
  }
  if (read < 20) throw new ProjectRefused("This file isn't a Storiiboard project.");
  if (header[18] === 2 || header[19] === 2) throw new ProjectRefused(OPEN_ONCE);
}

/** The project file, read-only, with one call's reads as one snapshot. */
export interface ReadOnlyFile extends ProjectFile {
  /** Runs `read` inside one read transaction (BEGIN … COMMIT), so every query in it sees the same file. */
  snapshot<T>(read: () => Promise<T>): Promise<T>;
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
export function openReadOnly(path: string): ReadOnlyFile {
  if (!/\.sbd$/i.test(path)) throw new ProjectRefused('A Storiiboard project file ends in .sbd.');
  if (!existsSync(path) || !statSync(path).isFile()) throw new ProjectRefused("There's no project file at that path.");
  refuseWal(path);
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec('PRAGMA query_only = ON');
    // A save under way holds the file for a moment: wait for it, at most 2 s, rather than fail.
    db.exec('PRAGMA busy_timeout = 2000');
  } catch (error) {
    throw sqliteRefusal(error) ?? new ProjectRefused("The project file couldn't be opened for reading.", { cause: error });
  }
  return {
    path,
    // The schema is read inside the same transaction as everything else, so the version checked is the file read.
    snapshot: async <T>(read: () => Promise<T>): Promise<T> => {
      try {
        db.exec('BEGIN');
      } catch (error) {
        throw sqliteRefusal(error) ?? error;
      }
      try {
        checkSchema(db);
        const value = await read();
        db.exec('COMMIT');
        return value;
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw sqliteRefusal(error) ?? error;
      }
    },
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
    throw sqliteRefusal(error) ?? new ProjectRefused("This file isn't a Storiiboard project.", { cause: error });
  }
  if (!Number.isInteger(version) || version < 1) throw new ProjectRefused("This file isn't a Storiiboard project.");
  // The server is built from the repo, so its remedy is a rebuild, not the app's "Update Storiiboard" (round 2).
  if (version > SCHEMA_VERSION) {
    throw new ProjectRefused(
      `This project was saved by a newer version of Storiiboard (file format ${String(version)}; these tools read ${String(SCHEMA_VERSION)}). ` +
        'Rebuild the server (npm run build --prefix mcp) after updating Storiiboard.',
    );
  }
  if (version < SCHEMA_VERSION) {
    throw new ProjectRefused(
      `This project was saved by an older version of Storiiboard (file format ${String(version)}; these tools read ${String(SCHEMA_VERSION)}). ` +
        'Open it in Storiiboard once to bring it up to date; the assistant tools never change the file.',
    );
  }
}

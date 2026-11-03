import type { Database, SqlJsStatic, SqlJsValue } from 'sql.js';
import { isBackupName, isMigrationBackupName } from './backups';
import type { BackupKind, ProjectFile, Row, SqlDriver } from './driver';
import { fileName, fileStem } from './paths';

// A third driver, for the end-to-end tests only (approved Nov 2): SQLite compiled to WebAssembly (sql.js), with each
// project kept in memory and saved to the page's localStorage after every write, so a test can create, edit,
// reload and reopen a project in an ordinary browser. The browser build loads it only in development, behind
// `?files=memory` (src/app/fileAccess.ts); production builds never include it.
//
// Same contract and refusals as sbd.rs and nodeDriver.ts, minus what a browser has no use for: there's no disk for a
// sync to replace a file on, no lock file and no folder to show.

export interface MemoryDriverOptions {
  /** Where sql-wasm.wasm is: a URL in the browser, a file path under Node. */
  wasm: string;
  /** Where the files live between page loads; left out, they last only as long as the page. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

const STORE_KEY = 'storiiboard.memory-files';

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

const folderOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));

function checkExtension(path: string): void {
  if (!/\.sbd$/i.test(path)) throw new Error('A Storiiboard project file ends in .sbd.');
}

function toRow(row: Record<string, SqlJsValue>): Row {
  return { ...row };
}

/** Runs a synchronous sql.js call and settles a promise with it, so refusals reject as the other drivers' do. */
function settle<T>(run: () => T): Promise<T> {
  try {
    return Promise.resolve(run());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function createMemoryDriver({ wasm, storage }: MemoryDriverOptions): Promise<SqlDriver> {
  const { default: initSqlJs } = await import('sql.js');
  const SQL: SqlJsStatic = await initSqlJs({ locateFile: () => wasm });

  const read = (): Map<string, string> => {
    try {
      return new Map(Object.entries(JSON.parse(storage?.getItem(STORE_KEY) ?? '{}') as Record<string, string>));
    } catch {
      return new Map();
    }
  };
  /** Each file's bytes, base64, by path. */
  const files = read();
  const persist = () => {
    storage?.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(files)));
  };

  const configure = (db: Database) => {
    // Export closes and reopens the database, which resets pragmas; this runs after each one.
    db.exec('PRAGMA foreign_keys = ON');
  };

  const openFile = (path: string, isNew: boolean): ProjectFile => {
    checkExtension(path);
    if (isNew && files.has(path)) throw new Error('A file already exists at that path.');
    const saved = files.get(path);
    if (!isNew && saved === undefined) throw new Error("There's no project file at that path.");
    let db: Database;
    try {
      db = new SQL.Database(saved === undefined ? undefined : fromBase64(saved));
      configure(db);
    } catch (error) {
      throw new Error("This file isn't a Storiiboard project.", { cause: error });
    }
    const totalChanges = () => {
      const statement = db.prepare('SELECT total_changes() AS changes');
      try {
        statement.step();
        return Number(statement.getAsObject().changes ?? 0);
      } finally {
        statement.free();
      }
    };
    // Export closes and reopens the database, which also resets SQLite's total_changes(), the count the backup
    // schedule uses to tell whether anything changed (backups.ts). The count carries over here.
    let earlierChanges = 0;
    const exportBytes = () => {
      earlierChanges += totalChanges();
      const bytes = db.export();
      configure(db);
      return bytes;
    };
    const save = () => {
      files.set(path, toBase64(exportBytes()));
      persist();
    };
    if (isNew) save();

    const stem = fileStem(path);
    const backupsDir = `${folderOf(path)}/Backups`;
    const backupPath = (kind: BackupKind, name: string) => {
      if (kind === 'migration') {
        if (!isMigrationBackupName(fileName(path), name)) {
          throw new Error(`"${name}" isn't a migration backup name for this project.`);
        }
        return `${folderOf(path)}/${name}`;
      }
      if (!isBackupName(stem, name)) throw new Error(`"${name}" isn't a backup name for this project.`);
      return `${backupsDir}/${name}`;
    };

    return {
      path,
      tx: (statements) =>
        settle(() => {
          db.exec('BEGIN IMMEDIATE');
          try {
            for (const { sql, params } of statements) db.run(sql, params ?? []);
            db.exec('COMMIT');
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
          save();
        }),
      query: (sql, params) =>
        settle(() => {
          if (/^\s*SELECT total_changes\(\) AS changes\s*$/i.test(sql)) return [{ changes: earlierChanges + totalChanges() }];
          const statement = db.prepare(sql);
          try {
            statement.bind(params ?? []);
            const rows: Row[] = [];
            while (statement.step()) rows.push(toRow(statement.getAsObject()));
            return rows;
          } finally {
            statement.free();
          }
        }),
      readBlob: (sql, params) =>
        settle(() => {
          const statement = db.prepare(sql);
          try {
            statement.bind(params ?? []);
            if (!statement.step()) return null;
            const value = Object.values(statement.getAsObject())[0];
            return value instanceof Uint8Array ? value : null;
          } finally {
            statement.free();
          }
        }),
      backup: (kind, name) =>
        settle(() => {
          const dest = backupPath(kind, name);
          if (files.has(dest)) throw new Error(`A backup named "${name}" already exists.`);
          files.set(dest, toBase64(exportBytes()));
          persist();
        }),
      listBackups: () =>
        settle(() =>
          [...files.keys()]
            .filter((key) => key.startsWith(`${backupsDir}/`))
            .map((key) => key.slice(backupsDir.length + 1))
            .filter((name) => isBackupName(stem, name))
            .sort(),
        ),
      deleteBackup: (name) =>
        settle(() => {
          if (!isBackupName(stem, name)) throw new Error(`"${name}" isn't a backup name for this project.`);
          files.delete(`${backupsDir}/${name}`);
          persist();
        }),
      placeBackups: () => settle(() => backupsDir),
      backupsFolder: () => settle(() => backupsDir),
      showBackups: () => settle(() => undefined),
      refreshLock: () => settle(() => undefined),
      close: () =>
        settle(() => {
          db.close();
        }),
    };
  };

  return {
    create: (path) => settle(() => openFile(path, true)),
    open: (path) => settle(() => openFile(path, false)),
    copy: (source, dest) =>
      settle(() => {
        checkExtension(source);
        checkExtension(dest);
        const saved = files.get(source);
        if (saved === undefined) throw new Error("There's no project file at that path.");
        if (files.has(dest)) throw new Error('A file already exists at that path.');
        files.set(dest, saved);
        persist();
      }),
    lockHolder: () => Promise.resolve(null),
  };
}

import type { Database, SqlJsStatic, SqlJsValue } from 'sql.js';
import { isBackupName, isMigrationBackupName } from './backups';
import { blobOf, doorVerdict, refuseBytes, refuseMisnamedLuts, refuseMisnamedPictures, refuseUncleanPictures, type BackupKind, type ProjectFile, type Row, type SqlDriver, type Statement } from './driver';
import { fileName, fileStem } from './paths';
import { isListedShape, statementShape } from './pictureStatements';

/**
 * Round 4 (Kevin, Nov 18): a statement the page writes that names the stored pictures' tables (or, from Nov 18 night 4,
 * `luts`) must be on the one list
 * both doors are tested against (src-tauri/testdata/picture-statements.json), by its shape (values as `?`). One that
 * isn't is said as a console error, which fails every end-to-end spec (none is ever filtered), so a new statement
 * can't reach the app without the list, and the doors' tests, knowing it. In a page only: a unit test's own probes of
 * the door aren't the app's.
 */
function reportUnlisted(statements: readonly Statement[]): void {
  if (typeof document === 'undefined') return;
  for (const { sql } of statements) {
    if (doorVerdict(sql, 'ordinary') === 'none') continue;
    const shape = statementShape(sql);
    if (!isListedShape(shape)) console.error(`A statement naming media_files, thumbnails or luts isn’t on src-tauri/testdata/picture-statements.json: ${shape}`);
  }
}

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

/** A row by name, the later of two same-named columns winning, as sbd.rs's map insert does. */
function toRow(names: string[], values: SqlJsValue[]): Row {
  const row: Row = {};
  values.forEach((value, i) => {
    row[names[i] ?? String(i)] = value;
  });
  return row;
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

  const read = (): Map<string, Uint8Array> => {
    try {
      const saved = Object.entries(JSON.parse(storage?.getItem(STORE_KEY) ?? '{}') as Record<string, string>);
      return new Map(saved.map(([path, text]) => [path, fromBase64(text)]));
    } catch {
      return new Map();
    }
  };
  /** Each file's bytes, by path; base64 only in storage. */
  const files = read();
  // Each file's base64, made once per change of its bytes, so a write encodes only the file it changed, not every
  // backup and copy beside it.
  const encoded = new WeakMap<Uint8Array, string>();
  const persist = () => {
    if (!storage) return;
    const text = (bytes: Uint8Array) => {
      let made = encoded.get(bytes);
      if (made === undefined) {
        made = toBase64(bytes);
        encoded.set(bytes, made);
      }
      return made;
    };
    storage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries([...files].map(([path, bytes]) => [path, text(bytes)]))));
  };
  // Without storage (a performance run, `keep=page`), an open file's bytes are copied out only when something needs
  // them (a reopen, a copy, a close) rather than after every write: a whole export per edit costs a second on a
  // project with hundreds of pictures, which the desktop never pays.
  const flushers = new Map<string, Set<() => void>>();
  const flush = (path: string) => {
    for (const run of flushers.get(path) ?? []) run();
  };
  // Copies saveCopy made that keepCopy hasn't named yet, and how many connections each path has open, as sbd.rs
  // keeps them: only a closed draft can be renamed or deleted.
  const drafts = new Set<string>();
  const open = new Map<string, number>();
  const checkDraft = (draft: string) => {
    if (!drafts.has(draft)) throw new Error("That isn't a copy Storiiboard is making.");
    if ((open.get(draft) ?? 0) > 0) throw new Error('That copy is still open.');
  };

  const configure = (db: Database) => {
    // Export closes and reopens the database, which resets pragmas; this runs after each one.
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA secure_delete = ON');
  };

  const openFile = (path: string, isNew: boolean): ProjectFile => {
    checkExtension(path);
    if (isNew && files.has(path)) throw new Error('A file already exists at that path.');
    flush(path);
    const saved = files.get(path);
    if (!isNew && saved === undefined) throw new Error("There's no project file at that path.");
    let db: Database;
    try {
      db = new SQL.Database(saved);
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
    let dirty = false;
    const write = () => {
      files.set(path, exportBytes());
      dirty = false;
      persist();
    };
    const save = () => {
      if (storage) write();
      else dirty = true;
    };
    const flushThis = () => {
      if (dirty) write();
    };
    if (isNew) write();
    open.set(path, (open.get(path) ?? 0) + 1);
    flushers.set(path, (flushers.get(path) ?? new Set()).add(flushThis));

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
      tx: async (statements, options) => {
        // sbd.rs's doors, before anything is written: Import project data writes its pictures as they came once each is
        // the one its name says, as sbd_import_tx_raw does; every other write refuses an unclean picture.
        reportUnlisted(statements);
        // A LUT whose text isn't the one its name says, at either door (Kevin, Nov 18 night 4), in a LUT's words.
        await refuseMisnamedLuts(statements, options?.imported ? 'import' : 'ordinary');
        if (options?.imported) await refuseMisnamedPictures(statements);
        return settle(() => {
          if (!options?.imported) refuseUncleanPictures(statements);
          db.exec('BEGIN IMMEDIATE');
          try {
            for (const { sql, params } of statements) db.run(sql, params ?? []);
            db.exec('COMMIT');
          } catch (error) {
            // SQLite may have rolled back itself (a full disk, out of memory): the error that did it is the one said.
            try {
              db.exec('ROLLBACK');
            } catch {
              // Nothing open to roll back.
            }
            throw error;
          }
          save();
        });
      },
      query: (sql, params) =>
        settle(() => {
          if (/^\s*SELECT total_changes\(\) AS changes\s*$/i.test(sql)) return [{ changes: earlierChanges + totalChanges() }];
          const statement = db.prepare(sql);
          try {
            statement.bind(params ?? []);
            // Every value by its position first, as sbd.rs checks them: by name, bytes behind a later column of the
            // same name (`SELECT bytes AS v, id AS v`) would be hidden and get through.
            const names = statement.getColumnNames();
            const rows: SqlJsValue[][] = [];
            while (statement.step()) rows.push(statement.get());
            refuseBytes(rows);
            return rows.map((values) => toRow(names, values));
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
            return blobOf(statement.get()[0]);
          } finally {
            statement.free();
          }
        }),
      backup: (kind, name) =>
        settle(() => {
          const dest = backupPath(kind, name);
          if (files.has(dest)) throw new Error(`A backup named "${name}" already exists.`);
          files.set(dest, exportBytes());
          persist();
        }),
      compact: () =>
        settle(() => {
          db.exec('VACUUM');
          save();
        }),
      listBackups: () =>
        settle(() =>
          [...files.entries()]
            .filter(([key]) => key.startsWith(`${backupsDir}/`))
            .map(([key, saved]) => ({ name: key.slice(backupsDir.length + 1), bytes: saved.length }))
            .filter((backup) => isBackupName(stem, backup.name))
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
        ),
      deleteBackup: (name) =>
        settle(() => {
          if (!isBackupName(stem, name)) throw new Error(`"${name}" isn't a backup name for this project.`);
          files.delete(`${backupsDir}/${name}`);
          persist();
        }),
      saveCopy: (dest) =>
        settle(() => {
          checkExtension(dest);
          if (files.has(dest)) throw new Error('A file already exists at that path.');
          files.set(dest, exportBytes());
          persist();
          drafts.add(dest);
        }),
      placeBackups: () => settle(() => backupsDir),
      backupsFolder: () => settle(() => backupsDir),
      showBackups: () => settle(() => undefined),
      refreshLock: () => settle(() => undefined),
      close: () =>
        settle(() => {
          flushThis();
          flushers.get(path)?.delete(flushThis);
          db.close();
          open.set(path, (open.get(path) ?? 1) - 1);
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
        flush(source);
        const saved = files.get(source);
        if (saved === undefined) throw new Error("There's no project file at that path.");
        if (files.has(dest)) throw new Error('A file already exists at that path.');
        files.set(dest, saved);
        persist();
      }),
    keepCopy: (draft, dest) =>
      settle(() => {
        checkExtension(dest);
        checkDraft(draft);
        const saved = files.get(draft);
        if (saved === undefined) throw new Error("There's no project file at that path.");
        if (files.has(dest)) throw new Error('A file already exists at that path.');
        files.set(dest, saved);
        files.delete(draft);
        persist();
        drafts.delete(draft);
      }),
    dropCopy: (draft) =>
      settle(() => {
        checkDraft(draft);
        files.delete(draft);
        persist();
        drafts.delete(draft);
      }),
    lockHolder: () => Promise.resolve(null),
  };
}

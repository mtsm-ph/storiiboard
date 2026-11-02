import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isBackupName, isMigrationBackupName } from './backups';
import type { BackupKind, ProjectFile, Row, SqlDriver } from './driver';
import { fileStem } from './paths';

// The same contract as the Rust commands in src-tauri/src/sbd.rs, on Node's built-in SQLite: Vitest runs on it now,
// and the MCP server will in Phase 7. Keep the pragmas, refusals and messages in step with sbd.rs. Never import this
// from app code; the webview has no node: modules.

function checkExtension(path: string): void {
  if (!/\.sbd$/i.test(path)) throw new Error('A Storiiboard project file ends in .sbd.');
}

function configure(db: DatabaseSync): void {
  try {
    db.exec('PRAGMA journal_mode = DELETE');
  } catch (error) {
    db.close();
    if (error instanceof Error && error.message.includes('file is not a database')) {
      throw new Error("This file isn't a Storiiboard project.", { cause: error });
    }
    throw error;
  }
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA fullfsync = ON');
  db.exec('PRAGMA foreign_keys = ON');
}

function toRow(row: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'bigint') out[key] = Number(value);
    else if (typeof value === 'string' || typeof value === 'number' || value === null) out[key] = value;
    else throw new Error("Binary values aren't supported yet.");
  }
  return out;
}

/**
 * Runs a synchronous node:sqlite call and settles a promise with it. The desktop driver rejects on every failure,
 * refusals included, so this one must never throw instead.
 */
function settle<T>(run: () => T): Promise<T> {
  try {
    return Promise.resolve(run());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

function nodeFile(db: DatabaseSync, path: string): ProjectFile {
  const dir = dirname(path);
  const backupsDir = join(dir, 'Backups');
  const stem = fileStem(path);

  const backupPath = (kind: BackupKind, name: string): string => {
    if (kind === 'migration') {
      if (!isMigrationBackupName(basename(path), name)) {
        throw new Error(`"${name}" isn't a migration backup name for this project.`);
      }
      return join(dir, name);
    }
    if (!isBackupName(stem, name)) throw new Error(`"${name}" isn't a backup name for this project.`);
    mkdirSync(backupsDir, { recursive: true });
    return join(backupsDir, name);
  };

  return {
    path,
    tx: (statements) =>
      settle(() => {
        // IMMEDIATE takes the write lock up front, as rusqlite's Immediate behaviour does.
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const { sql, params } of statements) db.prepare(sql).run(...(params ?? []));
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }),
    query: (sql, params) => settle(() => db.prepare(sql).all(...(params ?? [])).map(toRow)),
    backup: (kind, name) =>
      settle(() => {
        const dest = backupPath(kind, name);
        if (existsSync(dest)) throw new Error(`A backup named "${name}" already exists.`);
        db.prepare('VACUUM INTO ?').run(dest);
      }),
    listBackups: () =>
      settle(() =>
        existsSync(backupsDir)
          ? readdirSync(backupsDir)
              .filter((name) => isBackupName(stem, name))
              .sort()
          : [],
      ),
    deleteBackup: (name) =>
      settle(() => {
        if (!isBackupName(stem, name)) throw new Error(`"${name}" isn't a backup name for this project.`);
        rmSync(join(backupsDir, name));
      }),
    close: () =>
      settle(() => {
        db.close();
      }),
  };
}

function openFile(path: string, isNew: boolean): Promise<ProjectFile> {
  return settle(() => {
    checkExtension(path);
    if (isNew && existsSync(path)) throw new Error('A file already exists at that path.');
    if (!isNew && !existsSync(path)) throw new Error("There's no project file at that path.");
    const db = new DatabaseSync(path);
    configure(db);
    return nodeFile(db, path);
  });
}

export const nodeDriver: SqlDriver = {
  create: (path) => openFile(path, true),
  open: (path) => openFile(path, false),
};

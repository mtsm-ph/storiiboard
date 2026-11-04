import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isBackupName, isMigrationBackupName } from './backups';
import { CHANGED_ON_DISK, type BackupKind, type LockHolder, type ProjectFile, type Row, type SqlDriver } from './driver';
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
  // As the app does: deleted rows are overwritten, so what Empty Trash deletes is gone from the file itself.
  db.exec('PRAGMA secure_delete = ON');
}

function toRow(row: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'bigint') out[key] = Number(value);
    else if (typeof value === 'string' || typeof value === 'number' || value === null || value instanceof Uint8Array) out[key] = value;
    else throw new Error(`Unexpected value in column ${key}.`);
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

/** This computer, as the lock file names it (src-tauri/src/lock.rs). Tests make two to act as two computers. */
export interface NodeMachine {
  id: string;
  name: string;
  /**
   * Stands in for sync-folder detection (src-tauri/src/synced.rs), which needs the desktop app: a project in a synced
   * folder keeps its backups under `localBackups`, as the app keeps them in its data folder.
   */
  synced?: (path: string) => boolean;
  localBackups?: string;
}

/** FNV-1a, as sbd.rs names local backup folders. */
function fnv1a(text: string): number {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return Number(hash & 0xffffffffn);
}

/** Five minutes without a refresh: the lock was left by a crash, as in lock.rs. */
const STALE_MS = 5 * 60 * 1000;

interface LockInfo {
  app: string;
  computer: string;
  machine: string;
  session: string;
  opened_at: number;
  refreshed_at: number;
}

const lockPath = (path: string) => join(dirname(path), `.${basename(path)}.lock`);

function readLock(path: string): LockInfo | null {
  try {
    return JSON.parse(readFileSync(lockPath(path), 'utf8')) as LockInfo;
  } catch {
    return null;
  }
}

/** Size, modified time and (on Mac and Linux) device and inode, as sbd.rs compares them. */
function fingerprint(path: string): string {
  if (!existsSync(path)) throw new Error(CHANGED_ON_DISK);
  const stat = statSync(path, { bigint: true });
  const id = process.platform === 'win32' ? '' : `${String(stat.dev)}:${String(stat.ino)}`;
  return `${String(stat.size)}|${String(stat.mtimeNs)}|${id}`;
}

function nodeFile(db: DatabaseSync, path: string, machine: NodeMachine): ProjectFile {
  const dir = dirname(path);
  let backupsDir = join(dir, 'Backups');
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

  let lastWrite = fingerprint(path);
  const checkUnchanged = () => {
    if (fingerprint(path) !== lastWrite) throw new Error(CHANGED_ON_DISK);
  };

  // The lock file, written as lock.rs writes it; a folder that can't be written to gets none.
  const now = Date.now();
  const lock: LockInfo = {
    app: 'Storiiboard',
    computer: machine.name,
    machine: machine.id,
    session: randomUUID(),
    opened_at: now,
    refreshed_at: now,
  };
  const writeLock = () => {
    writeFileSync(lockPath(path), JSON.stringify(lock));
  };
  try {
    writeLock();
  } catch {
    // Read-only volume: the project still opens.
  }

  return {
    path,
    tx: (statements) =>
      settle(() => {
        checkUnchanged();
        try {
          // IMMEDIATE takes the write lock up front, as rusqlite's Immediate behaviour does.
          db.exec('BEGIN IMMEDIATE');
          try {
            for (const { sql, params } of statements) db.prepare(sql).run(...(params ?? []));
            db.exec('COMMIT');
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        } finally {
          lastWrite = fingerprint(path);
        }
      }),
    query: (sql, params) => settle(() => db.prepare(sql).all(...(params ?? [])).map(toRow)),
    readBlob: (sql, params) =>
      settle(() => {
        const row = db.prepare(sql).get(...(params ?? []));
        const value = row ? Object.values(row)[0] : undefined;
        return value instanceof Uint8Array ? value : null;
      }),
    backup: (kind, name) =>
      settle(() => {
        checkUnchanged();
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
              // Node has no clones: every backup here is a full copy.
              .map((name) => ({ name, bytes: statSync(join(backupsDir, name)).size }))
          : [],
      ),
    deleteBackup: (name) =>
      settle(() => {
        if (!isBackupName(stem, name)) throw new Error(`"${name}" isn't a backup name for this project.`);
        rmSync(join(backupsDir, name));
      }),
    placeBackups: (nextToProject) =>
      settle(() => {
        const synced = machine.synced?.(path) === true && machine.localBackups !== undefined;
        if (synced && !nextToProject) {
          let fileId = '';
          try {
            fileId = String(db.prepare("SELECT value FROM meta WHERE key = 'file_id'").get()?.value ?? '');
          } catch {
            // No meta table yet: keyed by the path alone, as in sbd.rs.
          }
          const key = fnv1a(`${fileId}\n${path}`).toString(16).padStart(8, '0');
          backupsDir = join(machine.localBackups ?? '', `${stem} ${key}`);
        } else {
          backupsDir = join(dir, 'Backups');
        }
        return backupsDir;
      }),
    backupsFolder: () => settle(() => backupsDir),
    showBackups: () => settle(() => undefined),
    refreshLock: () =>
      settle(() => {
        lock.refreshed_at = Date.now();
        writeLock();
      }),
    close: () =>
      settle(() => {
        db.close();
        // Another computer may have taken the lock over with Open anyway; only this session's lock is removed.
        if (readLock(path)?.session === lock.session) rmSync(lockPath(path), { force: true });
      }),
  };
}

function openFile(path: string, isNew: boolean, machine: NodeMachine): Promise<ProjectFile> {
  return settle(() => {
    checkExtension(path);
    if (isNew && existsSync(path)) throw new Error('A file already exists at that path.');
    if (!isNew && !existsSync(path)) throw new Error("There's no project file at that path.");
    const db = new DatabaseSync(path);
    configure(db);
    return nodeFile(db, path, machine);
  });
}

/** The Node driver as one computer. `nodeDriver` is this one; tests make others to act as a second computer. */
export function nodeDriverFor(machine: NodeMachine): SqlDriver {
  return {
    create: (path) => openFile(path, true, machine),
    open: (path) => openFile(path, false, machine),
    copy: (source, dest) => copyFile(source, dest),
    lockHolder: (path) =>
      settle((): LockHolder | null => {
        const info = readLock(path);
        if (!info || info.machine === machine.id || Date.now() - info.refreshed_at > STALE_MS) return null;
        return { computer: info.computer, openedAt: info.opened_at };
      }),
  };
}

function copyFile(source: string, dest: string): Promise<void> {
  return settle(() => {
    checkExtension(source);
    checkExtension(dest);
    if (!existsSync(source)) throw new Error("There's no project file at that path.");
    if (existsSync(dest)) throw new Error('A file already exists at that path.');
    const db = new DatabaseSync(source, { readOnly: true });
    try {
      db.prepare('VACUUM INTO ?').run(dest);
    } catch (error) {
      if (error instanceof Error && error.message.includes('file is not a database')) {
        throw new Error("This file isn't a Storiiboard project.", { cause: error });
      }
      throw error;
    } finally {
      db.close();
    }
  });
}

export const nodeDriver: SqlDriver = nodeDriverFor({ id: randomUUID(), name: hostname() });

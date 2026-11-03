// The one way into a .sbd. The desktop app talks to the Rust commands in src-tauri/src/sbd.rs (tauriDriver.ts); tests
// and, from Phase 7, the MCP server use Node's own SQLite (nodeDriver.ts). Both behave the same, so everything above
// this layer runs unchanged on either.

/** What SQLite stores. Objects and arrays go in as JSON text; bytes (images, schema 3) as Uint8Array. */
export type SqlValue = string | number | null | Uint8Array;

export type Row = Record<string, SqlValue>;

export interface Statement {
  sql: string;
  params?: readonly SqlValue[];
}

/**
 * The refusal when a sync replaced or rewrote the file while it was open (src-tauri/src/sbd.rs has the same text).
 * Nothing was written; the app reopens the new version.
 */
export const CHANGED_ON_DISK = 'The project file changed on disk since Storiiboard last saved it.';

/** Another computer that has a project open now, from the lock file next to it (src-tauri/src/lock.rs). */
export interface LockHolder {
  computer: string;
  /** When it opened the project, in ms since the epoch. */
  openedAt: number;
}

/** A scheduled backup goes to `Backups/` next to the project; a migration backup sits beside the file. */
export type BackupKind = 'scheduled' | 'migration';

/** One of a project's scheduled backups. */
export interface BackupFile {
  name: string;
  /**
   * The space only this backup takes, which is what deleting it would free: all of a full copy, and for an APFS clone
   * on a Mac, only what no other file shares, which starts at nothing (src-tauri/src/backup.rs).
   */
  bytes: number;
}

/**
 * An open project file. Every write first checks the file is still the one this app last wrote, and refuses with
 * CHANGED_ON_DISK if not. Opening writes a lock file next to it.
 */
export interface ProjectFile {
  readonly path: string;
  /** Runs every statement in one transaction: all of them land, or none do. */
  tx(statements: readonly Statement[]): Promise<void>;
  query(sql: string, params?: readonly SqlValue[]): Promise<Row[]>;
  /**
   * The bytes in the first column of the first row (an image or a thumbnail), or null when there's no such row.
   * Rows from `query` travel as JSON in the desktop app, which can't carry bytes, so they come this way.
   */
  readBlob(sql: string, params?: readonly SqlValue[]): Promise<Uint8Array | null>;
  /**
   * Writes a consistent copy of the open file: in the desktop app an APFS clone where it can, otherwise a full copy
   * made a few pages at a time so edits go on meanwhile. Only a file name is passed; the driver puts it in the right
   * folder and refuses any name that isn't one of this project's own backup names (backups.ts makes them).
   */
  backup(kind: BackupKind, fileName: string): Promise<void>;
  /** This project's scheduled backups, in name order, with the space each takes. */
  listBackups(): Promise<BackupFile[]>;
  deleteBackup(fileName: string): Promise<void>;
  /**
   * Decides where scheduled backups go and returns the folder: `Backups/` beside the project, or for a project in a
   * synced folder, a folder on this computer unless `nextToProject` (the person's setting).
   */
  placeBackups(nextToProject: boolean): Promise<string>;
  /** The folder this project's scheduled backups go to. */
  backupsFolder(): Promise<string>;
  /** Opens the backups folder in Finder or Explorer. */
  showBackups(): Promise<void>;
  /** Rewrites this computer's lock file, so another computer sees the project is still open here. */
  refreshLock(): Promise<void>;
  /** Closes the file and removes its lock. */
  close(): Promise<void>;
}

export interface SqlDriver {
  /** Makes a new, empty .sbd; refuses if a file is already there. */
  create(path: string): Promise<ProjectFile>;
  open(path: string): Promise<ProjectFile>;
  /**
   * Copies a .sbd that isn't open, such as a backup, to a new file with VACUUM INTO, for Open backup. Refuses to
   * overwrite anything.
   */
  copy(source: string, dest: string): Promise<void>;
  /** Another computer with this project open now, or null. Asked before opening, so the person can choose. */
  lockHolder(path: string): Promise<LockHolder | null>;
}

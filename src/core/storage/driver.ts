// The one way into a .sbd. The desktop app talks to the Rust commands in src-tauri/src/sbd.rs (tauriDriver.ts); tests
// and, from Phase 7, the MCP server use Node's own SQLite (nodeDriver.ts). Both behave the same, so everything above
// this layer runs unchanged on either.

/** What SQLite stores in schema v1. Objects and arrays go in as JSON text; raw bytes arrive with schema 2. */
export type SqlValue = string | number | null;

export type Row = Record<string, SqlValue>;

export interface Statement {
  sql: string;
  params?: readonly SqlValue[];
}

/** A scheduled backup goes to `Backups/` next to the project; a migration backup sits beside the file. */
export type BackupKind = 'scheduled' | 'migration';

/** An open project file. */
export interface ProjectFile {
  readonly path: string;
  /** Runs every statement in one transaction: all of them land, or none do. */
  tx(statements: readonly Statement[]): Promise<void>;
  query(sql: string, params?: readonly SqlValue[]): Promise<Row[]>;
  /**
   * Writes a consistent copy of the open file. Only a file name is passed; the driver puts it in the right folder
   * and refuses any name that isn't one of this project's own backup names (backups.ts makes them).
   */
  backup(kind: BackupKind, fileName: string): Promise<void>;
  /** This project's scheduled backups, by file name. */
  listBackups(): Promise<string[]>;
  deleteBackup(fileName: string): Promise<void>;
  close(): Promise<void>;
}

export interface SqlDriver {
  /** Makes a new, empty .sbd; refuses if a file is already there. */
  create(path: string): Promise<ProjectFile>;
  open(path: string): Promise<ProjectFile>;
}

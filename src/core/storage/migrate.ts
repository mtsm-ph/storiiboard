import { migrationBackupName } from './backups';
import type { ProjectFile, Statement } from './driver';
import { MIGRATIONS } from './migrations';
import { fileName } from './paths';

export interface Migration {
  /** The schema version a file is at once this migration has run. */
  version: number;
  description: string;
  statements: readonly Statement[];
}

export interface MigrationResult {
  from: number;
  to: number;
  /** The copy made before upgrading an existing file, or null when nothing needed one. */
  backup: string | null;
}

/** The file was saved by a newer Storiiboard. Opening it here could lose what that version added. */
export class NewerProjectError extends Error {
  constructor(
    readonly fileVersion: number,
    readonly appVersion: number,
  ) {
    super(
      `This project was saved by a newer version of Storiiboard (file format ${String(fileVersion)}; this version ` +
        `reads up to ${String(appVersion)}). Update Storiiboard to open it.`,
    );
    this.name = 'NewerProjectError';
  }
}

export class NotAProjectError extends Error {
  constructor() {
    super("This file isn't a Storiiboard project.");
    this.name = 'NotAProjectError';
  }
}

/** The upsert that records a meta value; meta rows carry an id and timestamps like every table. */
export function setMeta(key: string, value: string, now: Date): Statement {
  const at = now.toISOString();
  return {
    sql: `INSERT INTO meta (id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    params: [crypto.randomUUID(), key, value, at, at],
  };
}

/** 0 for a file with no schema yet: a brand-new one, or an SQLite file that isn't a project at all. */
async function readVersion(file: ProjectFile): Promise<{ version: number; empty: boolean }> {
  const tables = await file.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  if (!tables.some((table) => table.name === 'meta')) return { version: 0, empty: tables.length === 0 };
  const [row] = await file.query("SELECT value FROM meta WHERE key = 'schema_version'");
  const version = Number(row?.value);
  if (!Number.isInteger(version) || version < 1) throw new NotAProjectError();
  return { version, empty: false };
}

export interface MigrateOptions {
  /** True only for a file this app has just created: the one case where a file with no schema is expected. */
  isNew: boolean;
  migrations?: readonly Migration[];
  now?: () => Date;
}

/**
 * Brings a file up to the current schema. An existing file is copied first (`<name>.sbd.bak-v<from>-<date>`), and
 * each migration runs in its own transaction with its version bump, so a failure leaves the file at the last
 * version that completed.
 */
export async function migrate(file: ProjectFile, options: MigrateOptions): Promise<MigrationResult> {
  const { isNew, migrations = MIGRATIONS, now = () => new Date() } = options;
  const latest = migrations.length;
  const { version: from, empty } = await readVersion(file);

  if (from > latest) throw new NewerProjectError(from, latest);
  // An empty file is only a project when this app just made it; any other file without a schema isn't ours.
  if (from === 0 && !(isNew && empty)) throw new NotAProjectError();
  if (from === latest) return { from, to: latest, backup: null };

  let backup: string | null = null;
  if (from > 0) {
    backup = migrationBackupName(fileName(file.path), from, now());
    await file.backup('migration', backup);
  }
  for (const migration of migrations.slice(from)) {
    await file.tx([...migration.statements, setMeta('schema_version', String(migration.version), now())]);
  }
  return { from, to: latest, backup };
}

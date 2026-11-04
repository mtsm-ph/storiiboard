import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectFile } from './driver';
import { migrate, NewerProjectError, NotAProjectError, type Migration } from './migrate';
import { MIGRATIONS, SCHEMA_VERSION } from './migrations';
import { initial } from './migrations/001_initial';
import { nodeDriver } from './nodeDriver';
import { makeTestFolder, type TestFolder } from './testFolder';

let folder: TestFolder;
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(() => {
  folder.remove();
});

const now = () => new Date(2026, 10, 2, 14, 5);

async function schemaVersion(file: ProjectFile): Promise<string | undefined> {
  const [row] = await file.query("SELECT value FROM meta WHERE key = 'schema_version'");
  return row?.value === undefined ? undefined : String(row.value);
}

async function tables(file: ProjectFile): Promise<string[]> {
  const rows = await file.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  return rows.map((row) => String(row.name));
}

/** A v1 project holding one scene, closed. */
async function v1Project(name = 'Bey County.sbd'): Promise<string> {
  const path = folder.path(name);
  const file = await nodeDriver.create(path);
  await migrate(file, { isNew: true, migrations: [initial], now });
  const at = now().toISOString();
  await file.tx([
    {
      sql: 'INSERT INTO records (id, type, parent_id, sort_key, props, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      params: ['scene-4', 'scene', null, 'a0', JSON.stringify({ number: '4', heading: 'INT. CABIN - NIGHT' }), at, at],
    },
  ]);
  await file.close();
  return path;
}

const addTable = (version: number, table: string): Migration => ({
  version,
  description: `test migration ${String(version)}`,
  statements: [{ sql: `CREATE TABLE ${table} (id TEXT PRIMARY KEY) STRICT` }],
});

describe('migrations', () => {
  it('numbers migrations 1, 2, 3… with no gaps', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));
  });

  it('gives a new file the current schema', async () => {
    const file = await nodeDriver.create(folder.path('New.sbd'));
    expect(await migrate(file, { isNew: true, now })).toEqual({ from: 0, to: SCHEMA_VERSION, backup: null });
    expect(await tables(file)).toEqual(['media_files', 'meta', 'op_groups', 'ops', 'records', 'slate_numbers', 'thumbnails', 'versions']);
    expect(await schemaVersion(file)).toBe(String(SCHEMA_VERSION));
    await file.close();
  });

  it('enforces the column types and valid JSON in props', async () => {
    const file = await nodeDriver.open(await v1Project());
    const insert = (props: string) =>
      file.tx([
        {
          sql: "INSERT INTO records (id, type, sort_key, props, created_at, updated_at) VALUES ('x', 'shot', 'a1', ?, 'now', 'now')",
          params: [props],
        },
      ]);
    await expect(insert('{not json')).rejects.toThrow();
    await expect(
      file.tx([{ sql: "INSERT INTO ops (id, seq, group_id, record_id, kind, author, timestamp, state, created_at, updated_at) VALUES ('o', 'first', 'g', 'r', 'create', 'local', 't', 'applied', 't', 't')" }]),
    ).rejects.toThrow();
    await file.close();
  });

  it('leaves a file at the current version alone', async () => {
    const file = await nodeDriver.create(folder.path('Current.sbd'));
    await migrate(file, { isNew: true, now });
    expect(await migrate(file, { isNew: false, now })).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION, backup: null });
    await file.close();
  });

  it('backs up an existing file before upgrading it', async () => {
    const path = await v1Project();
    const file = await nodeDriver.open(path);
    const result = await migrate(file, { isNew: false, migrations: [initial, addTable(2, 'plans')], now });
    expect(result).toEqual({ from: 1, to: 2, backup: 'Bey County.sbd.bak-v1-2026-11-02 14-05' });
    expect(await schemaVersion(file)).toBe('2');
    expect(await tables(file)).toContain('plans');
    await file.close();

    // The backup is the file exactly as it was: still v1, scene and all, and with no v2 table.
    const backup = new DatabaseSync(folder.path('Bey County.sbd.bak-v1-2026-11-02 14-05'));
    expect(backup.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: '1' });
    expect(backup.prepare('SELECT id FROM records').all()).toEqual([{ id: 'scene-4' }]);
    expect(backup.prepare("SELECT name FROM sqlite_master WHERE name = 'plans'").get()).toBeUndefined();
    backup.close();
  });

  it('stops at the last migration that completed', async () => {
    const file = await nodeDriver.open(await v1Project());
    const broken: Migration = { version: 3, description: 'broken', statements: [{ sql: 'CREATE TABLE oops (' }] };
    await expect(
      migrate(file, { isNew: false, migrations: [initial, addTable(2, 'plans'), broken], now }),
    ).rejects.toThrow();
    expect(await schemaVersion(file)).toBe('2');
    await file.close();
  });

  it('refuses a file saved by a newer Storiiboard, and leaves it untouched', async () => {
    const path = await v1Project();
    const file = await nodeDriver.open(path);
    await file.tx([{ sql: "UPDATE meta SET value = '9' WHERE key = 'schema_version'" }]);
    await expect(migrate(file, { isNew: false, now })).rejects.toThrow(NewerProjectError);
    await expect(migrate(file, { isNew: false, now })).rejects.toThrow(/newer version of Storiiboard/);
    expect(await schemaVersion(file)).toBe('9');
    await file.close();
  });

  it("refuses an SQLite file that isn't a project, and adds nothing to it", async () => {
    const path = folder.path('Other app.sbd');
    const other = new DatabaseSync(path);
    other.exec('CREATE TABLE notes (body TEXT)');
    other.close();
    const file = await nodeDriver.open(path);
    await expect(migrate(file, { isNew: false, now })).rejects.toThrow(NotAProjectError);
    expect(await tables(file)).toEqual(['notes']);
    await file.close();
  });

  it("refuses an empty file it didn't just create", async () => {
    const path = folder.path('Empty.sbd');
    new DatabaseSync(path).close();
    const file = await nodeDriver.open(path);
    await expect(migrate(file, { isNew: false, now })).rejects.toThrow(NotAProjectError);
    await file.close();
  });
});

describe('the Node driver matches the desktop one', () => {
  it('refuses to create over a file, to open a missing one, or anything but .sbd', async () => {
    const path = await v1Project();
    await expect(nodeDriver.create(path)).rejects.toThrow('A file already exists at that path.');
    await expect(nodeDriver.open(folder.path('Missing.sbd'))).rejects.toThrow("There's no project file at that path.");
    await expect(nodeDriver.create(folder.path('notes.txt'))).rejects.toThrow('ends in .sbd');
    expect(existsSync(folder.path('notes.txt'))).toBe(false);
  });

  it('uses the rollback journal with full syncs', async () => {
    const file = await nodeDriver.open(await v1Project());
    expect(await file.query('PRAGMA journal_mode')).toEqual([{ journal_mode: 'delete' }]);
    expect(await file.query('PRAGMA synchronous')).toEqual([{ synchronous: 2 }]);
    await file.close();
  });

  it('lands a batch whole or not at all', async () => {
    const file = await nodeDriver.open(await v1Project());
    const at = now().toISOString();
    const scene = (id: string) => ({
      sql: 'INSERT INTO records (id, type, sort_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      params: [id, 'scene', 'a1', at, at],
    });
    await expect(file.tx([scene('scene-5'), scene('scene-4')])).rejects.toThrow();
    expect(await file.query("SELECT id FROM records WHERE id = 'scene-5'")).toEqual([]);
    await file.close();
  });

  it("only backs up under this project's own names", async () => {
    const file = await nodeDriver.open(await v1Project('Bey.sbd'));
    await expect(file.backup('scheduled', '../Bey 2026-11-02 14-05.sbd')).rejects.toThrow("isn't a backup name");
    await expect(file.deleteBackup('notes.txt')).rejects.toThrow("isn't a backup name");
    await file.backup('scheduled', 'Bey 2026-11-02 14-05.sbd');
    await expect(file.backup('scheduled', 'Bey 2026-11-02 14-05.sbd')).rejects.toThrow('already exists');
    expect(existsSync(folder.path('Backups', 'Bey 2026-11-02 14-05.sbd'))).toBe(true);
    await file.close();
  });
});

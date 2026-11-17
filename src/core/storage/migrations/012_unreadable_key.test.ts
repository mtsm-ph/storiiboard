import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../migrate';
import { nodeDriver } from '../nodeDriver';
import { openProject } from '../project';
import { makeTestFolder, type TestFolder } from '../testFolder';
import { MIGRATIONS } from '.';

// Schema 12 on an old file whose last character has a sort key keyBetween can't read (6.25, Kevin: "Tell me what a
// person sees if migration 012 throws on an old file, and confirm the file is left as it was"). The migration is
// frozen: it makes a character for a name with none after the project's last one, and throws on a key it can't read.
// It throws while working out its changes, before its transaction begins, so nothing of it is written.

let folder: TestFolder;
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(() => {
  folder.remove();
});

const at = '2026-11-09T10:00:00.000Z';
const NAME = 'Bey County.sbd';

/**
 * A v11 file as 012's own tests build theirs: its last character at the key '~', a scene naming one with no record.
 * `schema` makes the same file at an older schema.
 */
async function v11File(schema = 11): Promise<string> {
  const path = folder.path(NAME);
  const file = await nodeDriver.create(path);
  await migrate(file, { isNew: true, migrations: MIGRATIONS.slice(0, schema), now: () => new Date(at) });
  const record = (id: string, type: string, parent: string | null, props: object, sortKey = id) => ({
    sql: `INSERT INTO records (id, type, parent_id, sort_key, props, trashed_at, trashed_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    params: [id, type, parent, sortKey, JSON.stringify(props), at, at],
  });
  await file.tx([
    record('p', 'project', null, { name: 'Bey County' }),
    record('mary', 'character', 'p', { name: 'Mary' }, 'V'),
    record('odd', 'character', 'p', { name: 'Deputy' }, '~'),
    record('s1', 'scene', 'p', { number: '1', name: 'DINER', characters: ['Mary', 'Sheriff'] }),
  ]);
  await file.close();
  return path;
}

const bytes = (path: string) => readFileSync(path);
const beside = () => readdirSync(folder.dir).sort();

/** The file's schema version and its records, read without opening it as a project. */
async function read(path: string): Promise<{ version: string; records: unknown[]; ops: number }> {
  const file = await nodeDriver.open(path);
  try {
    const [row] = await file.query("SELECT value FROM meta WHERE key = 'schema_version'");
    const records = await file.query('SELECT id, type, parent_id, sort_key, props FROM records ORDER BY id');
    const [ops] = await file.query('SELECT COUNT(*) AS n FROM ops');
    return { version: String(row?.value), records, ops: Number(ops?.n) };
  } finally {
    await file.close();
  }
}

/** Everything a file holds: its schema and every table's rows, as text. */
function contents(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const schema = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
    const tables = schema.filter((entry) => entry.type === 'table').map((entry) => String(entry.name));
    const rows = tables.map((table) => [table, db.prepare(`SELECT * FROM "${table}" ORDER BY 1`).all()]);
    return JSON.stringify({ schema, rows }, (_key, value: unknown) => (value instanceof Uint8Array ? Buffer.from(value).toString('hex') : typeof value === 'bigint' ? String(value) : value));
  } finally {
    db.close();
  }
}

describe('schema 12 on a file whose last character’s sort key can’t be read (6.25)', () => {
  it('refuses to open, and leaves the file byte for byte as it was, with the backup made before it', async () => {
    const path = await v11File();
    const before = bytes(path);
    const was = await read(path);
    expect(was.version).toBe('11');
    // Reading it changed nothing.
    expect(bytes(path).equals(before)).toBe(true);

    await expect(openProject(path, { driver: nodeDriver, backups: false, now: () => new Date('2026-11-16T12:00:00') })).rejects.toThrow('"~" isn\'t a sort key.');

    // The project file: the same bytes, still schema 11, every record as it was, nothing added to History.
    expect(bytes(path).equals(before)).toBe(true);
    expect(await read(path)).toEqual(was);
    // Beside it: the backup migrate() made before the upgrade, and nothing else (no lock, no journal, no partial copy).
    const backup = `${NAME}.bak-v11-2026-11-16 12-00`;
    expect(beside()).toEqual([NAME, backup]);
    // The backup holds everything the file does: every table, row for row, and the same schema. (This driver writes a
    // backup with VACUUM INTO, as a compacted copy, so its bytes are not the file's; what it holds is.)
    expect(contents(join(folder.dir, backup))).toBe(contents(path));
    expect(contents(path)).toContain('"key":"schema_version","value":"11"');
  });

  it('fails the same way opened again later: nothing was half-applied', async () => {
    const path = await v11File();
    const before = bytes(path);
    await expect(openProject(path, { driver: nodeDriver, backups: false, now: () => new Date('2026-11-16T12:00:00') })).rejects.toThrow('"~" isn\'t a sort key.');
    await expect(openProject(path, { driver: nodeDriver, backups: false, now: () => new Date('2026-11-16T12:01:00') })).rejects.toThrow('"~" isn\'t a sort key.');
    expect(bytes(path).equals(before)).toBe(true);
    expect((await read(path)).version).toBe('11');
    // Each try makes its own backup of the untouched file first.
    expect(beside()).toEqual([NAME, `${NAME}.bak-v11-2026-11-16 12-00`, `${NAME}.bak-v11-2026-11-16 12-01`]);
  });

  it('on a schema-10 file: refused, no record lost or changed, the version-10 backup holding the original', async () => {
    // The migrations before 12 commit one by one, so this file is no longer byte for byte what it was. Only what must
    // hold whatever is decided about that is asserted here.
    const path = await v11File(10);
    const was = await read(path);
    expect(was.version).toBe('10');
    const original = contents(path);

    await expect(openProject(path, { driver: nodeDriver, backups: false, now: () => new Date('2026-11-16T12:00:00') })).rejects.toThrow();

    expect((await read(path)).records).toEqual(was.records);
    const backup = `${NAME}.bak-v10-2026-11-16 12-00`;
    expect(beside()).toContain(backup);
    expect(contents(join(folder.dir, backup))).toBe(original);
    // Again, later: refused again, the records still as they were.
    await expect(openProject(path, { driver: nodeDriver, backups: false, now: () => new Date('2026-11-16T12:01:00') })).rejects.toThrow();
    expect((await read(path)).records).toEqual(was.records);
  });
});

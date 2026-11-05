import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRecord } from '../../ops/ops';
import { migrate } from '../migrate';
import { nodeDriver } from '../nodeDriver';
import { createProject, openProject, type Project } from '../project';
import { makeTestFolder, type TestFolder } from '../testFolder';
import { MIGRATIONS, SCHEMA_VERSION } from '.';

let folder: TestFolder;
let project: Project | undefined;
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(async () => {
  await project?.close();
  project = undefined;
  folder.remove();
});

const at = '2026-11-05T10:00:00.000Z';

/** A v7 file, as Phase 1 left it: a frame with a picture. */
async function v7File(): Promise<string> {
  const path = folder.path('Bey County.sbd');
  const file = await nodeDriver.create(path);
  await migrate(file, { isNew: true, migrations: MIGRATIONS.slice(0, 7), now: () => new Date(at) });
  const record = (id: string, type: string, props: object) => ({
    sql: `INSERT INTO records (id, type, parent_id, sort_key, props, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)`,
    params: [id, type, id, JSON.stringify(props), at, at],
  });
  await file.tx([
    record('a', 'shot', { number: '4A', media_id: 'm' }),
    record('m', 'media', { kind: 'image', file: 'f'.repeat(64), width: 1920, height: 1080 }),
  ]);
  await file.close();
  return path;
}

describe('schema 8: video', () => {
  it('backs the file up, adds the luts table, and leaves every record as it was', async () => {
    expect(SCHEMA_VERSION).toBe(8);
    const path = await v7File();
    project = await openProject(path, { driver: nodeDriver, backups: false });
    expect(project.migration).toMatchObject({ from: 7, to: 8 });
    expect(readdirSync(folder.dir).some((name) => name.startsWith('Bey County.sbd.bak-v7-'))).toBe(true);
    expect((await getRecord(project.file, 'a'))?.props).toEqual({ number: '4A', media_id: 'm' });
    expect((await getRecord(project.file, 'm'))?.props).toEqual({ kind: 'image', file: 'f'.repeat(64), width: 1920, height: 1080 });
    const columns = await project.file.query("SELECT name FROM pragma_table_info('luts') ORDER BY cid");
    expect(columns.map((c) => c.name)).toEqual(['id', 'sha256', 'name', 'file_name', 'byte_size', 'created_at', 'updated_at', 'cube']);
  });

  it('keeps a LUT once, however many times it is loaded', async () => {
    project = await createProject(folder.path('New.sbd'), { driver: nodeDriver, backups: false });
    const insert = (id: string) => ({
      sql: `INSERT OR IGNORE INTO luts (id, sha256, name, file_name, byte_size, created_at, updated_at, cube)
        VALUES (?, ?, 'Invert', 'invert.cube', 9, ?, ?, 'LUT_3D_SIZE 2')`,
      params: [id, 'a'.repeat(64), at, at],
    });
    await project.file.tx([insert('one'), insert('two')]);
    expect(await project.file.query('SELECT id FROM luts')).toEqual([{ id: 'one' }]);
  });
});

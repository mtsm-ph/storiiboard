import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apply, emptyTrash, getRecord, opsOfRecord } from '../../ops/ops';
import { frameRows } from '../../../features/history/summary';
import { loadLookup, lookupStatement } from '../lookups';
import { migrate } from '../migrate';
import { nodeDriver } from '../nodeDriver';
import { createProject, openProject, type Project } from '../project';
import { makeTestFolder, type TestFolder } from '../testFolder';
import { MIGRATIONS, SCHEMA_VERSION } from '.';

// Schema 11 (3.4): network lookups cached in the project, outside the edit log.

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

const at = '2026-11-09T10:00:00.000Z';

describe('schema 11: cached lookups', () => {
  it('backs the file up, adds the table, and leaves every record as it was', async () => {
    const path = folder.path('Bey County.sbd');
    const file = await nodeDriver.create(path);
    await migrate(file, { isNew: true, migrations: MIGRATIONS.slice(0, 10), now: () => new Date(at) });
    await file.tx([
      {
        sql: `INSERT INTO records (id, type, parent_id, sort_key, props, created_at, updated_at) VALUES ('diner', 'location', NULL, 'a', ?, ?, ?)`,
        params: [JSON.stringify({ name: 'Diner', address: '5 Main St' }), at, at],
      },
    ]);
    await file.close();
    project = await openProject(path, { driver: nodeDriver, backups: false });
    expect(project.migration).toMatchObject({ from: 10, to: SCHEMA_VERSION });
    expect(readdirSync(folder.dir).some((name) => name.startsWith('Bey County.sbd.bak-v10-'))).toBe(true);
    expect((await getRecord(project.file, 'diner'))?.props).toEqual({ name: 'Diner', address: '5 Main St' });
    expect(await project.file.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lookups'")).toEqual([{ name: 'lookups' }]);
  });
});

describe('a lookup', () => {
  it('is kept with when it was fetched, read back, and replaced when asked again', async () => {
    project = await createProject(folder.path('New.sbd'), { driver: nodeDriver, backups: false });
    const file = project.file;
    expect(await loadLookup(file, 'address_search', 'en|plaza de armas')).toBeNull();
    const place = { name: 'Plaza de Armas, Cusco', latitude: -13.5, longitude: -71.9 };
    await file.tx([lookupStatement('address_search', 'en|plaza de armas', 'Plaza de Armas', [place], at)]);
    expect(await loadLookup(file, 'address_search', 'en|plaza de armas')).toEqual({ result: [place], fetchedAt: at });
    // Another language is another lookup.
    expect(await loadLookup(file, 'address_search', 'es|plaza de armas')).toBeNull();
    await file.tx([lookupStatement('address_search', 'en|plaza de armas', 'plaza de armas', [], '2026-11-10T10:00:00.000Z')]);
    expect(await loadLookup(file, 'address_search', 'en|plaza de armas')).toEqual({ result: [], fetchedAt: '2026-11-10T10:00:00.000Z' });
    expect(await file.query('SELECT count(*) AS n FROM lookups')).toEqual([{ n: 1 }]);
    // Asking isn't a step: nothing in History.
    expect(await file.query('SELECT count(*) AS n FROM op_groups')).toEqual([{ n: 0 }]);
  });

  it('that can’t be read is no lookup: not JSON, or no time it was fetched', async () => {
    project = await createProject(folder.path('Odd.sbd'), { driver: nodeDriver, backups: false });
    await project.file.tx([
      { sql: `INSERT INTO lookups VALUES ('x', 'address_search', 'k', 'q', 'not json', ?, ?, ?)`, params: [at, at, at] },
      { sql: `INSERT INTO lookups VALUES ('y', 'address_search', 'd', 'q', '[]', 'whenever', ?, ?)`, params: [at, at] },
    ]);
    expect(await loadLookup(project.file, 'address_search', 'k')).toBeNull();
    expect(await loadLookup(project.file, 'address_search', 'd')).toBeNull();
  });

  it('of addresses goes when a location is emptied from the Trash, as its data does', async () => {
    project = await createProject(folder.path('Purge.sbd'), { driver: nodeDriver, backups: false });
    const file = project.file;
    const p = project.projectId;
    await apply(file, [{ kind: 'create', record: { id: 'diner', type: 'location', parentId: p, sortKey: 'a', props: { name: 'Diner', address: '5 Main St' } } }]);
    await file.tx([lookupStatement('address_search', 'en|5 main st', '5 Main St', [], at)]);
    // Emptying the Trash of no location keeps the cache.
    await apply(file, [{ kind: 'create', record: { id: 'n', type: 'note', parentId: p, sortKey: 'b', props: {} } }]);
    await apply(file, [{ kind: 'trash', id: 'n' }]);
    await emptyTrash(file);
    expect(await file.query('SELECT count(*) AS n FROM lookups')).toEqual([{ n: 1 }]);
    await apply(file, [{ kind: 'trash', id: 'diner' }]);
    await emptyTrash(file);
    expect(await file.query('SELECT count(*) AS n FROM lookups')).toEqual([{ n: 0 }]);
  });
});

describe('a place on the map in an item’s History', () => {
  it('reads as one row, though it’s three props', async () => {
    project = await createProject(folder.path('Rows.sbd'), { driver: nodeDriver, backups: false });
    const file = project.file;
    await apply(file, [{ kind: 'create', record: { id: 'diner', type: 'location', parentId: project.projectId, sortKey: 'a', props: { name: 'Diner' } } }]);
    await apply(file, [{ kind: 'update', id: 'diner', set: { latitude: -13.5, longitude: -71.9, map_name: 'Cusco' } }]);
    const rows = frameRows(await opsOfRecord(file, 'diner'), 'diner').map((r) => r.change);
    expect(rows.filter((r) => r.includes('place on the map'))).toHaveLength(1);
  });
});

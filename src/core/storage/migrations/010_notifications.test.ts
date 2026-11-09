import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRecord } from '../../ops/ops';
import { migrate } from '../migrate';
import { nodeDriver } from '../nodeDriver';
import { isUnread, loadReadState, LOCAL_READER, markAllReadStatements, markReadStatement, stepsSince } from '../notifications';
import { createProject, openProject, type Project } from '../project';
import { makeTestFolder, type TestFolder } from '../testFolder';
import { MIGRATIONS, SCHEMA_VERSION } from '.';

// Schema 10 (3.10): notification read state, per person, outside the edit log.

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

describe('schema 10: notification read state', () => {
  it('backs the file up, adds the two tables, and leaves every record as it was', async () => {
    const path = folder.path('Bey County.sbd');
    const file = await nodeDriver.create(path);
    await migrate(file, { isNew: true, migrations: MIGRATIONS.slice(0, 9), now: () => new Date(at) });
    await file.tx([
      {
        sql: `INSERT INTO records (id, type, parent_id, sort_key, props, created_at, updated_at) VALUES ('a', 'shot', NULL, 'a', ?, ?, ?)`,
        params: [JSON.stringify({ number: '4A' }), at, at],
      },
    ]);
    await file.close();
    project = await openProject(path, { driver: nodeDriver, backups: false });
    expect(project.migration).toMatchObject({ from: 9, to: SCHEMA_VERSION });
    expect(readdirSync(folder.dir).some((name) => name.startsWith('Bey County.sbd.bak-v9-'))).toBe(true);
    expect((await getRecord(project.file, 'a'))?.props).toEqual({ number: '4A' });
    const tables = await project.file.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'notification_%' ORDER BY name");
    expect(tables.map((r) => r.name)).toEqual(['notification_cursors', 'notification_reads']);
  });
});

describe('read state', () => {
  it('reads one step at a time, then every step up to a place in the log, per person; the cursor never goes back', async () => {
    project = await createProject(folder.path('New.sbd'), { driver: nodeDriver, backups: false });
    const file = project.file;
    expect(await loadReadState(file, LOCAL_READER)).toEqual({ readThrough: null, read: new Set() });
    // Two steps in the log to read: their places are what the cursor counts.
    await file.tx([
      { sql: `INSERT INTO op_groups (id, seq, kind, author, timestamp, created_at, updated_at) VALUES ('g1', 101, 'edit', 'Sam', ?, ?, ?)`, params: [at, at, at] },
      { sql: `INSERT INTO op_groups (id, seq, kind, author, timestamp, created_at, updated_at) VALUES ('g2', 102, 'edit', 'Sam', ?, ?, ?)`, params: [at, at, at] },
    ]);
    await file.tx([markReadStatement(LOCAL_READER, 'op_group', 'g1', '2026-11-09T11:00:00.000Z')]);
    // Read twice, kept once; another person's read is their own.
    await file.tx([markReadStatement(LOCAL_READER, 'op_group', 'g1', '2026-11-09T12:00:00.000Z'), markReadStatement('sam', 'op_group', 'g2', at)]);
    const mine = await loadReadState(file, LOCAL_READER);
    expect(mine.read).toEqual(new Set(['op_group:g1']));
    expect(isUnread(mine, 'op_group', 'g1', 101)).toBe(false);
    expect(isUnread(mine, 'op_group', 'g2', 102)).toBe(true);

    // Mark all read through g2: by place, whatever any clock said; the reads at or before it go.
    await file.tx(markAllReadStatements(LOCAL_READER, 102, '2026-11-09T13:00:00.000Z'));
    const after = await loadReadState(file, LOCAL_READER);
    expect(after).toEqual({ readThrough: 102, read: new Set() });
    expect(isUnread(after, 'op_group', 'g3', 103)).toBe(true);
    expect((await loadReadState(file, 'sam')).read).toEqual(new Set(['op_group:g2']));
    // Never back, and never a second row.
    await file.tx(markAllReadStatements(LOCAL_READER, 50, '2026-11-09T14:00:00.000Z'));
    expect((await loadReadState(file, LOCAL_READER)).readThrough).toBe(102);
    expect(await file.query('SELECT count(*) AS n FROM notification_cursors')).toEqual([{ n: 1 }]);
    // The log's steps after a place, for the feed to read only what's new.
    expect((await stepsSince(file, 101)).map((s) => s.id)).toEqual(['g2']);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lutStatements, prepareLut } from '../media/lut';
import { apply, undo } from '../ops/ops';
import type { ProjectFile, Row } from './driver';
import { MIGRATIONS } from './migrations';
import { nodeDriver } from './nodeDriver';
import { createProject, openProject, type Project } from './project';
import {
  importProjectJson,
  ProjectJsonChangedError,
  ProjectJsonError,
  projectJsonBytes,
  projectJsonChunks,
  projectJsonSize,
  projectJsonText,
  projectJsonTitle,
  readProjectJson,
  type JsonTable,
  type JsonValue,
  type ProjectJson,
} from './projectJson';
import { markSeenStatement } from './seen';
import { makeTestFolder, type TestFolder } from './testFolder';
import { nameVersion } from './versions';

// Project data as JSON (2.9): the whole project out and back with nothing lost, History, Trash, pictures, LUTs,
// versions and all. The test fills a project with one of everything the file holds, exports it, imports the JSON as a
// new project, and holds every table of the two files to each other, row for row and byte for byte.

let folder: TestFolder;
let project: Project;
const at = () => new Date('2026-11-07T12:00:00.000Z');

const bytes = (seed: number, length: number) => new Uint8Array(length).map((_, i) => (i * seed + 7) % 256);

beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  const file = project.file;
  const root = project.projectId;
  // A picture and its thumbnail (bytes of every value 0 to 255), a LUT, frames, one in the Trash, an undone edit.
  const sha = 'a'.repeat(64);
  await file.tx([
    {
      sql: `INSERT INTO media_files (id, sha256, mime, width, height, byte_size, color_space, created_at, updated_at, bytes)
        VALUES (?, ?, 'image/png', 4, 4, 512, 'srgb', ?, ?, ?)`,
      params: ['m1', sha, at().toISOString(), at().toISOString(), bytes(3, 512)],
    },
    {
      sql: `INSERT INTO thumbnails (id, sha256, long_edge, mime, width, height, created_at, updated_at, bytes)
        VALUES (?, ?, 640, 'image/jpeg', 4, 4, ?, ?, ?)`,
      params: ['t1', sha, at().toISOString(), at().toISOString(), bytes(5, 300)],
    },
  ]);
  const lut = await prepareLut('SLog3 to 709.cube', 'TITLE "x"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n');
  if (!lut.ok) throw new Error('a good cube');
  await apply(
    file,
    [
      { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: root, sortKey: 'a', props: { number: '4', heading: 'INT. DINER – NIGHT' } } },
      {
        kind: 'create',
        record: { id: 's1', type: 'shot', parentId: 'sc4', sortKey: 'a', props: { number: '4A', media_id: 'p1', lens_mm: 35, notes: 'Ñandú “quoted”   line' } },
      },
      { kind: 'create', record: { id: 'p1', type: 'media', parentId: 's1', sortKey: 'a', props: { kind: 'image', sha256: sha, width: 4, height: 4 } } },
      { kind: 'create', record: { id: 's2', type: 'shot', parentId: 'sc4', sortKey: 'b', props: { number: '4B' } } },
      // A person (3.5), contacts and all: the export is the whole project, private fields included.
      {
        kind: 'create',
        record: {
          id: 'pe1',
          type: 'person',
          parentId: root,
          sortKey: 'a',
          props: { name: 'Ana Ruiz', role: 'hmu', departments: ['hmu', 'vfx'], phone: '+1 212 555 0100', email: 'ana@example.com', custom: { Agent: 'Lou' } },
        },
      },
    ],
    { author: 'Kevin', now: at, alsoWrite: lutStatements('lut-1', lut.lut, at()) },
  );
  await apply(file, [{ kind: 'trash', id: 's2' }], { author: 'Kevin', now: at });
  await apply(file, [{ kind: 'update', id: 's1', set: { lens_mm: 50 } }], { author: 'Kevin', now: at });
  await undo(file, { author: 'Kevin', now: at });
  const [group] = await file.query('SELECT id FROM op_groups ORDER BY seq DESC LIMIT 1');
  await nameVersion(file, { name: 'Lock', note: 'Before the recce', opGroupId: String(group?.id), createdBy: 'Kevin' }, at());
  await file.tx([
    markSeenStatement('s1', ['camera', 'art'], at().toISOString()),
    {
      sql: `INSERT INTO slate_numbers (id, scene_id, number, shot_id, created_at, updated_at) VALUES ('n1', 'sc4', '4B', 's2', ?, ?)`,
      params: [at().toISOString(), at().toISOString()],
    },
  ]);
});

afterEach(async () => {
  await project.close();
  folder.remove();
});

/** Every table of a file, row for row in stored order, blobs as bytes. */
async function everything(file: ProjectFile): Promise<Record<string, Row[]>> {
  const tables = await file.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const all: Record<string, Row[]> = {};
  for (const { name } of tables) all[String(name)] = await file.query(`SELECT * FROM "${String(name)}" ORDER BY rowid`);
  return all;
}

/** What may differ in an imported copy: its own file id, and the app that last opened it. */
function withoutOwnIds(tables: Record<string, Row[]>): Record<string, Row[]> {
  return { ...tables, meta: (tables.meta ?? []).filter((row) => row.key !== 'file_id' && row.key !== 'app_version') };
}

describe('project data as JSON (2.9)', () => {
  it('carries the whole project out and back: every table, row for row, byte for byte', async () => {
    const text = new TextDecoder().decode(await projectJsonBytes(project.file, at()));
    const data = readProjectJson(text);
    expect(data.schema_version).toBe(MIGRATIONS.length);
    expect(projectJsonTitle(data)).toBe('Bey County');
    // A row to a line, so it reads and diffs a row at a time.
    expect(text.split('\n').some((line) => line.startsWith('["s1","shot",'))).toBe(true);
    expect(text).toContain('"rows":[\n[');

    const copy = folder.path('Bey County (imported).sbd');
    await importProjectJson(nodeDriver, copy, data, at());
    const imported = await openProject(copy, { driver: nodeDriver, backups: false });
    try {
      const before = await everything(project.file);
      const after = await everything(imported.file);
      expect(withoutOwnIds(after)).toEqual(withoutOwnIds(before));
      // The pictures' bytes, the Trash, History, the version, Seen and slate numbers all came across.
      expect(after.media_files?.[0]?.bytes).toEqual(bytes(3, 512));
      expect(after.records?.find((r) => r.id === 's2')?.trashed_at).not.toBeNull();
      expect(after.ops?.length).toBe(before.ops?.length);
      expect(after.versions?.[0]?.name).toBe('Lock');
      expect(JSON.parse(String(after.records?.find((r) => r.id === 'pe1')?.props))).toMatchObject({ departments: ['hmu', 'vfx'], phone: '+1 212 555 0100', custom: { Agent: 'Lou' } });
      // Its own file id: a new file, whose backups are its own.
      const id = (rows: Row[] | undefined) => rows?.find((r) => r.key === 'file_id')?.value;
      expect(id(after.meta)).not.toBe(id(before.meta));
      // Out again, it's the same JSON but for the moment and the id.
      const again = new TextDecoder().decode(await projectJsonBytes(imported.file, at()));
      // (Opening a file writes its id if it has none and which app opened it last, as any open does: those rows aside.)
      const strip = (json: string) =>
        json
          .split('\n')
          .filter((line) => !line.includes('"file_id"') && !line.includes('"app_version",'))
          .join('\n');
      expect(strip(again)).toBe(strip(text));
    } finally {
      await imported.close();
    }
  });

  it('imports a project exported at an older schema, then upgrades it as on open', async () => {
    const data = readProjectJson(new TextDecoder().decode(await projectJsonBytes(project.file, at())));
    // Schema 7 had no video tables: the same project without them, said to be at 7.
    const older: ProjectJson = { ...data, schema_version: 7, tables: { ...data.tables } };
    delete older.tables.luts;
    // Nor schema 10's notification read state.
    delete older.tables.notification_cursors;
    delete older.tables.notification_reads;
    const meta = older.tables.meta;
    if (!meta) throw new Error('meta');
    const value = meta.columns.indexOf('value');
    const key = meta.columns.indexOf('key');
    older.tables.meta = { ...meta, rows: meta.rows.map((row) => (row[key] === 'schema_version' ? row.map((cell, i) => (i === value ? '7' : cell)) : row)) };
    const copy = folder.path('Older.sbd');
    await importProjectJson(nodeDriver, copy, older, at());
    const opened = await openProject(copy, { driver: nodeDriver, backups: false });
    try {
      expect(opened.migration).toMatchObject({ from: 7, to: MIGRATIONS.length });
      expect((await opened.file.query("SELECT id FROM records WHERE id = 's1'")).length).toBe(1);
    } finally {
      await opened.close();
    }
  });

  it('refuses what isn’t a project it can read, naming why', () => {
    const problem = (text: string) => {
      try {
        readProjectJson(text);
        return null;
      } catch (error) {
        return error instanceof ProjectJsonError ? error.problem : 'other';
      }
    };
    expect(problem('{not json')).toBe('notJson');
    expect(problem('{"format":"something else"}')).toBe('notProject');
    expect(problem('{"format":"storiiboard-project","format_version":2,"schema_version":1,"tables":{}}')).toBe('formatNewer');
    expect(problem(`{"format":"storiiboard-project","format_version":1,"schema_version":${String(MIGRATIONS.length + 1)},"tables":{}}`)).toBe(
      'schemaNewer',
    );
    expect(problem('{"format":"storiiboard-project","format_version":1,"schema_version":1,"tables":{"meta":{"columns":["id"],"rows":[["a","b"]]}}}')).toBe(
      'tables',
    );
    // A number too large to be exact, a nested object.
    expect(problem('{"format":"storiiboard-project","format_version":1,"schema_version":1,"tables":{"meta":{"columns":["id"],"rows":[[1e300]]}}}')).toBe(
      'tables',
    );
    // A limit of its own here, so the test holds no 400 MB string.
    expect(() => readProjectJson(' '.repeat(101), 100)).toThrow(ProjectJsonError);
    expect(() => projectJsonText(new Uint8Array(101).buffer, 100)).toThrow(ProjectJsonError);
    // Not UTF-8: refused, never read with replacement characters.
    try {
      projectJsonText(new Uint8Array([0x7b, 0xff, 0x7d]).buffer);
      expect.unreachable();
    } catch (error) {
      expect(error instanceof ProjectJsonError && error.problem).toBe('notJson');
    }
  });

  it('refuses a JSON whose rows say another schema than its header', async () => {
    const data = readProjectJson(new TextDecoder().decode(await projectJsonBytes(project.file, at())));
    const meta = data.tables.meta;
    if (!meta) throw new Error('meta');
    const key = meta.columns.indexOf('key');
    const said = (rows: typeof meta.rows) => JSON.stringify({ ...data, tables: { ...data.tables, meta: { ...meta, rows } } });
    expect(() => readProjectJson(said(meta.rows.filter((row) => row[key] !== 'schema_version')))).toThrow(ProjectJsonError);
    const value = meta.columns.indexOf('value');
    expect(() => readProjectJson(said(meta.rows.map((row) => (row[key] === 'schema_version' ? row.map((c, i) => (i === value ? '7' : c)) : row)))))
      .toThrow(ProjectJsonError);
  });

  it('puts rows back in any order, references checked once at commit; a row naming what isn’t there is refused in words', async () => {
    const data = readProjectJson(new TextDecoder().decode(await projectJsonBytes(project.file, at())));
    const { thumbnails, media_files: pictures, op_groups: groups, ...rest } = data.tables;
    if (!thumbnails || !pictures || !groups) throw new Error('tables');
    // Every op group before the earlier ones it names (undo_top, stack_below): only checks deferred to the commit
    // take it. (Tables go in in the schema's order whatever the JSON's, so it's rows within a table that can be out.)
    const reordered: ProjectJson = { ...data, tables: { thumbnails, ...rest, op_groups: { ...groups, rows: [...groups.rows].reverse() }, media_files: pictures } };
    const copy = folder.path('Reordered.sbd');
    await importProjectJson(nodeDriver, copy, reordered, at());
    const opened = await openProject(copy, { driver: nodeDriver, backups: false });
    try {
      expect((await opened.file.query('SELECT count(*) AS n FROM op_groups'))[0]?.n).toBe(groups.rows.length);
    } finally {
      await opened.close();
    }
    // A thumbnail of a picture that isn't there: SQLite refuses it at commit, and it's said as data that doesn't fit.
    const orphan: ProjectJson = { ...data, tables: { ...data.tables, media_files: { ...pictures, rows: [] } } };
    await expect(importProjectJson(nodeDriver, folder.path('Orphan.sbd'), orphan, at())).rejects.toMatchObject({ problem: 'tables' });
  });

  it('says SQLite refusing a row as data that doesn’t fit, and anything else as it is', async () => {
    const data = readProjectJson(new TextDecoder().decode(await projectJsonBytes(project.file, at())));
    const found = data.tables.records;
    if (!found) throw new Error('records');
    const records: JsonTable = found;
    const props = records.columns.indexOf('props');
    const type = records.columns.indexOf('type');
    const broken = (change: (row: JsonValue[]) => JsonValue[]): ProjectJson => ({
      ...data,
      tables: { ...data.tables, records: { ...records, rows: records.rows.map((row) => (row[0] === 's1' ? change(row) : row)) } },
    });
    // Props that aren't JSON (a CHECK), a record with no type (NOT NULL), the same id twice (UNIQUE).
    const cases: ProjectJson[] = [
      broken((row) => row.map((cell, i) => (i === props ? 'not json' : cell))),
      broken((row) => row.map((cell, i) => (i === type ? null : cell))),
      { ...data, tables: { ...data.tables, records: { ...records, rows: [...records.rows, records.rows[records.rows.length - 1] ?? []] } } },
    ];
    for (const [n, json] of cases.entries()) {
      await expect(importProjectJson(nodeDriver, folder.path(`Broken ${String(n)}.sbd`), json, at())).rejects.toMatchObject({ problem: 'tables' });
    }
    // The disk, not the data: said as it is.
    const full: typeof nodeDriver = {
      ...nodeDriver,
      create: async (path) => {
        const file = await nodeDriver.create(path);
        return {
          ...file,
          path: file.path,
          tx: (statements) =>
            statements.some((s) => s.sql.startsWith('PRAGMA defer_foreign_keys'))
              ? Promise.reject(new Error('database or disk is full'))
              : file.tx(statements),
          query: (sql, params) => file.query(sql, params),
          close: () => file.close(),
        };
      },
    };
    await expect(importProjectJson(full, folder.path('Full.sbd'), data, at())).rejects.toThrow('database or disk is full');
  });

  it('reads one consistent project: an edit landing mid-read starts it again, and one that never stops is refused', async () => {
    let edits = 0;
    const edit = async () => {
      edits += 1;
      await apply(project.file, [{ kind: 'update', id: 's1', set: { notes: `take ${String(edits)}` } }], { now: at });
    };
    // Once, between tables: read again, and the JSON has the edit, its frame and its step together.
    let landed = false;
    let passes = 0;
    const pending: Promise<void>[] = [];
    const chunks = await projectJsonChunks(project.file, at(), (table) => {
      if (table === 'meta') passes += 1;
      if (table === 'ops' && !landed) {
        landed = true;
        pending.push(edit());
      }
    });
    await Promise.all(pending);
    const text = chunks.join('');
    expect(passes).toBe(2);
    // The frame and its step from the same read.
    const records = readProjectJson(text).tables.records;
    expect(records?.rows.some((row) => row[0] === 's1' && JSON.stringify(row).includes('take 1'))).toBe(true);
    expect(readProjectJson(text).tables.ops?.rows.some((row) => JSON.stringify(row).includes('take 1'))).toBe(true);
    // Every time: refused, rather than a JSON that might not import.
    const always: Promise<void>[] = [];
    await expect(
      projectJsonChunks(project.file, at(), (table) => {
        if (table === 'ops') always.push(edit());
      }),
    ).rejects.toBeInstanceOf(ProjectJsonChangedError);
    await Promise.all(always);
  });

  it('knows about how large the JSON will be before it reads it', async () => {
    const size = await projectJsonSize(project.file);
    const actual = (await projectJsonBytes(project.file, at())).length;
    // An estimate for the early refusal; the bytes themselves decide just before the file is written.
    expect(size).toBeGreaterThan(actual * 0.8);
    expect(size).toBeLessThan(actual * 1.6);
  });

  it('refuses tables or columns the schema doesn’t have, and a path that’s taken', async () => {
    const data = readProjectJson(new TextDecoder().decode(await projectJsonBytes(project.file, at())));
    const extra: ProjectJson = { ...data, tables: { ...data.tables, secrets: { columns: ['id'], rows: [['x']] } } };
    await expect(importProjectJson(nodeDriver, folder.path('Extra.sbd'), extra, at())).rejects.toBeInstanceOf(ProjectJsonError);
    const records = data.tables.records;
    if (!records) throw new Error('records');
    const injected: ProjectJson = {
      ...data,
      tables: { ...data.tables, records: { columns: [...records.columns.slice(0, -1), 'updated_at") VALUES (1); DROP TABLE ops; --'], rows: records.rows } },
    };
    await expect(importProjectJson(nodeDriver, folder.path('Injected.sbd'), injected, at())).rejects.toBeInstanceOf(ProjectJsonError);
    await expect(importProjectJson(nodeDriver, project.file.path, data, at())).rejects.toThrow();
  });
});

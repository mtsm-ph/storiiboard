import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeDriver } from '../storage/nodeDriver';
import { createProject, openProject, type Project } from '../storage/project';
import { makeTestFolder, type TestFolder } from '../storage/testFolder';
import { createProjectStore } from '../../app/projectStore';
import { apply, emptyTrash, getRecord, log, loggedRewrite, redo, restoreTo, startStepClock, undo, type Change } from './ops';

// Two steps in the same millisecond are never one step (6.24): every op group gets a time strictly later than every
// group already in its file. Proved with a clock that stands still: each call of `now` below returns the same
// instant, as a change file or an assistant applying many steps at once would see. No wait anywhere.

const T = Date.parse('2026-11-16T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
/** A clock that stands still. */
const frozen = (ms = T) => ({ now: () => new Date(ms) });

let folder: TestFolder;
let project: Project;
const path = (name = 'Bey County.sbd') => folder.path(name);

beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(path(), { driver: nodeDriver, backups: false, ...frozen() });
});
afterEach(async () => {
  await project.close();
  folder.remove();
});

const scene = (id: string, parentId = project.projectId): Change => ({
  kind: 'create',
  record: { id, type: 'scene', parentId, sortKey: 'V', props: { number: id } },
});

const times = async (file = project.file) => (await log(file)).map((group) => group.timestamp);

/** Every group later than the one before it: so no two alike. */
function expectRising(list: readonly string[]) {
  for (let i = 1; i < list.length; i++) expect(Date.parse(list[i] ?? '')).toBeGreaterThan(Date.parse(list[i - 1] ?? ''));
}

describe('a step’s time (6.24)', () => {
  it('gives two applies in the same millisecond two different, rising times', async () => {
    await apply(project.file, [scene('sc1')], frozen());
    await apply(project.file, [scene('sc2')], frozen());
    await apply(project.file, [scene('sc3')], frozen());
    expect(await times()).toEqual([iso(T), iso(T + 1), iso(T + 2)]);
    // The records are stamped from their step's time.
    expect((await getRecord(project.file, 'sc1'))?.createdAt).toBe(iso(T));
    expect((await getRecord(project.file, 'sc2'))?.createdAt).toBe(iso(T + 1));
    expect((await getRecord(project.file, 'sc3'))?.updatedAt).toBe(iso(T + 2));
  });

  it('stamps two trashes in the same millisecond with two different times', async () => {
    await apply(project.file, [scene('sc1'), scene('sc2')], frozen());
    await apply(project.file, [{ kind: 'trash', id: 'sc1' }], frozen());
    await apply(project.file, [{ kind: 'trash', id: 'sc2' }], frozen());
    const first = (await getRecord(project.file, 'sc1'))?.trashedAt;
    const second = (await getRecord(project.file, 'sc2'))?.trashedAt;
    expect(first).toBe(iso(T + 1));
    expect(second).toBe(iso(T + 2));
  });

  it('keeps one time for everything in one step', async () => {
    await apply(project.file, [scene('sc1'), scene('sc2')], frozen());
    await apply(project.file, [{ kind: 'trash', id: 'sc1' }, { kind: 'trash', id: 'sc2' }], frozen());
    expect((await getRecord(project.file, 'sc1'))?.trashedAt).toBe(iso(T + 1));
    expect((await getRecord(project.file, 'sc2'))?.trashedAt).toBe(iso(T + 1));
    const rows = await project.file.query('SELECT o.timestamp AS op, g.timestamp AS grp FROM ops o JOIN op_groups g ON g.id = o.group_id');
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.op).toBe(row.grp);
  });

  it('gives an apply, its undo and its redo three rising times', async () => {
    await apply(project.file, [scene('sc1')], frozen());
    await undo(project.file, frozen());
    await redo(project.file, frozen());
    await undo(project.file, frozen());
    expect((await log(project.file)).map((group) => group.kind)).toEqual(['edit', 'undo', 'redo', 'undo']);
    expect(await times()).toEqual([iso(T), iso(T + 1), iso(T + 2), iso(T + 3)]);
  });

  it('gives a restore a later time than every step before it', async () => {
    await apply(project.file, [scene('sc1')], frozen());
    const point = (await log(project.file)).at(-1)?.id ?? null;
    await apply(project.file, [scene('sc2')], frozen());
    expect(await restoreTo(project.file, point, frozen())).not.toBeNull();
    expect((await log(project.file)).at(-1)?.kind).toBe('restore');
    expect(await times()).toEqual([iso(T), iso(T + 1), iso(T + 2)]);
  });

  it('gives Empty Trash’s purge a later time than the trash before it, and the step after a later one still', async () => {
    await apply(project.file, [scene('sc1')], frozen());
    await apply(project.file, [{ kind: 'trash', id: 'sc1' }], frozen());
    expect((await emptyTrash(project.file, frozen()))?.removed).toBe(1);
    await apply(project.file, [scene('sc2')], frozen());
    expect((await log(project.file)).map((group) => group.kind)).toEqual(['edit', 'edit', 'empty_trash', 'edit']);
    expect(await times()).toEqual([iso(T), iso(T + 1), iso(T + 2), iso(T + 3)]);
    const [purge] = await project.file.query("SELECT timestamp FROM ops WHERE kind = 'purge'");
    expect(purge?.timestamp).toBe(iso(T + 2));
  });

  it('gives a migration’s rewrite a later time than the steps in the file', async () => {
    await apply(project.file, [scene('sc1')], frozen());
    const before = await getRecord(project.file, 'sc1');
    if (!before) throw new Error('no scene');
    await project.file.tx(await loggedRewrite(project.file, [{ before, props: { number: '1' } }], iso(T)));
    expect(await times()).toEqual([iso(T), iso(T + 1)]);
    expect((await getRecord(project.file, 'sc1'))?.updatedAt).toBe(iso(T + 1));
  });

  it('stamps the records a migration’s rewrite makes with the step’s time too', async () => {
    await apply(project.file, [scene('sc1')], frozen());
    await apply(project.file, [scene('sc2')], frozen());
    const made = { id: 'ana', type: 'character' as const, parentId: project.projectId, sortKey: 'a', props: { name: 'ANA' }, trashedAt: null, trashedBy: null, createdAt: iso(T), updatedAt: iso(T) };
    await project.file.tx(await loggedRewrite(project.file, [], iso(T), 'local', [made]));
    expect(await times()).toEqual([iso(T), iso(T + 1), iso(T + 2)]);
    const stored = await getRecord(project.file, 'ana');
    expect(stored?.createdAt).toBe(iso(T + 2));
    expect(stored?.updatedAt).toBe(iso(T + 2));
    // The log's `create` op shows the record as stored.
    const [op] = await project.file.query("SELECT after, timestamp FROM ops WHERE record_id = 'ana'");
    expect(op?.timestamp).toBe(iso(T + 2));
    expect((JSON.parse(String(op?.after)) as { created_at: string; updated_at: string })).toMatchObject({ created_at: iso(T + 2), updated_at: iso(T + 2) });
  });

  it('refuses a `now` that is no time before the clock is touched: that step fails, the next one works', async () => {
    await apply(project.file, [scene('sc1')], frozen());
    await expect(apply(project.file, [scene('sc2')], { now: () => new Date('junk') })).rejects.toThrow(RangeError);
    await expect(undo(project.file, { now: () => new Date('junk') })).rejects.toThrow(RangeError);
    expect(await getRecord(project.file, 'sc2')).toBeNull();
    await apply(project.file, [scene('sc3')], frozen());
    await apply(project.file, [scene('sc4')], frozen());
    expect(await times()).toEqual([iso(T), iso(T + 1), iso(T + 2)]);
  });

  it('reads the newest time as the project opens, so the first edit issues no read of its own', async () => {
    await apply(project.file, [scene('sc1')], frozen(T + 60_000));
    await project.close();
    project = await openProject(path(), { driver: nodeDriver, backups: false, ...frozen() });
    const asked: string[] = [];
    const query = project.file.query.bind(project.file);
    project.file.query = (sql, params) => {
      asked.push(sql);
      return query(sql, params);
    };
    const newestReads = () => asked.filter((sql) => sql.includes('max(timestamp)')).length;
    const store = createProjectStore();
    await store.getState().open(project);
    try {
      expect(newestReads()).toBe(1);
      await store.getState().apply([scene('sc2')]);
      await store.getState().apply([scene('sc3')]);
      await store.getState().undo();
      expect(newestReads()).toBe(1);
      // And the time read at open is the one the first edit rose from: the file's newest, ahead of the real clock.
      const all = await times();
      expect(all).toHaveLength(4);
      expectRising(all);
    } finally {
      // The store closes the project; afterEach's close of a closed project must not throw, so open it again.
      await store.getState().close();
      project = await openProject(path(), { driver: nodeDriver, backups: false, ...frozen() });
    }
  });

  it('asks again on the first step when the read begun at open failed', async () => {
    await apply(project.file, [scene('sc1')], frozen());
    await project.close();
    project = await openProject(path(), { driver: nodeDriver, backups: false, ...frozen() });
    const query = project.file.query.bind(project.file);
    let reads = 0;
    project.file.query = (sql, params) => {
      if (sql.includes('max(timestamp)') && reads++ === 0) return Promise.reject(new Error('read failed'));
      return query(sql, params);
    };
    startStepClock(project.file);
    await apply(project.file, [scene('sc2')], frozen());
    expect(reads).toBe(2);
    expect(await times()).toEqual([iso(T), iso(T + 1)]);
  });

  it('gives the next step after closing and reopening a later time than everything in the file', async () => {
    await apply(project.file, [scene('sc1')], frozen());
    await apply(project.file, [scene('sc2')], frozen());
    await undo(project.file, frozen());
    await project.close();
    project = await openProject(path(), { driver: nodeDriver, backups: false, ...frozen() });
    await apply(project.file, [scene('sc3')], frozen());
    await undo(project.file, frozen());
    expect((await log(project.file)).map((group) => group.kind)).toEqual(['edit', 'edit', 'undo', 'edit', 'undo']);
    expect(await times()).toEqual([iso(T), iso(T + 1), iso(T + 2), iso(T + 3), iso(T + 4)]);
  });

  it('keeps rising from a newest step that is an hour in the future, and rewrites nothing', async () => {
    const ahead = T + 60 * 60 * 1000;
    // Another computer's clock ran ahead.
    await apply(project.file, [scene('sc1')], frozen(ahead));
    const stored = async () => (await project.file.query('SELECT * FROM op_groups ORDER BY seq')).map((row) => JSON.stringify(row));
    const [first] = await stored();
    await apply(project.file, [scene('sc2')], frozen());
    await project.close();
    project = await openProject(path(), { driver: nodeDriver, backups: false, ...frozen() });
    await apply(project.file, [{ kind: 'trash', id: 'sc2' }], frozen());
    expect(await times()).toEqual([iso(ahead), iso(ahead + 1), iso(ahead + 2)]);
    expect((await stored())[0]).toBe(first);
    expect((await getRecord(project.file, 'sc1'))?.createdAt).toBe(iso(ahead));
  });

  it('keeps rising when the clock jumps back, a millisecond a step, until the clock passes it', async () => {
    await apply(project.file, [scene('sc1')], frozen());
    const yesterday = T - 24 * 60 * 60 * 1000;
    await apply(project.file, [scene('sc2')], frozen(yesterday));
    await apply(project.file, [scene('sc3')], frozen(yesterday));
    // The clock has passed them: its own time again, exactly.
    await apply(project.file, [scene('sc4')], frozen(T + 5000));
    expect(await times()).toEqual([iso(T), iso(T + 1), iso(T + 2), iso(T + 5000)]);
  });

  it('leaves a clock that moves on as it is', async () => {
    await apply(project.file, [scene('sc1')], frozen(T));
    await apply(project.file, [scene('sc2')], frozen(T + 1));
    await apply(project.file, [scene('sc3')], frozen(T + 250));
    expect(await times()).toEqual([iso(T), iso(T + 1), iso(T + 250)]);
  });

  it('keeps a clock per open file: two projects never share one', async () => {
    const other = await createProject(path('Other.sbd'), { driver: nodeDriver, backups: false, ...frozen() });
    try {
      await apply(project.file, [scene('sc1')], frozen());
      await apply(project.file, [scene('sc2')], frozen());
      await apply(project.file, [scene('sc3')], frozen());
      // The other file's first step is at the clock's own time, whatever this one has reached.
      await apply(other.file, [scene('sc1', other.projectId)], frozen());
      await apply(project.file, [scene('sc4')], frozen());
      await apply(other.file, [scene('sc2', other.projectId)], frozen());
      expect(await times(other.file)).toEqual([iso(T), iso(T + 1)]);
      expect(await times()).toEqual([iso(T), iso(T + 1), iso(T + 2), iso(T + 3)]);
      expectRising(await times(other.file));
      expectRising(await times());
    } finally {
      await other.close();
    }
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { version } from '../../../package.json';
import type { AppDataStore } from './appData';
import { nodeDriver } from './nodeDriver';
import { fileName, fileStem } from './paths';
import { createProject, openProject } from './project';
import { forgetRecent, listRecent, MAX_RECENT, RECENT_FILE, rememberRecent } from './recent';
import { makeTestFolder, type TestFolder } from './testFolder';

function memoryStore(initial: Record<string, string> = {}): AppDataStore & { files: Record<string, string> } {
  const files = { ...initial };
  return {
    files,
    read: (name) => Promise.resolve(files[name] ?? null),
    write: (name, contents) => {
      files[name] = contents;
      return Promise.resolve();
    },
  };
}

let folder: TestFolder;
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(() => {
  folder.remove();
});

const now = () => new Date('2026-11-02T14:05:00.000Z');

describe('projects', () => {
  it('creates a project, records the app version and puts it at the top of Recent', async () => {
    const recent = memoryStore();
    const path = folder.path('Bey County.sbd');
    const project = await createProject(path, { driver: nodeDriver, recent, now });

    expect(project.name).toBe('Bey County');
    expect(project.migration).toEqual({ from: 0, to: 1, backup: null });
    expect(await project.file.query("SELECT value FROM meta WHERE key = 'app_version'")).toEqual([{ value: version }]);
    expect(await listRecent(recent)).toEqual([{ path, name: 'Bey County', openedAt: '2026-11-02T14:05:00.000Z' }]);
    await project.close();
  });

  it('reopens a project with everything it held', async () => {
    const path = folder.path('Bey County.sbd');
    const created = await createProject(path, { driver: nodeDriver, backups: false, now });
    await created.file.tx([
      {
        sql: "INSERT INTO records (id, type, sort_key, created_at, updated_at) VALUES ('scene-4', 'scene', 'a0', 't', 't')",
      },
    ]);
    await created.close();

    const opened = await openProject(path, { driver: nodeDriver, backups: false, now });
    expect(opened.migration).toEqual({ from: 1, to: 1, backup: null });
    expect(await opened.file.query('SELECT id FROM records')).toEqual([{ id: 'scene-4' }]);
    await opened.close();
  });

  it('makes no backup just for being opened, and one once something changes', async () => {
    const project = await createProject(folder.path('Bey.sbd'), { driver: nodeDriver, now });
    if (!project.backups) throw new Error('backups should be on by default');
    expect(await project.backups.runNow()).toEqual({ created: null, deleted: [] });

    await project.file.tx([
      { sql: "INSERT INTO records (id, type, sort_key, created_at, updated_at) VALUES ('s', 'scene', 'a0', 't', 't')" },
    ]);
    const run = await project.backups.runNow();
    expect(run.created).toMatch(/^Bey \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.sbd$/);
    expect(await project.file.listBackups()).toEqual([run.created]);
    await project.close();
  });

  it('opens even when the Recent list can\'t be saved', async () => {
    const broken: AppDataStore = {
      read: () => Promise.resolve(null),
      write: () => Promise.reject(new Error('The disk is full.')),
    };
    const project = await createProject(folder.path('Bey.sbd'), { driver: nodeDriver, recent: broken, backups: false });
    expect(project.name).toBe('Bey');
    await project.close();
  });
});

describe('the Recent list', () => {
  const entry = (n: number) => ({ path: `/Projects/P${String(n)}.sbd`, name: `P${String(n)}`, openedAt: `2026-11-0${String(n % 9)}` });

  it('reads a missing, corrupt or hand-edited file as empty or cleaned up', async () => {
    expect(await listRecent(memoryStore())).toEqual([]);
    expect(await listRecent(memoryStore({ [RECENT_FILE]: '{oops' }))).toEqual([]);
    expect(await listRecent(memoryStore({ [RECENT_FILE]: JSON.stringify([entry(1), { path: 3 }, 'x']) }))).toEqual([
      entry(1),
    ]);
  });

  it('moves a reopened project to the top without a duplicate, and keeps the newest 20', async () => {
    const store = memoryStore();
    for (let n = 1; n <= 25; n++) await rememberRecent(store, entry(n));
    await rememberRecent(store, entry(24));
    const list = await listRecent(store);
    expect(list).toHaveLength(MAX_RECENT);
    expect(list.slice(0, 3).map((e) => e.name)).toEqual(['P24', 'P25', 'P23']);
    expect(list.map((e) => e.name)).not.toContain('P5');
  });

  it('forgets a project', async () => {
    const store = memoryStore();
    await rememberRecent(store, entry(1));
    await rememberRecent(store, entry(2));
    expect((await forgetRecent(store, entry(1).path)).map((e) => e.name)).toEqual(['P2']);
  });
});

describe('paths', () => {
  it('takes the file name from Mac and Windows paths alike', () => {
    expect(fileName('/Users/kevin/Projects/Bey County.sbd')).toBe('Bey County.sbd');
    expect(fileName('C:\\Users\\kevin\\Projects\\Bey County.sbd')).toBe('Bey County.sbd');
    expect(fileStem('C:\\Projects\\Bey County.SBD')).toBe('Bey County');
  });
});

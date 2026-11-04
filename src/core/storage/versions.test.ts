import { existsSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openVersionCopy } from '../../app/openVersion';
import { createProjectStore } from '../../app/projectStore';
import { addShot, board } from '../../features/storyboard/board';
import { apply, log } from '../ops/ops';
import { backupFileName, migrationBackupName } from './backups';
import type { SqlDriver } from './driver';
import { migrate } from './migrate';
import { MIGRATIONS, SCHEMA_VERSION } from './migrations';
import { nodeDriver } from './nodeDriver';
import { versionCopyPaths } from './openBackup';
import { createProject, openProject, type Project } from './project';
import { arriveFromSync, makeTestFolder, type TestFolder } from './testFolder';
import { deleteVersion, listVersions, nameVersion, versionName, type NamedVersion } from './versions';

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
  await store.getState().apply([
    { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4' } } },
  ]);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const frame = async () => {
  const added = addShot(store.getState().records, project.projectId, 'sc4');
  await store.getState().apply(added.changes);
};
const numbers = () => (board(store.getState().records, store.getState().project?.projectId ?? '')[0]?.shots ?? []).map((s) => s.fields.number);
const newest = async () => (await log(project.file)).at(-1)?.id ?? '';
const fileId = async (path: string) => {
  const file = await nodeDriver.open(path);
  try {
    return String((await file.query("SELECT value FROM meta WHERE key = 'file_id'"))[0]?.value);
  } finally {
    await file.close();
  }
};
/** Every file in the test folder: no draft, journal or lock may be left behind. */
const files = () => readdirSync(folder.dir).sort();
const openPath = () => store.getState().project?.file.path;

/** 4A, named "Board sent to client", then 4B and 4C after it. */
async function boardSentToClient(): Promise<NamedVersion> {
  await frame();
  await nameVersion(project.file, { name: 'Board sent to client', opGroupId: await newest() });
  await frame();
  await frame();
  const [version] = await listVersions(project.file);
  if (!version) throw new Error('no version');
  return version;
}

describe('named versions', () => {
  it('names a point, lists versions newest first, and deletes one without touching History', async () => {
    await frame();
    await nameVersion(project.file, { name: 'Board sent to client', opGroupId: await newest() });
    await frame();
    await nameVersion(project.file, { name: 'Locked for shoot', note: 'Before the recce', opGroupId: await newest() });
    const versions = await listVersions(project.file);
    expect(versions.map((v) => [v.name, v.note])).toEqual([
      ['Locked for shoot', 'Before the recce'],
      ['Board sent to client', null],
    ]);
    const steps = (await log(project.file)).length;
    await deleteVersion(project.file, versions[0]?.id ?? '');
    expect((await listVersions(project.file)).map((v) => v.name)).toEqual(['Board sent to client']);
    expect((await log(project.file)).length).toBe(steps);
  });

  it('writes nothing when naming one dies halfway', async () => {
    await frame();
    const write = project.file.tx.bind(project.file);
    project.file.tx = (statements) => write([...statements, { sql: 'INSERT INTO no_such_table VALUES (1)' }]);
    await expect(nameVersion(project.file, { name: 'Board', opGroupId: await newest() })).rejects.toThrow();
    project.file.tx = write;
    expect(await listVersions(project.file)).toEqual([]);
  });

  it('tidies a typed name and refuses an empty one', () => {
    expect(versionName('  Board   sent ')).toBe('Board sent');
    expect(versionName('   ')).toBeNull();
    expect(versionName('x'.repeat(81))).toBeNull();
  });

  it('comes with a v3 project upgraded to v4, which keeps every frame, backed up first', async () => {
    await store.getState().close();
    const path = folder.path('Pilot.sbd');
    const v3 = await nodeDriver.create(path);
    await migrate(v3, { isNew: true, migrations: MIGRATIONS.slice(0, 3), now: () => new Date(2026, 10, 2, 14, 5) });
    await apply(v3, [{ kind: 'create', record: { id: 'sc1', type: 'scene', parentId: null, sortKey: 'V', props: { number: '1' } } }]);
    await v3.close();

    project = await openProject(path, { driver: nodeDriver, backups: false, now: () => new Date(2026, 10, 3, 9, 0) });
    expect(project.migration).toEqual({ from: 3, to: SCHEMA_VERSION, backup: 'Pilot.sbd.bak-v3-2026-11-03 09-00' });
    await store.getState().open(project);
    expect(store.getState().records.sc1?.props.number).toBe('1');
    await nameVersion(project.file, { name: 'Before the upgrade', opGroupId: await newest() });
    expect((await listVersions(project.file)).map((v) => v.name)).toEqual(['Before the upgrade']);
  });
});

describe('Open version', () => {
  it('opens a copy restored to its point, with a file id of its own; the original is unchanged', async () => {
    const version = await boardSentToClient();
    const steps = (await log(project.file)).length;
    const copy = await openVersionCopy(version, { store, driver: nodeDriver });
    expect(copy).toEqual({ path: folder.path('Bey County (Board sent to client).sbd'), opened: true });
    expect(openPath()).toBe(copy.path);
    expect(numbers()).toEqual(['4A']);
    expect(await fileId(copy.path)).not.toBe(await fileId(project.file.path));
    // Only the two projects: the draft became the copy, and nothing is left open.
    expect(files()).toEqual(['Bey County (Board sent to client).sbd', 'Bey County.sbd']);

    // The copy's restore is a step of its own there, and undo takes it back.
    await store.getState().undo();
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    await store.getState().redo();
    await store.getState().close();

    // After a restart, the copy is still at the version and the original has every frame and no new step.
    await store.getState().open(await openProject(copy.path, { driver: nodeDriver, backups: false }));
    expect(numbers()).toEqual(['4A']);
    await store.getState().close();
    project = await openProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    expect((await log(project.file)).length).toBe(steps);
  });

  it('numbers a second copy of the same version', async () => {
    const version = await boardSentToClient();
    const first = await openVersionCopy(version, { store, driver: nodeDriver });
    await store.getState().close();
    project = await openProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
    const second = await openVersionCopy(version, { store, driver: nodeDriver });
    expect([first.path, second.path]).toEqual([
      folder.path('Bey County (Board sent to client).sbd'),
      folder.path('Bey County (Board sent to client 2).sbd'),
    ]);
    expect(numbers()).toEqual(['4A']);
  });

  it('never touches the original when the open is cancelled at “open on another computer”', async () => {
    const version = await boardSentToClient();
    const steps = (await log(project.file)).length;
    // Another computer's lock already sits beside the copy's name.
    const driver: SqlDriver = {
      ...nodeDriver,
      lockHolder: (path) => Promise.resolve(path.endsWith('(Board sent to client).sbd') ? { computer: 'Studio iMac', openedAt: 0 } : null),
    };
    const copy = await openVersionCopy(version, { store, driver, askWhenLocked: () => Promise.resolve('cancel') });
    expect(copy.opened).toBe(false);
    expect(files()).toEqual(['.Bey County.sbd.lock', 'Bey County (Board sent to client).sbd', 'Bey County.sbd']);
    expect(openPath()).toBe(project.file.path);
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    expect((await log(project.file)).length).toBe(steps);
    // The copy was made and restored all the same, there for the person to open later.
    await store.getState().close();
    await store.getState().open(await openProject(copy.path, { driver: nodeDriver, backups: false }));
    expect(numbers()).toEqual(['4A']);
  });

  it('leaves nothing behind when the restore fails partway, and says why', async () => {
    const version = await boardSentToClient();
    const steps = (await log(project.file)).length;
    // The copy's own connection dies at its second write, the restore (its first gives it a file id).
    let writes = 0;
    const driver: SqlDriver = {
      ...nodeDriver,
      open: async (path) => {
        const file = await nodeDriver.open(path);
        if (!path.includes('(Board sent to client)')) return file;
        const write = file.tx.bind(file);
        file.tx = (statements) => {
          writes += 1;
          return writes === 2 ? Promise.reject(new Error('The disk is full.')) : write(statements);
        };
        return file;
      },
    };
    await expect(openVersionCopy(version, { store, driver })).rejects.toThrow('The disk is full.');
    // The original, still open, with its own lock: no draft, journal or lock of the copy's.
    expect(files()).toEqual(['.Bey County.sbd.lock', 'Bey County.sbd']);
    expect(openPath()).toBe(project.file.path);
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    expect((await log(project.file)).length).toBe(steps);
  });

  it('copies nothing from a file a sync has replaced', async () => {
    const version = await boardSentToClient();
    // A newer version of the project, from another computer.
    const incoming = await createProject(folder.path('incoming.sbd'), { driver: nodeDriver, backups: false });
    await incoming.close();
    arriveFromSync(folder.path('incoming.sbd'), folder.path('Bey County.sbd'));
    await expect(openVersionCopy(version, { store, driver: nodeDriver })).rejects.toThrow(
      'The project file changed on disk since Storiiboard last saved it.',
    );
    expect(files().filter((name) => name.endsWith('.sbd'))).toEqual(['Bey County.sbd']);
    expect(openPath()).toBe(project.file.path);
  });

  it('shortens a long name to a file name and a path the disk takes', async () => {
    await frame();
    // 80 characters, the most a name can have, are about 240 bytes in Japanese.
    const name = '絵コンテ'.repeat(20);
    await nameVersion(project.file, { name, opGroupId: await newest() });
    const [version] = await listVersions(project.file);
    if (!version) throw new Error('no version');
    const copy = await openVersionCopy(version, { store, driver: nodeDriver });
    expect(numbers()).toEqual(['4A']);
    const fileName = copy.path.slice(folder.dir.length + 1);
    expect(fileName.startsWith('Bey County (絵コンテ')).toBe(true);
    expect(new TextEncoder().encode(`.${fileName}.lock`).length).toBeLessThanOrEqual(255);
    expect(existsSync(copy.path)).toBe(true);
  });
});

describe('Open version’s file names', () => {
  const longest = (paths: ReturnType<typeof versionCopyPaths>) => [paths.draft, paths.path(50)];
  const at = new Date(2026, 11, 31, 23, 59);
  const nameOf = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  /** The copy's scheduled backup and its pre-upgrade backup, as SQLite writes them (`.partial` until complete). */
  const backupsOf = (path: string) => {
    const name = nameOf(path);
    const folder = path.slice(0, path.length - name.length);
    const separator = folder.at(-1) ?? '/';
    return [
      `${folder}Backups${separator}${backupFileName(name.slice(0, -'.sbd'.length), at)}.partial`,
      `${folder}${migrationBackupName(name, 99, at)}.partial`,
    ];
  };
  const bytes = (text: string) => new TextEncoder().encode(text).length;

  it('keeps every file name it makes within 255 bytes, journal and lock file included', () => {
    const paths = versionCopyPaths('/Films/Bey County.sbd', '絵コンテ'.repeat(20), '0a1b2c3d');
    for (const path of longest(paths)) {
      const name = path.slice('/Films/'.length);
      for (const beside of [`${name}-journal`, `.${name}.lock`]) expect(new TextEncoder().encode(beside).length).toBeLessThanOrEqual(255);
    }
    expect(paths.path(1).startsWith('/Films/Bey County (絵コンテ絵')).toBe(true);
    // A short name is left whole.
    expect(versionCopyPaths('/Films/Bey County.sbd', 'Board sent to client', '0a1b2c3d').path(1)).toBe('/Films/Bey County (Board sent to client).sbd');
  });

  it('keeps a Windows path and its journal within what SQLite opens there', () => {
    const folderPath = `C:\\Users\\kevma\\Documents\\${'Commercials\\'.repeat(14)}Spring`;
    const paths = versionCopyPaths(`${folderPath}\\Bey County.sbd`, 'Board sent to client after the second recce', '0a1b2c3d');
    for (const path of longest(paths)) expect(`${path}-journal`.length).toBeLessThanOrEqual(259);
    expect(paths.path(1).startsWith(`${folderPath}\\Bey County (Board`)).toBe(true);
    // A Mac path that long is fine as it is.
    const mac = versionCopyPaths(`${folderPath.replace(/\\/g, '/').slice(2)}/Bey County.sbd`, 'Board sent to client after the second recce', '0a1b2c3d');
    expect(mac.path(1).endsWith('(Board sent to client after the second recce).sbd')).toBe(true);
    expect(() => versionCopyPaths(`C:\\${'x'.repeat(240)}\\Bey County.sbd`, 'Board', '0a1b2c3d')).toThrow(/folder path is too long/);
  });

  it('leaves room for the copy’s backups: scheduled ones and the one made before a schema upgrade', () => {
    for (const attempt of [1, 50]) {
      const copy = versionCopyPaths('/Users/k/Films/Bey County.sbd', '絵コンテ'.repeat(20), '0a1b2c3d').path(attempt);
      for (const backup of backupsOf(copy)) {
        expect(bytes(nameOf(backup))).toBeLessThanOrEqual(255);
        expect(nameOf(backup).length).toBeLessThanOrEqual(255);
      }
    }
    // A short name is still left whole.
    expect(versionCopyPaths('/Films/Bey County.sbd', 'Board sent to client', '0a1b2c3d').path(1)).toBe('/Films/Bey County (Board sent to client).sbd');
  });

  it('keeps the copy’s backups’ Windows paths within what SQLite opens there', () => {
    const folderPath = `C:\\Users\\kevma\\Documents\\${'Shoot\\'.repeat(25)}Spring`;
    const version = 'Board sent to client after the second recce, with notes';
    for (const attempt of [1, 50]) {
      const copy = versionCopyPaths(`${folderPath}\\Bey County.sbd`, version, '0a1b2c3d').path(attempt);
      for (const backup of backupsOf(copy)) expect(backup.length).toBeLessThanOrEqual(259);
    }
    expect(versionCopyPaths(`${folderPath}\\Bey County.sbd`, version, '0a1b2c3d').path(1).startsWith(`${folderPath}\\Bey County (Board`)).toBe(true);
  });

  it('leaves out what a file name can’t hold', () => {
    expect(versionCopyPaths('/Films/Bey County.sbd', 'Cut 2: "final"/v3?', '0a1b2c3d').path(1)).toBe('/Films/Bey County (Cut 2 final v3).sbd');
    expect(versionCopyPaths('/Films/Bey County.sbd', '???', '0a1b2c3d').path(1)).toBe('/Films/Bey County (version).sbd');
  });
});

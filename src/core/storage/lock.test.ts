import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHANGED_ON_DISK } from './driver';
import { migrate } from './migrate';
import { nodeDriverFor } from './nodeDriver';
import { createProject, openProject } from './project';
import { arriveFromSync, makeTestFolder, type TestFolder } from './testFolder';

// Two computers sharing a synced folder, as two Node drivers with their own machine ids.
const studio = nodeDriverFor({ id: 'studio', name: 'Studio iMac' });
const laptop = nodeDriverFor({ id: 'laptop', name: 'Kevin’s MacBook Pro' });

let folder: TestFolder;
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(() => {
  folder.remove();
});

const lockFile = (name: string) => folder.path(`.${name}.lock`);

describe('the lock file next to an open project', () => {
  it('names the computer while the project is open, and goes when it closes', async () => {
    const project = await createProject(folder.path('Bey County.sbd'), { driver: studio, backups: false });
    expect(JSON.parse(readFileSync(lockFile('Bey County.sbd'), 'utf8'))).toMatchObject({
      app: 'Storiiboard',
      computer: 'Studio iMac',
      machine: 'studio',
    });
    expect(await laptop.lockHolder(folder.path('Bey County.sbd'))).toMatchObject({ computer: 'Studio iMac' });
    // A computer's own lock never warns it, even one left behind by a crash.
    expect(await studio.lockHolder(folder.path('Bey County.sbd'))).toBeNull();

    await project.close();
    expect(existsSync(lockFile('Bey County.sbd'))).toBe(false);
    expect(await laptop.lockHolder(folder.path('Bey County.sbd'))).toBeNull();
  });

  it('ignores a lock no one has refreshed for five minutes', async () => {
    writeFileSync(
      lockFile('Pilot.sbd'),
      JSON.stringify({ app: 'Storiiboard', computer: 'Studio iMac', machine: 'studio', session: 's', opened_at: 0, refreshed_at: Date.now() - 6 * 60 * 1000 }),
    );
    expect(await laptop.lockHolder(folder.path('Pilot.sbd'))).toBeNull();
  });

  it('leaves the lock alone when another computer took the project over', async () => {
    const path = folder.path('Pilot.sbd');
    const first = await createProject(path, { driver: studio, backups: false });
    const second = await laptop.open(path);
    await first.close();
    expect(await studio.lockHolder(path)).toMatchObject({ computer: 'Kevin’s MacBook Pro' });
    await second.close();
  });
});

describe('the check before every write', () => {
  it('refuses to write once a sync has put another file in its place, and writes nothing', async () => {
    const path = folder.path('Bey County.sbd');
    const file = await studio.create(path);
    await migrate(file, { isNew: true });
    await file.tx([{ sql: "INSERT INTO meta (id, key, value, created_at, updated_at) VALUES ('a', 'k1', 'v', 't', 't')" }]);

    // The newer version arrives the way sync services deliver it: written beside, then renamed over.
    const incoming = await laptop.create(folder.path('incoming.sbd'));
    await migrate(incoming, { isNew: true });
    await incoming.close();
    arriveFromSync(folder.path('incoming.sbd'), path);

    const write = file.tx([{ sql: "INSERT INTO meta (id, key, value, created_at, updated_at) VALUES ('b', 'k2', 'v', 't', 't')" }]);
    await expect(write).rejects.toThrow(CHANGED_ON_DISK);
    await expect(file.backup('scheduled', 'Bey County 2026-11-03 09-00.sbd')).rejects.toThrow(CHANGED_ON_DISK);
    await file.close();
  });

  it('keeps writing through its own edits', async () => {
    const file = await studio.create(folder.path('Pilot.sbd'));
    await migrate(file, { isNew: true });
    for (const key of ['a', 'b', 'c']) {
      await file.tx([{ sql: 'INSERT INTO meta (id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', params: [key, key, 'v', 't', 't'] }]);
    }
    await expect(file.tx([{ sql: 'INSERT INTO nowhere VALUES (1)' }])).rejects.toThrow();
    await file.tx([{ sql: "DELETE FROM meta WHERE key = 'a'" }]);
    await file.close();
  });
});

describe('backups of a project in a synced folder', () => {
  it('stay in a folder on this computer, one per file, unless the setting keeps them next to the project', async () => {
    const local = folder.path('app data', 'Backups');
    const synced = (path: string) => /[\\/]Dropbox[\\/]/.test(path);
    const here = nodeDriverFor({ id: 'laptop', name: 'Laptop', synced, localBackups: local });
    mkdirSync(folder.path('Dropbox'));
    mkdirSync(folder.path('Films'));

    const project = await createProject(folder.path('Dropbox', 'Bey County.sbd'), { driver: here, backups: false });
    const backupsAt = await project.file.backupsFolder();
    expect(backupsAt.startsWith(local)).toBe(true);
    await project.file.backup('scheduled', 'Bey County 2026-11-03 09-00.sbd');
    expect(existsSync(folder.path('Dropbox', 'Backups'))).toBe(false);
    expect(existsSync(`${backupsAt}/Bey County 2026-11-03 09-00.sbd`)).toBe(true);
    await project.close();

    // Opened again, the same file finds the same folder; with the setting on, backups go next to it.
    const again = await openProject(folder.path('Dropbox', 'Bey County.sbd'), { driver: here, backups: false });
    expect(await again.file.backupsFolder()).toBe(backupsAt);
    expect(await again.file.placeBackups(true)).toBe(folder.path('Dropbox', 'Backups'));
    await again.close();

    // A project in an ordinary folder keeps Backups/ next to it whatever the setting.
    const plain = await createProject(folder.path('Films', 'Pilot.sbd'), { driver: here, backups: false });
    expect(await plain.file.backupsFolder()).toBe(folder.path('Films', 'Backups'));
    await plain.close();
  });

  it('gives every file its own id', async () => {
    const one = await createProject(folder.path('One.sbd'), { driver: studio, backups: false });
    const two = await createProject(folder.path('Two.sbd'), { driver: studio, backups: false });
    const id = async (file: typeof one.file) => (await file.query("SELECT value FROM meta WHERE key = 'file_id'"))[0]?.value;
    expect(await id(one.file)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await id(one.file)).not.toBe(await id(two.file));
    await one.close();
    await two.close();
  });
});

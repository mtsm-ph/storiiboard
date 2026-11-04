import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apply, getRecord } from '../ops/ops';
import type { SqlDriver } from './driver';
import { createMemoryDriver } from './memoryDriver';
import { nodeDriverFor } from './nodeDriver';
import { createProject, openProject } from './project';
import { makeTestFolder, type TestFolder } from './testFolder';

// Open version's drafts (1.23): a copy of the open project made through its own connection, then named or deleted.
// The Node and memory drivers keep sbd.rs's guards (its tests cover the desktop's), so only a draft the driver made,
// and closed, can ever be renamed or deleted, and nothing is overwritten.

const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

let folder: TestFolder;
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(() => {
  folder.remove();
});

const drivers: [string, () => Promise<SqlDriver>][] = [
  ['Node', () => Promise.resolve(nodeDriverFor({ id: 'this-computer', name: 'Edit bay' }))],
  ['memory', () => createMemoryDriver({ wasm })],
];

describe.each(drivers)('drafts in the %s driver', (_, makeDriver) => {
  it('copies the open project as it is, then names the draft or deletes it, and nothing else', async () => {
    const driver = await makeDriver();
    const at = (name: string) => folder.path(name);
    const project = await createProject(at('Bey County.sbd'), { driver, backups: false });
    await apply(project.file, [{ kind: 'update', id: project.projectId, set: { notes: 'Golden hour on 4A' } }]);
    const draft = at('.Bey County (Board) 0a1b2c3d.sbd');
    await project.file.saveCopy(draft);
    await expect(project.file.saveCopy(draft)).rejects.toThrow('A file already exists at that path.');

    const notOurs = "That isn't a copy Storiiboard is making.";
    await expect(driver.dropCopy(project.file.path)).rejects.toThrow(notOurs);
    await expect(driver.keepCopy(project.file.path, at('Bey County (Board).sbd'))).rejects.toThrow(notOurs);

    const open = await driver.open(draft);
    await expect(driver.keepCopy(draft, at('Bey County (Board).sbd'))).rejects.toThrow('That copy is still open.');
    await expect(driver.dropCopy(draft)).rejects.toThrow('That copy is still open.');
    await open.close();

    await driver.keepCopy(draft, at('Bey County (Board).sbd'));
    const copy = await openProject(at('Bey County (Board).sbd'), { driver, backups: false });
    expect((await getRecord(copy.file, copy.projectId))?.props.notes).toBe('Golden hour on 4A');
    await copy.close();
    // Named, it's a project like any other: no longer a draft to rename or delete.
    await expect(driver.dropCopy(at('Bey County (Board).sbd'))).rejects.toThrow(notOurs);

    const failed = at('.Bey County (Board) 9f8e7d6c.sbd');
    await project.file.saveCopy(failed);
    await driver.dropCopy(failed);
    await expect(driver.open(failed)).rejects.toThrow("There's no project file at that path.");
    await project.close();
  });

  it('never names a draft over a file that’s there', async () => {
    const driver = await makeDriver();
    const project = await createProject(folder.path('Bey County.sbd'), { driver, backups: false });
    const taken = await createProject(folder.path('Bey County (Board).sbd'), { driver, backups: false });
    await apply(taken.file, [{ kind: 'update', id: taken.projectId, set: { notes: 'Someone else’s' } }]);
    await taken.close();
    const draft = folder.path('.Bey County (Board) 0a1b2c3d.sbd');
    await project.file.saveCopy(draft);
    await expect(driver.keepCopy(draft, folder.path('Bey County (Board).sbd'))).rejects.toThrow('A file already exists at that path.');
    const still = await openProject(folder.path('Bey County (Board).sbd'), { driver, backups: false });
    expect((await getRecord(still.file, still.projectId))?.props.notes).toBe('Someone else’s');
    await still.close();
    await project.close();
  });
});

describe('a draft in the Node driver', () => {
  it('isn’t made from a file something else has rewritten, and leaves no file behind', async () => {
    const driver = nodeDriverFor({ id: 'this-computer', name: 'Edit bay' });
    const project = await createProject(folder.path('Pilot.sbd'), { driver, backups: false });
    // As a sync rewriting it in place would (the way it must on Windows): size and time change.
    writeFileSync(folder.path('Pilot.sbd'), Buffer.alloc(4096), { flag: 'a' });
    const draft = folder.path('.Pilot (Locked) 0a1b2c3d.sbd');
    await expect(project.file.saveCopy(draft)).rejects.toThrow('The project file changed on disk since Storiiboard last saved it.');
    expect(existsSync(draft)).toBe(false);
    await project.close();
  });
});

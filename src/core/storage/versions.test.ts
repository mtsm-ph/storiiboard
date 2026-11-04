import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { addShot, board } from '../../features/storyboard/board';
import { log } from '../ops/ops';
import { nodeDriver } from './nodeDriver';
import { copyBeside } from './openBackup';
import { createProject, openProject, type Project } from './project';
import { makeTestFolder, type TestFolder } from './testFolder';
import { deleteVersion, freshFileId, listVersions, nameVersion, versionName } from './versions';

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
const numbers = () => (board(store.getState().records, project.projectId)[0]?.shots ?? []).map((s) => s.fields.number);
const newest = async () => (await log(project.file)).at(-1)?.id ?? '';
const fileId = async (path: string) => {
  const file = await nodeDriver.open(path);
  try {
    return String((await file.query("SELECT value FROM meta WHERE key = 'file_id'"))[0]?.value);
  } finally {
    await file.close();
  }
};

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

  it('opens as a copy restored to its point, with a file id of its own; the original is unchanged', async () => {
    await frame();
    await nameVersion(project.file, { name: 'Board sent to client', opGroupId: await newest() });
    await frame();
    await frame();
    const [version] = await listVersions(project.file);
    // What Open version does: copy, a fresh file id, open the copy, restore it to the version's step.
    const copy = await copyBeside(project.file.path, 'Board sent to client', nodeDriver);
    const raw = await nodeDriver.open(copy);
    await freshFileId(raw);
    await raw.close();
    expect(await fileId(copy)).not.toBe(await fileId(project.file.path));
    await store.getState().close();
    const opened = await openProject(copy, { driver: nodeDriver, backups: false });
    await store.getState().open(opened);
    await store.getState().restoreTo(version?.opGroupId ?? null);
    expect(numbers()).toEqual(['4A']);
    // The copy's restore is a step of its own there, and undo takes it back.
    await store.getState().undo();
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    await store.getState().redo();
    await store.getState().close();

    // After a restart, the copy is still at the version and the original still has every frame.
    await store.getState().open(await openProject(copy, { driver: nodeDriver, backups: false }));
    expect(numbers()).toEqual(['4A']);
    await store.getState().close();
    project = await openProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
    expect(numbers()).toEqual(['4A', '4B', '4C']);
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
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearNotice, noticeStore } from '../../app/notice';
import { createProjectStore } from '../../app/projectStore';
import { log } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { arriveFromSync, makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { listVersions } from '../../core/storage/versions';
import { nameThisPoint, removeNamedVersion } from './versionWrites';

// Name version and Delete… in History (1.23). Refused because a sync replaced the file, each is handled like a refused
// edit, so the shell reopens the newer version instead of leaving the stale one on screen.

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
  clearNotice();
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
  clearNotice();
});

const newest = async () => (await log(project.file)).at(-1)?.id ?? '';

/** A newer version of the project, from another computer, put in place by a sync. */
async function syncReplacesFile(): Promise<void> {
  const incoming = await createProject(folder.path('incoming.sbd'), { driver: nodeDriver, backups: false });
  await incoming.close();
  arriveFromSync(folder.path('incoming.sbd'), folder.path('Bey County.sbd'));
}

describe('naming and deleting a version', () => {
  it('names and deletes one on the file that is open', async () => {
    expect(await nameThisPoint(store, 'Board sent to client', await newest())).toBe(true);
    const [version] = await listVersions(project.file);
    expect(version?.name).toBe('Board sent to client');
    expect(await removeNamedVersion(store, version?.id ?? '')).toBe(true);
    expect(await listVersions(project.file)).toEqual([]);
  });

  it('naming one on a file a sync replaced flags it for reopening, rather than only showing the message', async () => {
    const at = await newest();
    await syncReplacesFile();
    expect(await nameThisPoint(store, 'Board sent to client', at)).toBe(false);
    expect(store.getState().changedOnDisk).toBe(true);
    expect(noticeStore.getState().message).toBeNull();
  });

  it('deleting one on a file a sync replaced flags it for reopening too', async () => {
    expect(await nameThisPoint(store, 'Board sent to client', await newest())).toBe(true);
    const [version] = await listVersions(project.file);
    await syncReplacesFile();
    expect(await removeNamedVersion(store, version?.id ?? '')).toBe(false);
    expect(store.getState().changedOnDisk).toBe(true);
    expect(noticeStore.getState().message).toBeNull();
  });

  it('any other failure says why, and nothing is reopened', async () => {
    // A step that isn't in the file: the versions table refuses it.
    expect(await nameThisPoint(store, 'Board sent to client', 'no-such-step')).toBe(false);
    expect(store.getState().changedOnDisk).toBe(false);
    expect(noticeStore.getState()).toMatchObject({ kind: 'warning' });
    expect(noticeStore.getState().message).not.toBeNull();
  });
});

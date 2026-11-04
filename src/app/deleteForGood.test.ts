import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readOriginal, type PreparedImage } from '../core/media/store';
import { historyOnlyPictures } from '../core/ops/ops';
import { nodeDriver } from '../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../core/storage/project';
import { makeTestFolder, type TestFolder } from '../core/storage/testFolder';
import { addShot, trashShot } from '../features/storyboard/board';
import { setPicture, type FramePicture } from '../features/storyboard/framePictures';
import { cleanUpConfirmed, emptyTrashConfirmed } from './deleteForGood';
import { createProjectStore } from './projectStore';

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
  return added.shotId;
};
const trash = (id: string) => store.getState().applyWith((now) => ({ changes: trashShot(now, project.projectId, id) }));
function picture(seed: number): FramePicture {
  const bytes = new Uint8Array(4000).map((_, i) => (i * seed) % 256);
  const image: PreparedImage = {
    original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/jpeg', width: 2560, height: 1440, colorSpace: 'srgb' },
    thumbnail: { bytes: bytes.slice(0, 500), mime: 'image/jpeg', width: 640, height: 360, longEdge: 640 },
  };
  return { image, source: { name: `IMG_${String(seed)}.JPG` } };
}

describe('Empty Trash, as the tiles run it', () => {
  it('deletes only what the confirm counted: a frame trashed while it was up stays in the Trash', async () => {
    const [first, second] = [await frame(), await frame()];
    await trash(first);
    const done = await emptyTrashConfirmed(store, { current: false }, async (text) => {
      expect(text).toContain('1 item will be deleted for good');
      await trash(second);
      return true;
    });
    expect(done).toEqual({ ran: true, result: { items: 1, freed: 0 } });
    expect(store.getState().records[first]).toBeUndefined();
    expect(typeof store.getState().records[second]?.trashedAt).toBe('string');
  });

  it('deletes nothing when another project opened while the confirm was up', async () => {
    const shot = await frame();
    await trash(shot);
    const other = await createProject(folder.path('Pilot.sbd'), { driver: nodeDriver, backups: false });
    const done = await emptyTrashConfirmed(store, { current: false }, async () => {
      await store.getState().open(other);
      return true;
    });
    expect(done).toEqual({ ran: false, why: 'switched' });
    // Back in Bey County, its Trash is as it was.
    await store.getState().open(await openProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false }));
    expect(typeof store.getState().records[shot]?.trashedAt).toBe('string');
  });
});

describe('Clean up old pictures, as Settings → Storage runs it', () => {
  it('deletes only the pictures it counted, not one left to History while the confirm was up', async () => {
    const [one, two] = [await frame(), await frame()];
    const put = async (shotId: string, seed: number) => {
      const edit = setPicture(store.getState().records, shotId, picture(seed), project.file.path);
      await store.getState().apply(edit.changes, { alsoWrite: edit.alsoWrite });
      return picture(seed).image.original.sha256;
    };
    const counted = await put(one, 1);
    await store.getState().undo();
    const shown = new Set((await historyOnlyPictures(project.file)).map((p) => p.sha256));
    let later = '';
    const done = await cleanUpConfirmed(store, { current: false }, shown, async (text) => {
      expect(text).toContain('1 picture only History uses');
      later = await put(two, 2);
      await store.getState().undo();
      return true;
    });
    expect(done.ran).toBe(true);
    expect(await readOriginal(project.file, counted)).toBeNull();
    expect(await readOriginal(project.file, later)).not.toBeNull();
  });

  it('deletes nothing when another project opened while the confirm was up', async () => {
    const shot = await frame();
    const edit = setPicture(store.getState().records, shot, picture(3), project.file.path);
    await store.getState().apply(edit.changes, { alsoWrite: edit.alsoWrite });
    await store.getState().undo();
    const shown = new Set((await historyOnlyPictures(project.file)).map((p) => p.sha256));
    const other = await createProject(folder.path('Pilot.sbd'), { driver: nodeDriver, backups: false });
    const done = await cleanUpConfirmed(store, { current: false }, shown, async () => {
      await store.getState().open(other);
      return true;
    });
    expect(done).toEqual({ ran: false, why: 'switched' });
    await store.getState().open(await openProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false }));
    const left = store.getState().project?.file;
    expect(left && (await historyOnlyPictures(left)).map((p) => p.sha256)).toEqual([...shown]);
  });
});

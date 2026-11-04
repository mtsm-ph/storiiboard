import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { addShot, moveItem, trashShot } from '../../features/storyboard/board';
import { setPicture, type FramePicture } from '../../features/storyboard/framePictures';
import { addStroke } from '../../features/storyboard/sketch/strokes';
import { readOriginal, readThumbnail, type PreparedImage } from '../media/store';
import { shotFields } from '../model/storyboard';
import { nodeDriver } from '../storage/nodeDriver';
import { createProject, openProject, type Project } from '../storage/project';
import { makeTestFolder, type TestFolder } from '../storage/testFolder';
import { historyOnlyPictures, log, restoreTo } from './ops';

function picture(seed: number): FramePicture {
  const bytes = new Uint8Array(4000).map((_, i) => (i * seed) % 256);
  const image: PreparedImage = {
    original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/jpeg', width: 2560, height: 1440, colorSpace: 'srgb' },
    thumbnail: { bytes: bytes.slice(0, 500), mime: 'image/jpeg', width: 640, height: 360, longEdge: 640 },
  };
  return { image, source: { name: `IMG_${String(seed)}.JPG` } };
}

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
    { kind: 'create', record: { id: 'sc5', type: 'scene', parentId: project.projectId, sortKey: 'W', props: { number: '5' } } },
  ]);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const reopen = async () => {
  await store.getState().close();
  project = await openProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await store.getState().open(project);
};
const frame = async (sceneId = 'sc4') => {
  const added = addShot(records(), project.projectId, sceneId);
  await store.getState().apply(added.changes);
  return added.shotId;
};
const withPicture = async (shotId: string, seed: number) => {
  const edit = setPicture(records(), shotId, picture(seed), project.file.path);
  await store.getState().apply(edit.changes, { alsoWrite: edit.alsoWrite });
  return picture(seed).image.original.sha256;
};
const trash = (id: string) => store.getState().applyWith((now) => ({ changes: trashShot(now, project.projectId, id) }));
/** Breaks the next write part way through, as a crash between its statements would. */
const failNextWrite = () => {
  const write = project.file.tx.bind(project.file);
  project.file.tx = (statements) => {
    project.file.tx = write;
    const half = Math.ceil(statements.length / 2);
    return write([...statements.slice(0, half), { sql: 'INSERT INTO no_such_table VALUES (1)' }, ...statements.slice(half)]);
  };
};

describe('Empty Trash', () => {
  it('deletes trashed frames with their sketch and pictures for good, and keeps a picture another frame still uses', async () => {
    const [gone, kept] = [await frame(), await frame()];
    const own = await withPicture(gone, 1);
    const shared = await withPicture(kept, 2);
    // The same picture on the frame that's going, as a second media record.
    const second = setPicture(records(), gone, picture(2), project.file.path);
    await store.getState().apply(second.changes, { alsoWrite: second.alsoWrite });
    const stroke = addStroke(records(), gone, { tool: 'pen', points: [0.1, 0.1, 0.2, 0.2], width: 0.008, pressures: null });
    await store.getState().apply([stroke]);
    await trash(gone);

    const done = await store.getState().emptyTrash();
    expect(done?.removed).toBeGreaterThanOrEqual(4);
    expect(Object.values(records()).filter((r) => r.trashedAt !== null)).toEqual([]);
    expect(records()[gone]).toBeUndefined();
    expect(Object.values(records()).filter((r) => r.parentId === gone)).toEqual([]);
    expect(await readOriginal(project.file, own)).toBeNull();
    expect(await readThumbnail(project.file, own)).toBeNull();
    expect(await readOriginal(project.file, shared)).not.toBeNull();
    expect(shotFields(records()[kept]?.props ?? {}).number).toBe('4A');
  });

  it('can’t be undone: the stacks end at it, it’s in History as purges, and older steps lose those records’ data', async () => {
    const shot = await frame();
    await trash(shot);
    expect(store.getState().canUndo).toBe(true);
    await store.getState().emptyTrash();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(false);
    await store.getState().undo();
    expect(records()[shot]).toBeUndefined();
    const groups = await log(project.file);
    expect(groups.at(-1)?.kind).toBe('empty_trash');
    const ops = await project.file.query('SELECT kind, before, after FROM ops WHERE record_id = ? ORDER BY seq', [shot]);
    expect(ops.map((o) => [o.kind, o.before, o.after])).toEqual([
      ['create', null, null],
      ['trash', null, null],
      ['purge', null, null],
    ]);
  });

  it('never brings a deleted record back through a History restore, nor moves one under a deleted parent', async () => {
    const moved = await frame('sc4');
    const before = (await log(project.file)).at(-1)?.id ?? null;
    // Moved out of scene 4, then scene 4 deleted for good.
    await store.getState().applyWith((now) => ({ changes: moveItem(now, project.projectId, moved, 'sc5', null) }));
    await store.getState().apply([{ kind: 'trash', id: 'sc4' }]);
    await store.getState().emptyTrash();

    await restoreTo(project.file, before);
    await reopen();
    expect(records().sc4).toBeUndefined();
    // Its place at that point was under scene 4, which is gone: it stays in scene 5.
    expect(records()[moved]?.parentId).toBe('sc5');
  });

  it('is still done after the project is closed and opened again, and edits go on as before', async () => {
    const shot = await frame();
    await trash(shot);
    await store.getState().emptyTrash();
    await reopen();
    expect(records()[shot]).toBeUndefined();
    const next = await frame();
    expect(shotFields(records()[next]?.props ?? {}).number).toBe('4A');
    await store.getState().undo();
    expect(records()[next]).toBeUndefined();
  });

  it('changes nothing when the write dies halfway: the Trash and its pictures are all still there', async () => {
    const shot = await frame();
    const sha = await withPicture(shot, 3);
    await trash(shot);
    failNextWrite();
    expect(await store.getState().emptyTrash()).toBeNull();
    expect(store.getState().error).not.toBeNull();
    await reopen();
    expect(records()[shot]?.trashedAt).not.toBeNull();
    expect(await readOriginal(project.file, sha)).not.toBeNull();
    expect((await log(project.file)).some((g) => g.kind === 'empty_trash')).toBe(false);
    // And it works once the file is well again.
    await store.getState().emptyTrash();
    expect(records()[shot]).toBeUndefined();
  });
});

describe('Clean up old pictures', () => {
  it('finds pictures only History uses, deletes them for good, and leaves every picture on the board or in the Trash', async () => {
    const [shown, trashed, undone] = [await frame(), await frame(), await frame()];
    const onBoard = await withPicture(shown, 4);
    const inTrash = await withPicture(trashed, 5);
    await trash(trashed);
    const historyOnly = await withPicture(undone, 6);
    await store.getState().undo();
    expect((await historyOnlyPictures(project.file)).map((p) => p.sha256)).toEqual([historyOnly]);

    const done = await store.getState().cleanUpPictures();
    expect(done?.removed).toBe(1);
    expect(await readOriginal(project.file, historyOnly)).toBeNull();
    expect(await readOriginal(project.file, onBoard)).not.toBeNull();
    expect(await readOriginal(project.file, inTrash)).not.toBeNull();
    expect(await historyOnlyPictures(project.file)).toEqual([]);
  });

  it('leaves redo working: the step comes back with its picture shown as removed, and it all lasts a restart', async () => {
    const shot = await frame();
    const sha = await withPicture(shot, 7);
    await store.getState().undo();
    await store.getState().cleanUpPictures();
    await store.getState().redo();
    const mediaId = shotFields(records()[shot]?.props ?? {}).mediaId;
    expect(mediaId).not.toBeNull();
    expect(await readOriginal(project.file, sha)).toBeNull();
    await reopen();
    expect(shotFields(records()[shot]?.props ?? {}).mediaId).toBe(mediaId);
    expect(await readOriginal(project.file, sha)).toBeNull();
  });

  it('deletes nothing when the write dies halfway', async () => {
    const shot = await frame();
    const sha = await withPicture(shot, 8);
    await store.getState().undo();
    failNextWrite();
    await store.getState().cleanUpPictures();
    expect(store.getState().error).not.toBeNull();
    await reopen();
    expect(await readOriginal(project.file, sha)).not.toBeNull();
    expect(await readThumbnail(project.file, sha)).not.toBeNull();
  });
});

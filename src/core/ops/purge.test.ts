import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { addScene, addShot, moveItem, setSceneNumber, trashShot } from '../../features/storyboard/board';
import { setPicture, type FramePicture } from '../../features/storyboard/framePictures';
import { addStroke, eraseStrokes } from '../../features/storyboard/sketch/strokes';
import { readOriginal, readThumbnail, type PreparedImage } from '../media/store';
import { shotFields } from '../model/storyboard';
import { nodeDriver } from '../storage/nodeDriver';
import { createProject, openProject, type Project } from '../storage/project';
import { makeTestFolder, type TestFolder } from '../storage/testFolder';
import { historyOnlyPictures, log, restoreTo, trashedRoots } from './ops';

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
/**
 * Breaks the next write after its last statement, as a crash before it commits would: every statement before it has
 * run, so anything not rolled back with the rest would show.
 */
const failNextWrite = () => {
  const write = project.file.tx.bind(project.file);
  project.file.tx = (statements) => {
    project.file.tx = write;
    return write([...statements, { sql: 'INSERT INTO no_such_table VALUES (1)' }]);
  };
};
/** Whether the project file on disk still holds a picture's bytes anywhere, free pages included. */
const fileHolds = (seed: number) => {
  const bytes = Buffer.from(picture(seed).image.original.bytes.slice(1000, 1200));
  return readFileSync(folder.path('Bey County.sbd')).includes(bytes);
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

  it('deletes only what the confirm counted: a frame trashed while it was up stays in the Trash', async () => {
    const [first, second] = [await frame(), await frame()];
    await trash(first);
    const confirmed = new Set(trashedRoots(Object.values(records())));
    await trash(second);
    expect(await store.getState().emptyTrash(confirmed)).not.toBeNull();
    expect(records()[first]).toBeUndefined();
    expect(typeof records()[second]?.trashedAt).toBe('string');
  });

  it('keeps pictures only History uses: that’s Clean up’s job, after its own confirm', async () => {
    const [undone, gone] = [await frame(), await frame()];
    const historyOnly = await withPicture(undone, 7);
    await store.getState().undo();
    await trash(gone);
    await store.getState().emptyTrash();
    expect(await readOriginal(project.file, historyOnly)).not.toBeNull();
    expect((await historyOnlyPictures(project.file)).map((p) => p.sha256)).toEqual([historyOnly]);
  });

  it('leaves a stroke erased from a frame still on the board, so History can bring the sketch back', async () => {
    const [kept, gone] = [await frame(), await frame()];
    const stroke = addStroke(records(), kept, { tool: 'pen', points: [0.1, 0.1, 0.2, 0.2], width: 0.008, pressures: null });
    await store.getState().apply([stroke]);
    const strokeId = stroke.record.id ?? '';
    const drawn = (await log(project.file)).at(-1)?.id ?? null;
    await store.getState().apply(eraseStrokes([strokeId]));
    await trash(gone);

    // The person was told about one item: the frame. The erased stroke isn't in the Trash, so it isn't deleted.
    expect((await store.getState().emptyTrash())?.removed).toBe(1);
    expect(typeof records()[strokeId]?.trashedAt).toBe('string');
    await restoreTo(project.file, drawn);
    await reopen();
    expect(records()[strokeId]?.trashedAt).toBeNull();
    expect(records()[strokeId]?.parentId).toBe(kept);
  });

  it('can’t be undone: the stacks end at it, it’s in History as purges, and older steps lose those records’ data', async () => {
    const shot = await frame();
    await trash(shot);
    // Something to redo, so the redo stack really is ended by it.
    await frame();
    await store.getState().undo();
    expect(store.getState().canUndo).toBe(true);
    expect(store.getState().canRedo).toBe(true);
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

    await reopen();
    await restoreTo(project.file, before);
    await reopen();
    expect(records().sc4).toBeUndefined();
    // Its place at that point was under scene 4, which is gone: it stays in scene 5, as it is there, number and all.
    expect(records()[moved]?.parentId).toBe('sc5');
    expect(shotFields(records()[moved]?.props ?? {}).number).toBe('5A');
  });

  it('keeps the scene a frame stays in as it is now, so no two frames share a slate number', async () => {
    const stays = await frame('sc5');
    const moved = await frame('sc4');
    const before = (await log(project.file)).at(-1)?.id ?? null;
    // Moved to the front of scene 5: it's 5A there now, and the frame that was 5A is 5B.
    await store.getState().applyWith((now) => ({ changes: moveItem(now, project.projectId, moved, 'sc5', stays) }));
    await store.getState().apply([{ kind: 'update', id: 'sc5', set: { name: 'Road' } }]);
    await store.getState().apply([{ kind: 'trash', id: 'sc4' }]);
    await store.getState().emptyTrash();

    await restoreTo(project.file, before);
    await reopen();
    const number = (id: string) => shotFields(records()[id]?.props ?? {}).number;
    expect([number(moved), number(stays)]).toEqual(['5A', '5B']);
    expect(records().sc5?.props.name).toBe('Road');
  });

  it('never puts a scene back on a number a scene kept as it is now has taken, nor its frames on one slate number', async () => {
    const moved = await frame('sc4');
    const other = await frame('sc5');
    const before = (await log(project.file)).at(-1)?.id ?? null;
    // Scene 5 becomes 9; a new scene takes 5, and the frame from scene 4 moves into it as 5A.
    await store.getState().applyWith((now) => ({ changes: setSceneNumber(now, project.projectId, 'sc5', '9') }));
    const added = addScene(records(), project.projectId);
    await store.getState().apply([added]);
    await store.getState().applyWith((now) => ({ changes: setSceneNumber(now, project.projectId, added.record.id, '5') }));
    await store.getState().applyWith((now) => ({ changes: moveItem(now, project.projectId, moved, added.record.id, null) }));
    await store.getState().apply([{ kind: 'trash', id: 'sc4' }]);
    await store.getState().emptyTrash();

    await restoreTo(project.file, before);
    await reopen();
    const live = Object.values(records()).filter((r) => r.trashedAt === null);
    const scenes = live.filter((r) => r.type === 'scene').map((r) => r.props.number);
    const frames = live.filter((r) => r.type === 'shot').map((r) => shotFields(r.props).number);
    expect(new Set(scenes).size).toBe(scenes.length);
    expect(new Set(frames).size).toBe(frames.length);
    expect(records()[moved]?.parentId).toBe(added.record.id);
    expect(records()[other]?.parentId).toBe('sc5');
  });

  it('keeps a frame kept as it is now with its newer picture and sketch, so nothing it shows is deleted', async () => {
    const moved = await frame('sc4');
    const before = (await log(project.file)).at(-1)?.id ?? null;
    await store.getState().applyWith((now) => ({ changes: moveItem(now, project.projectId, moved, 'sc5', null) }));
    const sha = await withPicture(moved, 10);
    await store.getState().apply([addStroke(records(), moved, { tool: 'pen', points: [0.1, 0.1, 0.2, 0.2], width: 0.008, pressures: null })]);
    await store.getState().apply([{ kind: 'trash', id: 'sc4' }]);
    await store.getState().emptyTrash();

    await restoreTo(project.file, before);
    await reopen();
    const mediaId = shotFields(records()[moved]?.props ?? {}).mediaId ?? '';
    expect(records()[mediaId]?.trashedAt).toBeNull();
    expect(Object.values(records()).filter((r) => r.type === 'stroke' && r.parentId === moved && r.trashedAt === null)).toHaveLength(1);
    expect(await historyOnlyPictures(project.file)).toEqual([]);
    expect(await readOriginal(project.file, sha)).not.toBeNull();
  });

  it('restores a point from before a scene that a frame moved into, keeping both, when the frame’s first scene is gone', async () => {
    const moved = await frame('sc4');
    const before = (await log(project.file)).at(-1)?.id ?? null;
    await store.getState().apply([
      { kind: 'create', record: { id: 'sc6', type: 'scene', parentId: project.projectId, sortKey: 'X', props: { number: '6' } } },
    ]);
    await store.getState().applyWith((now) => ({ changes: moveItem(now, project.projectId, moved, 'sc6', null) }));
    await store.getState().apply([{ kind: 'update', id: 'sc5', set: { name: 'Road' } }]);
    await store.getState().apply([{ kind: 'trash', id: 'sc4' }]);
    await store.getState().emptyTrash();

    // Scene 6 came after the point, but the frame stays in it, so it stays too; the rest goes back.
    expect(await restoreTo(project.file, before)).not.toBeNull();
    await reopen();
    expect(records().sc6).toBeDefined();
    expect(records()[moved]?.parentId).toBe('sc6');
    expect(records().sc5?.props.name).toBeUndefined();
  });

  it('restores a point whose frame and sketch were undone and then deleted for good with their scene: both stay away', async () => {
    const shot = await frame('sc4');
    await store.getState().apply([addStroke(records(), shot, { tool: 'pen', points: [0.1, 0.1, 0.2, 0.2], width: 0.008, pressures: null })]);
    const point = (await log(project.file)).at(-1)?.id ?? null;
    await store.getState().undo();
    await store.getState().undo();
    await store.getState().apply([{ kind: 'update', id: 'sc5', set: { name: 'Road' } }]);
    await store.getState().apply([{ kind: 'trash', id: 'sc4' }]);
    await store.getState().emptyTrash();

    expect(await restoreTo(project.file, point)).not.toBeNull();
    await reopen();
    expect(records()[shot]).toBeUndefined();
    expect(Object.values(records()).filter((r) => r.type === 'stroke')).toEqual([]);
    // What could come back did: scene 5's name from before the point.
    expect(records().sc5?.props.name).toBeUndefined();
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
    expect(records()[shot]).toBeDefined();
    expect(typeof records()[shot]?.trashedAt).toBe('string');
    expect(Object.values(records()).filter((r) => r.parentId === shot)).not.toEqual([]);
    expect(await readOriginal(project.file, sha)).not.toBeNull();
    expect((await log(project.file)).some((g) => g.kind === 'empty_trash')).toBe(false);
    // And it works once the file is well again, and the picture's bytes are gone from the file itself.
    expect(fileHolds(3)).toBe(true);
    await store.getState().emptyTrash();
    expect(records()[shot]).toBeUndefined();
    expect(fileHolds(3)).toBe(false);
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
    expect(fileHolds(6)).toBe(false);
    expect(fileHolds(4)).toBe(true);
  });

  it('deletes only the pictures the confirm counted', async () => {
    const [one, two] = [await frame(), await frame()];
    const counted = await withPicture(one, 8);
    await store.getState().undo();
    const confirmed = new Set((await historyOnlyPictures(project.file)).map((p) => p.sha256));
    // Another one is left to History while the confirm is up.
    const later = await withPicture(two, 9);
    await store.getState().undo();
    expect((await store.getState().cleanUpPictures(confirmed))?.removed).toBe(1);
    expect(await readOriginal(project.file, counted)).toBeNull();
    expect(await readOriginal(project.file, later)).not.toBeNull();
  });

  it('lets History restore a point where the picture showed: the frame names it again, and it reads as missing', async () => {
    const shot = await frame();
    const sha = await withPicture(shot, 9);
    const point = (await log(project.file)).at(-1)?.id ?? null;
    await store.getState().undo();
    await store.getState().cleanUpPictures();
    await reopen();
    expect(await restoreTo(project.file, point)).not.toBeNull();
    await reopen();
    expect(shotFields(records()[shot]?.props ?? {}).mediaId).not.toBeNull();
    expect(await readOriginal(project.file, sha)).toBeNull();
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

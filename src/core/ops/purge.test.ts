import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openVersionCopy } from '../../app/openVersion';
import { createProjectStore } from '../../app/projectStore';
import { addScene, addShot, moveItem, setSceneLocation, setSceneNumber, trashShot } from '../../features/storyboard/board';
import { setPicture, type FramePicture } from '../../features/storyboard/framePictures';
import { addStroke, eraseStrokes } from '../../features/storyboard/sketch/strokes';
import { readOriginal, readThumbnail, type PreparedImage } from '../media/store';
import { shotFields } from '../model/storyboard';
import { nodeDriver } from '../storage/nodeDriver';
import { createProject, openProject, type Project } from '../storage/project';
import { makeTestFolder, type TestFolder } from '../storage/testFolder';
import { deleteVersion, listVersions, nameVersion } from '../storage/versions';
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

  it('clears what only History holds under a deleted scene: a note and a picture made and undone there', async () => {
    const shot = await frame('sc4');
    await store.getState().apply([
      { kind: 'create', record: { id: 'n1', type: 'note', parentId: 'sc4', sortKey: 'Z', props: { text: 'SECRET-NOTE-TEXT-XYZ' } } },
    ]);
    await store.getState().undo();
    await withPicture(shot, 11);
    await store.getState().undo();
    await store.getState().apply([{ kind: 'trash', id: 'sc4' }]);
    await store.getState().emptyTrash();
    await store.getState().close();
    const bytes = readFileSync(folder.path('Bey County.sbd'));
    expect(bytes.includes(Buffer.from('SECRET-NOTE-TEXT-XYZ'))).toBe(false);
    expect(fileHolds(11)).toBe(false);
    await reopen();
  });

  it('keeps what only History holds under a parent that stays: a note made and undone in a live scene', async () => {
    await store.getState().apply([
      { kind: 'create', record: { id: 'n2', type: 'note', parentId: 'sc5', sortKey: 'Z', props: { text: 'KEPT-NOTE-TEXT' } } },
    ]);
    const made = (await log(project.file)).at(-1)?.id ?? null;
    await store.getState().undo();
    await trash(await frame('sc4'));
    await store.getState().emptyTrash();
    await restoreTo(project.file, made);
    await reopen();
    expect(records().n2?.props.text).toBe('KEPT-NOTE-TEXT');
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

  it('keeps a scene kept as it is now with the location it names, so its location is never deleted from under it', async () => {
    const moved = await frame('sc4');
    const before = (await log(project.file)).at(-1)?.id ?? null;
    await store.getState().applyWith((now) => ({ changes: moveItem(now, project.projectId, moved, 'sc5', null) }));
    await store.getState().applyWith((now) => ({ changes: setSceneLocation(now, project.projectId, 'sc5', 'Diner') }));
    await store.getState().apply([{ kind: 'trash', id: 'sc4' }]);
    await store.getState().emptyTrash();

    await restoreTo(project.file, before);
    await reopen();
    const locationId = records().sc5?.props.location_id;
    expect(typeof locationId).toBe('string');
    expect(typeof locationId === 'string' ? records()[locationId]?.props.name : null).toBe('Diner');
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

  it('tells History it ran, though it changes no record and no undo state, so older steps say the picture went', async () => {
    const shot = await frame();
    await withPicture(shot, 3);
    await store.getState().undo();
    const before = store.getState();
    expect((await store.getState().cleanUpPictures())?.removed).toBe(1);
    const after = store.getState();
    expect(after.records).toBe(before.records);
    expect([after.canUndo, after.canRedo]).toEqual([before.canUndo, before.canRedo]);
    expect(after.deletedForGood).toBe(before.deletedForGood + 1);
    // Nothing left to clean up: nothing to read again.
    await store.getState().cleanUpPictures();
    expect(store.getState().deletedForGood).toBe(after.deletedForGood);
    // Empty Trash says so too.
    await trash(shot);
    expect(await store.getState().emptyTrash()).not.toBeNull();
    expect(store.getState().deletedForGood).toBe(after.deletedForGood + 1);
  });

  it('keeps a picture one ⌘Z can bring back: the frame a History restore took away', async () => {
    const point = (await log(project.file)).at(-1)?.id ?? null;
    const shot = await frame();
    const sha = await withPicture(shot, 12);
    await restoreTo(project.file, point);
    await reopen();
    expect(await historyOnlyPictures(project.file)).toEqual([]);
    await store.getState().cleanUpPictures();
    await store.getState().undo();
    expect(await readOriginal(project.file, sha)).not.toBeNull();
    expect(shotFields(records()[shot]?.props ?? {}).mediaId).toBeTruthy();
  });

  it('still cleans up a picture added and then undone, once a new edit has cleared redo', async () => {
    const shot = await frame();
    const sha = await withPicture(shot, 13);
    await store.getState().undo();
    await store.getState().apply([{ kind: 'update', id: 'sc4', set: { name: 'Road' } }]);
    expect((await historyOnlyPictures(project.file)).map((p) => p.sha256)).toEqual([sha]);
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

  it('keeps a picture a named version shows until the version is deleted, so Open version still has it', async () => {
    const shot = await frame();
    const sent = await withPicture(shot, 10);
    await nameVersion(project.file, { name: 'Board sent to client', opGroupId: (await log(project.file)).at(-1)?.id ?? '' });
    // Taken back off the frame, so no record shows it: only History and the version do.
    await store.getState().undo();
    // One no version shows, which Clean up still takes.
    const tried = await withPicture(shot, 11);
    await store.getState().undo();
    expect((await historyOnlyPictures(project.file)).map((p) => p.sha256)).toEqual([tried]);
    expect((await store.getState().cleanUpPictures())?.removed).toBe(1);
    expect(await readOriginal(project.file, sent)).not.toBeNull();

    // Deleting the version leaves the picture to History alone.
    const [version] = await listVersions(project.file);
    if (!version) throw new Error('no version');
    const other = await nameVersion(project.file, { name: 'Spare', opGroupId: version.opGroupId });
    await deleteVersion(project.file, other);
    expect(await historyOnlyPictures(project.file)).toEqual([]);

    await openVersionCopy(version, { store, driver: nodeDriver });
    const copy = store.getState().project;
    const mediaId = shotFields(records()[shot]?.props ?? {}).mediaId ?? '';
    expect(records()[mediaId]?.props.file).toBe(sent);
    expect(await readOriginal(copy?.file ?? project.file, sent)).not.toBeNull();

    await reopen();
    await deleteVersion(project.file, version.id);
    expect((await historyOnlyPictures(project.file)).map((p) => p.sha256)).toEqual([sent]);
  });

  it('keeps a picture a version names after an earlier read took in the log', async () => {
    const shot = await frame();
    const tried = await withPicture(shot, 14);
    await store.getState().undo();
    await nameVersion(project.file, { name: 'Before', opGroupId: (await log(project.file)).at(-1)?.id ?? '' });
    expect((await historyOnlyPictures(project.file)).map((p) => p.sha256)).toEqual([tried]);
    // Written after that read: only the new writes are read next time, and they still count.
    const sent = await withPicture(shot, 15);
    await nameVersion(project.file, { name: 'Board sent to client', opGroupId: (await log(project.file)).at(-1)?.id ?? '' });
    await store.getState().undo();
    expect((await historyOnlyPictures(project.file)).map((p) => p.sha256)).toEqual([tried]);
    expect((await store.getState().cleanUpPictures())?.removed).toBe(1);
    expect(await readOriginal(project.file, sent)).not.toBeNull();
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

describe('Clean up old pictures on a long project', () => {
  /**
   * `groups` steps of `perGroup` sketch edits each, appended to the log as commit writes them: built in SQL, since
   * writing 60k ops through the store takes minutes, and what's tested is how Clean up reads them.
   */
  const longLog = async (groups: number, perGroup: number): Promise<string[]> => {
    const [top] = await project.file.query(
      'SELECT (SELECT coalesce(max(seq), 0) FROM ops) AS op, (SELECT coalesce(max(seq), 0) FROM op_groups) AS grp',
    );
    const [op, grp] = [Number(top?.op ?? 0), Number(top?.grp ?? 0)];
    const at = '2026-11-04T09:00:00.000Z';
    const stroke = (n: string) =>
      `json_object('id', 'stroke-' || ${n}, 'type', 'stroke', 'parentId', 'sc4', 'sortKey', 'a', 'props', json_object('tool', 'pen', 'width', ${n}), 'trashedAt', NULL, 'trashedBy', NULL, 'createdAt', '${at}', 'updatedAt', '${at}')`;
    await project.file.tx([
      {
        sql: `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
          INSERT INTO op_groups (id, seq, kind, target_group_id, restore_to, stack_below, undo_top, redo_top, author,
            timestamp, created_at, updated_at)
          SELECT 'long-' || i, ? + i, 'edit', NULL, NULL, NULL, 'long-' || i, NULL, 'local', ?, ?, ? FROM n`,
        params: [groups, grp, at, at, at],
      },
      {
        sql: `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
          INSERT INTO ops (id, seq, group_id, record_id, kind, before, after, author, timestamp, created_at, updated_at)
          SELECT 'long-op-' || i, ? + i, 'long-' || ((i - 1) / CAST(? AS INTEGER) + 1), 'stroke-' || (i % 500), 'update',
            ${stroke('(i - 1)')}, ${stroke('i')}, 'local', ?, ?, ? FROM n`,
        params: [groups * perGroup, op, perGroup, at, at, at],
      },
    ]);
    return Array.from({ length: groups }, (_, i) => `long-${String(i + 1)}`);
  };

  it('stays quick with 60k ops and 30 named versions, so Settings → Storage keeps up with every edit', async () => {
    const shot = await frame();
    const sent = await withPicture(shot, 12);
    await nameVersion(project.file, { name: 'Board sent to client', opGroupId: (await log(project.file)).at(-1)?.id ?? '' });
    await store.getState().undo();
    const tried = await withPicture(shot, 13);
    await store.getState().undo();
    const steps = await longLog(6000, 10);
    for (let i = 1; i < 30; i += 1) await nameVersion(project.file, { name: `Cut ${String(i)}`, opGroupId: steps[i * 200] ?? '' });
    // The first read takes in the whole log once.
    expect((await historyOnlyPictures(project.file)).map((p) => p.sha256)).toEqual([tried]);

    // Then the reads after each edit, as the tile makes them. One shows the version's picture again on another frame,
    // and is undone, so the log's newest writes name it: they're read too.
    const other = await frame();
    await withPicture(other, 12);
    await store.getState().undo();
    const start = performance.now();
    const found = (await historyOnlyPictures(project.file)).map((p) => p.sha256);
    const ms = performance.now() - start;
    // Still right: the version keeps the picture it shows, and the one no version shows is History's alone.
    expect(found).toEqual([tried]);
    expect(found).not.toContain(sent);
    expect((await historyOnlyPictures(project.file, { fresh: true })).map((p) => p.sha256)).toEqual([tried]);
    // Reading only the new writes and then through the indexes takes a few ms; joining every op after every point
    // took over a second, and reading the whole log each time about a tenth. Generous for a slow machine.
    expect(ms).toBeLessThan(40);
  });
});

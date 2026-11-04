import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import type { PreparedImage } from '../../core/media/store';
import { shotFields } from '../../core/model/storyboard';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot, board, trashShot } from '../storyboard/board';
import { setPicture, type FramePicture } from '../storyboard/framePictures';
import { addStroke, eraseStrokes } from '../storyboard/sketch/strokes';
import { restoreChanges, trashItems } from './trash';

function picture(seed: number, name: string): FramePicture {
  const bytes = new Uint8Array(4000).map((_, i) => (i * seed) % 256);
  const image: PreparedImage = {
    original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/jpeg', width: 2560, height: 1440, colorSpace: 'srgb' },
    thumbnail: { bytes: bytes.slice(0, 500), mime: 'image/jpeg', width: 640, height: 360, longEdge: 640 },
  };
  return { image, source: { name } };
}

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
const shots: string[] = [];
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
  await store.getState().apply([
    { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4', name: 'Diner' } } },
  ]);
  shots.length = 0;
  for (let i = 0; i < 3; i += 1) {
    const added = addShot(store.getState().records, project.projectId, 'sc4');
    await store.getState().apply(added.changes);
    shots.push(added.shotId);
  }
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const numbers = () => (board(records(), project.projectId)[0]?.shots ?? []).map((s) => s.fields.number);
const trash = (id: string) => store.getState().applyWith((now) => ({ changes: trashShot(now, project.projectId, id) }));
const restore = (id: string) => store.getState().applyWith((now) => ({ changes: restoreChanges(now, project.projectId, id) }));
const a = () => shots[0] ?? '';
const b = () => shots[1] ?? '';

describe('the Trash', () => {
  it('lists deleted frames, notes and pictures, newest first, but not strokes the eraser took', async () => {
    const frameB = b();
    await store.getState().apply([
      { kind: 'create', record: { id: 'n1', type: 'note', parentId: 'sc4', sortKey: 'z', props: { text: 'Rain all day.' } } },
    ]);
    const stroke = addStroke(records(), a(), { tool: 'pen', points: [0.1, 0.1, 0.2, 0.2], width: 0.008, pressures: null });
    await store.getState().apply([stroke]);
    await store.getState().apply(eraseStrokes([stroke.record.id ?? '']));
    await trash(frameB);
    await store.getState().apply([{ kind: 'trash', id: 'n1' }]);
    const items = trashItems(records(), project.projectId);
    expect(items.map((i) => [i.kind, i.name, i.sceneName])).toEqual([
      ['note', 'Rain all day.', 'SC 04'],
      ['frame', '4B', 'SC 04'],
    ]);
  });

  it('brings a frame back where it was, its scene’s letters following, as one edit that undo takes back', async () => {
    const frameB = b();
    await trash(frameB);
    expect(numbers()).toEqual(['4A', '4B']);
    await restore(frameB);
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    expect(shotFields(records()[frameB]?.props ?? {}).number).toBe('4B');
    expect(trashItems(records(), project.projectId)).toEqual([]);
    await store.getState().undo();
    expect(numbers()).toEqual(['4A', '4B']);
    expect(trashItems(records(), project.projectId).map((i) => i.id)).toEqual([frameB]);
  });

  it('brings back a frame’s old picture as its picture, the newer one going to the Trash; undo swaps them back', async () => {
    const frame = a();
    const first = setPicture(records(), frame, picture(1, 'first.jpg'), project.file.path);
    await store.getState().apply(first.changes, { alsoWrite: first.alsoWrite });
    const firstId = shotFields(records()[frame]?.props ?? {}).mediaId ?? '';
    const second = setPicture(records(), frame, picture(2, 'second.jpg'), project.file.path);
    await store.getState().apply(second.changes, { alsoWrite: second.alsoWrite });
    const secondId = shotFields(records()[frame]?.props ?? {}).mediaId ?? '';
    expect(trashItems(records(), project.projectId).map((i) => i.name)).toEqual(['first.jpg of 4A']);

    await restore(firstId);
    expect(shotFields(records()[frame]?.props ?? {}).mediaId).toBe(firstId);
    expect(records()[secondId]?.trashedAt).not.toBeNull();
    await store.getState().undo();
    expect(shotFields(records()[frame]?.props ?? {}).mediaId).toBe(secondId);
    expect(records()[firstId]?.trashedAt).not.toBeNull();
  });

  it('lists a scene deleted with its frames as one row, and brings them back together, not ones deleted before', async () => {
    const frameA = a();
    await trash(frameA);
    // The scene and its remaining frames in one op group, as deleting a scene does.
    const live = (board(records(), project.projectId)[0]?.shots ?? []).map((s) => s.record.id);
    await store.getState().apply([{ kind: 'trash', id: 'sc4' }, ...live.map((id) => ({ kind: 'trash' as const, id }))]);
    expect(trashItems(records(), project.projectId).map((i) => [i.kind, i.name])).toEqual([
      ['scene', 'SC 04  Diner (with 2 frames)'],
      ['frame', '4A'],
    ]);
    await restore('sc4');
    expect(numbers()).toEqual(['4A', '4B']);
    expect(records()[frameA]?.trashedAt).not.toBeNull();
  });

  it('brings a frame’s scene back with it when that’s in the Trash too', async () => {
    const frameA = a();
    await trash(frameA);
    await store.getState().apply([{ kind: 'trash', id: 'sc4' }]);
    expect(trashItems(records(), project.projectId).map((i) => i.kind)).toEqual(['scene', 'frame']);
    await restore(frameA);
    expect(records().sc4?.trashedAt).toBeNull();
    expect(numbers()).toEqual(['4A', '4B', '4C']);
  });

  it('restores after the app is closed and opened again, and the restore is still there after another restart', async () => {
    const frameB = b();
    await trash(frameB);
    await store.getState().close();
    project = await openProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
    expect(trashItems(records(), project.projectId).map((i) => i.id)).toEqual([frameB]);
    await restore(frameB);
    await store.getState().close();
    project = await openProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    expect(trashItems(records(), project.projectId)).toEqual([]);
  });

  it('leaves the item in the Trash, and nothing half done, when the write dies halfway', async () => {
    const frameB = b();
    await trash(frameB);
    // The restore's transaction fails part way through, as a crash between its statements would leave it.
    const write = project.file.tx.bind(project.file);
    project.file.tx = (statements) =>
      write([...statements.slice(0, Math.ceil(statements.length / 2)), { sql: 'INSERT INTO no_such_table VALUES (1)' }, ...statements.slice(Math.ceil(statements.length / 2))]);
    await restore(frameB);
    expect(store.getState().error).not.toBeNull();
    // What's on disk, read fresh: still in the Trash, the other frames' letters as they were.
    await store.getState().close();
    project = await openProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
    expect(trashItems(records(), project.projectId).map((i) => i.id)).toEqual([frameB]);
    expect(numbers()).toEqual(['4A', '4B']);
  });
});

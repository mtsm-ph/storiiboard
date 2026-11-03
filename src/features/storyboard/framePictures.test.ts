import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { mediaFields, readOriginal, type PreparedImage } from '../../core/media/store';
import { shotFields } from '../../core/model/storyboard';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot, board } from './board';
import { placePictures, removePicture, setCrop, setPicture, type FramePicture, type PictureEdit } from './framePictures';

function picture(seed: number, name = `IMG_${String(4000 + seed)}.JPG`): FramePicture {
  const bytes = new Uint8Array(4000).map((_, i) => (i * seed) % 256);
  const image: PreparedImage = {
    original: {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes,
      mime: 'image/jpeg',
      width: 2560,
      height: 1707,
      colorSpace: 'display-p3',
    },
    thumbnail: { bytes: bytes.slice(0, 500), mime: 'image/jpeg', width: 640, height: 427, longEdge: 640 },
  };
  return { image, source: { name } };
}

let folder: TestFolder;
let project: Project;
const store = createProjectStore();
let projectId = '';
let shotId = '';
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await store.getState().open(project);
  projectId = project.projectId;
  await store.getState().apply([
    { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: projectId, sortKey: 'V', props: { number: '4' } } },
  ]);
  const added = addShot(store.getState().records, projectId, 'sc4');
  shotId = added.shotId;
  await store.getState().apply(added.changes);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const fields = (id: string) => shotFields(records()[id]?.props ?? {});
const shownPicture = (id: string) => {
  const mediaId = fields(id).mediaId;
  const media = mediaId ? records()[mediaId] : undefined;
  return media ? { record: media, fields: mediaFields(media.props) } : null;
};
const apply = (edit: PictureEdit) => store.getState().apply(edit.changes, { alsoWrite: edit.alsoWrite });

describe('a frame picture', () => {
  it('is a media record under the shot, saved with its bytes in one edit', async () => {
    const first = picture(1);
    await apply(setPicture(records(), shotId, first, project.file.path));
    const shown = shownPicture(shotId);
    expect(shown?.record.parentId).toBe(shotId);
    expect(shown?.fields).toMatchObject({ sha256: first.image.original.sha256, width: 2560, height: 1707, sourceName: 'IMG_4001.JPG' });
    expect((await readOriginal(project.file, first.image.original.sha256))?.bytes).toEqual(first.image.original.bytes);
  });

  it('replaces the last one, which goes to the Trash with the edit and comes back with undo', async () => {
    await apply(setPicture(records(), shotId, picture(1), project.file.path));
    const firstId = fields(shotId).mediaId ?? '';
    await store.getState().apply([setCrop(shotId, { x: 0.3, y: 0.5, zoom: 2 })]);
    await apply(setPicture(records(), shotId, picture(2), project.file.path));
    expect(fields(shotId).mediaId).not.toBe(firstId);
    expect(records()[firstId]?.trashedAt).not.toBeNull();
    // A new picture starts centred.
    expect(fields(shotId).crop).toEqual({ x: 0.5, y: 0.5, zoom: 1 });

    await store.getState().undo();
    expect(fields(shotId).mediaId).toBe(firstId);
    expect(records()[firstId]?.trashedAt).toBeNull();
    expect(fields(shotId).crop).toEqual({ x: 0.3, y: 0.5, zoom: 2 });
  });

  it('can be removed, leaving the frame', async () => {
    await apply(setPicture(records(), shotId, picture(1), project.file.path));
    const mediaId = fields(shotId).mediaId ?? '';
    await store.getState().apply(removePicture(records(), shotId));
    expect(fields(shotId).mediaId).toBeNull();
    expect(records()[mediaId]?.trashedAt).not.toBeNull();
    expect(removePicture(records(), shotId)).toEqual([]);
  });

  it('stores the centred crop as no prop at all', async () => {
    await store.getState().apply([setCrop(shotId, { x: 0.5, y: 0.5, zoom: 1 })]);
    expect(records()[shotId]?.props.crop).toBeUndefined();
    await store.getState().apply([setCrop(shotId, { x: 0.123456, y: 0.5, zoom: 1.5 })]);
    expect(records()[shotId]?.props.crop).toEqual({ x: 0.123, y: 0.5, zoom: 1.5 });
  });

  it('keeps the original path as a pointer, relative inside the project folder', async () => {
    const inside = { ...picture(1), source: { name: 'still.jpg', path: folder.path('refs/still.jpg') } };
    await apply(setPicture(records(), shotId, inside, project.file.path));
    expect(shownPicture(shotId)?.fields?.sourcePath).toBe('refs/still.jpg');
  });
});

describe('pictures dropped on the board', () => {
  const numbers = () => board(records(), projectId)[0]?.shots.map((s) => s.fields.number) ?? [];

  it('onto a frame: the first is its picture, the rest new frames after it, in one undo', async () => {
    const placed = placePictures(records(), projectId, { kind: 'frame', shotId }, [picture(1), picture(2), picture(3)], project.file.path);
    await apply(placed);
    expect(placed.selectShotId).toBe(shotId);
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    const shots = board(records(), projectId)[0]?.shots ?? [];
    expect(shots.map((s) => shownPicture(s.record.id)?.fields?.sourceName)).toEqual(['IMG_4001.JPG', 'IMG_4002.JPG', 'IMG_4003.JPG']);

    await store.getState().undo();
    expect(numbers()).toEqual(['4A']);
    expect(fields(shotId).mediaId).toBeNull();
  });

  it('into a scene: all new frames, after the one given', async () => {
    const placed = placePictures(records(), projectId, { kind: 'scene', sceneId: 'sc4', afterShotId: null }, [picture(1), picture(1)], project.file.path);
    // The same picture twice is sent once.
    expect(placed.alsoWrite.filter((s) => s.sql.includes('media_files'))).toHaveLength(1);
    await apply(placed);
    expect(numbers()).toEqual(['4A', '4B', '4C']);
    expect(placed.selectShotId).toBe(board(records(), projectId)[0]?.shots[1]?.record.id);
  });
});

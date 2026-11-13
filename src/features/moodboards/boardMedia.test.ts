import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { setLocale } from '../../core/i18n';
import { readOriginal, readThumbnail, type PreparedImage } from '../../core/media/store';
import type { VideoProbe } from '../../core/media/video';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { selectionStore } from '../storyboard/selection';
import { loadSteps } from '../history/steps';
import { lineText } from '../history/summary';
import { currentCard, cardFor, clearCard, playCard } from '../video/playerSource';
import { restoreChanges, trashItems } from '../trash/trash';
import { addShot } from '../storyboard/board';
import { setPicture } from '../storyboard/framePictures';
import { forgetDecoded, loadPicture } from '../../core/media/decoded';
import { forgetImageUrls } from '../../core/media/urls';
import { openCard } from './boardActions';
import { boardFileChanges, DROP_GAP, PLACED_LONG_EDGE, sizeForAspect } from './boardFiles';
import { openDepartmentBoard } from './boards';
import { cardInfo } from './cards';
import { BoundedCache, levelFor, MAX_FULL_PICTURES } from '../../core/media/decoded';
import { itemFields, itemsOf, linkChanges, clipOf, pasteChanges, trashItemsChanges, createItems } from './items';
import { mediaChildOf } from './itemMedia';
import { cardUrl, linkLabel, pastedAddress } from './links';

function image(seed: number, width = 2560, height = 1707): PreparedImage {
  const bytes = new Uint8Array(3000).map((_, i) => (i * seed) % 256);
  return {
    original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/jpeg', width, height, colorSpace: 'display-p3' },
    thumbnail: { bytes: bytes.slice(0, 300), mime: 'image/jpeg', width: 640, height: Math.round((640 * height) / width), longEdge: 640 },
  };
}

const probe: VideoProbe = {
  codec: 'h264',
  width: 1920,
  height: 1080,
  sarNum: 1,
  sarDen: 1,
  fpsNum: 24,
  fpsDen: 1,
  durationFrames: 48,
  startTimecode: null,
  rotation: 0,
  hasAudio: false,
  hdr: false,
  bitDepth: 8,
};

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
let boardId = '';
beforeEach(async () => {
  setLocale('en');
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
  const opened = openDepartmentBoard(store.getState().records, project.projectId, 'camera');
  await store.getState().apply(opened.changes);
  boardId = opened.id;
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const groups = async () => (await import('../../core/ops/ops')).log(project.file).then((g) => g.length);
const items = () => itemsOf(records(), boardId);

/** Drops files as the board does, in one edit. */
async function drop(files: Parameters<typeof boardFileChanges>[2], at = { x: 100, y: 50 }, centred = false) {
  let made: ReturnType<typeof boardFileChanges> | null = null;
  await store.getState().applyWith((now) => {
    made = boardFileChanges(now, boardId, files, at, project.file.path, centred);
    return made;
  });
  return made as unknown as ReturnType<typeof boardFileChanges>;
}
const picture = (seed: number, name = `IMG_${String(seed)}.JPG`, w = 2560, h = 1707) => ({ kind: 'picture' as const, picture: { image: image(seed, w, h), source: { name, path: folder.path(`refs/${name}`) } } });

describe('pictures on a board', () => {
  it('makes one item and its media child in one group, sized to the picture’s aspect', async () => {
    const before = await groups();
    const made = await drop([picture(3)]);
    expect(await groups()).toBe(before + 1);
    const [item] = items();
    expect(item?.id).toBe(made.ids[0]);
    const fields = itemFields(item?.props ?? {});
    expect(fields).toMatchObject({ kind: 'picture', x: 100, y: 50, width: PLACED_LONG_EDGE });
    expect(fields?.height).toBeCloseTo(400 / (2560 / 1707), 1);
    const media = mediaChildOf(records(), item?.id ?? '', 'image');
    expect(media?.parentId).toBe(item?.id);
    expect(media?.props).toMatchObject({ kind: 'image', file: image(3).original.sha256, source_name: 'IMG_3.JPG', source_path: 'refs/IMG_3.JPG' });
    // The pipeline's picture and its thumbnail are stored, never the original.
    expect((await readOriginal(project.file, image(3).original.sha256))?.bytes.length).toBe(3000);
    expect(await readThumbnail(project.file, image(3).original.sha256)).not.toBeNull();
  });

  it('keeps the aspect of a tall picture, long edge 400', () => {
    expect(sizeForAspect(0.5)).toEqual({ width: 200, height: 400 });
    expect(sizeForAspect(2)).toEqual({ width: 400, height: 200 });
  });

  it('lands three files side by side from the drop point, in one group', async () => {
    const before = await groups();
    await drop([picture(3), picture(5), picture(7)]);
    expect(await groups()).toBe(before + 1);
    const placed = items().map((r) => itemFields(r.props));
    expect(placed.map((f) => f?.x)).toEqual([100, 100 + 400 + DROP_GAP, 100 + 2 * (400 + DROP_GAP)]);
    expect(new Set(placed.map((f) => f?.y))).toEqual(new Set([50]));
    await store.getState().undo();
    expect(items()).toEqual([]);
  });

  it('centres a row on the view when there is no drop point', async () => {
    await drop([picture(3), picture(5)], { x: 0, y: 0 }, true);
    const placed = items().map((r) => itemFields(r.props));
    expect(placed[0]?.x).toBe(-(400 * 2 + DROP_GAP) / 2);
  });

  it('stores a picture dropped twice once, and gives each item its own media record', async () => {
    await drop([picture(3), picture(3, 'copy.jpg')]);
    const [one, two] = items();
    expect(mediaChildOf(records(), one?.id ?? '', 'image')?.id).not.toBe(mediaChildOf(records(), two?.id ?? '', 'image')?.id);
    const rows = await project.file.query('SELECT count(*) AS n FROM media_files');
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('pastes and duplicates a picture item as a new item and a new media record naming the same stored file', async () => {
    await drop([picture(3)]);
    const [item] = items();
    const clip = clipOf(records(), boardId, [item?.id ?? '']);
    const pasted = pasteChanges(records(), boardId, clip, null);
    await store.getState().apply(pasted.changes);
    expect(items()).toHaveLength(2);
    const [, copy] = items();
    const original = mediaChildOf(records(), item?.id ?? '', 'image');
    const second = mediaChildOf(records(), copy?.id ?? '', 'image');
    expect(second?.id).not.toBe(original?.id);
    expect(second?.props.file).toBe(original?.props.file);
    expect(itemFields(copy?.props ?? {})).toMatchObject({ x: 116, y: 66 });
    const rows = await project.file.query('SELECT count(*) AS n FROM media_files');
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('trashes the item alone and restores it whole, named for its board', async () => {
    await drop([picture(3)]);
    const [item] = items();
    await store.getState().apply(trashItemsChanges(records(), [item?.id ?? '']));
    expect(items()).toEqual([]);
    expect(mediaChildOf(records(), item?.id ?? '', 'image')).toBeDefined();
    expect(trashItems(records(), project.projectId).map((r) => r.name)).toEqual(['Picture on Camera board']);
    await store.getState().apply(restoreChanges(records(), project.projectId, item?.id ?? ''));
    expect(items().map((r) => r.id)).toEqual([item?.id]);
  });

  it('keeps the bytes a frame still uses at Empty Trash, and removes the ones nothing uses', async () => {
    await drop([picture(3), picture(5)]);
    // A real frame whose picture is the same file as the first item's.
    await store.getState().apply([{ kind: 'create', record: { id: 'sc1', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '1' } } }]);
    const added = addShot(records(), project.projectId, 'sc1');
    await store.getState().apply(added.changes);
    const framed = setPicture(records(), added.shotId, { image: image(3), source: { name: 'frame.jpg' } }, project.file.path);
    await store.getState().apply(framed.changes, { alsoWrite: framed.alsoWrite });
    const [a, b] = items();
    await store.getState().apply(trashItemsChanges(records(), [a?.id ?? '', b?.id ?? '']));
    const done = await store.getState().emptyTrash();
    expect(done?.removed).toBeGreaterThan(0);
    expect(await readOriginal(project.file, image(3).original.sha256)).not.toBeNull();
    expect(await readOriginal(project.file, image(5).original.sha256)).toBeNull();
  });

  it('keeps a bytes another board item still uses at Empty Trash', async () => {
    await drop([picture(3)]);
    const [a] = items();
    await store.getState().apply(pasteChanges(records(), boardId, clipOf(records(), boardId, [a?.id ?? '']), null).changes);
    await store.getState().apply(trashItemsChanges(records(), [a?.id ?? '']));
    await store.getState().emptyTrash();
    expect(await readOriginal(project.file, image(3).original.sha256)).not.toBeNull();
  });

  it('Clean up old pictures keeps a live board picture and removes one that was added and undone', async () => {
    await drop([picture(3)]);
    await drop([picture(5)], { x: 900, y: 0 });
    await store.getState().undo();
    const done = await store.getState().cleanUpPictures();
    expect(done?.removed).toBe(1);
    expect(await readOriginal(project.file, image(3).original.sha256)).not.toBeNull();
    expect(await readOriginal(project.file, image(5).original.sha256)).toBeNull();
  });

  it('names the new kinds in History and the Trash', async () => {
    await drop([picture(3)]);
    const [item] = items();
    await store.getState().apply(trashItemsChanges(records(), [item?.id ?? '']));
    await store.getState().apply(restoreChanges(records(), project.projectId, item?.id ?? ''));
    const lines = (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line)).reverse();
    expect(lines.slice(-3)).toEqual(['Added a picture', 'Deleted a picture', 'Restored a picture']);
  });

  it('says "gone" for a live picture whose bytes were deleted, and not before', async () => {
    await drop([picture(3)]);
    const [item] = items();
    const sha = image(3).original.sha256;
    forgetDecoded();
    expect(cardInfo(records(), item?.id ?? '', itemFields(item?.props ?? {}) as never, {})?.sha256).toBe(sha);
    // Before the delete the file holds it: not "gone" (this node run has no image decoder, so a read is an error).
    expect((await loadPicture(project.file, sha, 'thumbnail')).status).not.toBe('gone');
    expect((await loadPicture(project.file, sha, 'original')).status).not.toBe('gone');
    await project.file.tx([{ sql: 'DELETE FROM thumbnails' }, { sql: 'DELETE FROM media_files' }]);
    forgetDecoded();
    await forgetImageUrls(project.file, [sha]);
    expect((await loadPicture(project.file, sha, 'thumbnail')).status).toBe('gone');
    expect((await loadPicture(project.file, sha, 'original')).status).toBe('gone');
  });

  it('draws a placeholder for a picture whose media record is gone', async () => {
    await drop([picture(3)]);
    const [item] = items();
    const fields = itemFields(item?.props ?? {});
    const mediaId = mediaChildOf(records(), item?.id ?? '', 'image')?.id;
    const without = Object.fromEntries(Object.entries(records()).filter(([id]) => id !== mediaId));
    const card = cardInfo(without, item?.id ?? '', fields as never, {});
    expect(card?.sha256).toBeNull();
  });
});

describe('what size is drawn', () => {
  it('draws the thumbnail at 640 screen pixels or less on the long edge, and the stored picture beyond', () => {
    expect(levelFor(400, 267, 1)).toBe('thumbnail');
    expect(levelFor(400, 267, 1.6)).toBe('thumbnail');
    expect(levelFor(400, 267, 1.61)).toBe('original');
    expect(levelFor(200, 400, 2)).toBe('original');
    expect(levelFor(400, 267, 0.1)).toBe('thumbnail');
  });

  it('keeps at most the bound, dropping the least recently drawn', () => {
    const cache = new BoundedCache<number>(MAX_FULL_PICTURES);
    for (let i = 0; i < MAX_FULL_PICTURES; i += 1) cache.set(`p${String(i)}`, i);
    // p0 is drawn again, so p1 is now the oldest.
    expect(cache.get('p0')).toBe(0);
    cache.set('new', 99);
    expect(cache.size).toBe(MAX_FULL_PICTURES);
    expect(cache.has('p1')).toBe(false);
    expect(cache.has('p0')).toBe(true);
    expect(cache.has('new')).toBe(true);
  });

  it('tells the one that wants a picture when the cache lets it go to make room, and not when it is deleted', () => {
    const dropped: string[] = [];
    const cache = new BoundedCache<number>(2, (key) => dropped.push(key));
    cache.set('a', 1);
    cache.set('b', 2);
    cache.delete('a');
    expect(dropped).toEqual([]);
    cache.set('c', 3);
    cache.set('d', 4);
    expect(dropped).toEqual(['b']);
  });
});

describe('video cards', () => {
  const clip = (name: string, seed: number) => ({
    kind: 'video' as const,
    video: { probe, still: image(seed, 1920, 1080), source: { name, path: folder.path(`Footage/${name}`), size: 99 } },
  });

  it('is an item with the linked video as its media child and the poster under that', async () => {
    const made = await drop([clip('A001.MP4', 9)]);
    expect(made.videoIds).toHaveLength(1);
    const [item] = items();
    expect(itemFields(item?.props ?? {})).toMatchObject({ kind: 'video', width: 400, height: 225 });
    const video = mediaChildOf(records(), item?.id ?? '', 'video');
    expect(video?.id).toBe(made.videoIds[0]);
    expect(video?.props).toMatchObject({ kind: 'video', source_name: 'A001.MP4', source_path: 'Footage/A001.MP4', duration_frames: 48 });
    const card = cardInfo(records(), item?.id ?? '', itemFields(item?.props ?? {}) as never, {});
    expect(card).toMatchObject({ sha256: image(9, 1920, 1080).original.sha256, name: 'A001.MP4', duration: '00:00:02:00', missing: false, videoId: video?.id });
    expect(cardInfo(records(), item?.id ?? '', itemFields(item?.props ?? {}) as never, { [video?.id ?? '']: true })?.missing).toBe(true);
  });

  it('copies with its poster as a record of its own', async () => {
    await drop([clip('A001.MP4', 9)]);
    const [item] = items();
    await store.getState().apply(pasteChanges(records(), boardId, clipOf(records(), boardId, [item?.id ?? '']), null).changes);
    const [, copy] = items();
    const first = mediaChildOf(records(), item?.id ?? '', 'video');
    const second = mediaChildOf(records(), copy?.id ?? '', 'video');
    expect(second?.id).not.toBe(first?.id);
    expect(second?.props.poster).not.toBe(first?.props.poster);
    expect(second?.props.source_path).toBe('Footage/A001.MP4');
  });

  it('opening a card sets the Player’s source to that card’s video, until another frame is selected', async () => {
    await drop([clip('A001.MP4', 9)]);
    const [item] = items();
    let shown = 0;
    await openCard(
      boardId,
      item?.id ?? '',
      () => {
        shown += 1;
      },
      records(),
    );
    expect(shown).toBe(1);
    const video = mediaChildOf(records(), item?.id ?? '', 'video');
    expect(currentCard()).toEqual({ videoId: video?.id, itemId: item?.id, shotId: null });
    // A frame selected afterwards hands the Player back to the frames.
    selectionStore.getState().selectShot('shot-1', 'sc-1');
    expect(currentCard()).toBeNull();
    expect(cardFor({ videoId: 'v', itemId: 'i', shotId: 'shot-1' }, 'shot-1')).toEqual({ videoId: 'v', itemId: 'i', shotId: 'shot-1' });
    // Selecting another frame cleared it, and going back to the first selection does not bring the card back.
    selectionStore.getState().selectShot(null, null);
    expect(currentCard()).toBeNull();
    clearCard();
    playCard('v', 'i');
    expect(currentCard()?.videoId).toBe('v');
    clearCard();
    selectionStore.getState().selectShot(null, null);
  });
});

describe('link cards', () => {
  it('keeps only http and https addresses', () => {
    expect(cardUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(cardUrl('http://example.com')).toBe('http://example.com/');
    expect(cardUrl('vimeo.com/123')).toBe('https://vimeo.com/123');
    for (const bad of ['javascript:alert(1)', 'file:///C:/x.txt', 'data:text/html,hi', 'ftp://x.com', 'https://user:pw@x.com', '', '   ']) {
      expect(cardUrl(bad)).toBeNull();
    }
  });

  it('takes pasted text for a link only when it is one written-out address', () => {
    expect(pastedAddress(' https://example.com/page?x=1 ')).toBe('https://example.com/page?x=1');
    expect(pastedAddress('example.com')).toBeNull();
    expect(pastedAddress('see https://example.com now')).toBeNull();
    expect(pastedAddress('javascript:alert(1)')).toBeNull();
    expect(pastedAddress('file:///etc/passwd')).toBeNull();
  });

  it('shows the title, else the host and path, and nothing fetched', () => {
    expect(linkLabel('https://vimeo.com/123/', '')).toBe('vimeo.com/123');
    expect(linkLabel('https://example.com/', '')).toBe('example.com');
    expect(linkLabel('https://example.com/', 'Look book')).toBe('Look book');
  });

  it('is an item with a url and a title, edited in one group', async () => {
    const made = createItems(records(), boardId, [{ kind: 'link', x: 0, y: 0, width: 280, height: 88, rotation: 0, url: 'https://example.com/', title: 'Look book' }]);
    await store.getState().apply(made.changes);
    const id = made.ids[0] ?? '';
    expect(itemFields(records()[id]?.props ?? {})).toMatchObject({ kind: 'link', url: 'https://example.com/', title: 'Look book' });
    expect(linkChanges(records(), id, { url: 'https://example.com/', title: 'Look book' })).toEqual([]);
    await store.getState().apply(linkChanges(records(), id, { title: '' }));
    expect(records()[id]?.props.title).toBeUndefined();
    const lines = (await loadSteps(project.file, Number.MAX_SAFE_INTEGER)).steps.map((s) => lineText(s.line)).reverse();
    expect(lines).toContain('Added a link card');
  });
});

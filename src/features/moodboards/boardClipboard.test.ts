import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { noticeStore } from '../../app/notice';
import { createProjectStore } from '../../app/projectStore';
import { levelFor } from '../../core/media/decoded';
import { readOriginal, type PreparedImage } from '../../core/media/store';
import type { VideoProbe } from '../../core/media/video';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { pasteEventSeen, pasteStep, resetPasteFallback, waitFoundNoEvent } from '../../ui/canvas/pasteFallback';
import { pasteClipboard } from './boardActions';
import { boardFileChanges } from './boardFiles';
import { openDepartmentBoard } from './boards';
import { CLIP_FALLBACK_TEXT, CLIP_TYPE, clipTaken, clipText, decidePaste, lastCopy, markSystemClipboard, markWriteFailed, resetClipboardMarker, windowBlurred, type PasteInput } from './clipboardMarker';
import { mediaChildOf } from './itemMedia';
import { canvasItems, clipOf, createItems, itemFields, itemsOf, linkChanges, trashItemsChanges } from './items';
import { moodboardStore } from './moodboardStore';

// Copy and paste of pictures and videos within a project and between projects, and the board's clipboard against the
// system's (5.1b). A clip carries no bytes: pictures and video cards paste only into the project they came from.

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
let other: TestFolder;
let project: Project;
let second: Project;
let store = createProjectStore();
let secondStore = createProjectStore();
let boardId = '';
let secondBoard = '';

async function withBoard(target: Project, targetStore: typeof store): Promise<string> {
  await targetStore.getState().open(target);
  const opened = openDepartmentBoard(targetStore.getState().records, target.projectId, 'camera');
  await targetStore.getState().apply(opened.changes);
  return opened.id;
}

beforeEach(async () => {
  folder = makeTestFolder();
  other = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  second = await createProject(other.path('Other.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  secondStore = createProjectStore();
  boardId = await withBoard(project, store);
  secondBoard = await withBoard(second, secondStore);
  resetClipboardMarker();
  resetPasteFallback();
  noticeStore.setState({ message: null });
});
afterEach(async () => {
  await store.getState().close();
  await secondStore.getState().close();
  folder.remove();
  other.remove();
});

const records = () => store.getState().records;
const items = () => itemsOf(records(), boardId);

async function dropPicture(seed: number, name = `IMG_${String(seed)}.JPG`) {
  await store.getState().applyWith((now) =>
    boardFileChanges(now, boardId, [{ kind: 'picture', picture: { image: image(seed), source: { name, path: folder.path(`refs/${name}`) } } }], { x: 0, y: 0 }, project.file.path),
  );
}

const sticky = { kind: 'sticky' as const, x: 0, y: 0, width: 200, height: 200, rotation: 0, text: 'Warm light' };

/** Copy as the board does (the items are kept inside the app), then paste into a target as the board does. */
async function copyThenPaste(ids: string[], target: { store: typeof store; board: string }) {
  moodboardStore.getState().copy(clipOf(records(), boardId, ids), { projectId: project.projectId, path: project.file.path });
  await pasteClipboard(target.board, null, moodboardStore.getState().clipboard, target.store);
  return itemsOf(target.store.getState().records, target.board);
}

describe('copying pictures and video cards', () => {
  it('pastes within its own project, and the other kinds with them', async () => {
    await dropPicture(3);
    const made = createItems(records(), boardId, [sticky]);
    await store.getState().apply(made.changes);
    const [picture] = items();
    const all = await copyThenPaste([picture?.id ?? '', made.ids[0] ?? ''], { store, board: boardId });
    expect(all.map((r) => itemFields(r.props)?.kind)).toEqual(['picture', 'sticky', 'picture', 'sticky']);
    expect(noticeStore.getState().message).toBeNull();
  });

  it('leaves pictures out of a paste into another project, with one notice, and pastes the other kinds', async () => {
    await dropPicture(3);
    const made = createItems(records(), boardId, [sticky]);
    await store.getState().apply(made.changes);
    const [picture] = items();
    const pasted = await copyThenPaste([picture?.id ?? '', made.ids[0] ?? ''], { store: secondStore, board: secondBoard });
    expect(pasted.map((r) => itemFields(r.props)?.kind)).toEqual(['sticky']);
    expect(noticeStore.getState().message).toBe('Pictures and video cards paste within their own project; drop the file again here.');
    // Nothing of the picture reached the other file.
    expect(await readOriginal(second.file, image(3).original.sha256)).toBeNull();
  });

  it('leaves a picture out when its stored picture is gone when the paste’s turn comes (an Empty Trash queued ahead of it)', async () => {
    await dropPicture(3);
    const [picture] = items();
    moodboardStore.getState().copy(clipOf(records(), boardId, [picture?.id ?? '']), { projectId: project.projectId, path: project.file.path });
    await store.getState().apply(trashItemsChanges(records(), [picture?.id ?? '']));
    const emptied = store.getState().emptyTrash();
    const pasted = pasteClipboard(boardId, null, moodboardStore.getState().clipboard, store);
    await Promise.all([emptied, pasted]);
    expect(await readOriginal(project.file, image(3).original.sha256)).toBeNull();
    expect(items()).toEqual([]);
    expect(noticeStore.getState().message).toContain('deleted for good');
  });

  it('keeps a video card’s path as stored when it is pasted within its project', async () => {
    await store.getState().applyWith((now) =>
      boardFileChanges(now, boardId, [{ kind: 'video', video: { probe, still: image(9, 1920, 1080), source: { name: 'A001.MP4', path: folder.path('Footage/A001.MP4'), size: 99 } } }], { x: 0, y: 0 }, project.file.path),
    );
    const [card] = items();
    const [first, copy] = await copyThenPaste([card?.id ?? ''], { store, board: boardId });
    const one = mediaChildOf(records(), first?.id ?? '', 'video');
    const two = mediaChildOf(records(), copy?.id ?? '', 'video');
    expect(two?.id).not.toBe(one?.id);
    expect(two?.props.source_path).toBe(one?.props.source_path);
    expect(two?.props.poster).not.toBe(one?.props.poster);
  });
});

describe('which project a clip came from', () => {
  it('counts a file with the same id but another path (a backup, an opened version) as another project', async () => {
    await dropPicture(3);
    const [picture] = items();
    moodboardStore.getState().copy(clipOf(records(), boardId, [picture?.id ?? '']), { projectId: project.projectId, path: folder.path('Elsewhere/Bey County.sbd') });
    await pasteClipboard(boardId, null, moodboardStore.getState().clipboard, store);
    expect(items()).toHaveLength(1);
    expect(noticeStore.getState().message).toContain('paste within their own project');
  });

  it('pastes a video card that has no poster, without one, rather than leaving it out', async () => {
    await store.getState().applyWith((now) =>
      boardFileChanges(now, boardId, [{ kind: 'video', video: { probe, still: image(9, 1920, 1080), source: { name: 'A001.MP4', path: folder.path('Footage/A001.MP4'), size: 99 } } }], { x: 0, y: 0 }, project.file.path),
    );
    const [card] = items();
    const video = mediaChildOf(records(), card?.id ?? '', 'video');
    await store.getState().apply([{ kind: 'update', id: video?.id ?? '', unset: ['poster'] }]);
    const [, copy] = await copyThenPaste([card?.id ?? ''], { store, board: boardId });
    const pasted = mediaChildOf(records(), copy?.id ?? '', 'video');
    expect(pasted).toBeDefined();
    expect(pasted?.props.poster).toBeUndefined();
    expect(noticeStore.getState().message).toBeNull();
  });
});

describe('the board’s clipboard against the system’s', () => {
  const input = (over: Partial<PasteInput> = {}): PasteInput => ({ token: '', text: '', files: 0, hasClip: true, ...over });
  const wrote = () => {
    markSystemClipboard({ setData: () => undefined } as unknown as DataTransfer, null);
  };

  it('puts human text on the system clipboard: words, link addresses and file names, one to a line', () => {
    expect(clipText(['Warm light', 'https://example.com/', 'IMG_4012.JPG', ''])).toBe('Warm light\nhttps://example.com/\nIMG_4012.JPG');
    expect(clipText(['', '  '])).toBe(CLIP_FALLBACK_TEXT);
  });

  it('marks the copy event’s data with the text and a token, and remembers that the write worked', () => {
    clipTaken('Warm light');
    expect(lastCopy().write).toBe('unknown');
    const set: Record<string, string> = {};
    markSystemClipboard({ setData: (type: string, value: string) => { set[type] = value; } } as unknown as DataTransfer, null);
    expect(set['text/plain']).toBe('Warm light');
    expect(lastCopy()).toMatchObject({ text: 'Warm light', write: 'ok' });
    expect(set[CLIP_TYPE]).toBe(lastCopy().token);
  });

  it('pastes the items when the data carries our token, or exactly our text with no files', () => {
    clipTaken('Warm light');
    wrote();
    const { token } = lastCopy();
    expect(decidePaste(input({ token, text: 'https://stale.example/' }))).toBe('items');
    expect(decidePaste(input({ text: 'Warm light' }))).toBe('items');
    // The same text with a picture: the picture is the system's.
    expect(decidePaste(input({ text: 'Warm light', files: 1 }))).toBe('system');
  });

  it('lets what replaced our text win: a screenshot, a copied address, and someone else’s words (which paste nothing)', () => {
    clipTaken('Warm light');
    wrote();
    expect(decidePaste(input({ files: 1 }))).toBe('system');
    expect(decidePaste(input({ text: 'https://example.com/copied-link' }))).toBe('system');
    // Our write is known to have worked, so other plain text is someone else's.
    expect(decidePaste(input({ text: '#DF5E27' }))).toBe('foreign');
    expect(decidePaste(input({ text: '' }))).toBe('nothing');
  });

  it('reads our text the same with Windows line endings', () => {
    clipTaken('Warm light\nhttps://example.com/');
    wrote();
    expect(decidePaste(input({ text: 'Warm light\r\nhttps://example.com/' }))).toBe('items');
  });

  it('pastes the fresh items over a stale picture or address when our write is unknown (no copy event, as on a Mac)', () => {
    clipTaken('Warm light');
    expect(lastCopy().write).toBe('unknown');
    expect(decidePaste(input({ files: 1 }))).toBe('items');
    expect(decidePaste(input({ text: 'https://stale.example/' }))).toBe('items');
    expect(decidePaste(input({ text: 'anything else' }))).toBe('items');
  });

  it('does the same when our write failed', () => {
    clipTaken('Warm light');
    markWriteFailed();
    expect(decidePaste(input({ files: 1 }))).toBe('items');
    expect(decidePaste(input({ text: 'https://stale.example/' }))).toBe('items');
  });

  it('lets the system content win once the items are not fresh (a switch of window), or when there are no items', () => {
    for (const failed of [false, true]) {
      clipTaken('Warm light');
      if (failed) markWriteFailed();
      windowBlurred();
      expect(decidePaste(input({ files: 1 }))).toBe('system');
      expect(decidePaste(input({ text: 'https://stale.example/' }))).toBe('system');
      expect(decidePaste(input({ text: 'anything else' }))).toBe('foreign');
    }
    clipTaken('Warm light');
    expect(decidePaste(input({ files: 1, hasClip: false }))).toBe('system');
  });
});

describe('how ⌘V reaches the canvas', () => {
  it('waits once for a paste event, then learns that none comes and pastes at once', () => {
    expect(pasteStep()).toBe('wait');
    waitFoundNoEvent();
    expect(pasteStep()).toBe('now');
  });

  it('never waits or pastes on its own again once an event has been seen, even after a silent wait', () => {
    pasteEventSeen();
    expect(pasteStep()).toBe('event');
    waitFoundNoEvent();
    expect(pasteStep()).toBe('event');
  });

  it('goes back to the event path when one arrives after the key learned to paste at once', () => {
    waitFoundNoEvent();
    expect(pasteStep()).toBe('now');
    pasteEventSeen();
    expect(pasteStep()).toBe('event');
  });
});

describe('details', () => {
  it('draws the full picture only past 640 device pixels, and never for an item out of view', () => {
    expect(levelFor(400, 267, 1, 2)).toBe('original');
    expect(levelFor(400, 267, 0.8, 2)).toBe('thumbnail');
    expect(levelFor(400, 267, 3, 1, false)).toBe('thumbnail');
  });

  it('refuses a link address that is not http or https when the strip edits it, and stores the clean one', async () => {
    const made = createItems(records(), boardId, [{ kind: 'link', x: 0, y: 0, width: 280, height: 88, rotation: 0, url: 'https://example.com/' }]);
    await store.getState().apply(made.changes);
    const id = made.ids[0] ?? '';
    expect(linkChanges(records(), id, { url: 'javascript:alert(1)' })).toEqual([]);
    expect(linkChanges(records(), id, { url: 'file:///x' })).toEqual([]);
    expect(linkChanges(records(), id, { url: 'vimeo.com/1' })).toEqual([{ kind: 'update', id, set: { url: 'https://vimeo.com/1' } }]);
  });

  it('announces a card by its own name, and keeps a picture’s shape when it is resized', async () => {
    await dropPicture(3, 'IMG_4012.JPG');
    const made = createItems(records(), boardId, [{ kind: 'link', x: 0, y: 0, width: 280, height: 88, rotation: 0, url: 'https://example.com/a', title: 'Look book' }]);
    await store.getState().apply(made.changes);
    const shown = canvasItems(records(), boardId);
    expect(shown.map((c) => c.label)).toEqual(['Picture: IMG_4012.JPG', 'Link: Look book']);
    expect(shown.map((c) => c.keepRatio)).toEqual([true, false]);
  });
});

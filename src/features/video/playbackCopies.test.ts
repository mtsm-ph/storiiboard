import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoProbe } from '../../core/media/video';
import { lutStatements, prepareLut } from '../../core/media/lut';
import { relinkChange, videoProps } from '../../core/media/video';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';

// The queue of playback copies (2.3b) with a stand-in driver, on a real project file: one copy asked of Rust at a time,
// in order; Cancel off the queue or of the copy being made; failures kept until tried again; and a project switch
// stopping the last one's copy.

const driver = vi.hoisted(() => ({
  make: vi.fn(),
  find: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('../../app/playback', () => ({ playbackDriver: driver }));

const { projectStore } = await import('../../app/projectStore');
const { copiesChanged, copiesStore, cancelCopy, copyMayBeGone, makeCopy, remakeCopy, showCopy } = await import('./playbackCopies');

const probe: VideoProbe = {
  codec: 'h264',
  width: 1920,
  height: 1080,
  sarNum: 1,
  sarDen: 1,
  fpsNum: 24000,
  fpsDen: 1001,
  durationFrames: 48,
  startTimecode: '01:00:00:00',
  rotation: 0,
  hasAudio: true,
  hdr: false,
  bitDepth: 8,
};

let folder: TestFolder;
let project: Project;
const video = (id: string, name: string) => ({
  kind: 'create' as const,
  record: {
    id,
    type: 'media' as const,
    parentId: project.projectId,
    sortKey: id,
    props: videoProps(probe, { name, path: folder.path(`Footage/${name}`), size: 1234 }, project.file.path, null),
  },
});

/** A make that ends when the test says, reporting progress meanwhile. */
function pending() {
  let progress: (done: number) => void = () => undefined;
  let resolve: (made: { path: string; silent: boolean }) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const made = new Promise<{ path: string; silent: boolean }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {
    impl: (_source: unknown, _handle: unknown, onProgress: (done: number) => void) => {
      progress = onProgress;
      return made;
    },
    progress: (done: number) => {
      progress(done);
    },
    resolve: (silent = false) => {
      resolve({ path: '/cache/copy.mp4', silent });
    },
    reject: (message: string) => {
      reject(new Error(message));
    },
  };
}

const state = (id: string) => copiesStore.getState().byVideo[id];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  vi.clearAllMocks();
  driver.cancel.mockResolvedValue(true);
  driver.find.mockResolvedValue(null);
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  // As the desktop app's file has: the handle Rust reads a video by when the person picked the project, not the video.
  Object.defineProperty(project.file, 'nativeHandle', { value: 7 });
  await projectStore.getState().open(project);
  await projectStore.getState().apply([video('a', 'C0042.MP4'), video('b', 'C0043.MP4'), video('c', 'C0044.MP4')]);
});
afterEach(async () => {
  await projectStore.getState().close();
  folder.remove();
});

describe('the queue of playback copies', () => {
  it('asks Rust for one copy at a time, in order, with the file where the project says', async () => {
    const first = pending();
    const second = pending();
    driver.make.mockImplementationOnce(first.impl).mockImplementationOnce(second.impl);
    makeCopy('a');
    makeCopy('b');
    makeCopy('a');
    expect(driver.make).toHaveBeenCalledTimes(1);
    const [source, handle] = driver.make.mock.calls[0] as [{ videoId: string; path: string }, number | undefined];
    expect(source).toEqual({ videoId: 'a', path: folder.path('Footage/C0042.MP4'), lut: null });
    expect(handle).toBe(7);
    expect(state('a')).toEqual({ kind: 'making', done: null });
    expect(state('b')).toEqual({ kind: 'queued' });
    first.progress(0.25);
    expect(state('a')).toEqual({ kind: 'making', done: 0.25 });
    first.resolve();
    await settle();
    expect(state('a')).toEqual({ kind: 'made', silent: false });
    expect(state('b')).toEqual({ kind: 'making', done: null });
    expect(driver.make).toHaveBeenCalledTimes(2);
    second.resolve(true);
    await settle();
    expect(state('b')).toEqual({ kind: 'made', silent: true });
    // Made whole and still there: asked again, nothing to do. Made without sound: tried again.
    driver.make.mockResolvedValue({ path: '/cache/copy.mp4', silent: false });
    driver.find.mockResolvedValue({ path: '/cache/copy.mp4', silent: false });
    makeCopy('a');
    await settle();
    expect(driver.make).toHaveBeenCalledTimes(2);
    makeCopy('b');
    expect(driver.make).toHaveBeenCalledTimes(3);
  });

  it('after a <video> error, makes a copy again only if it is gone, never to retry its sound', async () => {
    // Made without sound but still there: a copy that loads and then fails isn't made again and again.
    driver.make.mockResolvedValue({ path: '/cache/copy-silent.mp4', silent: true });
    makeCopy('a');
    await settle();
    expect(state('a')).toEqual({ kind: 'made', silent: true });
    driver.find.mockResolvedValue({ path: '/cache/copy-silent.mp4', silent: true });
    copyMayBeGone('a');
    await settle();
    expect(driver.make).toHaveBeenCalledTimes(1);
    expect(state('a')).toEqual({ kind: 'made', silent: true });
    // Gone: made again.
    driver.find.mockResolvedValue(null);
    copyMayBeGone('a');
    await settle();
    expect(driver.make).toHaveBeenCalledTimes(2);
    // Never asked of a video with no copy made.
    copyMayBeGone('b');
    await settle();
    expect(driver.make).toHaveBeenCalledTimes(2);
  });

  it('makes again a copy made before that the cap or a Clear has removed since', async () => {
    driver.make.mockResolvedValue({ path: '/cache/copy.mp4', silent: false });
    makeCopy('a');
    await settle();
    expect(state('a')).toEqual({ kind: 'made', silent: false });
    // Gone since (the cap lowered in Settings): asked for again, it's looked for, then made.
    driver.find.mockResolvedValue(null);
    makeCopy('a');
    await settle();
    await settle();
    expect(driver.find).toHaveBeenCalled();
    expect(driver.make).toHaveBeenCalledTimes(2);
    expect(state('a')).toEqual({ kind: 'made', silent: false });
  });

  it('keeps a video asked for again while its cancelled copy is still stopping on the queue, shown as waiting', async () => {
    const first = pending();
    const second = pending();
    driver.make.mockImplementationOnce(first.impl).mockImplementationOnce(second.impl).mockResolvedValue({ path: '/cache/copy.mp4', silent: false });
    makeCopy('a');
    makeCopy('b');
    // Cancel, then Make again (or a relink) before Rust has stopped the first: the new request is the one that counts.
    cancelCopy('a');
    makeCopy('a');
    expect(state('a')).toEqual({ kind: 'queued' });
    expect(copiesStore.getState().waiting).toEqual(['b', 'a']);
    first.reject('The playback copy was cancelled.');
    await settle();
    // b being made, a waiting behind it, and saying so: not "none", which would offer Make and queue it twice.
    expect(copiesStore.getState().making).toBe('b');
    expect(copiesStore.getState().waiting).toEqual(['a']);
    expect(state('a')).toEqual({ kind: 'queued' });
    makeCopy('a');
    expect(copiesStore.getState().waiting).toEqual(['a']);
    second.resolve();
    await settle();
    await settle();
    expect(driver.make.mock.calls.map(([source]) => (source as { videoId: string }).videoId)).toEqual(['a', 'b', 'a']);
    expect(state('a')).toEqual({ kind: 'made', silent: false });
    expect(state('b')).toEqual({ kind: 'made', silent: false });
  });

  it('looks again at a copy shown as made once another is made, as room for it may have taken that one', async () => {
    driver.make.mockResolvedValue({ path: '/cache/copy.mp4', silent: false });
    makeCopy('a');
    await settle();
    const hide = showCopy('a');
    // b's copy made, and the floor took a's for its room.
    driver.find.mockResolvedValue(null);
    makeCopy('b');
    await settle();
    await settle();
    expect(state('a')).toEqual({ kind: 'none' });
    hide();
    // Not shown: not looked for (each look counts as a use, which would upset the cap's order).
    driver.find.mockClear();
    makeCopy('c');
    await settle();
    expect(driver.find).not.toHaveBeenCalled();
  });

  it('keeps a failure, with its words, through a Clear, a Move or a cap change', async () => {
    driver.make.mockRejectedValueOnce(new Error('That video couldn’t be made into a playback copy.'));
    makeCopy('a');
    await settle();
    copiesChanged();
    expect(state('a')).toEqual({ kind: 'failed', message: 'That video couldn’t be made into a playback copy.' });
  });

  it('takes a copy off the queue at once, and stops the one being made', async () => {
    const first = pending();
    driver.make.mockImplementationOnce(first.impl).mockResolvedValue({ path: '/cache/copy.mp4', silent: false });
    makeCopy('a');
    makeCopy('b');
    makeCopy('c');
    // Waiting: off the queue, and never asked of Rust.
    cancelCopy('b');
    expect(state('b')).toEqual({ kind: 'none' });
    expect(copiesStore.getState().waiting).toEqual(['c']);
    // Being made: Rust is told, and however its make ends, it ended cancelled.
    cancelCopy('a');
    expect(driver.cancel).toHaveBeenCalledWith({ videoId: 'a', path: folder.path('Footage/C0042.MP4'), lut: null });
    expect(state('a')).toEqual({ kind: 'none' });
    first.reject('The playback copy was cancelled.');
    await settle();
    expect(state('a')).toEqual({ kind: 'none' });
    // The next one goes ahead.
    await settle();
    expect(driver.make.mock.calls.map(([source]) => (source as { videoId: string }).videoId)).toEqual(['a', 'c']);
    expect(state('c')).toEqual({ kind: 'made', silent: false });
  });

  it('keeps a failure, with Rust’s words, until it’s tried again', async () => {
    driver.make.mockRejectedValueOnce(new Error('That video couldn’t be made into a playback copy.'));
    makeCopy('a');
    await settle();
    expect(state('a')).toEqual({ kind: 'failed', message: 'That video couldn’t be made into a playback copy.' });
    driver.make.mockResolvedValueOnce({ path: '/cache/copy.mp4', silent: false });
    makeCopy('a');
    await settle();
    expect(state('a')).toEqual({ kind: 'made', silent: false });
  });

  it('makes a relinked video’s copy again, and looks again after a Clear', async () => {
    driver.make.mockResolvedValue({ path: '/cache/copy.mp4', silent: false });
    makeCopy('a');
    await settle();
    expect(state('a')).toEqual({ kind: 'made', silent: false });
    remakeCopy('a');
    await settle();
    expect(driver.make).toHaveBeenCalledTimes(2);
    copiesChanged();
    expect(state('a')).toBeUndefined();
  });

  it('stops the last project’s copy when another opens, and forgets its queue', async () => {
    const first = pending();
    driver.make.mockImplementationOnce(first.impl);
    makeCopy('a');
    makeCopy('b');
    const source = { videoId: 'a', path: folder.path('Footage/C0042.MP4'), lut: null };
    const other = await createProject(folder.path('Lake Mead.sbd'), { driver: nodeDriver, backups: false });
    await projectStore.getState().open(other);
    expect(driver.cancel).toHaveBeenCalledWith(source);
    expect(copiesStore.getState().waiting).toEqual([]);
    expect(copiesStore.getState().byVideo).toEqual({});
    // Its make ends after: nothing of it comes back, and nothing more is asked.
    first.resolve();
    await settle();
    expect(copiesStore.getState().byVideo).toEqual({});
    expect(driver.make).toHaveBeenCalledTimes(1);
  });

  it('never keeps a copy of the file a video no longer points at: a relink, and its undo, while copies are made (2.3c)', async () => {
    const [ofA, ofB, ofAAgain] = [pending(), pending(), pending()];
    driver.make.mockImplementationOnce(ofA.impl).mockImplementationOnce(ofB.impl).mockImplementationOnce(ofAAgain.impl);
    const at = (name: string) => ({ videoId: 'a', path: folder.path(`Footage/${name}`), lut: null });
    makeCopy('a');
    // Relinked to another file while its copy is made: that copy stops, and one of the new file is made.
    await projectStore.getState().applyWith(() => ({
      changes: [relinkChange('a', probe, { name: 'C0099.MP4', path: folder.path('Footage/C0099.MP4'), size: 1234 }, project.file.path)],
    }));
    expect(driver.cancel).toHaveBeenCalledWith(at('C0042.MP4'));
    expect(state('a')).toEqual({ kind: 'queued' });
    ofA.resolve();
    await settle();
    expect(driver.make.mock.calls[1]?.[0]).toEqual(at('C0099.MP4'));
    // Undone while the new file's copy is made: it stops too, and its copy, finishing after, is never the video's.
    await projectStore.getState().undo();
    expect(driver.cancel).toHaveBeenCalledWith(at('C0099.MP4'));
    // Every state the video goes through from here: C0099's copy, finishing after all, is never one of them.
    const seen: string[] = [];
    const stop = copiesStore.subscribe((s) => seen.push(s.byVideo.a?.kind ?? 'unknown'));
    ofB.resolve();
    await settle();
    stop();
    expect(seen).not.toContain('made');
    expect(state('a')).toEqual({ kind: 'making', done: null });
    ofAAgain.resolve();
    await settle();
    expect(driver.make.mock.calls.map(([source]) => source as { videoId: string; path: string })).toEqual([at('C0042.MP4'), at('C0099.MP4'), at('C0042.MP4')]);
    expect(state('a')).toEqual({ kind: 'made', silent: false });
  });

  it('makes a graded copy of its own once a LUT is set, never keeping the one of the take as shot (2.5)', async () => {
    const prepared = await prepareLut('Invert.cube', 'TITLE "Invert"\nLUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n');
    if (!prepared.ok) throw new Error('a good cube');
    const lutId = 'b1d3c0de-0000-4000-8000-000000000001';
    const plain = { videoId: 'a', path: folder.path('Footage/C0042.MP4'), lut: null };
    // Ffmpeg reads the LUT without its title; the copy's key takes the file's own hash.
    const graded = { ...plain, lut: { sha256: prepared.lut.sha256, cube: 'LUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n' } };
    const [asShot, withLut] = [pending(), pending()];
    driver.make.mockImplementationOnce(asShot.impl).mockImplementationOnce(withLut.impl);
    makeCopy('a');
    expect(driver.make.mock.calls[0]?.[0]).toEqual(plain);
    // A LUT set while the copy as shot is made: that one stops, and the graded one is made.
    await projectStore.getState().apply([{ kind: 'update', id: 'a', set: { lut: lutId } }], { alsoWrite: lutStatements(lutId, prepared.lut, new Date()) });
    expect(driver.cancel).toHaveBeenCalledWith(plain);
    const seen: string[] = [];
    const stop = copiesStore.subscribe((s) => seen.push(s.byVideo.a?.kind ?? 'unknown'));
    asShot.resolve();
    await settle();
    expect(seen).not.toContain('made');
    stop();
    expect(driver.make.mock.calls[1]?.[0]).toEqual(graded);
    withLut.resolve();
    await settle();
    expect(state('a')).toEqual({ kind: 'made', silent: false });
    // Undone: the copy as shot is the video's again.
    await projectStore.getState().undo();
    expect(state('a')).toEqual({ kind: 'unknown' });
    makeCopy('a');
    await settle();
    expect(driver.make.mock.calls[2]?.[0]).toEqual(plain);
  });

  it('cancels a graded copy by its LUT, and refuses to make one whose LUT isn’t stored', async () => {
    const copy = pending();
    driver.make.mockImplementationOnce(copy.impl);
    // Named but not stored (a file edited by hand): no copy without the grade it should have.
    await projectStore.getState().apply([{ kind: 'update', id: 'b', set: { lut: 'b1d3c0de-0000-4000-8000-00000000dead' } }]);
    makeCopy('b');
    await settle();
    expect(driver.make).not.toHaveBeenCalled();
    expect(state('b')).toEqual({ kind: 'failed', message: 'This video’s LUT isn’t in the project, so its playback copy can’t be made.' });
    // A graded copy being made is stopped by its LUT.
    const prepared = await prepareLut('Invert.cube', 'LUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n');
    if (!prepared.ok) throw new Error('a good cube');
    const lutId = 'b1d3c0de-0000-4000-8000-000000000002';
    await projectStore.getState().apply([{ kind: 'update', id: 'c', set: { lut: lutId } }], { alsoWrite: lutStatements(lutId, prepared.lut, new Date()) });
    makeCopy('c');
    await settle();
    cancelCopy('c');
    const [stopped] = driver.cancel.mock.calls.at(-1) as [{ videoId: string; lut: { sha256: string } | null }];
    expect([stopped.videoId, stopped.lut?.sha256]).toEqual(['c', prepared.lut.sha256]);
    copy.reject('The playback copy was cancelled.');
    await settle();
    expect(state('c')).toEqual({ kind: 'none' });
  });

  it('lets a copy carry on while its video is in the Trash, and looks for it again once it is back', async () => {
    const copy = pending();
    driver.make.mockImplementationOnce(copy.impl);
    makeCopy('a');
    await projectStore.getState().apply([{ kind: 'trash', id: 'a' }]);
    // Not another file: nothing is stopped.
    expect(driver.cancel).not.toHaveBeenCalled();
    copy.resolve();
    await settle();
    // Made while it was in the Trash: not kept as its state then, so looked for again once restored.
    expect(state('a')).toEqual({ kind: 'unknown' });
    await projectStore.getState().undo();
    expect(driver.make).toHaveBeenCalledTimes(1);
  });

  it('drops what it knew of a video whose file changed, to look again', async () => {
    driver.make.mockRejectedValueOnce(new Error('That video stopped being read partway.'));
    makeCopy('a');
    await settle();
    expect(state('a')).toEqual({ kind: 'failed', message: 'That video stopped being read partway.' });
    await projectStore.getState().applyWith(() => ({
      changes: [relinkChange('a', probe, { name: 'C0099.MP4', path: folder.path('Footage/C0099.MP4'), size: 1234 }, project.file.path)],
    }));
    // The failure was the other file's.
    expect(state('a')).toEqual({ kind: 'unknown' });
  });

  it('keeps a copy whose every sound track is silent as whole: asked for again, nothing to make', async () => {
    driver.make.mockResolvedValue({ path: '/cache/copy.mp4', silent: true, quiet: true });
    driver.find.mockResolvedValue({ path: '/cache/copy.mp4', silent: true, quiet: true });
    makeCopy('a');
    await settle();
    expect(state('a')).toEqual({ kind: 'made', silent: true, quiet: true });
    makeCopy('a');
    await settle();
    expect(driver.make).toHaveBeenCalledTimes(1);
  });

  it('asks for no copy of a video in the Trash', async () => {
    await projectStore.getState().apply([{ kind: 'trash', id: 'c' }]);
    makeCopy('c');
    expect(driver.make).not.toHaveBeenCalled();
  });
});

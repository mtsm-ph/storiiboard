import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoProbe } from '../../core/media/video';
import { videoProps } from '../../core/media/video';
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
const { copiesChanged, copiesStore, cancelCopy, makeCopy, remakeCopy } = await import('./playbackCopies');

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
    expect(source).toEqual({ videoId: 'a', path: folder.path('Footage/C0042.MP4') });
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
    driver.make.mockImplementationOnce(first.impl).mockResolvedValue({ path: '/cache/copy.mp4', silent: false });
    makeCopy('a');
    makeCopy('b');
    // Cancel, then Make again (or a relink) before Rust has stopped the first: the new request is the one that counts.
    cancelCopy('a');
    makeCopy('a');
    expect(state('a')).toEqual({ kind: 'queued' });
    expect(copiesStore.getState().waiting).toEqual(['b', 'a']);
    first.reject('The playback copy was cancelled.');
    await settle();
    // Still waiting, as it says, behind b; then made.
    expect(state('a')).not.toEqual({ kind: 'none' });
    await settle();
    await settle();
    expect(driver.make.mock.calls.map(([source]) => (source as { videoId: string }).videoId)).toEqual(['a', 'b', 'a']);
    expect(state('a')).toEqual({ kind: 'made', silent: false });
    expect(state('b')).toEqual({ kind: 'made', silent: false });
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
    expect(driver.cancel).toHaveBeenCalledWith({ videoId: 'a', path: folder.path('Footage/C0042.MP4') });
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
    const source = { videoId: 'a', path: folder.path('Footage/C0042.MP4') };
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

  it('asks for no copy of a video in the Trash', async () => {
    await projectStore.getState().apply([{ kind: 'trash', id: 'c' }]);
    makeCopy('c');
    expect(driver.make).not.toHaveBeenCalled();
  });
});

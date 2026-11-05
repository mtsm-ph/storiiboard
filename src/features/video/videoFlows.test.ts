import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoProbe } from '../../core/media/video';
import { videoFields, videoProps } from '../../core/media/video';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';

// The missing flag and Relink (2.2b) with a stand-in video driver and a stand-in question, on a real project file:
// what the desktop app does with Rust's answers, without Rust.

const driver = vi.hoisted(() => ({
  probe: vi.fn(),
  still: vi.fn(),
  status: vi.fn(),
  choose: vi.fn(),
}));
vi.mock('../../app/video', () => ({ videoDriver: driver }));
const asked = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock('../../app/ask', () => asked);

const { projectStore } = await import('../../app/projectStore');
const { checkVideos, videoStatusStore } = await import('./videoStatus');
const { relinkVideo } = await import('./relink');

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
  hasAudio: false,
  hdr: false,
  bitDepth: 8,
};

let folder: TestFolder;
let project: Project;
const records = () => projectStore.getState().records;
const video = (id: string, name: string, extra: object = {}) => ({
  kind: 'create' as const,
  record: {
    id,
    type: 'media' as const,
    parentId: project.projectId,
    sortKey: id,
    props: { ...videoProps(probe, { name, path: folder.path(`Footage/${name}`), size: 1234 }, project.file.path, null), ...extra },
  },
});

beforeEach(async () => {
  vi.clearAllMocks();
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await projectStore.getState().open(project);
});
afterEach(async () => {
  await projectStore.getState().close();
  folder.remove();
});

describe('the missing flag', () => {
  it('flags a video whose file isn’t there, or can’t be read here, and leaves out one in the Trash', async () => {
    await projectStore.getState().apply([video('here', 'C0042.MP4'), video('gone', 'C0043.MP4'), video('elsewhere', 'C0044.MP4'), video('trashed', 'C0045.MP4')]);
    await projectStore.getState().apply([{ kind: 'trash', id: 'trashed' }]);
    driver.status.mockImplementation((paths: string[]) =>
      Promise.resolve(paths.map((path) => (path.endsWith('C0042.MP4') ? { exists: true, size: 1234 } : path.endsWith('C0043.MP4') ? { exists: false, size: null } : null))),
    );
    await checkVideos();
    expect(videoStatusStore.getState().missing).toEqual({ gone: true, elsewhere: true });
    // Asked with the files where the project says, in full, and the project's handle.
    const [paths] = driver.status.mock.calls.at(-1) as [string[]];
    expect(paths).toHaveLength(3);
    expect(paths.every((path) => path.startsWith(folder.dir))).toBe(true);

    // Nothing changed: the same object, so nothing redraws.
    const before = videoStatusStore.getState().missing;
    await checkVideos();
    expect(videoStatusStore.getState().missing).toBe(before);
  });

  it('runs one check at a time, once more if asked again meanwhile, and clears with no project', async () => {
    await projectStore.getState().apply([video('v', 'C0042.MP4')]);
    let answer: (value: unknown) => void = () => undefined;
    driver.status.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    driver.status.mockResolvedValue([{ exists: false, size: null }]);
    const first = checkVideos();
    const second = checkVideos();
    expect(driver.status).toHaveBeenCalledTimes(1);
    answer([{ exists: true, size: 1 }]);
    await Promise.all([first, second]);
    // The second ask ran after the first, and had the last word.
    expect(driver.status).toHaveBeenCalledTimes(2);
    expect(videoStatusStore.getState().missing).toEqual({ v: true });

    await projectStore.getState().close();
    await checkVideos();
    expect(videoStatusStore.getState().missing).toEqual({});
  });
});

describe('Relink', () => {
  const offer = (name: string, changed: Partial<VideoProbe> = {}, size = 1234) => {
    driver.choose.mockResolvedValue([{ name, path: folder.path(`Card/${name}`), size }]);
    driver.probe.mockResolvedValue({ ...probe, ...changed });
    driver.status.mockResolvedValue([{ exists: true, size }]);
  };

  it('relinks the same clip at once, as one undoable edit', async () => {
    await projectStore.getState().apply([video('v', 'C0042.MP4')]);
    offer('C0042.MP4');
    await relinkVideo('v');
    expect(asked.ask).not.toHaveBeenCalled();
    expect(videoFields(records().v?.props ?? {})?.sourcePath).toBe('Card/C0042.MP4');
    await projectStore.getState().undo();
    expect(videoFields(records().v?.props ?? {})?.sourcePath).toBe('Footage/C0042.MP4');
  });

  it('asks about another take, and Cancel changes nothing', async () => {
    await projectStore.getState().apply([video('v', 'C0042.MP4')]);
    offer('C0043.MP4');
    asked.ask.mockResolvedValue('cancel');
    await relinkVideo('v');
    expect(asked.ask).toHaveBeenCalledTimes(1);
    expect(asked.ask.mock.calls[0]?.[0]).toMatchObject({ title: 'Is this the same file?' });
    expect(videoFields(records().v?.props ?? {})?.sourceName).toBe('C0042.MP4');

    asked.ask.mockResolvedValue('relink');
    await relinkVideo('v');
    expect(videoFields(records().v?.props ?? {})?.sourceName).toBe('C0043.MP4');
  });

  it('does nothing if the video went to the Trash while the question was up', async () => {
    await projectStore.getState().apply([video('v', 'C0042.MP4')]);
    offer('C0042.MP4', { durationFrames: 40 });
    asked.ask.mockImplementation(async () => {
      await projectStore.getState().apply([{ kind: 'trash', id: 'v' }]);
      return 'relink';
    });
    await relinkVideo('v');
    expect(videoFields(records().v?.props ?? {})?.sourcePath).toBe('Footage/C0042.MP4');
  });
});

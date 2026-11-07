import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoProbe } from '../../core/media/video';
import { videoFields, videoProps } from '../../core/media/video';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';

// A video's LUT (2.5), as the inspector sets it: one edit each, nothing for nothing, and a LUT loaded twice stored once,
// even when the two loads overlap. The file dialog and Rust are stand-ins.

const files = vi.hoisted(() => ({ next: [] as { name: string; text: string }[], opened: 0, held: null as Promise<void> | null }));
vi.mock('../../app/luts', () => ({
  chooseLut: async () => {
    files.opened += 1;
    const file = files.next.shift();
    // A dialog the person hasn't answered yet.
    if (files.held) await files.held;
    return file ? { name: file.name, text: () => Promise.resolve(file.text) } : null;
  },
}));
const driver = vi.hoisted(() => ({ make: vi.fn(), find: vi.fn(), cancel: vi.fn() }));
vi.mock('../../app/playback', () => ({ playbackDriver: driver }));
const notices = vi.hoisted(() => ({ shown: [] as string[] }));
vi.mock('../../app/notice', () => ({
  showNotice: (error: unknown) => notices.shown.push(error instanceof Error ? error.message : String(error)),
}));

const { projectStore } = await import('../../app/projectStore');
const { loadLut, setLut } = await import('./lutEdits');
const { listLuts } = await import('../../core/media/lut');

const probe: VideoProbe = {
  codec: 'h264',
  width: 1920,
  height: 1080,
  sarNum: 1,
  sarDen: 1,
  fpsNum: 24,
  fpsDen: 1,
  durationFrames: 48,
  startTimecode: '01:00:00:00',
  rotation: 0,
  hasAudio: true,
  hdr: false,
  bitDepth: 8,
};
const INVERT = 'TITLE "Invert"\nLUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n';

let folder: TestFolder;
let project: Project;
const lutOf = (id: string) => {
  const record = projectStore.getState().records[id];
  return record ? videoFields(record.props)?.lutId : undefined;
};
const steps = async () => (await project.file.query("SELECT COUNT(*) AS n FROM op_groups")).map((row) => Number(row.n))[0] ?? 0;

beforeEach(async () => {
  vi.clearAllMocks();
  files.next = [];
  files.opened = 0;
  files.held = null;
  notices.shown = [];
  driver.find.mockResolvedValue(null);
  driver.make.mockReturnValue(new Promise(() => undefined));
  driver.cancel.mockResolvedValue(true);
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await projectStore.getState().open(project);
  const video = (id: string, name: string) => ({
    kind: 'create' as const,
    record: { id, type: 'media' as const, parentId: project.projectId, sortKey: id, props: videoProps(probe, { name, path: folder.path(name), size: 1 }, project.file.path, null) },
  });
  await projectStore.getState().apply([video('a', 'C0042.MP4'), video('b', 'C0043.MP4')]);
});
afterEach(async () => {
  await projectStore.getState().close();
  folder.remove();
});

describe('a video’s LUT', () => {
  it('stores a LUT loaded for two videos at once only once, and both name the row stored', async () => {
    files.next = [
      { name: 'Invert.cube', text: INVERT },
      { name: 'Invert copy.cube', text: INVERT },
    ];
    // The first load waits on its dialog: the second waits its turn, so it can't look for the LUT before the first
    // has stored it (two looks finding none would store one, and leave the other video naming a row never written).
    let answer: () => void = () => undefined;
    files.held = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const both = Promise.all([loadLut('a'), loadLut('b')]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(files.opened).toBe(1);
    files.held = null;
    answer();
    await both;
    expect(files.opened).toBe(2);
    const stored = await listLuts(project.file);
    expect(stored.map((lut) => lut.name)).toEqual(['Invert']);
    expect([lutOf('a'), lutOf('b')]).toEqual([stored[0]?.id, stored[0]?.id]);
    expect(notices.shown).toEqual([]);
  });

  it('makes one edit for a change, none for nothing, and none for a video in the Trash', async () => {
    files.next = [{ name: 'Invert.cube', text: INVERT }];
    await loadLut('a');
    const id = lutOf('a');
    expect(id).toEqual(expect.any(String));
    const before = await steps();
    await setLut('a', id ?? null);
    expect(await steps()).toBe(before);
    await setLut('b', id ?? null);
    expect(await steps()).toBe(before + 1);
    await setLut('b', null);
    expect(lutOf('b')).toBeNull();
    await projectStore.getState().apply([{ kind: 'trash', id: 'a' }]);
    const trashed = await steps();
    await setLut('a', null);
    expect(await steps()).toBe(trashed);
  });

  it('says why a file can’t be used, and changes nothing', async () => {
    files.next = [{ name: 'Shaper.cube', text: 'LUT_1D_SIZE 2\n0 0 0\n1 1 1\n' }];
    const before = await steps();
    await loadLut('a');
    expect(notices.shown).toEqual(['Shaper.cube is a 1D LUT. Load a 3D LUT (one with LUT_3D_SIZE) instead.']);
    expect(await steps()).toBe(before);
    expect(await listLuts(project.file)).toEqual([]);
    // Cancelled: nothing at all.
    await loadLut('a');
    expect(notices.shown).toHaveLength(1);
  });
});

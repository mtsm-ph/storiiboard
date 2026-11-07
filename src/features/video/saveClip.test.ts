import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lutStatements, prepareLut } from '../../core/media/lut';
import { clipProp, videoProps, type VideoProbe } from '../../core/media/video';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';

// Save clip as file (2.8b), as the page asks it of Rust: named as the frame's picture exports, to the place the Save
// dialog picked, the frame's in and out and window, graded with its LUT. Rust's render has its own tests.

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/core', () => tauri);
vi.mock('../../app/fileAccess', () => ({ isTauriApp: true }));
const notices = vi.hoisted(() => ({ said: [] as string[] }));
vi.mock('../../app/notice', () => ({
  showInfo: (message: string) => notices.said.push(message),
  showNotice: (error: unknown) => notices.said.push(error instanceof Error ? error.message : String(error)),
}));

const { projectStore } = await import('../../app/projectStore');
const { cancelSaveClip, clipFileName, clipSaving, saveClip } = await import('./saveClip');

const probe: VideoProbe = {
  codec: 'h264',
  width: 3840,
  height: 2160,
  sarNum: 1,
  sarDen: 1,
  fpsNum: 24000,
  fpsDen: 1001,
  durationFrames: 480,
  startTimecode: '01:00:00:00',
  rotation: 0,
  hasAudio: true,
  hdr: false,
  bitDepth: 10,
};

let folder: TestFolder;
let project: Project;
beforeEach(async () => {
  tauri.invoke.mockReset();
  notices.said = [];
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await projectStore.getState().open(project);
  const prepared = await prepareLut('Invert.cube', 'LUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n');
  if (!prepared.ok) throw new Error('a good cube');
  await projectStore.getState().apply(
    [
      { kind: 'update', id: project.projectId, set: { aspect_ratio: '2.39:1' } },
      { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'a', props: { number: '4' } } },
      {
        kind: 'create',
        record: {
          id: 'v1',
          type: 'media',
          parentId: project.projectId,
          sortKey: 'b',
          props: { ...videoProps(probe, { name: 'A001_C003.MOV', path: '/Footage/A001_C003.MOV', size: 1 }, project.file.path, null), lut: 'lut-1' },
        },
      },
      {
        kind: 'create',
        record: {
          id: 's1',
          type: 'shot',
          parentId: 'sc4',
          sortKey: 'a',
          props: { number: '4A', clip: clipProp({ videoId: 'v1', inFrame: 24, outFrame: 96, crop: { x: 0.5, y: 0.5, zoom: 1 } }) },
        },
      },
    ],
    { alsoWrite: lutStatements('lut-1', prepared.lut, new Date()) },
  );
});
afterEach(async () => {
  await projectStore.getState().close();
  folder.remove();
});

describe('a frame’s clip saved as a file (2.8b)', () => {
  it('is named as the frame’s picture exports, so an editor matches it to the slate', () => {
    expect(clipFileName('4', '4A')).toBe('SC004_4A.mp4');
    expect(clipFileName('12A', '12AB')).toBe('SC012A_12AB.mp4');
  });

  it('asks where, then asks Rust for the frame’s in and out, its window and its LUT, and says it’s saved', async () => {
    tauri.invoke.mockImplementation((name: string) => Promise.resolve(name === 'export_choose_file' ? '/Exports/SC004_4A.mp4' : null));
    expect(await saveClip('s1')).toBe(true);
    const calls = tauri.invoke.mock.calls as [string, Record<string, unknown>][];
    expect(calls[0]).toEqual(['export_choose_file', { name: 'SC004_4A.mp4' }]);
    const [name, args] = calls[1] ?? ['', {}];
    expect(name).toBe('clip_save');
    expect(args).toMatchObject({ path: '/Footage/A001_C003.MOV', inFrame: 24, outFrame: 96, fpsNum: 24000, fpsDen: 1001, dest: '/Exports/SC004_4A.mp4' });
    // A 2.39 frame over a 16:9 take, centred: the full width, a band of its height.
    const window = args.window as { left: number; top: number; width: number; height: number };
    expect(window.left).toBeCloseTo(0);
    expect(window.width).toBeCloseTo(1);
    expect(window.height).toBeCloseTo(16 / 9 / 2.39);
    expect(window.top).toBeCloseTo((1 - window.height) / 2);
    // Graded as its copy is: the LUT's text and the hash of what ffmpeg reads.
    expect(args.lut).toMatchObject({ cube: expect.stringContaining('LUT_3D_SIZE 2') as string });
    expect(notices.said).toEqual(['Saving SC004_4A.mp4…', 'Saved SC004_4A.mp4.']);
  });

  it('does nothing when the Save dialog is cancelled, and says why when it can’t be saved', async () => {
    tauri.invoke.mockResolvedValueOnce(null);
    expect(await saveClip('s1')).toBe(false);
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(notices.said).toEqual([]);
    tauri.invoke.mockResolvedValueOnce('/Exports/SC004_4A.mp4').mockRejectedValueOnce(new Error("The clip couldn't be saved there."));
    expect(await saveClip('s1')).toBe(false);
    expect(notices.said.at(-1)).toBe("The clip couldn't be saved there.");
  });
  it('names a frame with no shot number by its place in its scene, as the picture export does', async () => {
    await projectStore.getState().apply([
      { kind: 'create', record: { id: 's0', type: 'shot', parentId: 'sc4', sortKey: '0', props: {} } },
      { kind: 'update', id: 's1', set: { number: '' } },
    ]);
    tauri.invoke.mockResolvedValueOnce(null);
    await saveClip('s1');
    expect(tauri.invoke.mock.calls[0]).toEqual(['export_choose_file', { name: 'SC004_2.mp4' }]);
  });

  it('a clip whose LUT isn’t stored is said as such, and nothing is saved ungraded', async () => {
    await projectStore.getState().apply([{ kind: 'update', id: 'v1', set: { lut: 'lut-gone' } }]);
    tauri.invoke.mockResolvedValueOnce('/Exports/SC004_4A.mp4');
    expect(await saveClip('s1')).toBe(false);
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(notices.said.at(-1)).toContain('LUT');
  });

  it('one clip at a time: a second is refused before its Save dialog, and Cancel stops the first and says so', async () => {
    let finish: (value: unknown) => void = () => undefined;
    tauri.invoke.mockImplementation((name: string) => {
      if (name === 'export_choose_file') return Promise.resolve('/Exports/SC004_4A.mp4');
      if (name === 'clip_save') return new Promise((resolve) => (finish = resolve));
      if (name === 'clip_cancel') {
        finish(Promise.reject(new Error('Saving the clip was cancelled.')));
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
    });
    const first = saveClip('s1');
    await vi.waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith('clip_save', expect.anything());
    });
    expect(clipSaving.getState().shotId).toBe('s1');
    expect(await saveClip('s1')).toBe(false);
    expect(notices.said.at(-1)).toBe('SC004_4A.mp4 is being saved. Wait for it, or cancel it on its frame.');
    expect(tauri.invoke.mock.calls.filter(([name]) => name === 'export_choose_file')).toHaveLength(1);
    await cancelSaveClip();
    expect(await first).toBe(false);
    // Said as what happened, as information, and the next save may start.
    expect(notices.said.at(-1)).toBe('Saving the clip was cancelled.');
    expect(clipSaving.getState()).toEqual({ shotId: null, cancelled: false });
  });

  it('a Cancel that reaches Rust before the save does is asked again until Rust has it', async () => {
    let finish: (value: unknown) => void = () => undefined;
    let asked = 0;
    tauri.invoke.mockImplementation((name: string) => {
      if (name === 'export_choose_file') return Promise.resolve('/Exports/SC004_4A.mp4');
      if (name === 'clip_save') return new Promise((resolve) => (finish = resolve));
      if (name === 'clip_cancel') {
        asked += 1;
        // Not started yet the first time; the second time it's stopped.
        if (asked === 1) return Promise.resolve(false);
        finish(Promise.reject(new Error('Saving the clip was cancelled.')));
        return Promise.resolve(true);
      }
      return Promise.resolve(null);
    });
    const saving = saveClip('s1');
    await vi.waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith('clip_save', expect.anything());
    });
    await cancelSaveClip();
    expect(asked).toBe(2);
    expect(await saving).toBe(false);
  });

  it('a Cancel while the Save dialog is open stops it there: Rust is never asked', async () => {
    tauri.invoke.mockImplementation((name: string) => {
      if (name === 'export_choose_file') {
        void cancelSaveClip();
        return Promise.resolve('/Exports/SC004_4A.mp4');
      }
      return Promise.resolve(true);
    });
    expect(await saveClip('s1')).toBe(false);
    expect((tauri.invoke.mock.calls as [string][]).map(([name]) => name)).not.toContain('clip_save');
    expect(clipSaving.getState()).toEqual({ shotId: null, cancelled: false });
  });
});

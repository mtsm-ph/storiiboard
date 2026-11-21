import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lutStatements } from '../../core/media/lut';
import { mediaFields, type PreparedImage } from '../../core/media/store';
import { clipProp, readClip, readFromVideo, videoFields, videoProps, type VideoFields, type VideoProbe } from '../../core/media/video';
import { readCrop } from '../../core/media/crop';
import type { SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';

// Still capture (2.7): the edit that makes a grabbed still the frame's picture. The grab itself (ffmpeg from the
// original, graded) has its Rust tests; the end-to-end test drives the Player's button and key. What grabStill says
// when it can't grab is tested here, as the desktop app runs it.

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@tauri-apps/api/core', () => tauri);
vi.mock('../../app/fileAccess', () => ({ isTauriApp: true }));
const notices = vi.hoisted(() => ({ said: [] as string[] }));
vi.mock('../../app/notice', () => ({
  showInfo: (message: string) => notices.said.push(message),
  showNotice: (error: unknown) => notices.said.push(error instanceof Error ? error.message : String(error)),
}));

const { projectStore } = await import('../../app/projectStore');
const { videoDriver } = await import('../../app/video');
const { grabStill, stillEdit } = await import('./grabStill');

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

function still(seed: number): PreparedImage {
  const bytes = new Uint8Array(2000).map((_, i) => (i * seed) % 256);
  return {
    original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/png', width: 2560, height: 1440, colorSpace: 'srgb' },
    thumbnail: { bytes: bytes.slice(0, 300), mime: 'image/jpeg', width: 640, height: 360, longEdge: 640 },
  };
}

const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: SbdRecord['props']): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: 'a',
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: '2026-11-07T00:00:00.000Z',
  updatedAt: '2026-11-07T00:00:00.000Z',
});

const crop = { x: 0.3, y: 0.6, zoom: 2 };
const asTaken = (start: Record<string, SbdRecord>): VideoFields => {
  const fields = videoFields(start.v1?.props ?? {});
  if (!fields) throw new Error('the video');
  return fields;
};
const records = (): Record<string, SbdRecord> => ({
  v1: record('v1', 'media', 'p', videoProps(probe, { name: 'A001_C003.MOV', path: '/Footage/A001_C003.MOV', size: 1 }, '/Films/Bey County.sbd', null)),
  old: record('old', 'media', 's1', { kind: 'image', sha256: 'f'.repeat(64), width: 100, height: 100, mime: 'image/png' }),
  s1: record('s1', 'shot', 'sc', { number: '1A', media_id: 'old', clip: clipProp({ videoId: 'v1', inFrame: 24, outFrame: 96, crop }) }),
});

/** What the records would be with the edit's creates and updates laid over them (trash as trashed). */
function after(start: Record<string, SbdRecord>, changes: readonly Change[]): Record<string, SbdRecord> {
  const now = { ...start };
  for (const change of changes) {
    if (change.kind === 'create') now[change.record.id ?? ''] = record(change.record.id ?? '', change.record.type, change.record.parentId ?? null, change.record.props ?? {});
    else if (change.kind === 'update') {
      const was = now[change.id];
      if (!was) continue;
      const unset = new Set(change.unset ?? []);
      const props = Object.fromEntries(Object.entries({ ...was.props, ...(change.set ?? {}) }).filter(([name]) => !unset.has(name)));
      now[change.id] = { ...was, props };
    } else if (change.kind === 'trash') {
      const was = now[change.id];
      if (was) now[change.id] = { ...was, trashedAt: 'now' };
    }
  }
  return now;
}

describe('a still grabbed into its frame (2.7)', () => {
  it('becomes the frame’s picture, framed by the clip’s crop, saying where it came from and with what LUT', () => {
    const start = records();
    const edit = stillEdit(start, 's1', 'v1', 48, still(3), { id: 'lut-1', name: 'SLog3 to 709' }, '/Films/Bey County.sbd', asTaken(start));
    const now = after(start, edit.changes);
    const shot = now.s1;
    if (!shot) throw new Error('the frame');
    const pictureId = typeof shot.props.media_id === 'string' ? shot.props.media_id : '';
    expect(pictureId).not.toBe('old');
    const picture = now[pictureId];
    expect(picture && mediaFields(picture.props)?.sha256).toBe(still(3).original.sha256);
    // Where it came from, enough to grab the same frame again: the frame, its timecode, the take, the LUT.
    expect(picture && readFromVideo(picture.props)).toEqual({
      videoId: 'v1',
      frame: 48,
      fps: { num: 24000, den: 1001 },
      timecode: '01:00:02:00',
      sourceName: 'A001_C003.MOV',
      lutId: 'lut-1',
      lutName: 'SLog3 to 709',
    });
    // The frame still plays its clip, and its picture is framed as the window was.
    expect(readClip(shot.props)).toEqual({ videoId: 'v1', inFrame: 24, outFrame: 96, crop });
    expect(readCrop(shot.props)).toEqual(crop);
    // The old picture goes to the Trash with it; its bytes are written in the same transaction.
    expect(now.old?.trashedAt).not.toBeNull();
    expect(edit.alsoWrite.some((statement) => statement.params?.includes(still(3).original.sha256))).toBe(true);
    // The clip prop is kept as stored, every field of it.
    expect(shot.props.clip).toEqual(start.s1?.props.clip);
  });

  it('a centred clip leaves the picture centred; no LUT is said as none', () => {
    const start = records();
    const centred = start.s1;
    if (!centred) throw new Error('the frame');
    start.s1 = { ...centred, props: { ...centred.props, clip: clipProp({ videoId: 'v1', inFrame: 0, outFrame: 10, crop: { x: 0.5, y: 0.5, zoom: 1 } }) } };
    const now = after(start, stillEdit(start, 's1', 'v1', 0, still(4), null, '/Films/Bey County.sbd', asTaken(start)).changes);
    expect(now.s1?.props.crop).toBeUndefined();
    const id = now.s1?.props.media_id;
    const picture = typeof id === 'string' ? now[id] : undefined;
    expect(picture && readFromVideo(picture.props)?.lutId).toBeNull();
  });

  it('makes no edit when the frame no longer plays that video, the video was relinked meanwhile, or the frame is in the Trash', () => {
    const start = records();
    const taken = asTaken(start);
    expect(stillEdit(start, 's1', 'v2', 48, still(5), null, '', taken).changes).toEqual([]);
    // Relinked while the still was made: it's the old file's, so it isn't the frame's picture under the new one.
    expect(stillEdit(start, 's1', 'v1', 48, still(5), null, '', { ...taken, sourcePath: '/Footage/A001_C004.MOV' }).changes).toEqual([]);
    expect(stillEdit(start, 's1', 'v1', 48, still(5), null, '', { ...taken, fps: { num: 25, den: 1 } }).changes).toEqual([]);
    const shot = start.s1;
    if (!shot) throw new Error('the frame');
    start.s1 = { ...shot, trashedAt: 'now' };
    expect(stillEdit(start, 's1', 'v1', 48, still(5), null, '', taken).changes).toEqual([]);
  });
});

describe('what a still grab says when its LUT is missing or unreadable (round 3; Kevin, Nov 19)', () => {
  let folder: TestFolder;
  let project: Project;
  beforeEach(async () => {
    tauri.invoke.mockReset();
    notices.said = [];
    folder = makeTestFolder();
    project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await projectStore.getState().open(project);
    await projectStore.getState().apply([
      { kind: 'create', record: { id: 'sc1', type: 'scene', parentId: project.projectId, sortKey: 'a', props: { number: '1' } } },
      {
        kind: 'create',
        record: {
          id: 'v1',
          type: 'media',
          parentId: project.projectId,
          sortKey: 'b',
          props: { ...videoProps(probe, { name: 'A001_C003.MOV', path: '/Footage/A001_C003.MOV', size: 1 }, project.file.path, null), lut: 'lut-gone' },
        },
      },
      { kind: 'create', record: { id: 's1', type: 'shot', parentId: 'sc1', sortKey: 'a', props: { number: '1A', clip: clipProp({ videoId: 'v1', inFrame: 24, outFrame: 96, crop }) } } },
    ]);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await projectStore.getState().close();
    folder.remove();
  });

  it('a LUT no longer stored: says so, names the still, and grabs nothing ungraded', async () => {
    const grab = vi.spyOn(videoDriver, 'still');
    expect(await grabStill('s1', 48)).toBe(false);
    expect(notices.said).toEqual(['This video’s LUT is no longer in the project, so a graded still can’t be made. Choose its LUT again, or set it to None.']);
    expect(grab).not.toHaveBeenCalled();
    expect(projectStore.getState().records.s1?.props.media_id).toBeUndefined();
  });

  it('a LUT stored but unreadable: names the still, never the playback copy, and grabs nothing ungraded', async () => {
    // Stored under its own name, but a 1D LUT ffmpeg can't read.
    const text = 'LUT_1D_SIZE 2\n0 0 0\n1 1 1\n';
    const sha256 = createHash('sha256').update(text).digest('hex');
    await projectStore.getState().apply([{ kind: 'update', id: 'v1', set: { lut: 'lut-1d' } }], {
      alsoWrite: lutStatements('lut-1d', { sha256, name: 'Shaper', fileName: 'Shaper.cube', cube: text }, new Date()),
    });
    const grab = vi.spyOn(videoDriver, 'still');
    expect(await grabStill('s1', 48)).toBe(false);
    expect(notices.said).toEqual(['This video’s LUT can’t be read, so the still can’t be made.']);
    expect(grab).not.toHaveBeenCalled();
    expect(projectStore.getState().records.s1?.props.media_id).toBeUndefined();
  });
});

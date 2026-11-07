import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mediaFields, type PreparedImage } from '../../core/media/store';
import { clipProp, readClip, readFromVideo, videoProps, type VideoProbe } from '../../core/media/video';
import { readCrop } from '../../core/media/crop';
import type { SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { stillEdit } from './grabStill';

// Still capture (2.7): the edit that makes a grabbed still the frame's picture. The grab itself (ffmpeg from the
// original, graded) has its Rust tests; the end-to-end test drives the Player's button and key.

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
    const edit = stillEdit(start, 's1', 'v1', 48, still(3), { id: 'lut-1', name: 'SLog3 to 709' }, '/Films/Bey County.sbd');
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
    expect(edit.alsoWrite.length).toBeGreaterThan(0);
  });

  it('a centred clip leaves the picture centred; no LUT is said as none', () => {
    const start = records();
    const centred = start.s1;
    if (!centred) throw new Error('the frame');
    start.s1 = { ...centred, props: { ...centred.props, clip: clipProp({ videoId: 'v1', inFrame: 0, outFrame: 10, crop: { x: 0.5, y: 0.5, zoom: 1 } }) } };
    const now = after(start, stillEdit(start, 's1', 'v1', 0, still(4), null, '/Films/Bey County.sbd').changes);
    expect(now.s1?.props.crop).toBeUndefined();
    const id = now.s1?.props.media_id;
    const picture = typeof id === 'string' ? now[id] : undefined;
    expect(picture && readFromVideo(picture.props)?.lutId).toBeNull();
  });

  it('makes no edit when the frame no longer plays that video, or is in the Trash', () => {
    const start = records();
    expect(stillEdit(start, 's1', 'v2', 48, still(5), null, '').changes).toEqual([]);
    const shot = start.s1;
    if (!shot) throw new Error('the frame');
    start.s1 = { ...shot, trashedAt: 'now' };
    expect(stillEdit(start, 's1', 'v1', 48, still(5), null, '').changes).toEqual([]);
  });
});

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PreparedImage } from '../../core/media/store';
import type { VideoProbe } from '../../core/media/video';
import type { Props, SbdRecord } from '../../core/model/record';
import { keyBetween } from '../../core/ops/order';
import { placeFiles, type PreparedFile } from './linkVideos';

// Videos dropped into a project past a sort key keyBetween can't read (6.23, Kevin: an odd imported file never makes the
// app throw): the first video record after the project's last readable key, each next after the one before; a sound
// project's keys are keyBetween's, as before.

const at = '2026-11-16T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));

function still(seed: number): PreparedImage {
  const bytes = new Uint8Array(300).map((_, i) => (i * seed) % 256);
  return {
    original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/png', width: 1920, height: 1080, colorSpace: 'srgb' },
    thumbnail: { bytes: bytes.slice(0, 100), mime: 'image/jpeg', width: 640, height: 360, longEdge: 640 },
  };
}
const probe: VideoProbe = { codec: 'h264', width: 3840, height: 2160, sarNum: 1, sarDen: 1, fpsNum: 24000, fpsDen: 1001, durationFrames: 48, startTimecode: '01:00:00:00', rotation: 0, hasAudio: true, hdr: false, bitDepth: 10 };
const video = (name: string, seed: number): PreparedFile => ({ kind: 'video', video: { probe, still: still(seed), source: { name, path: `/Footage/${name}`, size: 1234 } } });

/** The video records' keys, in the order made. */
const videoKeys = (records: Record<string, SbdRecord>) =>
  placeFiles(records, 'p', { kind: 'scene', sceneId: 's1', afterShotId: null }, [video('A001.MP4', 2), video('A002.MP4', 3)], '/Films/Odd.sbd').changes.flatMap((c) =>
    c.kind === 'create' && c.record.parentId === 'p' ? [c.record.sortKey] : [],
  );

describe('videos past an odd key (6.23)', () => {
  it('go after the project’s last readable key; a sound project’s keys as before', () => {
    const base = [record('p', 'project', null, { title: 'Odd' }), record('s1', 'scene', 'p', { number: '1' }, 'b')];
    const first = keyBetween('b', null);
    expect(videoKeys(recordsOf(...base, record('m1', 'media', 'p', { kind: 'link' }, '~')))).toEqual([first, keyBetween(first, null)]);
    const sound = keyBetween('d', null);
    expect(videoKeys(recordsOf(...base, record('m1', 'media', 'p', { kind: 'link' }, 'd')))).toEqual([sound, keyBetween(sound, null)]);
  });
});

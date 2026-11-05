import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { readOriginal, type PreparedImage } from '../../core/media/store';
import { readClip, readFromVideo, videoFields, type VideoProbe } from '../../core/media/video';
import { shotFields } from '../../core/model/storyboard';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot } from '../storyboard/board';
import { removePicture, setPicture } from '../storyboard/framePictures';
import { describeEdit, lineText } from '../history/summary';
import { log, opsOfGroups } from '../../core/ops/ops';
import { linkVideos, placeFiles, type PreparedVideo } from './linkVideos';
import { clipsPastEnd, fpsLabel, mismatchTitle, relinkMismatch } from './relink';

function still(seed: number): PreparedImage {
  const bytes = new Uint8Array(3000).map((_, i) => (i * seed) % 256);
  return {
    original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/png', width: 1920, height: 1080, colorSpace: 'srgb' },
    thumbnail: { bytes: bytes.slice(0, 300), mime: 'image/jpeg', width: 640, height: 360, longEdge: 640 },
  };
}

const probe: VideoProbe = {
  codec: 'h264',
  width: 3840,
  height: 2160,
  sarNum: 1,
  sarDen: 1,
  fpsNum: 24000,
  fpsDen: 1001,
  durationFrames: 48,
  startTimecode: '01:00:00:00',
  rotation: 0,
  hasAudio: true,
  hdr: false,
  bitDepth: 10,
};

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
const records = () => store.getState().records;

const video = (name: string, seed: number): PreparedVideo => ({
  probe,
  still: still(seed),
  source: { name, path: folder.path(`Footage/${name}`), size: 1234 },
});

beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
  await store.getState().apply([
    { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4' } } },
  ]);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const frame = async () => {
  const added = addShot(records(), project.projectId, 'sc4');
  await store.getState().apply(added.changes);
  return added.shotId;
};

const link = (target: Parameters<typeof linkVideos>[2], videos: PreparedVideo[]) =>
  store.getState().applyWith((now, slate) => linkVideos(now, project.projectId, target, videos, project.file.path, slate));

const videosIn = () => Object.values(records()).filter((r) => r.type === 'media' && r.props.kind === 'video' && r.trashedAt === null);

describe('linking a video to a frame', () => {
  it('makes a video record with its poster, and gives the frame its first frame and the whole clip, in one undo', async () => {
    const shotId = await frame();
    expect(await link({ kind: 'frame', shotId }, [video('C0042.MP4', 1)])).toBe(true);

    const [record] = videosIn();
    const fields = record ? videoFields(record.props) : null;
    expect(fields).toMatchObject({ sourceName: 'C0042.MP4', sourcePath: 'Footage/C0042.MP4', sourceSize: 1234, durationFrames: 48 });
    // The poster is an image record under the video, its bytes stored once with the frame's picture.
    const poster = fields?.poster ? records()[fields.poster] : undefined;
    expect(poster).toMatchObject({ type: 'media', parentId: record?.id, props: { kind: 'image', file: still(1).original.sha256 } });
    expect(await readOriginal(project.file, still(1).original.sha256)).not.toBeNull();

    const shot = shotFields(records()[shotId]?.props ?? {});
    expect(readClip(records()[shotId]?.props ?? {})).toEqual({ videoId: record?.id, inFrame: 0, outFrame: 47, crop: { x: 0.5, y: 0.5, zoom: 1 } });
    const picture = shot.mediaId ? records()[shot.mediaId] : undefined;
    expect(readFromVideo(picture?.props ?? {})).toMatchObject({ videoId: record?.id, frame: 0, timecode: '01:00:00:00', sourceName: 'C0042.MP4' });

    const [step] = (await log(project.file)).slice(-1);
    const ops = step ? await opsOfGroups(project.file, [step.id]) : [];
    expect(lineText(describeEdit(ops, new Set([still(1).original.sha256])))).toBe('Linked C0042.MP4 to 4A');

    await store.getState().undo();
    expect(videosIn()).toEqual([]);
    expect(readClip(records()[shotId]?.props ?? {})).toBeNull();
    expect(shotFields(records()[shotId]?.props ?? {}).mediaId).toBeNull();
  });

  it('reuses the record of a file the project links already, and of one dropped twice', async () => {
    const [a, b] = [await frame(), await frame()];
    await link({ kind: 'frame', shotId: a }, [video('C0042.MP4', 1)]);
    await link({ kind: 'frame', shotId: b }, [video('C0042.MP4', 1)]);
    expect(videosIn()).toHaveLength(1);
    expect(readClip(records()[a]?.props ?? {})?.videoId).toBe(readClip(records()[b]?.props ?? {})?.videoId);

    await link({ kind: 'scene', sceneId: 'sc4', afterShotId: null }, [video('C0050.MP4', 2), video('C0050.MP4', 2)]);
    expect(videosIn()).toHaveLength(2);
  });

  it('makes new frames for videos dropped into a scene, each playing its own video', async () => {
    await link({ kind: 'scene', sceneId: 'sc4', afterShotId: null }, [video('C0042.MP4', 1), video('C0043.MP4', 2)]);
    const shots = Object.values(records()).filter((r) => r.type === 'shot');
    expect(shots.map((s) => shotFields(s.props).number).sort()).toEqual(['4A', '4B']);
    expect(new Set(shots.map((s) => readClip(s.props)?.videoId)).size).toBe(2);
  });

  it('ends a frame’s clip when a still picture replaces it or the picture is removed', async () => {
    const shotId = await frame();
    await link({ kind: 'frame', shotId }, [video('C0042.MP4', 1)]);
    const replace = setPicture(records(), shotId, { image: still(3), source: { name: 'IMG_1.JPG' } }, project.file.path);
    await store.getState().apply(replace.changes, { alsoWrite: replace.alsoWrite });
    expect(readClip(records()[shotId]?.props ?? {})).toBeNull();

    await link({ kind: 'frame', shotId }, [video('C0042.MP4', 1)]);
    expect(readClip(records()[shotId]?.props ?? {})).not.toBeNull();
    await store.getState().apply(removePicture(records(), shotId));
    expect(readClip(records()[shotId]?.props ?? {})).toBeNull();
    // The video stays for other frames; unlinking a frame never touches it.
    expect(videosIn()).toHaveLength(1);
  });
});

describe('a drop of videos and pictures together', () => {
  it('lands as one edit in the order dropped: the video on the frame, the picture a new frame after it', async () => {
    const shotId = await frame();
    const picture = { kind: 'picture' as const, picture: { image: still(5), source: { name: 'ref.jpg' } } };
    await store.getState().applyWith((now, slate) =>
      placeFiles(now, project.projectId, { kind: 'frame', shotId }, [{ kind: 'video', video: video('C0042.MP4', 1) }, picture], project.file.path, slate),
    );
    expect(readClip(records()[shotId]?.props ?? {})).not.toBeNull();
    const shots = Object.values(records()).filter((r) => r.type === 'shot' && r.trashedAt === null);
    expect(shots.map((s) => shotFields(s.props).number).sort()).toEqual(['4A', '4B']);
    const after = shots.find((s) => s.id !== shotId);
    expect(after && readClip(after.props)).toBeNull();
    expect(await readOriginal(project.file, still(5).original.sha256)).not.toBeNull();

    // One undo takes the whole drop back.
    await store.getState().undo();
    expect(readClip(records()[shotId]?.props ?? {})).toBeNull();
    expect(Object.values(records()).filter((r) => r.type === 'shot' && r.trashedAt === null)).toHaveLength(1);
    expect(videosIn()).toEqual([]);
  });

  it('gives a file re-exported to the same path with another length a record of its own', async () => {
    const [a, b] = [await frame(), await frame()];
    await link({ kind: 'frame', shotId: a }, [video('Selects.mov', 1)]);
    const longer = { ...video('Selects.mov', 2), probe: { ...probe, durationFrames: 96, startTimecode: '02:00:00:00' } };
    await link({ kind: 'frame', shotId: b }, [longer]);
    expect(videosIn()).toHaveLength(2);
    const clipB = readClip(records()[b]?.props ?? {});
    const recordB = clipB ? videoFields(records()[clipB.videoId]?.props ?? {}) : null;
    // The clip and the record it plays agree.
    expect(clipB?.outFrame).toBe(95);
    expect(recordB?.durationFrames).toBe(96);
    expect(recordB?.startTimecode).toBe('02:00:00:00');
  });
});

describe('relinking', () => {
  const linked = () => {
    const fields = videoFields({ kind: 'video', source_name: 'C0042.MP4', source_size: 1234, fps: { num: 24000, den: 1001 }, width: 10, height: 10, duration_frames: 48, start_timecode: '01:00:00:00' });
    if (!fields) throw new Error('a video');
    return fields;
  };
  const same = { name: 'C0042.MP4', size: 1234 };

  it('asks only when the new file might not be the same clip, and says what differs most', () => {
    expect(relinkMismatch(linked(), probe, same)).toBeNull();
    // 48000/2002 is 24000/1001; a size this computer can't tell isn't a difference.
    expect(relinkMismatch(linked(), { ...probe, fpsNum: 48000, fpsDen: 2002 }, { name: 'C0042.MP4', size: null })).toBeNull();
    const rate = relinkMismatch(linked(), { ...probe, fpsNum: 25, fpsDen: 1 }, same);
    expect(rate).toEqual({ rate: true, length: false, file: false });
    expect(rate && mismatchTitle(rate)).toBe('relink.differentRate');
    const length = relinkMismatch(linked(), { ...probe, durationFrames: 47 }, same);
    expect(length && mismatchTitle(length)).toBe('relink.differentLength');
    // Same rate and length, but another take: the name, the size or the start timecode.
    for (const [changedProbe, file] of [
      [probe, { name: 'C0043.MP4', size: 1234 }],
      [probe, { name: 'C0042.MP4', size: 999 }],
      [{ ...probe, startTimecode: '01:00:10:00' }, same],
    ] as const) {
      const other = relinkMismatch(linked(), changedProbe, file);
      expect(other).toEqual({ rate: false, length: false, file: true });
      expect(other && mismatchTitle(other)).toBe('relink.differentFile');
    }
  });

  it('counts the clips a shorter file would leave running past its end', async () => {
    const [a, b] = [await frame(), await frame()];
    await link({ kind: 'frame', shotId: a }, [video('C0042.MP4', 1)]);
    await link({ kind: 'frame', shotId: b }, [video('C0042.MP4', 1)]);
    const videoId = readClip(records()[a]?.props ?? {})?.videoId ?? '';
    expect(clipsPastEnd(records(), videoId, 48)).toBe(0);
    expect(clipsPastEnd(records(), videoId, 40)).toBe(2);
  });

  it('writes a rate as a camera menu does', () => {
    expect(fpsLabel({ num: 24000, den: 1001 })).toBe('23.976');
    expect(fpsLabel({ num: 30000, den: 1001 })).toBe('29.97');
    expect(fpsLabel({ num: 25, den: 1 })).toBe('25');
  });
});

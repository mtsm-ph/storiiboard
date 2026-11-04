import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import type { PreparedImage } from '../../core/media/store';
import type { Change } from '../../core/ops/ops';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot } from '../storyboard/board';
import { setCrop, setPicture, type FramePicture, type PictureEdit } from '../storyboard/framePictures';
import { frameContent, renderFrame, watermarkOutline } from './renderFrame';

// What an exported frame is drawn from (1.24), read from a real file: the drawing itself is the browser's to check
// (e2e/export.spec.ts), but whether a trashed stroke or picture gets in, and whether a lost or undecodable picture is
// noticed, is decided here.

function picture(seed: number): FramePicture {
  const bytes = new Uint8Array(3000).map((_, i) => (i * seed) % 256);
  const image: PreparedImage = {
    original: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes, mime: 'image/jpeg', width: 1600, height: 900, colorSpace: 'srgb' },
    thumbnail: { bytes: bytes.slice(0, 300), mime: 'image/jpeg', width: 640, height: 360, longEdge: 640 },
  };
  return { image, source: { name: `IMG_${String(5000 + seed)}.JPG` } };
}

const stroke = (id: string, parentId: string, sortKey: string): Change => ({
  kind: 'create',
  record: { id, type: 'stroke', parentId, sortKey, props: { tool: 'pen', points: [0.1, 0.5, 0.9, 0.5], width: 0.008 } },
});

describe('a frame for export', () => {
  let folder: TestFolder;
  let project: Project;
  const store = createProjectStore();
  let shotId = '';
  const records = () => store.getState().records;
  const shot = () => {
    const record = records()[shotId];
    if (!record) throw new Error('no shot');
    return record;
  };
  const apply = (edit: PictureEdit) => store.getState().apply(edit.changes, { alsoWrite: edit.alsoWrite });

  beforeEach(async () => {
    folder = makeTestFolder();
    project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
    await store.getState().apply([
      { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4' } } },
    ]);
    const added = addShot(records(), project.projectId, 'sc4');
    shotId = added.shotId;
    await store.getState().apply(added.changes);
  });
  afterEach(async () => {
    await store.getState().close();
    folder.remove();
  });

  it('draws only the live strokes, in the order they were drawn', async () => {
    await store.getState().apply([stroke('s1', shotId, 'a'), stroke('s2', shotId, 'b'), stroke('s3', shotId, 'c')]);
    await store.getState().apply([{ kind: 'trash', id: 's2' }]);
    const { strokes } = await frameContent(records(), project.file, shot());
    expect(strokes.map((s) => s.id)).toEqual(['s1', 's3']);
  });

  it('carries the full-size picture with the crop the person chose', async () => {
    const chosen = picture(1);
    await apply(setPicture(records(), shotId, chosen, project.file.path));
    await store.getState().apply([setCrop(shotId, { x: 0.3, y: 0.6, zoom: 2 })]);
    const { picture: drawn } = await frameContent(records(), project.file, shot());
    expect(drawn).toEqual({ bytes: chosen.image.original.bytes, mime: 'image/jpeg', crop: { x: 0.3, y: 0.6, zoom: 2 } });
  });

  it('leaves out a trashed picture, even one the frame still names', async () => {
    await apply(setPicture(records(), shotId, picture(1), project.file.path));
    const mediaId = shot().props.media_id;
    if (typeof mediaId !== 'string') throw new Error('no picture');
    // Trashed alone, the way an older build or a hand-edited file could leave it: the frame still points at it.
    await store.getState().apply([{ kind: 'trash', id: mediaId }]);
    expect(shot().props.media_id).toBe(mediaId);
    expect((await frameContent(records(), project.file, shot())).picture).toBeNull();
  });

  it('says a picture is missing when the file no longer holds its bytes', async () => {
    // A live media record whose stored picture is gone: what an old or damaged file can hold.
    const sha256 = 'f'.repeat(64);
    await store.getState().apply([
      { kind: 'create', record: { id: 'm1', type: 'media', parentId: shotId, sortKey: 'a', props: { kind: 'image', file: sha256, width: 1600, height: 900 } } },
      { kind: 'update', id: shotId, set: { media_id: 'm1' } },
    ]);
    expect((await frameContent(records(), project.file, shot())).picture).toBe('missing');
  });

  it('is empty with no picture set: a blank frame, nothing missing', async () => {
    expect(await frameContent(records(), project.file, shot())).toEqual({ strokes: [], picture: null });
  });
});

/**
 * A browser's canvas and decoder, as far as renderFrame uses them, since Node has neither: a 2D context that notes the
 * text and pictures drawn on it, and a createImageBitmap that decodes only bytes that start as a JPEG does and
 * rejects the rest as a browser does ('The source image could not be decoded').
 */
class FakeContext {
  readonly texts: string[] = [];
  pictures = 0;
  font = '';
  fillText(text: string) {
    this.texts.push(text);
  }
  strokeText() {}
  measureText(text: string) {
    return { width: text.length * 8 };
  }
  drawImage() {
    this.pictures += 1;
  }
  fillRect() {}
  strokeRect() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  stroke() {}
  fill() {}
  save() {}
  restore() {}
}
class FakeCanvas {
  readonly context = new FakeContext();
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  getContext() {
    return this.context;
  }
}
async function fakeDecode(blob: Blob) {
  const head = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
  if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
  return { width: 1600, height: 900, close: () => undefined };
}

describe('drawing a frame for export', () => {
  let folder: TestFolder;
  let project: Project;
  const store = createProjectStore();
  let shotId = '';
  const records = () => store.getState().records;
  const shot = () => {
    const record = records()[shotId];
    if (!record) throw new Error('no shot');
    return record;
  };

  beforeEach(async () => {
    vi.stubGlobal('OffscreenCanvas', FakeCanvas);
    vi.stubGlobal('createImageBitmap', fakeDecode);
    folder = makeTestFolder();
    project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
    await store.getState().apply([
      { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4' } } },
    ]);
    const added = addShot(records(), project.projectId, 'sc4');
    shotId = added.shotId;
    await store.getState().apply(added.changes);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await store.getState().close();
    folder.remove();
  });

  async function setBytes(bytes: Uint8Array) {
    const chosen = picture(1);
    chosen.image.original = { ...chosen.image.original, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
    const edit = setPicture(records(), shotId, chosen, project.file.path);
    await store.getState().apply(edit.changes, { alsoWrite: edit.alsoWrite });
  }
  const render = () => renderFrame(records(), project.file, shot(), { width: 1920, height: 1080 }, null);
  const drawnOn = (canvas: unknown) => (canvas as FakeCanvas).context;

  it('draws a picture that decodes', async () => {
    await setBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    const { canvas, pictureMissing } = await render();
    expect(pictureMissing).toBe(false);
    expect(drawnOn(canvas).pictures).toBe(1);
    expect(drawnOn(canvas).texts).toEqual([]);
  });

  it('marks a stored picture that won’t decode as missing, rather than ending the export', async () => {
    // Bytes the file holds, under their own true sha256, that no decoder reads: a damaged blob in an old file.
    await setBytes(new Uint8Array(3000).map((_, i) => (i * 7) % 256));
    const { canvas, pictureMissing } = await render();
    expect(pictureMissing).toBe(true);
    expect(drawnOn(canvas).pictures).toBe(0);
    expect(drawnOn(canvas).texts).toEqual(['PICTURE MISSING']);
  });
});

describe('the watermark outline', () => {
  it('grows with the type and never thins to nothing', () => {
    expect(watermarkOutline(48)).toBe(8);
    expect(watermarkOutline(4)).toBe(1.5);
  });
});

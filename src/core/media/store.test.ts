import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { apply, getRecord, redo, undo, type Change } from '../ops/ops';
import type { SqlDriver } from '../storage/driver';
import { createMemoryDriver } from '../storage/memoryDriver';
import { nodeDriver } from '../storage/nodeDriver';
import { createProject, type Project } from '../storage/project';
import { makeTestFolder, type TestFolder } from '../storage/testFolder';
import { imageStatements, mediaProps, readOriginal, readThumbnail, relativeToProject, type PreparedImage } from './store';

const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

/** Bytes with every value from 0 to 255 in them, so a driver that treats them as text would garble them. */
function bytes(length: number, seed: number): Uint8Array {
  return new Uint8Array(length).map((_, i) => (i * seed + (i >> 8)) % 256);
}

function picture(seed: number): PreparedImage {
  const original = bytes(300_000, seed);
  return {
    original: {
      sha256: createHash('sha256').update(original).digest('hex'),
      bytes: original,
      mime: 'image/jpeg',
      width: 2560,
      height: 1440,
      colorSpace: 'display-p3',
    },
    thumbnail: { bytes: bytes(20_000, seed + 1), mime: 'image/jpeg', width: 640, height: 360, longEdge: 640 },
  };
}

// Each driver the app runs on, besides the desktop one (its Rust side has its own test, its JS side is below).
const drivers: [string, () => Promise<{ driver: SqlDriver; path: string; done: () => void }>][] = [
  [
    'node',
    () => {
      const folder: TestFolder = makeTestFolder();
      return Promise.resolve({ driver: nodeDriver, path: folder.path('Bey County.sbd'), done: () => {
          folder.remove();
        },
      });
    },
  ],
  ['memory', async () => ({ driver: await createMemoryDriver({ wasm }), path: '/memory/Bey County.sbd', done: () => undefined })],
];

describe.each(drivers)('stored pictures (%s driver)', (_name, setUp) => {
  let project: Project;
  let done: () => void;

  async function open() {
    const made = await setUp();
    done = made.done;
    project = await createProject(made.path, { driver: made.driver, backups: false });
  }
  afterEach(async () => {
    await project.close();
    done();
  });

  const media = (id: string, image: PreparedImage): Change => ({
    kind: 'create',
    record: { id, type: 'media', parentId: project.projectId, sortKey: 'V', props: mediaProps(image) },
  });
  const count = async (table: string) => Number((await project.file.query(`SELECT count(*) AS n FROM ${table}`))[0]?.n);

  it('stores a picture with its record in one transaction and reads the bytes back exactly', async () => {
    await open();
    const image = picture(7);
    await apply(project.file, [media('m1', image)], { alsoWrite: imageStatements(image, new Date()) });

    expect((await getRecord(project.file, 'm1'))?.props).toMatchObject({ kind: 'image', file: image.original.sha256 });
    expect(await readOriginal(project.file, image.original.sha256)).toEqual({ bytes: image.original.bytes, mime: 'image/jpeg' });
    expect(await readThumbnail(project.file, image.original.sha256)).toEqual({ bytes: image.thumbnail.bytes, mime: 'image/jpeg' });
    const [row] = await project.file.query('SELECT byte_size, color_space, width, height FROM media_files');
    expect(row).toEqual({ byte_size: 300_000, color_space: 'display-p3', width: 2560, height: 1440 });
  });

  it('keeps one copy of a picture used in two frames', async () => {
    await open();
    const image = picture(11);
    await apply(project.file, [media('m1', image)], { alsoWrite: imageStatements(image, new Date()) });
    await apply(project.file, [media('m2', image)], { alsoWrite: imageStatements(image, new Date()) });
    expect([await count('media_files'), await count('thumbnails'), await count("records WHERE type = 'media'")]).toEqual([1, 1, 2]);
  });

  it('writes neither the record nor the bytes when the transaction fails', async () => {
    await open();
    const image = picture(13);
    const failing = [...imageStatements(image, new Date()), { sql: 'INSERT INTO nowhere VALUES (1)' }];
    await expect(apply(project.file, [media('m1', image)], { alsoWrite: failing })).rejects.toThrow();
    expect(await getRecord(project.file, 'm1')).toBeNull();
    expect([await count('media_files'), await count('thumbnails')]).toEqual([0, 0]);
  });

  it('keeps the bytes through undo, so redo brings the picture back', async () => {
    await open();
    const image = picture(17);
    await apply(project.file, [media('m1', image)], { alsoWrite: imageStatements(image, new Date()) });
    await undo(project.file);
    expect(await getRecord(project.file, 'm1')).toBeNull();
    expect((await readOriginal(project.file, image.original.sha256))?.bytes).toEqual(image.original.bytes);
    await redo(project.file);
    expect((await getRecord(project.file, 'm1'))?.props.file).toBe(image.original.sha256);
  });

  it("says when the file doesn't hold a picture", async () => {
    await open();
    expect(await readOriginal(project.file, 'f'.repeat(64))).toBeNull();
    expect(await readThumbnail(project.file, 'f'.repeat(64))).toBeNull();
  });
});

describe("a picture's original file", () => {
  it('is stored relative to the project when it sits in the project folder, absolute otherwise', () => {
    expect(relativeToProject('/Films/Bey County/refs/still.jpg', '/Films/Bey County/Bey County.sbd')).toBe('refs/still.jpg');
    expect(relativeToProject('C:\\Films\\Bey County\\refs\\still.jpg', 'C:\\Films\\Bey County\\Bey County.sbd')).toBe(
      'refs/still.jpg',
    );
    // A folder whose name only starts the same is somewhere else.
    expect(relativeToProject('/Films/Bey County 2/still.jpg', '/Films/Bey County/Bey County.sbd')).toBe(
      '/Films/Bey County 2/still.jpg',
    );
    expect(relativeToProject('/Users/kevin/Downloads/still.jpg', '/Films/Bey County/Bey County.sbd')).toBe(
      '/Users/kevin/Downloads/still.jpg',
    );
  });

  it("is a pointer in the media record's props, next to the stored picture", () => {
    const image = picture(3);
    expect(
      mediaProps(image, { name: 'IMG_4012.JPG', path: '/Films/Bey County/refs/IMG_4012.JPG' }, '/Films/Bey County/Bey County.sbd'),
    ).toEqual({
      kind: 'image',
      file: image.original.sha256,
      mime: 'image/jpeg',
      width: 2560,
      height: 1440,
      color_space: 'display-p3',
      source_name: 'IMG_4012.JPG',
      source_path: 'refs/IMG_4012.JPG',
    });
    // A pasted picture has no file behind it.
    expect(mediaProps(image)).not.toHaveProperty('source_path');
  });
});

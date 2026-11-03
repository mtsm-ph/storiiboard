import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDriver } from '../storage/memoryDriver';
import { createProject } from '../storage/project';
import { imageStatements } from './store';
import { imageUrl, releaseImageUrls } from './urls';

const wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('picture URLs', () => {
  it('reads each picture once per open project, and frees every URL on close', async () => {
    const project = await createProject('/memory/Bey County.sbd', { driver: await createMemoryDriver({ wasm }), backups: false });
    const sha256 = 'a'.repeat(64);
    const pixel = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    await project.file.tx(
      imageStatements(
        {
          original: { sha256, bytes: pixel, mime: 'image/jpeg', width: 1, height: 1, colorSpace: 'srgb' },
          thumbnail: { bytes: pixel, mime: 'image/jpeg', width: 1, height: 1, longEdge: 640 },
        },
        new Date(),
      ),
    );
    const reads = vi.spyOn(project.file, 'readBlob');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');

    const thumbnail = await imageUrl(project.file, sha256);
    expect(thumbnail).toMatch(/^blob:/);
    expect(await imageUrl(project.file, sha256)).toBe(thumbnail);
    const original = await imageUrl(project.file, sha256, 'original');
    expect(original).not.toBe(thumbnail);
    expect(await imageUrl(project.file, 'b'.repeat(64))).toBeNull();
    expect(reads).toHaveBeenCalledTimes(2);

    await releaseImageUrls(project.file);
    expect(revoke.mock.calls.map(([url]) => url).sort()).toEqual([original, thumbnail].sort());
    await project.close();
  });
});

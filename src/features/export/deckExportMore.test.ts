import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { isTaggedP3 } from '../../core/media/image';
import type { ExportTarget } from '../../core/storage/exportFiles';
import type { ProjectFile } from '../../core/storage/driver';
import { aspectMatches, ASPECT_TOLERANCE, meanAbsDifference, TRANSPARENT_LONG_EDGE } from './deckPictures';
import { writePagePngs } from './deckPng';

// The rest of 5.6a's review: Stop before the PDF is written, a PNG set that appears whole or not at all, and the checks on an original picture. What needs a canvas is in e2e/deckExport.spec.ts.

vi.mock('../moodboards/deckPrint', () => ({
  printPages: () => [{ id: 'p', number: 1, name: '', format: '16:9', orientation: 'portrait', background: '#FFFFFF', width: 1920, height: 1080, page: {}, items: [], links: [], pictures: [], faces: [] }],
}));
vi.mock('./deckRender', () => ({
  preparePage: () => Promise.resolve(),
  picturesReady: () => true,
  renderPage: () =>
    Promise.resolve({
      print: () => ({ format: '16:9', orientation: 'portrait', width: 1920, height: 1080, background: '#FFFFFF', ops: [] }),
      dispose: () => undefined,
    }),
}));

describe('Stop in the deck PDF', () => {
  it('writes nothing when it is pressed after the last page and before the file is written', async () => {
    const { deckPdf } = await import('./deckPdf');
    const controller = new AbortController();
    const written: string[] = [];
    const target: ExportTarget = {
      label: 'Pitch.pdf',
      write: (name) => {
        written.push(name);
        return Promise.resolve();
      },
    };
    await expect(
      deckPdf.run({
        records: {},
        projectId: 'project',
        title: 'Pitch',
        scope: { kind: 'project' },
        deckId: 'deck',
        file: {} as ProjectFile,
        target,
        progress: (done, total) => {
          if (done === total && done > 0) controller.abort();
        },
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(written).toEqual([]);
  });

  it('writes the file when nothing stops it', async () => {
    const { deckPdf } = await import('./deckPdf');
    const written: string[] = [];
    const result = await deckPdf.run({
      records: {},
      projectId: 'project',
      title: 'Pitch',
      scope: { kind: 'project' },
      deckId: 'deck',
      file: {} as ProjectFile,
      target: { label: 'Pitch.pdf', write: (name) => (written.push(name), Promise.resolve()) },
      progress: () => undefined,
      signal: new AbortController().signal,
    });
    expect(written).toEqual(['Pitch.pdf']);
    expect(result.what).toBe('1 page');
  });
});

describe('a set of PNGs on a target that stages them', () => {
  function staging() {
    const log: string[] = [];
    const target: ExportTarget = {
      label: 'Pitch',
      write: (name) => (log.push(`write ${name}`), Promise.resolve()),
      stage: (name) => (log.push(`stage ${name}`), Promise.resolve()),
      commit: () => (log.push('commit'), Promise.resolve()),
      abandon: () => (log.push('abandon'), Promise.resolve()),
    };
    return { log, target };
  }

  it('are staged as they are made and given their names at the end', async () => {
    const { log, target } = staging();
    await writePagePngs({ count: 3, name: (i) => `P${String(i)}.png`, render: () => Promise.resolve(new Uint8Array([1])), target, signal: new AbortController().signal, progress: () => undefined });
    expect(log).toEqual(['stage P0.png', 'stage P1.png', 'stage P2.png', 'commit']);
  });

  it('are taken away again when Stop is pressed or a page fails: no commit, the target abandons what it made', async () => {
    const stopped = staging();
    const controller = new AbortController();
    await expect(
      writePagePngs({
        count: 4,
        name: (i) => `P${String(i)}.png`,
        render: (i) => {
          if (i === 2) controller.abort();
          return Promise.resolve(new Uint8Array([i]));
        },
        target: stopped.target,
        signal: controller.signal,
        progress: () => undefined,
      }),
    ).rejects.toThrow();
    expect(stopped.log).toEqual(['stage P0.png', 'stage P1.png', 'abandon']);

    const failed = staging();
    await expect(
      writePagePngs({ count: 3, name: (i) => `P${String(i)}.png`, render: (i) => (i === 1 ? Promise.reject(new Error('no canvas')) : Promise.resolve(new Uint8Array([i]))), target: failed.target, signal: new AbortController().signal, progress: () => undefined }),
    ).rejects.toThrow('no canvas');
    expect(failed.log).toEqual(['stage P0.png', 'abandon']);
  });

  it('are taken away when the commit itself fails partway', async () => {
    const { log, target } = staging();
    const broken: ExportTarget = { ...target, commit: () => Promise.reject(new Error('disk full')) };
    await expect(writePagePngs({ count: 2, name: (i) => `P${String(i)}.png`, render: () => Promise.resolve(new Uint8Array([1])), target: broken, signal: new AbortController().signal, progress: () => undefined })).rejects.toThrow('disk full');
    expect(log).toEqual(['stage P0.png', 'stage P1.png', 'abandon']);
  });
});

describe('an original picture', () => {
  it('must be the stored picture’s shape to within half a percent', () => {
    expect(ASPECT_TOLERANCE).toBe(0.005);
    expect(aspectMatches(6000, 4000, 2560, 1707)).toBe(true);
    expect(aspectMatches(6000, 4000, 4000, 6000)).toBe(false);
    expect(aspectMatches(1920, 1080, 1920, 1090)).toBe(false);
    expect(aspectMatches(0, 10, 10, 10)).toBe(false);
  });

  it('is told from another picture by the mean difference of its pixels, and alpha is no part of it', () => {
    const grey = (v: number, a = 255) => new Uint8ClampedArray([v, v, v, a, v, v, v, a]);
    expect(meanAbsDifference(grey(100), grey(100))).toBe(0);
    expect(meanAbsDifference(grey(100), grey(103))).toBe(3);
    expect(meanAbsDifference(grey(100), grey(100, 0))).toBe(0);
    expect(meanAbsDifference(grey(0), grey(255))).toBe(255);
    expect(meanAbsDifference(grey(1), new Uint8ClampedArray(4))).toBe(Infinity);
    expect(meanAbsDifference(new Uint8ClampedArray(), new Uint8ClampedArray())).toBe(Infinity);
  });

  it('keeps a transparent picture to 3000 pixels on the long edge', () => {
    expect(TRANSPARENT_LONG_EDGE).toBe(3000);
  });

  it('is found tagged as P3 by a v2 or a v4 profile name, and not when it has none', () => {
    const v2 = new TextEncoder().encode('....Display P3....');
    const v4 = new Uint8Array([...new TextEncoder().encode('....'), ...Array.from('Display P3').flatMap((c) => [0, c.charCodeAt(0)])]);
    expect(isTaggedP3(v2)).toBe(true);
    expect(isTaggedP3(v4)).toBe(true);
    expect(isTaggedP3(new TextEncoder().encode('....sRGB IEC61966-2.1....'))).toBe(false);
    // The fixtures: the P3 photo carries a profile the check finds; the sRGB one does not.
    const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../e2e/fixtures/images/${name}`, import.meta.url)));
    expect(isTaggedP3(fixture('p3-red.jpg'))).toBe(true);
    expect(isTaggedP3(fixture('srgb.jpg'))).toBe(false);
  });
});

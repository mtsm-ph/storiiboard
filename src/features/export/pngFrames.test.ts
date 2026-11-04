import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import type { ExportTarget } from '../../core/storage/exportFiles';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot } from '../storyboard/board';
import type { SbdRecord } from '../../core/model/record';
import { missingWarning, pngFrames } from './pngFrames';
import type { ExportContext } from './registry';
import type { ExportScope } from './scope';

// The PNG export's naming, scope and stopping, without drawing: Node has no OffscreenCanvas, and what's drawn is the
// browser's to check (e2e/export.spec.ts). The stand-in says a frame's picture is missing when its shot is in
// `lostPictures`, as renderFrame does for a picture the file no longer holds (renderFrame.test.ts).
const drawn = vi.hoisted(() => ({ shots: [] as string[], lostPictures: new Set<string>() }));
vi.mock('./renderFrame', () => ({
  renderFrame: (_records: unknown, _file: unknown, shot: SbdRecord) => {
    drawn.shots.push(shot.id);
    return Promise.resolve({
      canvas: { convertToBlob: () => Promise.resolve(new Blob([new Uint8Array([137, 80, 78, 71])])) },
      pictureMissing: drawn.lostPictures.has(shot.id),
    });
  },
}));

describe('the PNG frames export', () => {
  let folder: TestFolder;
  let project: Project;
  const store = createProjectStore();
  beforeEach(async () => {
    folder = makeTestFolder();
    project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
    drawn.shots = [];
    drawn.lostPictures.clear();
  });
  afterEach(async () => {
    await store.getState().close();
    folder.remove();
  });

  async function scene(id: string, number: string, sortKey: string, frames: number) {
    await store.getState().apply([{ kind: 'create', record: { id, type: 'scene', parentId: project.projectId, sortKey, props: { number, name: '' } } }]);
    const shots: string[] = [];
    for (let i = 0; i < frames; i += 1) {
      const added = addShot(store.getState().records, project.projectId, id);
      await store.getState().apply(added.changes);
      shots.push(added.shotId);
    }
    return shots;
  }

  /** Runs the export into a list of names; `onWrite` sees each one as it's written. */
  async function exportFrames(scope: ExportScope, onWrite: (name: string) => void = () => undefined, signal = new AbortController().signal) {
    const names: string[] = [];
    const target: ExportTarget = {
      label: 'Bey County frames',
      write: (name) => {
        names.push(name);
        onWrite(name);
        return Promise.resolve();
      },
    };
    const context: ExportContext = {
      records: store.getState().records,
      projectId: project.projectId,
      title: 'Bey County',
      scope,
      file: project.file,
      target,
      progress: () => undefined,
      signal,
    };
    return { ...(await pngFrames.run(context)), names };
  }

  it('gives two live scenes with one number (an old file) a name each, so the export runs to the end', async () => {
    await scene('a', '4', 'V', 2);
    await scene('b', '4', 'W', 1);
    // The numbers as stored: both scenes call their frames 4A, 4B.
    const { what, names } = await exportFrames({ kind: 'project' });
    expect(names).toEqual(['SC004_4A.png', 'SC004_4B.png', 'SC004_4A (2).png']);
    expect(what).toBe('3 frames');
  });

  it('exports one scene alone when that is the scope', async () => {
    await scene('a', '4', 'V', 2);
    await scene('b', '12A', 'W', 1);
    const { what, names } = await exportFrames({ kind: 'scene', sceneId: 'b' });
    expect(names).toEqual(['SC012A_12AA.png']);
    expect(what).toBe('1 frame');
  });

  it('leaves out a trashed scene and a trashed frame: neither is drawn nor written', async () => {
    const [a1, a2] = await scene('a', '4', 'V', 3);
    await scene('b', '5', 'W', 1);
    await scene('c', '6', 'X', 1);
    await store.getState().apply([{ kind: 'trash', id: a2 ?? '' }]);
    await store.getState().apply([{ kind: 'trash', id: 'b' }]);
    const { what, names } = await exportFrames({ kind: 'project' });
    // Trashed as it stands, without closing up the letters (a scene whose numbers are locked), so 4B's name is the
    // trashed frame's own; scene 5 goes entirely.
    expect(names).toEqual(['SC004_4A.png', 'SC004_4C.png', 'SC006_6A.png']);
    expect(drawn.shots).not.toContain(a2);
    expect(drawn.shots).toContain(a1);
    expect(drawn.shots).toHaveLength(3);
    expect(what).toBe('3 frames');
  });

  it('names the frames whose picture is missing, so a blank one is never passed off as done', async () => {
    const [, b, c] = await scene('a', '4', 'V', 3);
    drawn.lostPictures.add(b ?? '').add(c ?? '');
    const { what, warning, names } = await exportFrames({ kind: 'project' });
    // Every frame still goes out, in order, so the sequence has no gaps.
    expect(names).toEqual(['SC004_4A.png', 'SC004_4B.png', 'SC004_4C.png']);
    expect(what).toBe('3 frames');
    expect(warning).toBe('2 have a missing picture: SC004_4B, SC004_4C.');
  });

  it('says nothing more when every picture is there', async () => {
    await scene('a', '4', 'V', 2);
    expect((await exportFrames({ kind: 'project' })).warning).toBeUndefined();
  });

  it('lists ten missing frames by name, then a count', () => {
    expect(missingWarning(['SC004_4A'])).toBe('1 has a missing picture: SC004_4A.');
    const twelve = Array.from({ length: 12 }, (_, i) => `SC001_1${String.fromCharCode(65 + i)}`);
    expect(missingWarning(twelve)).toBe(`12 have a missing picture: ${twelve.slice(0, 10).join(', ')} and 2 more.`);
  });

  it('stops between frames when the person stops it, keeping what it wrote', async () => {
    await scene('a', '4', 'V', 3);
    const stopper = new AbortController();
    const written: string[] = [];
    const run = exportFrames(
      { kind: 'project' },
      (name) => {
        written.push(name);
        stopper.abort();
      },
      stopper.signal,
    );
    await expect(run).rejects.toThrow(/abort/i);
    expect(written).toEqual(['SC004_4A.png']);
  });
});

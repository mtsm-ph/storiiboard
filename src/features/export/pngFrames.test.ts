import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import type { ExportTarget } from '../../core/storage/exportFiles';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { addShot } from '../storyboard/board';
import { pngFrames } from './pngFrames';
import type { ExportContext } from './registry';
import type { ExportScope } from './scope';

// The PNG export's naming, scope and stopping, without drawing: Node has no OffscreenCanvas, and what's drawn is the
// browser's to check (e2e/export.spec.ts).
vi.mock('./renderFrame', () => ({
  renderFrame: () => Promise.resolve({ convertToBlob: () => Promise.resolve(new Blob([new Uint8Array([137, 80, 78, 71])])) }),
}));

describe('the PNG frames export', () => {
  let folder: TestFolder;
  let project: Project;
  const store = createProjectStore();
  beforeEach(async () => {
    folder = makeTestFolder();
    project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
  });
  afterEach(async () => {
    await store.getState().close();
    folder.remove();
  });

  async function scene(id: string, number: string, sortKey: string, frames: number) {
    await store.getState().apply([{ kind: 'create', record: { id, type: 'scene', parentId: project.projectId, sortKey, props: { number, name: '' } } }]);
    for (let i = 0; i < frames; i += 1) await store.getState().apply(addShot(store.getState().records, project.projectId, id).changes);
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
    return { what: await pngFrames.run(context), names };
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

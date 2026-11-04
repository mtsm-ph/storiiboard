import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectStore } from '../../app/projectStore';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { exportStore, openExportDialog } from './exportStore';

// The shell's own project store, the one the export dialogs follow: another project opened in place closes them.

let folder: TestFolder;
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(async () => {
  await projectStore.getState().close();
  exportStore.setState({ open: null });
  folder.remove();
});

const create = (name: string) => createProject(folder.path(name), { driver: nodeDriver, backups: false });

describe('the export dialogs', () => {
  it('close when another project opens in place, rather than coming up again for it', async () => {
    await projectStore.getState().open(await create('Bey County.sbd'));
    for (const kind of ['watermark', 'export'] as const) {
      openExportDialog(kind);
      await projectStore.getState().open(await create(`Other ${kind}.sbd`));
      expect(exportStore.getState().open).toBeNull();
    }
  });

  it('close when the project closes, so none waits to come up with the next one', async () => {
    await projectStore.getState().open(await create('Bey County.sbd'));
    openExportDialog('watermark');
    await projectStore.getState().close();
    expect(exportStore.getState().open).toBeNull();
  });

  it('stay open through edits to the project they were opened for', async () => {
    const project = await create('Bey County.sbd');
    await projectStore.getState().open(project);
    openExportDialog('watermark');
    await projectStore.getState().apply([{ kind: 'update', id: project.projectId, set: { title: 'Bey County II' } }]);
    expect(exportStore.getState().open).toBe('watermark');
  });
});

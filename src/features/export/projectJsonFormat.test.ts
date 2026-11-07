import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';

// Project data (JSON) (2.9) as Export runs it: never a file the import would refuse. The estimate stands aside here
// (it says nothing is too large) and the limit is small, so the bytes themselves have to refuse it.

vi.mock('../../core/storage/projectJson', async (original) => ({
  ...(await original<typeof import('../../core/storage/projectJson')>()),
  MAX_IMPORT_CHARS: 1000,
  projectJsonSize: () => Promise.resolve(0),
}));

const { projectJsonFormat } = await import('./projectJsonFormat');

let folder: TestFolder;
let project: Project;
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
});
afterEach(async () => {
  await project.close();
  folder.remove();
});

describe('the project data export (2.9)', () => {
  it('refuses a JSON larger than an import takes, by its bytes, and writes nothing', async () => {
    const write = vi.fn(() => Promise.resolve());
    await expect(
      projectJsonFormat.run({
        records: {},
        projectId: project.projectId,
        title: 'Bey County',
        scope: { kind: 'project' },
        file: project.file,
        target: { label: 'x', write },
        progress: () => undefined,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/too large to export/);
    expect(write).not.toHaveBeenCalled();
  });
});

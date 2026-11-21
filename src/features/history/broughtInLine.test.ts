import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../core/i18n';
import { bringInChangeFile } from '../../core/ops/suggestions';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { loadSteps } from './steps';
import { lineText } from './summary';

// A change file brought in, in History (7.1): "Brought in 3 suggestions from Robin Vale", the name as text from the
// records it made; only the count when the authors don't share one. Made-up people only.

const FILE = '8d0f3c52-5a0e-4c47-9a7e-2b1f0c6e9a11';
const id = (n: number) => `f2b7a1c0-0000-4c47-9a7e-${String(n).padStart(12, '0')}`;

let folder: TestFolder;
let project: Project;

const file = (people: { id: string; name: string }[], authors: string[]): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({
      format: 'storiiboard.changes',
      version: 1,
      id: FILE,
      project_id: project.projectId,
      people: people.map((p) => ({ ...p, role: 'dp' })),
      suggestions: authors.map((author, i) => ({ id: id(i), kind: 'trash', target: { id: 'b', type: 'shot', label: '4B' }, author, data: {} })),
    }),
  );

const newest = async () => lineText((await loadSteps(project.file, 1)).steps[0]?.line ?? []);

beforeEach(async () => {
  setLocale('en');
  folder = makeTestFolder();
  project = await createProject(folder.path('Harbor Lights.sbd'), { driver: nodeDriver, backups: false });
});

afterEach(async () => {
  setLocale('en');
  await project.close();
  folder.remove();
});

describe('a change file brought in, in History (7.1)', () => {
  it('names the authors when they share a name, as text', async () => {
    await bringInChangeFile(project.file, project.projectId, file([{ id: 'r1', name: 'Robin Vale‮' }], ['r1', 'r1', 'r1']));
    expect(await newest()).toBe('Brought in 3 suggestions from Robin Vale');
    setLocale('es');
    expect(await newest()).toBe('Se incorporaron 3 sugerencias de Robin Vale');
  });

  it('says only how many when they don’t, and one in the singular', async () => {
    await bringInChangeFile(project.file, project.projectId, file([{ id: 'r1', name: 'Robin Vale' }, { id: 'r2', name: 'Ana Ruiz' }], ['r1', 'r2']));
    expect(await newest()).toBe('Brought in 2 suggestions');
  });

  it('one suggestion with no author', async () => {
    await bringInChangeFile(project.file, project.projectId, file([], ['nobody']));
    expect(await newest()).toBe('Brought in 1 suggestion');
  });
});

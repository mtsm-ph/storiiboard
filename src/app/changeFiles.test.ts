import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../core/i18n';
import { nodeDriver } from '../core/storage/nodeDriver';
import { createProject, type Project } from '../core/storage/project';
import { makeTestFolder, type TestFolder } from '../core/storage/testFolder';
import { bringInBytes, isChangeFileName, outcomeWords } from './changeFiles';
import { projectStore } from './projectStore';

// Change files in, as the app runs them (7.1): read and checked, then one op group in the store's queue, into the
// project it was asked for only; the status line's words for each outcome. Made-up people only: Robin Vale.

const FILE = '8d0f3c52-5a0e-4c47-9a7e-2b1f0c6e9a11';
const id = (n: number) => `f2b7a1c0-0000-4c47-9a7e-${String(n).padStart(12, '0')}`;

let folder: TestFolder;
let project: Project;

const bytes = (projectId: string, ids: readonly string[]) =>
  new TextEncoder().encode(
    JSON.stringify({
      format: 'storiiboard.changes',
      version: 1,
      id: FILE,
      project_id: projectId,
      project_name: 'Harbor Lights',
      people: [{ id: 'r1', name: 'Robin Vale', role: 'dp' }],
      suggestions: ids.map((sid) => ({ id: sid, kind: 'trash', target: { id: 'b', type: 'shot', label: '4B' }, author: 'r1', data: {} })),
    }),
  );

beforeEach(async () => {
  setLocale('en');
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await projectStore.getState().open(project);
});

afterEach(async () => {
  await projectStore.getState().close();
  folder.remove();
});

const suggestions = () => Object.values(projectStore.getState().records).filter((r) => r.type === 'suggestion');

describe('change files in, in the app (7.1)', () => {
  it('brings a file in through the store, then says it is already in', async () => {
    const first = await bringInBytes(project, bytes(project.projectId, [id(1), id(2)]));
    expect(first.kind).toBe('added');
    expect(outcomeWords(first)).toBe('Brought in 2 suggestions from Robin Vale.');
    expect(suggestions()).toHaveLength(2);
    expect(projectStore.getState().canUndo).toBe(true);

    const again = await bringInBytes(project, bytes(project.projectId, [id(1), id(2)]));
    expect(again.kind).toBe('already');
    expect(outcomeWords(again)).toBe('Already brought in: every suggestion in this change file is in the project.');

    await projectStore.getState().undo();
    expect(suggestions()).toHaveLength(0);
  });

  it('refuses a file for another project with its words, named by its file from the folder', async () => {
    const other = await bringInBytes(project, bytes('6f1c0d2e-8a4b-4c3d-9e2f-1a0b9c8d7e6f', [id(1)]));
    expect(outcomeWords(other)).toBe('This change file is for another project, Harbor Lights.');
    expect(outcomeWords(other, 'Robin‮.sbdchanges')).toBe('Robin.sbdchanges: This change file is for another project, Harbor Lights.');
    expect(suggestions()).toHaveLength(0);
  });

  it('writes nothing into a project other than the one it was asked for', async () => {
    const elsewhere = await createProject(folder.path('Harbor Lights.sbd'), { driver: nodeDriver, backups: false });
    const outcome = await bringInBytes(elsewhere, bytes(elsewhere.projectId, [id(1)]));
    expect(outcome.kind).toBe('not_written');
    expect(suggestions()).toHaveLength(0);
    await elsewhere.close();
  });

  it('says how many it left out when an id is another item’s', () => {
    const words = outcomeWords({ kind: 'added', broughtIn: { changes: [], added: 1, already: 0, taken: 1, authorName: null } });
    expect(words).toBe('Brought in 1 suggestion. 1 suggestion was left out: an item in the project already has its id.');
    setLocale('es');
    expect(outcomeWords({ kind: 'already', broughtIn: { changes: [], added: 0, already: 2, taken: 0, authorName: null } })).toBe(
      'Ya se incorporó: cada sugerencia de este archivo de cambios ya está en el proyecto.',
    );
  });

  it('knows a change file by its name, whatever its case', () => {
    expect(isChangeFileName('Robin Vale.sbdchanges')).toBe(true);
    expect(isChangeFileName('ROBIN.SBDCHANGES')).toBe(true);
    expect(isChangeFileName('still.jpg')).toBe(false);
    expect(isChangeFileName('notes.sbdchanges.txt')).toBe(false);
  });
});

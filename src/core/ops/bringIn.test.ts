import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import type { JsonValue } from '../model/record';
import { nodeDriver } from '../storage/nodeDriver';
import { createProject, type Project } from '../storage/project';
import { makeTestFolder, type TestFolder } from '../storage/testFolder';
import { apply, getRecord, loadRecords, log, undo } from './ops';
import { bringInChangeFile } from './suggestions';

// Bringing a change file in (7.1): one op group of suggestion records under the project, which one undo removes; the
// same file again adds nothing and writes no op; a file sharing ids adds only what's new; an id another record has is
// left out, that record untouched. Made-up projects and people only: "Harbor Lights", Robin Vale.

const FILE_A = '8d0f3c52-5a0e-4c47-9a7e-2b1f0c6e9a11';
const FILE_B = '8d0f3c52-5a0e-4c47-9a7e-2b1f0c6e9a22';
const id = (n: number) => `f2b7a1c0-0000-4c47-9a7e-${String(n).padStart(12, '0')}`;

let folder: TestFolder;
let project: Project;

const changeFile = (fileId: string, ids: readonly string[], extra: Record<string, JsonValue> = {}): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({
      format: 'storiiboard.changes',
      version: 1,
      id: fileId,
      project_id: project.projectId,
      created_by: 'mcp',
      people: [{ id: 'r1', name: 'Robin Vale', role: 'dp' }],
      suggestions: ids.map((sid) => ({ id: sid, kind: 'trash', target: { id: 'b', type: 'shot', label: 'SC 04 · 4B' }, author: 'r1', data: {} })),
      ...extra,
    }),
  );

const suggestions = async () => (await loadRecords(project.file)).filter((r) => r.type === 'suggestion');

beforeEach(async () => {
  setLocale('en');
  folder = makeTestFolder();
  project = await createProject(folder.path('Harbor Lights.sbd'), { driver: nodeDriver, backups: false });
});

afterEach(async () => {
  await project.close();
  folder.remove();
});

describe('bringing a change file in (7.1)', () => {
  it('is one op group of pending suggestions under the project, and one undo removes them', async () => {
    const groups = (await log(project.file)).length;
    const result = await bringInChangeFile(project.file, project.projectId, changeFile(FILE_A, [id(1), id(2), id(3)]), { author: 'local' });
    expect(result).toMatchObject({ ok: true, broughtIn: { added: 3, already: 0, taken: 0, authorName: 'Robin Vale' } });
    expect((await log(project.file)).length).toBe(groups + 1);
    const made = await suggestions();
    expect(made.map((r) => r.id).sort()).toEqual([id(1), id(2), id(3)]);
    for (const record of made) {
      expect(record.parentId).toBe(project.projectId);
      expect(record.props).toMatchObject({ status: 'pending', source: 'mcp', change_file_id: FILE_A, author: { name: 'Robin Vale', role: 'dp' } });
    }
    // Placed one after another, each with a key of its own.
    expect(new Set(made.map((r) => r.sortKey)).size).toBe(3);

    await undo(project.file);
    expect(await suggestions()).toEqual([]);
  });

  it('adds nothing and writes no op for the same file twice', async () => {
    await bringInChangeFile(project.file, project.projectId, changeFile(FILE_A, [id(1), id(2)]));
    const groups = (await log(project.file)).length;
    const again = await bringInChangeFile(project.file, project.projectId, changeFile(FILE_A, [id(1), id(2)]));
    expect(again).toMatchObject({ ok: true, broughtIn: { added: 0, already: 2, changes: [] } });
    expect((await log(project.file)).length).toBe(groups);
    expect(await suggestions()).toHaveLength(2);
  });

  it('adds only the new ones from a second file sharing an id with the first', async () => {
    await bringInChangeFile(project.file, project.projectId, changeFile(FILE_A, [id(1), id(2)]));
    const first = await getRecord(project.file, id(2));
    const second = await bringInChangeFile(project.file, project.projectId, changeFile(FILE_B, [id(2), id(3)]));
    expect(second).toMatchObject({ ok: true, broughtIn: { added: 1, already: 1 } });
    expect((await suggestions()).map((r) => r.id).sort()).toEqual([id(1), id(2), id(3)]);
    // The one already in is as the first file left it.
    expect(await getRecord(project.file, id(2))).toEqual(first);
    expect((await getRecord(project.file, id(3)))?.props.change_file_id).toBe(FILE_B);
  });

  it('leaves out a suggestion whose id another record has, and never writes over that record', async () => {
    await apply(project.file, [{ kind: 'create', record: { id: id(9), type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4', name: 'Dock' } } }]);
    const scene = await getRecord(project.file, id(9));
    const result = await bringInChangeFile(project.file, project.projectId, changeFile(FILE_A, [id(9), id(1)]));
    expect(result).toMatchObject({ ok: true, broughtIn: { added: 1, taken: 1 } });
    expect(await getRecord(project.file, id(9))).toEqual(scene);
  });

  it('writes nothing for a file it refuses', async () => {
    const groups = (await log(project.file)).length;
    const other = await bringInChangeFile(project.file, project.projectId, changeFile(FILE_A, [id(1)], { project_id: '6f1c0d2e-8a4b-4c3d-9e2f-1a0b9c8d7e6f' }));
    expect(other).toEqual({ ok: false, refusal: { kind: 'other_project', projectName: '' } });
    expect((await log(project.file)).length).toBe(groups);
    expect(await suggestions()).toEqual([]);
  });
});

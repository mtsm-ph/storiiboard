import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apply, bringBack, getRecord, log, undo } from '../ops/ops';
import { nodeDriver } from './nodeDriver';
import { createProject, openProject, type Project } from './project';
import { importProjectJson, projectJsonBytes, readProjectJson } from './projectJson';
import { makeTestFolder, type TestFolder } from './testFolder';

// A bring_back step (item 7, Nov 20) in the JSON export: a Full archive writes op_groups rows as they are, so it comes
// back exactly; Project data leaves History out, as for every other kind.

let folder: TestFolder;
let project: Project;
const at = () => new Date('2026-11-20T12:00:00.000Z');

beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  const root = project.projectId;
  await apply(project.file, [{ kind: 'create', record: { id: 'sc4', type: 'scene', parentId: root, sortKey: 'V', props: { number: '4' } } }], { now: at });
  await apply(project.file, [{ kind: 'create', record: { id: '4A', type: 'shot', parentId: 'sc4', sortKey: 'V', props: { number: '4A', lens_mm: 35 } } }], { now: at });
  await apply(project.file, [{ kind: 'update', id: '4A', set: { lens_mm: 50 } }], { now: at });
  await undo(project.file, { now: at });
  await undo(project.file, { now: at });
  await bringBack(project.file, (await log(project.file)).at(-1)?.id ?? '', { now: at });
});
afterEach(async () => {
  await project.close();
  folder.remove();
});

const groupsOf = async (file: Project['file']) => file.query('SELECT * FROM op_groups ORDER BY seq');
const opsOf = async (file: Project['file']) => file.query('SELECT * FROM ops ORDER BY seq');

describe('a bring_back in the JSON export', () => {
  it('round-trips exactly in a Full archive, and the copy undoes it', async () => {
    const data = readProjectJson(new TextDecoder().decode(await projectJsonBytes(project.file, at())));
    const copy = folder.path('Copy.sbd');
    await importProjectJson(nodeDriver, copy, data, at());
    const opened = await openProject(copy, { driver: nodeDriver, backups: false });
    try {
      expect(await groupsOf(opened.file)).toEqual(await groupsOf(project.file));
      expect(await opsOf(opened.file)).toEqual(await opsOf(project.file));
      expect((await log(opened.file)).map((g) => g.kind)).toEqual(['edit', 'edit', 'edit', 'undo', 'undo', 'bring_back']);
      expect((await getRecord(opened.file, '4A'))?.props.lens_mm).toBe(50);
      await undo(opened.file);
      expect(await getRecord(opened.file, '4A')).toBeNull();
    } finally {
      await opened.close();
    }
  });

  it('is left out of Project data with the rest of History', async () => {
    const data = readProjectJson(new TextDecoder().decode(await projectJsonBytes(project.file, at(), undefined, undefined, 'project_data')));
    expect(data.tables.op_groups?.rows).toEqual([]);
    expect(data.tables.ops?.rows).toEqual([]);
  });
});

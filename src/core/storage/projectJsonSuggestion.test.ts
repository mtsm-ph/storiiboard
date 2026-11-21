import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apply } from '../ops/ops';
import { nodeDriver } from './nodeDriver';
import { createProject, type Project } from './project';
import { projectJsonBytes, readProjectJson } from './projectJson';
import { makeTestFolder, type TestFolder } from './testFolder';

// Project data keeps only the pictures what's left names (3.14); a suggestion's text came from a change file anyone can
// write (7.1 round 2), so a picture's hash in a suggestion never keeps that picture in the export. Made-up projects
// only: "Harbor Lights".

let folder: TestFolder;
let project: Project;
const at = () => new Date('2026-11-21T12:00:00.000Z');
const KEPT = 'a'.repeat(64);
const REMOVED = 'b'.repeat(64);

const picture = (id: string, sha256: string) => ({
  sql: `INSERT INTO media_files (id, sha256, mime, width, height, byte_size, color_space, created_at, updated_at, bytes)
    VALUES (?, ?, 'image/png', 4, 4, 4, 'srgb', ?, ?, ?)`,
  params: [id, sha256, at().toISOString(), at().toISOString(), new Uint8Array([1, 2, 3, 4])],
});

beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Harbor Lights.sbd'), { driver: nodeDriver, backups: false });
});
afterEach(async () => {
  await project.close();
  folder.remove();
});

describe('Project data and a suggestion naming a picture', () => {
  it('leaves out a picture only a suggestion names, and keeps one a record left names', async () => {
    const root = project.projectId;
    await project.file.tx([picture('m1', KEPT), picture('m2', REMOVED)]);
    await apply(project.file, [
      { kind: 'create', record: { id: 's1', type: 'shot', parentId: root, sortKey: 'V', props: { number: '4A', media_id: 'p1' } } },
      { kind: 'create', record: { id: 'p1', type: 'media', parentId: 's1', sortKey: 'V', props: { kind: 'image', file: KEPT } } },
      {
        kind: 'create',
        record: {
          id: 'g1',
          type: 'suggestion',
          parentId: root,
          sortKey: 'W',
          props: { kind: 'update', status: 'pending', note: `bring back ${REMOVED}`, data: { set: { file: REMOVED } } },
        },
      },
    ]);
    const data = readProjectJson(new TextDecoder().decode(await projectJsonBytes(project.file, at(), undefined, undefined, 'project_data')));
    const table = data.tables.media_files;
    const sha = table?.columns.indexOf('sha256') ?? -1;
    expect((table?.rows ?? []).map((row) => row[sha])).toEqual([KEPT]);
    // The suggestion itself is still in the export, as it is.
    const records = data.tables.records;
    const id = records?.columns.indexOf('id') ?? -1;
    expect((records?.rows ?? []).map((row) => row[id])).toContain('g1');
  });
});

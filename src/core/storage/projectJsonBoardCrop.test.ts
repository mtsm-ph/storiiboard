import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apply } from '../ops/ops';
import { nodeDriver } from './nodeDriver';
import { createProject, openProject, type Project } from './project';
import { importProjectJson, projectJsonBytes, readProjectJson } from './projectJson';
import { makeTestFolder, type TestFolder } from './testFolder';

// Project data as JSON (2.9) with what 6.5.7b writes on a board's picture: its `crop` (every decimal kept) and its
// border's `border`, `border_color` and `border_width`. Out and back with nothing lost.

let folder: TestFolder;
let project: Project;
const at = () => new Date('2026-11-16T12:00:00.000Z');

beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
});

afterEach(async () => {
  await project.close();
  folder.remove();
});

describe('a cropped, bordered board picture as JSON (6.5.7b)', () => {
  it('carries its crop and border out and back', async () => {
    const file = project.file;
    const root = project.projectId;
    const picture = { kind: 'picture', x: 140.25, y: 50, width: 320, height: 225, rotation: 30, crop: { x: 0.123457, y: 0, width: 0.8, height: 0.75 }, border: true, border_color: '#A35139', border_width: 7.5 };
    await apply(
      file,
      [
        { kind: 'create', record: { id: 'b1', type: 'board', parentId: root, sortKey: 'a', props: { kind: 'moodboard', name: 'Look' } } },
        { kind: 'create', record: { id: 'i1', type: 'board_item', parentId: 'b1', sortKey: 'a', props: picture } },
      ],
      { author: 'Kevin', now: at },
    );
    const data = readProjectJson(new TextDecoder().decode(await projectJsonBytes(file, at())));
    const copy = folder.path('Bey County (crop).sbd');
    await importProjectJson(nodeDriver, copy, data, at());
    const imported = await openProject(copy, { driver: nodeDriver, backups: false });
    try {
      const rows = await imported.file.query('SELECT id, type, parent_id, props FROM records ORDER BY id');
      expect(JSON.parse(String(rows.find((r) => r.id === 'i1')?.props))).toEqual(picture);
      expect(rows).toEqual(await file.query('SELECT id, type, parent_id, props FROM records ORDER BY id'));
    } finally {
      await imported.close();
    }
  });
});

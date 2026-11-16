import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apply } from '../ops/ops';
import { nodeDriver } from './nodeDriver';
import { createProject, openProject, type Project } from './project';
import { importProjectJson, projectJsonBytes, readProjectJson } from './projectJson';
import { makeTestFolder, type TestFolder } from './testFolder';

// Project data as JSON (2.9) with what 6.5.6 writes: a room's ceiling, a window's sill and top, a door's height, each in
// metres as typed in feet (every decimal kept). Out and back with nothing lost.

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

describe('heights as JSON (6.5.6)', () => {
  it('carries a ceiling, a sill, a top and a door’s height out and back', async () => {
    const file = project.file;
    const root = project.projectId;
    const room = { kind: 'room', name: 'Diner', ceiling_height_m: 2.4384 };
    const wall = { kind: 'wall', x: 0, y: -0.05, width: 4, height: 0.1, rotation: 0 };
    const window = { kind: 'window', wall_id: 'w1', along_m: 1, width_m: 1.2, sill_height_m: 0.9144, top_height_m: 2.1336 };
    const door = { kind: 'door', wall_id: 'w1', along_m: 3, width_m: 0.9, hinge: 'start', swing: 'left', height_m: 2.032 };
    await apply(
      file,
      [
        { kind: 'create', record: { id: 'room', type: 'plan', parentId: root, sortKey: 'a', props: room } },
        { kind: 'create', record: { id: 'w1', type: 'plan_item', parentId: 'room', sortKey: 'a', props: wall } },
        { kind: 'create', record: { id: 'win', type: 'plan_item', parentId: 'room', sortKey: 'b', props: window } },
        { kind: 'create', record: { id: 'door', type: 'plan_item', parentId: 'room', sortKey: 'c', props: door } },
      ],
      { author: 'Kevin', now: at },
    );
    const data = readProjectJson(new TextDecoder().decode(await projectJsonBytes(file, at())));
    const copy = folder.path('Bey County (heights).sbd');
    await importProjectJson(nodeDriver, copy, data, at());
    const imported = await openProject(copy, { driver: nodeDriver, backups: false });
    try {
      const rows = await imported.file.query('SELECT id, type, parent_id, props FROM records ORDER BY id');
      const row = (id: string) => rows.find((r) => r.id === id);
      expect(JSON.parse(String(row('room')?.props))).toEqual(room);
      expect(JSON.parse(String(row('win')?.props))).toEqual(window);
      expect(JSON.parse(String(row('door')?.props))).toEqual(door);
      const original = await file.query('SELECT id, type, parent_id, props FROM records ORDER BY id');
      expect(rows).toEqual(original);
    } finally {
      await imported.close();
    }
  });
});

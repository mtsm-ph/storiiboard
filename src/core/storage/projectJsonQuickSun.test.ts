import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apply } from '../ops/ops';
import { nodeDriver } from './nodeDriver';
import { createProject, openProject, type Project } from './project';
import { importProjectJson, projectJsonBytes, readProjectJson } from './projectJson';
import { makeTestFolder, type TestFolder } from './testFolder';

// Project data as JSON (2.9) with what 6.5.5 writes: a sun path's own place and date (every decimal kept), a location
// put on the map by pasted coordinates, and a `settings_preset` record (6.5.8's type, listed ahead of its UI). Out and
// back with nothing lost.

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

describe('quick sun and presets as JSON (6.5.5)', () => {
  it('carries a sun path’s own place and date, a pasted place and a settings preset out and back', async () => {
    const file = project.file;
    const root = project.projectId;
    const sun = { kind: 'sun', icon: 'lighting/sun-path', x: 1, y: 1, width: 0.8, height: 0.8, rotation: 0, time: '07:15', own_latitude: 40.86771234, own_longitude: -73.92125678, own_date: '2026-06-21' };
    const pasted = { name: 'Fort Tryon', status: 'tbd', latitude: 40.8677, longitude: -73.9212, map_name: '40.8677, -73.9212', map_moved: true };
    const preset = { name: 'Night exteriors', settings: { canvas_view: 'dark', grid: false, nested: { a: [1, 2.5, 'three'] } } };
    await apply(
      file,
      [
        { kind: 'create', record: { id: 'sc1', type: 'scene', parentId: root, sortKey: 'a', props: { number: '1' } } },
        { kind: 'create', record: { id: 'u1', type: 'setup', parentId: 'sc1', sortKey: 'a', props: { name: '' } } },
        { kind: 'create', record: { id: 'own1', type: 'plan', parentId: 'u1', sortKey: 'a', props: { kind: 'setup', name: '' } } },
        { kind: 'create', record: { id: 'sun1', type: 'plan_item', parentId: 'own1', sortKey: 'a', props: sun } },
        { kind: 'create', record: { id: 'loc1', type: 'location', parentId: root, sortKey: 'a', props: pasted } },
        { kind: 'create', record: { id: 'pre1', type: 'settings_preset', parentId: root, sortKey: 'a', props: preset } },
      ],
      { author: 'Kevin', now: at },
    );
    const data = readProjectJson(new TextDecoder().decode(await projectJsonBytes(file, at())));
    const copy = folder.path('Bey County (quick sun).sbd');
    await importProjectJson(nodeDriver, copy, data, at());
    const imported = await openProject(copy, { driver: nodeDriver, backups: false });
    try {
      const rows = await imported.file.query('SELECT id, type, parent_id, props FROM records ORDER BY id');
      const row = (id: string) => rows.find((r) => r.id === id);
      expect(JSON.parse(String(row('sun1')?.props))).toEqual(sun);
      expect(JSON.parse(String(row('loc1')?.props))).toEqual(pasted);
      expect(row('pre1')).toMatchObject({ type: 'settings_preset', parent_id: root });
      expect(JSON.parse(String(row('pre1')?.props))).toEqual(preset);
      const original = await file.query('SELECT id, type, parent_id, props FROM records ORDER BY id');
      expect(rows).toEqual(original);
    } finally {
      await imported.close();
    }
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { sceneFields } from '../../core/model/storyboard';
import { parseFountain } from '../../core/script/fountain';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { board, setSceneLocation } from '../storyboard/board';
import { importChanges, planImport } from './importScript';

const SCRIPT = parseFountain(`Title: Bey County

INT. DINER - NIGHT

MARY
We're closed.

TOM
Door was open.

EXT. COUNTY ROAD - DAY

A truck idles.

INT. DINER - MOMENTS LATER

mary's back.

MARY
Still here?

.FLASHBACK - THE BRIDGE

Water.
`);

let folder: TestFolder;
let project: Project;
const store = createProjectStore();
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await store.getState().open(project);
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const records = () => store.getState().records;
const scenes = () => board(records(), project.projectId).map((s) => sceneFields(s.record.props));
const named = (type: 'location' | 'character') =>
  Object.values(records())
    .filter((r) => r.type === type && r.trashedAt === null)
    .map((r) => r.props.name)
    .sort();
const runImport = () => store.getState().applyWith((now) => ({ changes: importChanges(now, project.projectId, planImport(now, project.projectId, SCRIPT)) }));

describe('a script import', () => {
  it('makes a scene shell for every scene, numbered in order, with its heading, length and speakers', async () => {
    await runImport();
    expect(scenes().map((s) => [s.number, s.intExt, s.name, s.dayNight])).toEqual([
      ['1', 'INT', 'DINER', 'NIGHT'],
      ['2', 'EXT', 'COUNTY ROAD', 'DAY'],
      ['3', 'INT', 'DINER — MOMENTS LATER', null],
      ['4', null, 'FLASHBACK - THE BRIDGE', null],
    ]);
    expect(scenes()[0]?.characters).toEqual(['MARY', 'TOM']);
    expect(scenes().every((s) => (s.pageEighths ?? 0) >= 1)).toBe(true);
  });

  it('creates each location and character once, links scenes to their place, and leaves a forced heading placeless', async () => {
    await runImport();
    expect(named('location')).toEqual(['COUNTY ROAD', 'DINER']);
    expect(named('character')).toEqual(['MARY', 'TOM']);
    const [first, , third, fourth] = scenes();
    expect(first?.locationId).not.toBeNull();
    expect(third?.locationId).toBe(first?.locationId);
    expect(fourth?.locationId).toBeNull();
  });

  it('is one edit: one undo takes the whole import back', async () => {
    await runImport();
    await store.getState().undo();
    expect(scenes()).toEqual([]);
    expect(named('location')).toEqual([]);
    expect(named('character')).toEqual([]);
  });

  it('reuses a location the project has by name, whatever its case, and skips scenes the board has by number', async () => {
    await store.getState().apply([
      { kind: 'create', record: { id: 'sc1', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '1', name: 'Cold open' } } },
    ]);
    await store.getState().applyWith((now) => ({ changes: setSceneLocation(now, project.projectId, 'sc1', 'Diner') }));
    const plan = planImport(records(), project.projectId, SCRIPT);
    expect(plan.scenes.map((s) => [s.number, s.exists])).toEqual([
      ['1', true],
      ['2', false],
      ['3', false],
      ['4', false],
    ]);
    expect(plan.locations).toEqual({ created: ['COUNTY ROAD'], linked: ['Diner'] });
    await runImport();
    // The board's own scene 1 is left as it was; the rest follow it.
    expect(scenes().map((s) => [s.number, s.name])).toEqual([
      ['1', 'Cold open'],
      ['2', 'COUNTY ROAD'],
      ['3', 'DINER — MOMENTS LATER'],
      ['4', 'FLASHBACK - THE BRIDGE'],
    ]);
    expect(named('location')).toEqual(['COUNTY ROAD', 'Diner']);
  });

  it('keeps the script’s own numbers, and numbers the rest after the highest one so far', () => {
    const script = parseFountain('INT. A - DAY #4A#\n\nEXT. B - DAY\n\nINT. C - DAY #12#\n\nEXT. D - NIGHT\n');
    expect(planImport(records(), project.projectId, script).scenes.map((s) => s.number)).toEqual(['4A', '5', '12', '13']);
  });

  it('counts scenes in the Trash as taken, so a restored one never shares a number', async () => {
    await store.getState().apply([
      { kind: 'create', record: { id: 'old', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '1' } } },
    ]);
    await store.getState().apply([{ kind: 'trash', id: 'old' }]);
    expect(planImport(records(), project.projectId, SCRIPT).scenes[0]).toMatchObject({ number: '1', exists: true });
  });
});

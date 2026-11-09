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
    // By id (3.13): the characters the import made, in the script's order.
    expect(scenes()[0]?.characterIds.map((id) => store.getState().records[id]?.props.name)).toEqual(['MARY', 'TOM']);
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
    // The board's scene 1 is another scene (its own name). The script prints no numbers, so its scenes are numbered
    // around the board's instead of being left out.
    expect(plan.scenes.map((s) => [s.number, s.status])).toEqual([
      ['2', 'new'],
      ['3', 'new'],
      ['4', 'new'],
      ['5', 'new'],
    ]);
    expect(plan.locations).toEqual({ created: ['COUNTY ROAD'], linked: ['Diner'] });
    await runImport();
    // The board's own scene 1 is left as it was; the script's follow it.
    expect(scenes().map((s) => [s.number, s.name])).toEqual([
      ['1', 'Cold open'],
      ['2', 'DINER'],
      ['3', 'COUNTY ROAD'],
      ['4', 'DINER — MOMENTS LATER'],
      ['5', 'FLASHBACK - THE BRIDGE'],
    ]);
    expect(named('location')).toEqual(['COUNTY ROAD', 'Diner']);
  });

  it('keeps every number the script prints, and numbers the rest between them as the board would', () => {
    const script = parseFountain('INT. A - DAY #4A#\n\nEXT. B - DAY\n\nINT. C - DAY #12#\n\nEXT. D - NIGHT\n');
    expect(planImport(records(), project.projectId, script).scenes.map((s) => s.number)).toEqual(['4A', '4B', '12', '13']);
    // An unnumbered scene before a printed 2 never takes the 2.
    const partly = parseFountain('INT. A - DAY #1#\n\nINT. B - DAY\n\nINT. C - DAY #2#\n');
    expect(planImport(records(), project.projectId, partly).scenes.map((s) => s.number)).toEqual(['1', '1A', '2']);
  });

  it('numbers a second copy of a printed number, or one that can’t be a scene number, and says why', () => {
    const script = parseFountain('INT. A - DAY #2#\n\nINT. B - DAY #2#\n\nINT. C - DAY #1-a#\n');
    const plan = planImport(records(), project.projectId, script).scenes;
    expect(plan.map((s) => s.number)).toEqual(['2', '2A', '1A']);
    expect(plan[1]?.note).toBe('The script prints 2 twice');
    expect(plan[2]?.note).toBeNull();
  });

  it('finds its own scenes when the same draft is imported again, and nothing else', async () => {
    await runImport();
    const again = planImport(records(), project.projectId, SCRIPT);
    expect(again.scenes.map((s) => s.status)).toEqual(['same', 'same', 'same', 'same']);
    expect(importChanges(records(), project.projectId, again)).toEqual([]);
  });

  it('imports an unnumbered script into a board with scenes of its own made by hand', async () => {
    await store.getState().apply([
      { kind: 'create', record: { id: 'mine', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '1' } } },
    ]);
    // Scene 1 is the person's own: every scene of the script comes in, numbered around it.
    expect(planImport(records(), project.projectId, SCRIPT).scenes.map((s) => [s.number, s.status])).toEqual([
      ['2', 'new'],
      ['3', 'new'],
      ['4', 'new'],
      ['5', 'new'],
    ]);
  });

  it('finds an unnumbered draft’s scenes again after they were numbered round hand-made ones', async () => {
    await store.getState().apply([
      { kind: 'create', record: { id: 'mine', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '1' } } },
    ]);
    await runImport();
    expect(planImport(records(), project.projectId, SCRIPT).scenes.map((s) => [s.number, s.status])).toEqual([
      ['2', 'same'],
      ['3', 'same'],
      ['4', 'same'],
      ['5', 'same'],
    ]);
  });

  it('leaves out a printed number the board has for another scene, rather than move it off the slate', async () => {
    await store.getState().apply([
      { kind: 'create', record: { id: 'mine', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4' } } },
    ]);
    const script = parseFountain('INT. A - DAY #4#\n\nINT. B - DAY #5#\n\nINT. C - DAY #12-14#\n');
    const plan = planImport(records(), project.projectId, script).scenes;
    expect(plan.map((s) => [s.number, s.status])).toEqual([
      ['4', 'taken'],
      ['5', 'new'],
      ['6', 'new'],
    ]);
    // Combined scenes aren't one number: numbered, with the reason.
    expect(plan[2]?.note).toBe('The script’s number “12-14” isn’t a scene number');
  });

  it('reuses a character the project has, whatever its case, and adds scenes after a trashed last one', async () => {
    await store.getState().apply([
      { kind: 'create', record: { id: 'ch', type: 'character', parentId: project.projectId, sortKey: 'V', props: { name: 'Mary' } } },
      { kind: 'create', record: { id: 'z', type: 'scene', parentId: project.projectId, sortKey: 'zz', props: { number: '90' } } },
    ]);
    await store.getState().apply([{ kind: 'trash', id: 'z' }]);
    expect(planImport(records(), project.projectId, SCRIPT).characters).toEqual({ created: ['TOM'], linked: ['Mary'] });
    await runImport();
    const keys = Object.values(records())
      .filter((r) => r.type === 'scene' && r.id !== 'z')
      .map((r) => r.sortKey);
    expect(keys.every((k) => k > 'zz')).toBe(true);
    // The scene lists the project's own Mary by id (3.13), and the Tom it made.
    const first = scenes()[0];
    expect(first?.characterIds[0]).toBe('ch');
    expect(first?.characterIds.map((id) => records()[id]?.props.name)).toEqual(['Mary', 'TOM']);
    // A scene without speakers has no list at all, as the upgrade leaves one.
    expect(Object.values(records()).filter((r) => r.type === 'scene' && r.id !== 'z' && sceneFields(r.props).characterIds.length === 0).every((r) => !('character_ids' in r.props))).toBe(true);
  });

  it('is worked out again when it lands, so an edit made after the preview isn’t undone by it', async () => {
    const preview = planImport(records(), project.projectId, SCRIPT);
    expect(preview.scenes[0]?.status).toBe('new');
    // Scene 1 made by hand while the preview was open.
    await store.getState().apply([
      { kind: 'create', record: { id: 'mine', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '1', name: 'Mine' } } },
    ]);
    await runImport();
    expect(scenes().filter((s) => s.number === '1').map((s) => s.name)).toEqual(['Mine']);
  });

  it('counts scenes in the Trash as taken, so a restored one never shares a number', async () => {
    await store.getState().apply([
      { kind: 'create', record: { id: 'old', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '1' } } },
    ]);
    await store.getState().apply([{ kind: 'trash', id: 'old' }]);
    // A printed number in the Trash is left out; an unnumbered scene passes over it.
    expect(planImport(records(), project.projectId, SCRIPT).scenes[0]).toMatchObject({ number: '2', status: 'new' });
    const printed = parseFountain('INT. DINER - NIGHT #1#\n');
    expect(planImport(records(), project.projectId, printed).scenes[0]).toMatchObject({ number: '1', status: 'trashed' });
  });
});

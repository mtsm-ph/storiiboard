import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { moveItem } from '../../features/storyboard/board';
import { setLocale } from '../i18n';
import type { Change } from '../ops/ops';
import { nodeDriver } from '../storage/nodeDriver';
import { createProject, type Project } from '../storage/project';
import { makeTestFolder, type TestFolder } from '../storage/testFolder';
import type { Props, SbdRecord } from './record';
import {
  addSetup,
  frameSetup,
  frameSetupId,
  framesWithoutSetup,
  joinSetup,
  leaveSetup,
  moveSetup,
  newSetupFromFrames,
  renameSetup,
  sceneSetups,
  setupFrames,
  setupLabel,
  sharedScene,
  trashSetup,
} from './setup';

// Setups (6.0, docs/PHASE6_DECISIONS.md 3): numbered within the scene by their order, never lettered, those in the Trash
// skipped; one reader of a frame's `setup_id`; and the edits, each one op group that one undo takes back.

const at = '2026-11-13T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id, trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));

const base = () =>
  recordsOf(
    record('p', 'project', null, {}),
    record('s1', 'scene', 'p', { number: '1' }, 'a'),
    record('s2', 'scene', 'p', { number: '2' }, 'b'),
    record('u1', 'setup', 's1', { name: '' }, 'a'),
    record('u2', 'setup', 's1', { name: 'Window side' }, 'b', at),
    record('u3', 'setup', 's1', { name: ' Door ' }, 'c'),
    record('v1', 'setup', 's2', { name: '' }, 'a'),
    record('a', 'shot', 's1', { number: '1A', setup_id: 'u1' }, 'a'),
    record('b', 'shot', 's1', { number: '1B', setup_id: 'u2' }, 'b'),
    record('c', 'shot', 's1', { number: '1C', setup_id: 'v1' }, 'c'),
    record('d', 'shot', 's1', { number: '1D', setup_id: 'nothing' }, 'd'),
    record('e', 'shot', 's1', { number: '1E' }, 'e'),
    record('f', 'shot', 's1', { number: '1F', setup_id: 'u1' }, 'f'),
    record('g', 'shot', 's2', { number: '2A' }, 'a'),
  );

afterEach(() => {
  setLocale('en');
});

describe('setups', () => {
  it('are numbered within their scene by order, skipping those in the Trash, and never lettered', () => {
    const records = base();
    expect(sceneSetups(records, 's1').map((s) => [s.record.id, s.number, s.fields.name])).toEqual([
      ['u1', 1, ''],
      ['u3', 2, 'Door'],
    ]);
    expect(sceneSetups(records, 's2').map((s) => s.number)).toEqual([1]);
    const [first, second] = sceneSetups(records, 's1');
    if (!first || !second) throw new Error('two setups');
    expect(setupLabel(first)).toBe('Setup 1');
    expect(setupLabel(second)).toBe('Setup 2 · Door');
    // Restored, the trashed one takes its place back and the one after it follows.
    const restored = { ...records, u2: { ...(records.u2 as SbdRecord), trashedAt: null } };
    expect(sceneSetups(restored, 's1').map((s) => [s.record.id, s.number])).toEqual([
      ['u1', 1],
      ['u2', 2],
      ['u3', 3],
    ]);
    setLocale('es');
    expect(setupLabel(second)).toBe('Emplazamiento 2 · Door');
  });

  it('read a frame’s setup_id one way: a live setup in its scene, else none (another scene’s, trashed or missing)', () => {
    const records = base();
    const of = (id: string) => frameSetupId(records, records[id] as SbdRecord);
    expect(of('a')).toBe('u1');
    // In the Trash.
    expect(of('b')).toBeNull();
    // Another scene's setup.
    expect(of('c')).toBeNull();
    // An id that names nothing, and none at all.
    expect(of('d')).toBeNull();
    expect(of('e')).toBeNull();
    expect(frameSetup(records, records.a as SbdRecord)?.number).toBe(1);
    expect(setupFrames(records, 'u1').map((r) => r.id)).toEqual(['a', 'f']);
    expect(setupFrames(records, 'u2')).toEqual([]);
    expect(framesWithoutSetup(records, 's1').map((r) => r.id)).toEqual(['b', 'c', 'd', 'e']);
  });

  it('are added at the end, after those in the Trash, and renamed only to something new', () => {
    const records = base();
    const [made] = addSetup(records, 's1', 'new');
    expect(made).toMatchObject({ kind: 'create', record: { id: 'new', type: 'setup', parentId: 's1', props: { name: '' } } });
    expect(made?.kind === 'create' && made.record.sortKey > 'c').toBe(true);
    expect(addSetup(records, 'nowhere')).toEqual([]);
    expect(renameSetup(records, 'u1', '  Window side ')).toEqual([{ kind: 'update', id: 'u1', set: { name: 'Window side' } }]);
    expect(renameSetup(records, 'u3', 'Door')).toEqual([]);
    expect(renameSetup(records, 'u3', '')).toEqual([{ kind: 'update', id: 'u3', set: { name: '' } }]);
    expect(renameSetup(records, 'u2', 'x')).toEqual([]);
  });

  it('reorder among the live ones, never landing on a key one in the Trash has', () => {
    const records = base();
    const [move] = moveSetup(records, 'u3', 0);
    expect(move).toMatchObject({ kind: 'move', id: 'u3', parentId: 's1' });
    const key = move?.kind === 'move' ? move.sortKey : '';
    expect(key < 'a').toBe(true);
    const moved = { ...records, u3: { ...(records.u3 as SbdRecord), sortKey: key } };
    expect(sceneSetups(moved, 's1').map((s) => s.record.id)).toEqual(['u3', 'u1']);
    // Down past u1: right after it, before the trashed u2.
    const [down] = moveSetup(moved, 'u3', 1);
    const downKey = down?.kind === 'move' ? down.sortKey : '';
    expect(downKey > 'a' && downKey < 'b').toBe(true);
    expect(moveSetup(records, 'u1', 0)).toEqual([]);
    expect(moveSetup(records, 'u2', 0)).toEqual([]);
  });

  it('take frames in and out, only frames of the setup’s scene, and make one from frames of one scene', () => {
    const records = base();
    expect(joinSetup(records, ['e', 'g', 'a', 'e'], 'u3')).toEqual([
      { kind: 'update', id: 'e', set: { setup_id: 'u3' } },
      { kind: 'update', id: 'a', set: { setup_id: 'u3' } },
    ]);
    expect(joinSetup(records, ['e'], 'u2')).toEqual([]);
    // Only frames that read as in one: a frame whose setup is in the Trash keeps its id for the restore.
    expect(leaveSetup(records, ['a', 'b', 'e'])).toEqual([{ kind: 'update', id: 'a', unset: ['setup_id'] }]);
    expect(sharedScene(records, ['a', 'e'])).toBe('s1');
    expect(sharedScene(records, ['a', 'g'])).toBeNull();
    expect(newSetupFromFrames(records, ['a', 'g'])).toEqual([]);
    const changes = newSetupFromFrames(records, ['e', 'a'], 'n');
    expect(changes.map((c) => c.kind)).toEqual(['create', 'update', 'update']);
    expect(changes.slice(1)).toEqual([
      { kind: 'update', id: 'e', set: { setup_id: 'n' } },
      { kind: 'update', id: 'a', set: { setup_id: 'n' } },
    ]);
    expect(trashSetup(records, 'u1')).toEqual([{ kind: 'trash', id: 'u1' }]);
    expect(trashSetup(records, 'u2')).toEqual([]);
  });
});

describe('setups in a project', () => {
  let folder: TestFolder;
  let project: Project;
  let store = createProjectStore();
  const records = () => store.getState().records;
  const apply = (build: (now: Readonly<Record<string, SbdRecord>>) => Change[]) => store.getState().applyWith((now) => ({ changes: build(now) }));

  beforeEach(async () => {
    folder = makeTestFolder();
    project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    store = createProjectStore();
    await store.getState().open(project);
    const p = project.projectId;
    await store.getState().apply([
      { kind: 'create', record: { id: 'sc1', type: 'scene', parentId: p, sortKey: 'a', props: { number: '1', name: 'Diner' } } },
      { kind: 'create', record: { id: 'sc2', type: 'scene', parentId: p, sortKey: 'b', props: { number: '2', name: 'Street' } } },
      { kind: 'create', record: { id: 'f1', type: 'shot', parentId: 'sc1', sortKey: 'a', props: { number: '1A', status: 'need' } } },
      { kind: 'create', record: { id: 'f2', type: 'shot', parentId: 'sc1', sortKey: 'b', props: { number: '1B', status: 'need' } } },
      { kind: 'create', record: { id: 'f3', type: 'shot', parentId: 'sc2', sortKey: 'a', props: { number: '2A', status: 'need' } } },
    ]);
  });
  afterEach(async () => {
    await store.getState().close();
    folder.remove();
  });

  it('makes each edit one step that one undo takes back', async () => {
    await apply((now) => addSetup(now, 'sc1', 'x1'));
    await apply((now) => addSetup(now, 'sc1', 'x2'));
    await apply((now) => renameSetup(now, 'x2', 'Window side'));
    await apply((now) => joinSetup(now, ['f1', 'f2'], 'x2'));
    expect(setupFrames(records(), 'x2').map((r) => r.id)).toEqual(['f1', 'f2']);
    await apply((now) => moveSetup(now, 'x2', 0));
    expect(sceneSetups(records(), 'sc1').map((s) => [s.record.id, s.number])).toEqual([
      ['x2', 1],
      ['x1', 2],
    ]);
    await store.getState().undo();
    expect(sceneSetups(records(), 'sc1').map((s) => s.record.id)).toEqual(['x1', 'x2']);
    await apply((now) => leaveSetup(now, ['f1']));
    expect(setupFrames(records(), 'x2').map((r) => r.id)).toEqual(['f2']);
    await store.getState().undo();
    expect(setupFrames(records(), 'x2').map((r) => r.id)).toEqual(['f1', 'f2']);
    // Deleted: its frames keep their id but read as no setup; undo brings it, and them, back.
    await apply((now) => trashSetup(now, 'x2'));
    expect(frameSetupId(records(), records().f1 as SbdRecord)).toBeNull();
    expect(records().f1?.props.setup_id).toBe('x2');
    await store.getState().undo();
    expect(setupFrames(records(), 'x2').map((r) => r.id)).toEqual(['f1', 'f2']);
    await store.getState().undo();
    expect(setupFrames(records(), 'x2')).toEqual([]);
    await store.getState().undo();
    expect(nameOf(records().x2)).toBe('');
    await store.getState().undo();
    expect(sceneSetups(records(), 'sc1').map((s) => s.record.id)).toEqual(['x1']);
    await apply((now) => newSetupFromFrames(now, ['f1', 'f2'], 'n'));
    expect(setupFrames(records(), 'n').map((r) => r.id)).toEqual(['f1', 'f2']);
    await store.getState().undo();
    expect(records().n).toBeUndefined();
    expect(frameSetupId(records(), records().f1 as SbdRecord)).toBeNull();
  });

  it('takes a frame out of its setup when it moves to another scene, in the same step', async () => {
    await apply((now) => newSetupFromFrames(now, ['f1'], 'x'));
    const p = project.projectId;
    const changes = moveItem(records(), p, 'f1', 'sc2', null);
    expect(changes).toContainEqual({ kind: 'update', id: 'f1', unset: ['setup_id'] });
    await store.getState().applyWith((now, slate) => ({ changes: moveItem(now, p, 'f1', 'sc2', null, slate) }));
    expect(records().f1?.parentId).toBe('sc2');
    expect(records().f1?.props.setup_id).toBeUndefined();
    await store.getState().undo();
    expect(records().f1?.parentId).toBe('sc1');
    expect(frameSetupId(records(), records().f1 as SbdRecord)).toBe('x');
    // Within its own scene it stays in its setup.
    expect(moveItem(records(), p, 'f1', 'sc1', null).some((c) => c.kind === 'update' && c.unset?.includes('setup_id'))).toBe(false);
  });
});

const nameOf = (record: SbdRecord | undefined) => (typeof record?.props.name === 'string' ? record.props.name : null);

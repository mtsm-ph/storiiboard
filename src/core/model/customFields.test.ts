import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { addShot, setCustomField } from '../../features/storyboard/board';
import { nodeDriver } from '../storage/nodeDriver';
import { createProject, type Project } from '../storage/project';
import { makeTestFolder, type TestFolder } from '../storage/testFolder';
import { customFieldNames, customFieldsOf, customValue, fieldName, MAX_FIELD_NAME, withField, withoutField } from './customFields';
import type { SbdRecord } from './record';

const shot = (id: string, custom: unknown, trashed = false): SbdRecord =>
  ({ id, type: 'shot', parentId: 'sc', sortKey: id, props: { custom }, trashedAt: trashed ? 'now' : null }) as unknown as SbdRecord;

describe('custom fields', () => {
  it('reads a shot’s fields as text, leaving out anything else', () => {
    expect(customFieldsOf({ custom: { Drone: 'Mavic 3', VFX: 2, Budget: '' } })).toEqual({ Drone: 'Mavic 3', Budget: '' });
    expect(customFieldsOf({ custom: ['Drone'] })).toEqual({});
    expect(customFieldsOf({})).toEqual({});
  });

  it('lists the names the project’s live shots use, once each whatever the case, in the spelling most of them use', () => {
    const records = {
      a: shot('a', { vfx: 'plate', Drone: '' }),
      b: shot('b', { VFX: 'clean', Budget: '$' }),
      d: shot('d', { VFX: 'sky' }),
      c: shot('c', { Gone: 'x' }, true),
    };
    expect(customFieldNames(records)).toEqual(['Budget', 'Drone', 'VFX']);
    // A tie goes the same way whichever shot comes first, so editing one never flips a column.
    expect(customFieldNames({ a: shot('a', { vfx: '' }), b: shot('b', { VFX: '' }) })).toEqual(['VFX']);
    expect(customFieldNames({ b: shot('b', { VFX: '' }), a: shot('a', { vfx: '' }) })).toEqual(['VFX']);
  });

  it('reads a frame’s value for the project’s field whatever case the frame spells it in', () => {
    expect(customValue({ vfx: 'clean' }, 'VFX')).toBe('clean');
    expect(customValue({ Drone: 'yes' }, 'VFX')).toBe('');
  });

  it('tidies a typed name, takes the project’s spelling of one it already has, and refuses the frame’s own fields', () => {
    expect(fieldName('  drone   shot ', ['Drone shot'])).toEqual({ ok: true, name: 'Drone shot' });
    expect(fieldName('Budget', [])).toEqual({ ok: true, name: 'Budget' });
    // Names an object already has are names like any other.
    expect(fieldName('constructor', [])).toEqual({ ok: true, name: 'constructor' });
    expect(fieldName('   ', [])).toMatchObject({ ok: false });
    expect(fieldName('x'.repeat(MAX_FIELD_NAME + 1), [])).toMatchObject({ ok: false });
    for (const builtIn of ['Status', 'status', 'Lens (mm)', 'Dialogue', 'New field']) {
      expect(fieldName(builtIn, [])).toEqual({ ok: false, problem: `${builtIn} is one of the frame’s own fields. Choose another name.` });
    }
  });

  it('sets one field in the frame’s own spelling and keeps the rest, text or not; taking off the last one takes the prop off', () => {
    expect(withField({ custom: { Drone: 'yes' } }, 'VFX', 'plate')).toEqual({ set: { custom: { Drone: 'yes', VFX: 'plate' } } });
    expect(withField({ custom: { vfx: 'plate' } }, 'VFX', 'clean')).toEqual({ set: { custom: { vfx: 'clean' } } });
    // A later version or a hand edit may keep more than text there; an edit never drops it.
    expect(withField({ custom: { Takes: 3, Drone: 'x' } }, 'Drone', 'y')).toEqual({ set: { custom: { Takes: 3, Drone: 'y' } } });
    expect(withoutField({ custom: { Takes: 3, Drone: 'x' } }, 'Drone')).toEqual({ set: { custom: { Takes: 3 } } });
    expect(withField({ custom: { Takes: 3 } }, 'takes', '')).toEqual({ set: { custom: { Takes: 3, takes: '' } } });
    expect(withoutField({ custom: { Drone: 'yes', VFX: 'plate' } }, 'Drone')).toEqual({ set: { custom: { VFX: 'plate' } } });
    expect(withoutField({ custom: { Drone: 'yes' } }, 'Drone')).toEqual({ unset: ['custom'] });
  });
});

describe('custom fields in a project', () => {
  let folder: TestFolder;
  let project: Project;
  const store = createProjectStore();
  let shotId = '';
  beforeEach(async () => {
    folder = makeTestFolder();
    project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    await store.getState().open(project);
    await store.getState().apply([
      { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4' } } },
    ]);
    const added = addShot(store.getState().records, project.projectId, 'sc4');
    shotId = added.shotId;
    await store.getState().apply(added.changes);
  });
  afterEach(async () => {
    await store.getState().close();
    folder.remove();
  });

  // As the inspector does it: worked out from the records the edit lands on.
  const set = (name: string, value: string | null) => store.getState().applyWith((now) => ({ changes: setCustomField(now, shotId, name, value) }));
  const fields = () => customFieldsOf(store.getState().records[shotId]?.props ?? {});

  it('keeps two fields added quickly, each an edit of its own that undo takes back in turn', async () => {
    await Promise.all([set('Drone', 'Mavic 3'), set('VFX', 'sky replace')]);
    expect(fields()).toEqual({ Drone: 'Mavic 3', VFX: 'sky replace' });
    await store.getState().undo();
    expect(fields()).toEqual({ Drone: 'Mavic 3' });
    await set('Drone', null);
    expect(store.getState().records[shotId]?.props).not.toHaveProperty('custom');
    await store.getState().undo();
    expect(fields()).toEqual({ Drone: 'Mavic 3' });
    await store.getState().redo();
    expect(store.getState().records[shotId]?.props).not.toHaveProperty('custom');
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { addShot } from '../../features/storyboard/board';
import { nodeDriver } from '../storage/nodeDriver';
import { createProject, type Project } from '../storage/project';
import { makeTestFolder, type TestFolder } from '../storage/testFolder';
import { customFieldNames, customFieldsOf, fieldName, MAX_FIELD_NAME, withField, withoutField } from './customFields';
import type { SbdRecord } from './record';

const shot = (id: string, custom: unknown, trashed = false): SbdRecord =>
  ({ id, type: 'shot', parentId: 'sc', sortKey: id, props: { custom }, trashedAt: trashed ? 'now' : null }) as unknown as SbdRecord;

describe('custom fields', () => {
  it('reads a shot’s fields as text, leaving out anything else', () => {
    expect(customFieldsOf({ custom: { Drone: 'Mavic 3', VFX: 2, Budget: '' } })).toEqual({ Drone: 'Mavic 3', Budget: '' });
    expect(customFieldsOf({ custom: ['Drone'] })).toEqual({});
    expect(customFieldsOf({})).toEqual({});
  });

  it('lists the names the project’s live shots use, once each whatever the case, in the spelling met first', () => {
    const records = {
      a: shot('a', { VFX: 'plate', Drone: '' }),
      b: shot('b', { vfx: 'clean', Budget: '$' }),
      c: shot('c', { Gone: 'x' }, true),
    };
    expect(customFieldNames(records)).toEqual(['Budget', 'Drone', 'VFX']);
  });

  it('tidies a typed name and takes the project’s spelling of one it already has', () => {
    expect(fieldName('  drone   shot ', ['Drone shot'])).toBe('Drone shot');
    expect(fieldName('Budget', [])).toBe('Budget');
    expect(fieldName('   ', [])).toBeNull();
    expect(fieldName('x'.repeat(MAX_FIELD_NAME + 1), [])).toBeNull();
  });

  it('sets one field and keeps the rest; taking off the last one takes the prop off too', () => {
    expect(withField({ custom: { Drone: 'yes' } }, 'VFX', 'plate')).toEqual({ set: { custom: { Drone: 'yes', VFX: 'plate' } } });
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

  const set = (name: string, value: string | null) =>
    store.getState().applyWith((now) => {
      const props = now[shotId]?.props ?? {};
      return { changes: [{ kind: 'update', id: shotId, ...(value === null ? withoutField(props, name) : withField(props, name, value)) }] };
    });
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
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { departmentStates, departmentStatesText, departmentStatuses, stateCounts } from '../core/model/departmentStatus';
import { log } from '../core/ops/ops';
import { migrate } from '../core/storage/migrate';
import { MIGRATIONS } from '../core/storage/migrations';
import { nodeDriver } from '../core/storage/nodeDriver';
import { createProject, openProject, type Project } from '../core/storage/project';
import { loadSeen } from '../core/storage/seen';
import { makeTestFolder, type TestFolder } from '../core/storage/testFolder';
import { shotListCsv } from '../features/export/shotListCsv';
import { addShot, trashShot } from '../features/storyboard/board';
import { createProjectStore } from './projectStore';

// Seen (schema 7, polish 6b): automatic, outside the edit log.

let folder: TestFolder;
let project: Project;
let store = createProjectStore();
let shot = '';
let other = '';
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  store = createProjectStore();
  await store.getState().open(project);
  await store.getState().apply([
    { kind: 'create', record: { id: 'sc4', type: 'scene', parentId: project.projectId, sortKey: 'V', props: { number: '4' } } },
  ]);
  for (let i = 0; i < 2; i += 1) {
    const added = addShot(store.getState().records, project.projectId, 'sc4');
    await store.getState().apply(added.changes);
    if (i === 0) shot = added.shotId;
    else other = added.shotId;
  }
});
afterEach(async () => {
  await store.getState().close();
  folder.remove();
});

const trash = (id: string) => store.getState().applyWith((now) => ({ changes: trashShot(now, project.projectId, id) }));

describe('Seen', () => {
  it('marks a frame seen once per department, keeps it in the file, and never as a step undo takes back', async () => {
    const steps = (await log(project.file)).length;
    await store.getState().markSeen(shot, ['camera']);
    await store.getState().markSeen(shot, ['direction', 'camera']);
    expect(store.getState().seen[shot]).toEqual(['camera', 'direction']);
    expect(await loadSeen(project.file)).toEqual({ [shot]: ['camera', 'direction'] });
    // Not an op: nothing new in History, and undo takes back the last edit, not Seen.
    expect((await log(project.file)).length).toBe(steps);
    await store.getState().apply([{ kind: 'update', id: shot, set: { lens_mm: 35 } }]);
    await store.getState().undo();
    expect(await loadSeen(project.file)).toEqual({ [shot]: ['camera', 'direction'] });

    // Read again on open.
    const path = project.file.path;
    await store.getState().close();
    project = await openProject(path, { driver: nodeDriver, backups: false });
    await store.getState().open(project);
    expect(store.getState().seen).toEqual({ [shot]: ['camera', 'direction'] });
  });

  it('marks only a live frame, and never in a project opened since the mark was asked for', async () => {
    await trash(shot);
    await store.getState().markSeen(shot, ['camera']);
    expect(await loadSeen(project.file)).toEqual({});

    // Asked for in this project while another is already opening ahead of it in the queue: by its turn the store
    // holds the other one, so it's written to neither.
    const second = await createProject(folder.path('Second.sbd'), { driver: nodeDriver, backups: false });
    const opened = store.getState().open(second);
    const marked = store.getState().markSeen(other, ['camera']);
    await Promise.all([opened, marked]);
    expect(store.getState().seen).toEqual({});
    expect(await loadSeen(second.file)).toEqual({});
    await store.getState().close();
    const first = await openProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
    expect(await loadSeen(first.file)).toEqual({});
    await store.getState().open(first);
  });

  it('goes with a frame Empty Trash deletes for good, and stays with one in the Trash it leaves', async () => {
    await store.getState().markSeen(shot, ['camera']);
    await store.getState().markSeen(other, ['sound']);
    await trash(shot);
    await trash(other);
    expect(await loadSeen(project.file)).toEqual({ [shot]: ['camera'], [other]: ['sound'] });
    await store.getState().emptyTrash(new Set([shot]));
    expect(await loadSeen(project.file)).toEqual({ [other]: ['sound'] });
    expect(store.getState().seen).toEqual({ [other]: ['sound'] });
  });

  it('goes into the shot list CSV, with a department a newer version added kept by its id', async () => {
    await store.getState().apply([{ kind: 'update', id: shot, set: { department_status: { drone: { priority: true }, art: { done: true } } } }]);
    await store.getState().markSeen(shot, ['camera']);
    const csv = shotListCsv(store.getState().records, project.projectId, { kind: 'project' }, store.getState().seen);
    expect(csv.split('\r\n')[1]).toContain(',Camera: Seen; Art: Done; drone: Priority');
  });

  it('counts and words each department’s states, Seen among them, Priority first', () => {
    const statuses = departmentStatuses({ department_status: { art: { working: true }, sound: { priority: true, done: true } } });
    const seen = ['camera', 'sound'];
    expect(stateCounts(statuses, seen)).toEqual([
      { state: 'priority', count: 1 },
      { state: 'seen', count: 2 },
      { state: 'working', count: 1 },
      { state: 'done', count: 1 },
    ]);
    expect(departmentStates(statuses, seen).map((row) => [row.department, row.states.join(' ')])).toEqual([
      ['sound', 'priority seen done'],
      ['camera', 'seen'],
      ['art', 'working'],
    ]);
    expect(departmentStatesText(statuses, seen, 'sound')).toBe('Priority, Seen, Done');
  });
});

describe('schema 7', () => {
  it('backs a v6 file up, then gives it an empty Seen table', async () => {
    const file = await nodeDriver.create(folder.path('Old.sbd'));
    await migrate(file, { isNew: true, migrations: MIGRATIONS.slice(0, 6) });
    await file.close();
    const old = await openProject(folder.path('Old.sbd'), { driver: nodeDriver, backups: false });
    expect(old.migration).toMatchObject({ from: 6, to: 7 });
    expect(old.migration.backup).toMatch(/^Old\.sbd\.bak-v6-/);
    expect(await loadSeen(old.file)).toEqual({});
    await old.close();
  });
});

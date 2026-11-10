import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { departmentStatuses } from '../../model/departmentStatus';
import { approvalBasis, approvalState, sceneApprovals } from '../../model/sceneApprovals';
import { apply, getRecord, loadRecords, log, opsOfGroups, redo, restoreTo, undo } from '../../ops/ops';
import { migrate } from '../migrate';
import { nodeDriver } from '../nodeDriver';
import { openProject, type Project } from '../project';
import { makeTestFolder, type TestFolder } from '../testFolder';
import { MIGRATIONS, SCHEMA_VERSION } from '.';

let folder: TestFolder;
let project: Project | undefined;
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(async () => {
  await project?.close();
  project = undefined;
  folder.remove();
});

const at = '2026-11-08T10:00:00.000Z';
const early = '2026-11-08T11:00:00.000Z';
const late = '2026-11-08T12:00:00.000Z';
const gone = '2026-11-08T13:00:00.000Z';
const dp = (name: string, when: string) => ({ name, roles: ['dp'], at: when });
const director = (name: string, when: string) => ({ name, roles: ['director'], at: when });
const both = (when: string) => ({ name: 'Kevin Matos', roles: ['director', 'dp'], at: when });

/** A v8 file, as 3.6a left it: frames with their own approvals, in a live scene, an empty one and one in the Trash. */
async function v8File(): Promise<string> {
  const path = folder.path('Bey County.sbd');
  const file = await nodeDriver.create(path);
  await migrate(file, { isNew: true, migrations: MIGRATIONS.slice(0, 8), now: () => new Date(at) });
  const record = (id: string, type: string, parent: string | null, props: object, trashedAt: string | null = null) => ({
    sql: `INSERT INTO records (id, type, parent_id, sort_key, props, trashed_at, trashed_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [id, type, parent, id, JSON.stringify(props), trashedAt, trashedAt ? 'Kevin Matos' : null, at, at],
  });
  await file.tx([
    record('p', 'project', null, { name: 'Bey County' }),
    record('s1', 'scene', 'p', { number: '4', name: 'Penn Station' }),
    record('a', 'shot', 's1', {
      number: '4A',
      department_status: {
        camera: { done: true, approvals: [dp('Sam Reyes', early)] },
        art: { approvals: [director('Kevin Matos', early)] },
        sound: { approvals: [both(early)] },
        drone: { approvals: [dp('Sam Reyes', early)], note: 'B unit' },
        // An approval this version can't read: never one of the director's or the DP's, so it stays where it is.
        post: { approvals: [{ name: 'X', roles: ['producer'], at: early }] },
      },
    }),
    record('b', 'shot', 's1', {
      number: '4B',
      department_status: {
        camera: { priority: true, approvals: [dp('Sam Reyes', late), director('Ana Ruiz', early)] },
        sound: { approvals: [both(late)] },
        drone: { approvals: [dp('Sam Reyes', late)] },
      },
    }),
    // In the Trash on its own: not one of the scene's frames, but its approvals come off all the same.
    record('c', 'shot', 's1', { number: '4C', department_status: { art: { working: true, approvals: [director('Kevin Matos', late)] } } }, early),
    record('s2', 'scene', 'p', { number: '5' }),
    // A scene deleted with its frames, in one step: those frames are its own.
    record('s3', 'scene', 'p', { number: '6' }, gone),
    record('d', 'shot', 's3', { number: '6A', department_status: { hmu: { approvals: [director('Kevin Matos', early)] } } }, gone),
  ]);
  // A step from before the upgrade, which ⌘Z must never reach once it's done: a rename of the scene.
  await apply(file, [{ kind: 'update', id: 's1', set: { name: 'Penn Station, lower level' } }], { now: () => new Date(early) });
  // And one undone, which ⌘⇧Z must never redo once the upgrade is done.
  await apply(file, [{ kind: 'update', id: 's2', set: { name: 'Platform' } }], { now: () => new Date(early) });
  await undo(file, { now: () => new Date(early) });
  await file.close();
  return path;
}

describe('schema 9: approvals per scene', () => {
  it('backs the file up, approves a scene for a department only where every frame was, and takes the frames’ off', async () => {
    const path = await v8File();
    project = await openProject(path, { driver: nodeDriver, backups: false });
    expect(project.migration).toMatchObject({ from: 8, to: SCHEMA_VERSION });
    expect(readdirSync(folder.dir).some((name) => name.startsWith('Bey County.sbd.bak-v8-'))).toBe(true);

    const s1 = sceneApprovals((await getRecord(project.file, 's1'))?.props ?? {});
    // The DP approved Camera on both frames: the scene's, with the latest name and time. The director on one only: not.
    expect(s1.camera).toMatchObject([{ name: 'Sam Reyes', roles: ['dp'], at: late }]);
    // Art was approved on one of the two frames (the other in the Trash doesn't count): not approved.
    expect(s1.art).toBeUndefined();
    // One person who was both, on every frame: one approval with both roles.
    expect(s1.sound).toMatchObject([{ name: 'Kevin Matos', roles: ['director', 'dp'], at: late }]);
    // A department this version doesn't know is carried the same way.
    expect(s1.drone).toMatchObject([{ name: 'Sam Reyes', roles: ['dp'], at: late }]);

    // A scene without frames carries nothing; one in the Trash carries its own frames'.
    expect((await getRecord(project.file, 's2'))?.props).toEqual({ number: '5' });
    expect(sceneApprovals((await getRecord(project.file, 's3'))?.props ?? {}).hmu).toMatchObject([{ name: 'Kevin Matos', roles: ['director'] }]);

    // Every frame's approvals come off; everything else in its status stays, and an entry left empty goes.
    expect((await getRecord(project.file, 'a'))?.props.department_status).toEqual({
      camera: { done: true },
      drone: { note: 'B unit' },
      post: { approvals: [{ name: 'X', roles: ['producer'], at: early }] },
    });
    expect((await getRecord(project.file, 'b'))?.props.department_status).toEqual({ camera: { priority: true } });
    expect((await getRecord(project.file, 'c'))?.props.department_status).toEqual({ art: { working: true } });
    expect(departmentStatuses((await getRecord(project.file, 'd'))?.props ?? {})).toEqual({});
  });

  it('is one step in History, and ⌘Z can’t reach past it to write a record back in the older shape', async () => {
    project = await openProject(await v8File(), { driver: nodeDriver, backups: false, now: () => new Date(late) });
    const groups = await log(project.file);
    const last = groups.at(-1);
    expect(last).toMatchObject({ kind: 'edit', author: 'local' });
    const ops = await opsOfGroups(project.file, [last?.id ?? '']);
    expect(ops.map((op) => op.recordId).sort()).toEqual(['a', 'b', 'c', 'd', 's1', 's3']);
    // Each record as it was and as it is: History lists the approvals that moved and those that came off.
    const s1 = ops.find((op) => op.recordId === 's1');
    expect(s1?.before?.props.department_approvals).toBeUndefined();
    expect(sceneApprovals(s1?.after?.props ?? {}).camera).toHaveLength(1);
    expect((await getRecord(project.file, 's1'))?.updatedAt).toBe(s1?.after?.updatedAt);

    // The rename before the upgrade can't be undone any more: its snapshot has no approvals.
    expect(await undo(project.file)).toBeNull();
    expect(sceneApprovals((await getRecord(project.file, 's1'))?.props ?? {}).camera).toHaveLength(1);
    // Restore to the upgrade itself changes nothing; one to a point before it is a choice, and undo takes it back.
    expect(await restoreTo(project.file, last?.id ?? null)).toBeNull();
    const rename = groups[0]?.id ?? null;
    expect(await restoreTo(project.file, rename)).not.toBeNull();
    expect(sceneApprovals((await getRecord(project.file, 's1'))?.props ?? {}).camera).toBeUndefined();
    expect(await undo(project.file)).not.toBeNull();
    expect(sceneApprovals((await getRecord(project.file, 's1'))?.props ?? {}).camera).toHaveLength(1);
  });

  it('starts a fresh undo stack: an edit after the upgrade undoes, and undo stops there; nothing from before redoes', async () => {
    project = await openProject(await v8File(), { driver: nodeDriver, backups: false, now: () => new Date(late) });
    expect(await redo(project.file)).toBeNull();
    await apply(project.file, [{ kind: 'update', id: 's1', set: { name: 'Penn' } }]);
    expect(await undo(project.file)).not.toBeNull();
    expect((await getRecord(project.file, 's1'))?.props.name).toBe('Penn Station, lower level');
    expect(sceneApprovals((await getRecord(project.file, 's1'))?.props ?? {}).camera).toHaveLength(1);
    expect(await undo(project.file)).toBeNull();
    expect(await redo(project.file)).not.toBeNull();
    expect((await getRecord(project.file, 's1'))?.props.name).toBe('Penn');
  });

  it('starts each carried approval current: its fingerprint is the scene as it is', async () => {
    project = await openProject(await v8File(), { driver: nodeDriver, backups: false });
    const records = Object.fromEntries((await loadRecords(project.file)).map((r) => [r.id, r]));
    const s1 = sceneApprovals(records.s1?.props ?? {});
    // Carried by the rule in force (3.18's), never 3.6b's.
    expect(s1.camera?.[0]?.basis.startsWith('3:')).toBe(true);
    for (const department of ['camera', 'sound', 'drone']) {
      expect(approvalState(s1[department] ?? [], approvalBasis(records, 's1', department))).toBe('approved');
    }
    // The scene in the Trash reads as it did once it's back, its frames with it.
    expect(approvalState(sceneApprovals(records.s3?.props ?? {}).hmu ?? [], approvalBasis(records, 's3', 'hmu'))).toBe('approved');
  });
});

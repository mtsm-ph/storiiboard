import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { approvalWho, departmentStatuses, storedStatuses, withMyApproval, withState, type Approval } from '../../model/departmentStatus';
import { getRecord } from '../../ops/ops';
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

const at = '2026-11-04T10:00:00.000Z';

/** A v5 file, as 1.28 left it: three frames, two with departments ticked on, one listing a department twice. */
async function v5File(): Promise<string> {
  const path = folder.path('Bey County.sbd');
  const file = await nodeDriver.create(path);
  await migrate(file, { isNew: true, migrations: MIGRATIONS.slice(0, 5), now: () => new Date(at) });
  const shot = (id: string, props: object) => ({
    sql: `INSERT INTO records (id, type, parent_id, sort_key, props, created_at, updated_at) VALUES (?, 'shot', NULL, ?, ?, ?, ?)`,
    params: [id, id, JSON.stringify(props), at, at],
  });
  await file.tx([
    shot('a', { number: '4A', departments: ['camera', 'art', 'camera', 7] }),
    shot('b', { number: '4B', departments: [] }),
    shot('c', { number: '4C', lens_mm: 35 }),
    {
      sql: `INSERT INTO records (id, type, parent_id, sort_key, props, created_at, updated_at) VALUES ('n', 'note', NULL, 'n', ?, ?, ?)`,
      params: [JSON.stringify({ text: 'Rain', departments: ['art'] }), at, at],
    },
  ]);
  await file.close();
  return path;
}

describe('schema 6: department status', () => {
  it('backs the file up, then makes each department that was on a Priority one, and takes the list off', async () => {
    const path = await v5File();
    project = await openProject(path, { driver: nodeDriver, backups: false });
    expect(SCHEMA_VERSION).toBe(6);
    expect(readdirSync(folder.dir).some((name) => name.startsWith('Bey County.sbd.bak-v5-'))).toBe(true);

    const a = await getRecord(project.file, 'a');
    expect(a?.props).toEqual({ number: '4A', department_status: { camera: { priority: true }, art: { priority: true } } });
    expect(departmentStatuses(a?.props ?? {})).toMatchObject({
      camera: { priority: true, working: false, done: false, approvals: [] },
      art: { priority: true, working: false, done: false, approvals: [] },
    });
    // No departments on: an empty status, nothing else touched.
    expect((await getRecord(project.file, 'b'))?.props).toEqual({ number: '4B', department_status: {} });
    expect((await getRecord(project.file, 'c'))?.props).toEqual({ number: '4C', lens_mm: 35 });
    // Only shots ever had departments; anything else keeps its props as they are.
    expect((await getRecord(project.file, 'n'))?.props).toEqual({ text: 'Rain', departments: ['art'] });
  });
});

describe('editing department status', () => {
  const dp: Approval = { name: 'Sam Reyes', roles: ['dp'], at };
  const director: Approval = { name: 'Kevin Matos', roles: ['director'], at };

  it('keeps each approver’s sign-off: the DP’s beside the director’s, and each takes back only their own', () => {
    let statuses = withMyApproval({}, 'camera', director);
    statuses = withMyApproval(statuses, 'camera', dp);
    expect(statuses.camera?.approvals).toEqual([director, dp]);
    statuses = withMyApproval(statuses, 'camera', { ...dp, at: 'later' });
    expect(statuses.camera?.approvals).toEqual([director]);
    // One person who is both: one approval, and it takes back either role's.
    const both: Approval = { name: 'Kevin Matos', roles: ['director', 'dp'], at };
    expect(withMyApproval(statuses, 'camera', both).camera?.approvals).toEqual([]);
    expect(withMyApproval({}, 'camera', both).camera?.approvals).toEqual([both]);
  });

  it('names an approver without a profile name by role, in the sentence’s case', () => {
    expect(approvalWho({ name: '', roles: ['director', 'dp'], at })).toBe('the director and DP');
    expect(approvalWho(director)).toBe('Kevin Matos (Director)');
  });

  it('never drops what a newer version keeps in an entry, through an edit of this one', () => {
    const props = {
      department_status: {
        camera: { priority: true, note: 'B camera too', approvals: [{ name: 'X', roles: ['producer'], at }] },
        drone: { blocked: true },
      },
    };
    const edited = storedStatuses(withState(departmentStatuses(props), 'camera', 'done', true));
    expect(edited).toEqual({
      camera: { note: 'B camera too', priority: true, done: true, approvals: [{ name: 'X', roles: ['producer'], at }] },
      drone: { blocked: true },
    });
  });
});

describe('approvals read from a file', () => {
  it('go back exactly as stored when another department is edited, a role or field this version lacks included', () => {
    const approval = { name: 'Sam', roles: ['dp', 'producer'], at, note: 'B camera' };
    const props = { department_status: { camera: { approvals: [approval] } } };
    const edited = storedStatuses(withState(departmentStatuses(props), 'art', 'done', true));
    expect(edited.camera).toEqual({ approvals: [approval] });
  });
});

describe('reading department status', () => {
  it('reads an older list as Priority, as a point restored from before schema 6 has it', () => {
    expect(Object.keys(departmentStatuses({ departments: ['sound', 3, 'hmu'] }))).toEqual(['sound', 'hmu']);
    // Once there's a status, an old list beside it means nothing.
    const read = departmentStatuses({ departments: ['sound'], department_status: { art: { done: true } } });
    expect(Object.keys(read)).toEqual(['art']);
    expect(read.art).toMatchObject({ priority: false, working: false, done: true, approvals: [] });
  });

  it('keeps only approvals with a director or DP, and ids a newer version may have added', () => {
    const statuses = departmentStatuses({
      department_status: {
        camera: { approvals: [{ name: 'Kevin Matos', roles: ['dp', 'director', 'dp'], at }, { name: 'X', roles: ['gaffer'], at }] },
        drone: { working: true },
        art: { priority: 'yes' },
      },
    });
    expect(statuses.camera?.approvals).toMatchObject([{ name: 'Kevin Matos', roles: ['dp', 'director'], at }]);
    expect(statuses.drone?.working).toBe(true);
    expect(statuses.art).toBeUndefined();
  });
});

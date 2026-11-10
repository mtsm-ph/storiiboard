import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from '../../model/record';
import { approvalBasis, approvalState, sceneApprovals } from '../../model/sceneApprovals';
import { apply, loadRecords, log, loggedRewrite, opsOfGroups, undo } from '../../ops/ops';
import { migrate, type Migration } from '../migrate';
import { nodeDriver } from '../nodeDriver';
import { openProject, type Project } from '../project';
import { makeTestFolder, type TestFolder } from '../testFolder';
import { characterIdChanges, characterIds } from './012_character_ids';
import { approvalRepairs } from './013_approvals_kept';
import { MIGRATIONS, SCHEMA_VERSION } from '.';

// Schema 13 (3.18, Kevin Nov 9): approvals schema 12 left "Changed since approval" on files it upgraded before it
// re-stamped them are current again.

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

const at = '2026-11-09T10:00:00.000Z';
const late = '2026-11-09T12:00:00.000Z';

/** Schema 12 as 3.13 shipped it: the names become ids, the approvals are left as they were. */
const twelveAsShipped: Migration = {
  ...characterIds,
  backfill: async (file, now) => {
    const stamp = now().toISOString();
    const { created, changes } = characterIdChanges(await loadRecords(file), stamp);
    const unstamped = changes.map(({ before, props }) => {
      const out: Props = Object.fromEntries(Object.entries(props).filter(([key]) => key !== 'department_approvals'));
      if (before.props.department_approvals !== undefined) out.department_approvals = before.props.department_approvals;
      return { before, props: out };
    });
    return loggedRewrite(file, unstamped, stamp, 'local', created);
  },
};

const sign = (basis: string) => [{ name: 'Sam Reyes', roles: ['dp'], at, basis }];

/**
 * A file schema 12 upgraded before 3.18: a script's scenes, each approved by 3.6b's rule before the upgrade (s1 and s2;
 * s1's sound approval given before a lens change), one approved after it (s3), and one whose characters were edited
 * since (s2).
 */
async function v12File(): Promise<string> {
  const path = folder.path('Bey County.sbd');
  const file = await nodeDriver.create(path);
  await migrate(file, { isNew: true, migrations: MIGRATIONS.slice(0, 11), now: () => new Date(at) });
  const record = (id: string, type: string, parent: string | null, props: object) => ({
    sql: `INSERT INTO records (id, type, parent_id, sort_key, props, trashed_at, trashed_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    params: [id, type, parent, id, JSON.stringify(props), at, at],
  });
  await file.tx([
    record('p', 'project', null, { name: 'Bey County' }),
    record('mary', 'character', 'p', { name: 'Mary' }),
    record('s1', 'scene', 'p', { number: '1', name: 'DINER', characters: ['MARY', 'Tom'] }),
    record('a', 'shot', 's1', { number: '1A', lens_mm: 35 }),
    record('s2', 'scene', 'p', { number: '2', name: 'ROAD', characters: ['Mary'] }),
    record('s3', 'scene', 'p', { number: '3', name: 'BARN', characters: ['Mary'] }),
    // No speakers: schema 12 took the empty list off and wrote no ids.
    record('s4', 'scene', 'p', { number: '4', name: 'FIELD', characters: [] }),
  ]);
  const before = Object.fromEntries((await loadRecords(file)).map((r) => [r.id, r]));
  const legacy = (scene: string, department: string) => approvalBasis(before, scene, department).legacy;
  const approvals: Record<string, object> = {
    s1: { camera: sign(legacy('s1', 'camera')), sound: sign(legacy('s1', 'sound')) },
    s2: { camera: sign(legacy('s2', 'camera')) },
    s4: { art: sign(legacy('s4', 'art')) },
  };
  for (const [id, given] of Object.entries(approvals)) {
    await file.tx([{ sql: `UPDATE records SET props = json_set(props, '$.department_approvals', json(?)) WHERE id = ?`, params: [JSON.stringify(given), id] }]);
  }
  // The frame's lens changes: both of s1's approvals are from before it.
  await apply(file, [{ kind: 'update', id: 'a', set: { lens_mm: 50 } }], { now: () => new Date(at) });
  // Camera is approved again on the new lens; sound's stays from before it.
  await file.tx([
    {
      sql: `UPDATE records SET props = json_set(props, '$.department_approvals.camera', json(?)) WHERE id = 's1'`,
      params: [JSON.stringify(sign(approvalBasis(Object.fromEntries((await loadRecords(file)).map((r) => [r.id, r])), 's1', 'camera').legacy))],
    },
  ]);
  await migrate(file, { isNew: false, migrations: [...MIGRATIONS.slice(0, 11), twelveAsShipped], now: () => new Date(at) });
  // After the upgrade: s3 approved on the scene as it is now; s2's characters edited.
  const now = Object.fromEntries((await loadRecords(file)).map((r) => [r.id, r]));
  await file.tx([
    { sql: `UPDATE records SET props = json_set(props, '$.department_approvals', json(?)) WHERE id = 's3'`, params: [JSON.stringify({ camera: sign(approvalBasis(now, 's3', 'camera').legacy) })] },
  ]);
  await apply(file, [{ kind: 'update', id: 's2', set: { character_ids: [] } }], { now: () => new Date(at) });
  await file.close();
  return path;
}

const states = (records: Record<string, SbdRecord>) => (scene: string, department: string) =>
  approvalState(sceneApprovals(records[scene]?.props ?? {})[department] ?? [], approvalBasis(records, scene, department));

describe('schema 13: approvals kept through schema 12', () => {
  it('shows the bug it repairs: schema 12 as shipped left current approvals “Changed”', async () => {
    const file = await nodeDriver.open(await v12File());
    const state = states(Object.fromEntries((await loadRecords(file)).map((r) => [r.id, r])));
    expect(state('s1', 'camera')).toBe('changed');
    await file.close();
  });

  it('backs the file up; re-stamps those current before schema 12, and nothing else', async () => {
    const path = await v12File();
    const file = await nodeDriver.open(path);
    const stamps = (records: readonly SbdRecord[]) =>
      Object.fromEntries(records.filter((r) => r.type === 'scene').map((r) => [r.id, JSON.stringify(r.props.department_approvals ?? null)]));
    const was = stamps(await loadRecords(file));
    await file.close();
    project = await openProject(path, { driver: nodeDriver, backups: false, now: () => new Date(late) });
    expect(project.migration).toMatchObject({ from: 12, to: SCHEMA_VERSION });
    expect(readdirSync(folder.dir).some((name) => name.startsWith('Bey County.sbd.bak-v12-'))).toBe(true);
    const records = Object.fromEntries((await loadRecords(project.file)).map((r) => [r.id, r]));
    const state = states(records);
    expect(state('s1', 'camera')).toBe('approved');
    // Given before the lens changed: still changed.
    expect(state('s1', 'sound')).toBe('changed');
    // Its characters edited since: a real change.
    expect(state('s2', 'camera')).toBe('changed');
    // Approved after the upgrade: current, untouched.
    expect(state('s3', 'camera')).toBe('approved');
    // A scene schema 12 emptied of names: repaired too.
    expect(state('s4', 'art')).toBe('approved');
    // Still 3.6b's rule: a later change it reads turns it, as before.
    expect(sceneApprovals(records.s1?.props ?? {}).camera?.[0]?.basis.includes(':')).toBe(false);
    // Only s1's camera and s4's art are stamped again; every other sign-off is as it was.
    const is = stamps(Object.values(records));
    expect([is.s2, is.s3]).toEqual([was.s2, was.s3]);
    expect(sceneApprovals(records.s1?.props ?? {}).sound).toEqual(sceneApprovals({ department_approvals: JSON.parse(was.s1 ?? 'null') as never }).sound);
  });

  it('is one step in History, and ⌘Z can’t reach past it', async () => {
    project = await openProject(await v12File(), { driver: nodeDriver, backups: false, now: () => new Date(late) });
    const last = (await log(project.file)).at(-1);
    expect(last).toMatchObject({ kind: 'edit', author: 'local' });
    const ops = await opsOfGroups(project.file, [last?.id ?? '']);
    expect(ops.map((op) => op.recordId).sort()).toEqual(['s1', 's4']);
    expect(await undo(project.file)).toBeNull();
  });

  it('leaves a file schema 12 already re-stamped as it was: no step in History', async () => {
    const path = await v12File();
    // The same file, put through today's schema 12 instead: nothing left to repair.
    const fresh = folder.path('Fresh.sbd');
    const file = await nodeDriver.create(fresh);
    await migrate(file, { isNew: true, migrations: MIGRATIONS.slice(0, 11), now: () => new Date(at) });
    const old = await nodeDriver.open(path);
    const rows = await old.query('SELECT id, type, parent_id, sort_key, props, trashed_at, trashed_by, created_at, updated_at FROM records');
    await old.close();
    expect(rows.length).toBeGreaterThan(0);
    // Back to the scenes as they were before schema 12, approvals and all.
    const opsBefore = await nodeDriver.open(path);
    const befores = await opsBefore.query("SELECT record_id, before FROM ops WHERE kind = 'update' AND json_type(before, '$.props.characters') = 'array'");
    await opsBefore.close();
    const original = new Map(befores.map((row) => [String(row.record_id), String(row.before)]));
    await file.tx(
      rows.map((row) => {
        const before = original.get(String(row.id));
        const props = before ? JSON.stringify((JSON.parse(before) as { props: unknown }).props) : row.props;
        return {
          sql: 'INSERT INTO records (id, type, parent_id, sort_key, props, trashed_at, trashed_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          params: [row.id, row.type, row.parent_id, row.sort_key, props, row.trashed_at, row.trashed_by, row.created_at, row.updated_at].map((v) => v ?? null),
        };
      }),
    );
    await migrate(file, { isNew: false, migrations: MIGRATIONS.slice(0, 12), now: () => new Date(at) });
    const steps = (await log(file)).length;
    await file.close();
    project = await openProject(fresh, { driver: nodeDriver, backups: false, now: () => new Date(late) });
    expect(project.migration).toMatchObject({ from: 12, to: SCHEMA_VERSION });
    expect(await log(project.file)).toHaveLength(steps);
  });
});

describe('the repair itself', () => {
  const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props): SbdRecord => ({
    id,
    type,
    parentId,
    sortKey: id,
    props,
    trashedAt: null,
    trashedBy: null,
    createdAt: at,
    updatedAt: at,
  });

  it('needs schema 12’s step for the scene, and its characters as that step left them', () => {
    const was = record('s', 'scene', 'p', { number: '1', characters: ['Mary'] });
    const basis = approvalBasis({ s: was }, 's', 'camera').legacy;
    const scene = record('s', 'scene', 'p', { number: '1', character_ids: ['m'], department_approvals: { camera: sign(basis) } });
    const step = { before: was.props, after: { number: '1', character_ids: ['m'] } };
    expect(approvalRepairs([scene], new Map([['s', step]]))).toHaveLength(1);
    expect(approvalRepairs([scene], new Map())).toEqual([]);
    const edited = { ...scene, props: { ...scene.props, character_ids: ['m', 'n'] } };
    expect(approvalRepairs([edited], new Map([['s', step]]))).toEqual([]);
    // Restored to before schema 12 (its names back): left alone; its approvals came back with it.
    const restored = { ...scene, props: { ...was.props, department_approvals: scene.props.department_approvals ?? null } };
    expect(approvalRepairs([restored], new Map([['s', step]]))).toEqual([]);
  });
});

import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sceneCharacters } from '../../model/person';
import type { SbdRecord } from '../../model/record';
import { approvalBasis, approvalState, sceneApprovals } from '../../model/sceneApprovals';
import { apply, getRecord, loadRecords, log, opsOfGroups, restoreTo, undo } from '../../ops/ops';
import { migrate } from '../migrate';
import { nodeDriver } from '../nodeDriver';
import { openProject, type Project } from '../project';
import { makeTestFolder, type TestFolder } from '../testFolder';
import { characterIdChanges } from './012_character_ids';
import { MIGRATIONS, SCHEMA_VERSION } from '.';

// Schema 12 (3.13, approved by Kevin Nov 9): a scene's character names become ids of the project's characters.

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
const early = '2026-11-09T11:00:00.000Z';
const late = '2026-11-09T12:00:00.000Z';

/** A v11 file: a script's scenes with names, a character the project has, one in the Trash. */
async function v11File(): Promise<string> {
  const path = folder.path('Bey County.sbd');
  const file = await nodeDriver.create(path);
  await migrate(file, { isNew: true, migrations: MIGRATIONS.slice(0, 11), now: () => new Date(at) });
  const record = (id: string, type: string, parent: string | null, props: object, trashedAt: string | null = null) => ({
    sql: `INSERT INTO records (id, type, parent_id, sort_key, props, trashed_at, trashed_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [id, type, parent, id, JSON.stringify(props), trashedAt, trashedAt ? 'Kevin Matos' : null, at, at],
  });
  await file.tx([
    record('p', 'project', null, { name: 'Bey County' }),
    record('mary', 'character', 'p', { name: 'Mary', cast_id: 'ana' }),
    record('oldtom', 'character', 'p', { name: 'TOM' }, early),
    record('s1', 'scene', 'p', { number: '1', name: 'DINER', characters: ['MARY ', 'Tom', 'mary', 42, ''] }),
    record('s2', 'scene', 'p', { number: '2', name: 'ROAD', characters: ['TOM', 'Sheriff'] }, early),
    record('s3', 'scene', 'p', { number: '3', name: 'BRIDGE' }),
    record('s4', 'scene', 'p', { number: '4', name: 'BARN', characters: [] }),
  ]);
  // A step from before the upgrade, which ⌘Z must never reach once it's done.
  await apply(file, [{ kind: 'update', id: 's3', set: { name: 'THE BRIDGE' } }], { now: () => new Date(early) });
  await file.close();
  return path;
}

const byName = (records: readonly SbdRecord[], name: string) => records.find((r) => r.type === 'character' && r.trashedAt === null && r.props.name === name);

describe('schema 12: scene characters as ids', () => {
  it('backs the file up; matches names trimmed and in any case, makes the missing ones, and keeps what isn’t a name', async () => {
    project = await openProject(await v11File(), { driver: nodeDriver, backups: false, now: () => new Date(late) });
    expect(project.migration).toMatchObject({ from: 11, to: SCHEMA_VERSION });
    expect(readdirSync(folder.dir).some((name) => name.startsWith('Bey County.sbd.bak-v11-'))).toBe(true);
    const list = await loadRecords(project.file);
    const records = Object.fromEntries(list.map((r) => [r.id, r]));
    const tom = byName(list, 'Tom');
    const sheriff = byName(list, 'Sheriff');
    expect(tom && sheriff).toBeTruthy();
    // Mary is the project's own; Tom is new (the TOM in the Trash isn't matched); MARY twice is one; 42 stays.
    expect(records.s1?.props).toEqual({ number: '1', name: 'DINER', character_ids: ['mary', tom?.id], characters: [42] });
    expect(sceneCharacters(records, records.s1 as SbdRecord).map((c) => c.props.name)).toEqual(['Mary', 'Tom']);
    // A scene in the Trash is changed too; TOM there is the Tom just made.
    expect(records.s2?.props).toEqual({ number: '2', name: 'ROAD', character_ids: [tom?.id, sheriff?.id] });
    expect(records.s3?.props).toEqual({ number: '3', name: 'THE BRIDGE' });
    expect(records.s4?.props).toEqual({ number: '4', name: 'BARN' });
    // The project's own Mary keeps who plays her; the trashed TOM stays as it was.
    expect(records.mary?.props).toEqual({ name: 'Mary', cast_id: 'ana' });
    expect(records.oldtom?.trashedAt).toBe(early);
    // New characters go after every other, in the Trash too.
    expect((tom?.sortKey ?? '') > 'oldtom' && (sheriff?.sortKey ?? '') > (tom?.sortKey ?? '')).toBe(true);
  });

  it('is one step in History, its new characters among it, and ⌘Z can’t reach past it', async () => {
    project = await openProject(await v11File(), { driver: nodeDriver, backups: false, now: () => new Date(late) });
    const groups = await log(project.file);
    const last = groups.at(-1);
    expect(last).toMatchObject({ kind: 'edit', author: 'local' });
    const ops = await opsOfGroups(project.file, [last?.id ?? '']);
    expect(ops.filter((op) => op.kind === 'create').map((op) => op.after?.props.name).sort()).toEqual(['Sheriff', 'Tom']);
    expect(ops.filter((op) => op.kind === 'update').map((op) => op.recordId).sort()).toEqual(['s1', 's2', 's4']);
    expect(ops.find((op) => op.recordId === 's1')?.before?.props.characters).toEqual(['MARY ', 'Tom', 'mary', 42, '']);
    // The rename before the upgrade can't be undone: its snapshot is from the older shape.
    expect(await undo(project.file)).toBeNull();
    expect((await getRecord(project.file, 's3'))?.props.name).toBe('THE BRIDGE');
    // Restore to before it is a choice, and undo takes it back.
    const made = ops.filter((op) => op.kind === 'create').map((op) => op.recordId);
    expect(await restoreTo(project.file, groups[0]?.id ?? null)).not.toBeNull();
    expect((await getRecord(project.file, 's1'))?.props.characters).toEqual(['MARY ', 'Tom', 'mary', 42, '']);
    // The characters it made go with it; the scene reads its names as the upgrade matched them, Mary only.
    for (const id of made) expect(await getRecord(project.file, id)).toBeNull();
    const before = Object.fromEntries((await loadRecords(project.file)).map((r) => [r.id, r]));
    expect(sceneCharacters(before, before.s1 as SbdRecord).map((c) => c.id)).toEqual(['mary']);
    expect(await undo(project.file)).not.toBeNull();
    const after = Object.fromEntries((await loadRecords(project.file)).map((r) => [r.id, r]));
    expect(sceneCharacters(after, after.s1 as SbdRecord).map((c) => c.props.name)).toEqual(['Mary', 'Tom']);
  });
});

describe('a scene’s characters after the upgrade', () => {
  it('stay with a scene a restore keeps as it is now', async () => {
    project = await openProject(await v11File(), { driver: nodeDriver, backups: false, now: () => new Date(late) });
    const file = project.file;
    await apply(file, [
      { kind: 'create', record: { id: 'old', type: 'scene', parentId: 'p', sortKey: 'x1', props: { number: '8' } } },
      { kind: 'create', record: { id: 'f', type: 'shot', parentId: 'old', sortKey: 'a', props: { number: '8A' } } },
    ]);
    const point = (await log(file)).at(-1)?.id ?? null;
    // After the point: a character, a scene listing it, the frame moved into it, and its old scene emptied for good.
    await apply(file, [
      { kind: 'create', record: { id: 'x', type: 'character', parentId: 'p', sortKey: 'zz', props: { name: 'Deputy' } } },
      { kind: 'create', record: { id: 'new', type: 'scene', parentId: 'p', sortKey: 'x2', props: { number: '9', character_ids: ['x'] } } },
    ]);
    await apply(file, [{ kind: 'move', id: 'f', parentId: 'new', sortKey: 'a' }]);
    // And an edit the restore does take back.
    await apply(file, [{ kind: 'update', id: 's3', set: { name: 'BRIDGE, LATER' } }]);
    await apply(file, [{ kind: 'trash', id: 'old' }]);
    const { emptyTrash } = await import('../../ops/ops');
    await emptyTrash(file);
    // Back to the point: the frame can't go back under a scene that's gone, so it and its scene stay as they are now,
    // and the scene's character with them.
    expect(await restoreTo(file, point)).not.toBeNull();
    expect((await getRecord(file, 'f'))?.parentId).toBe('new');
    expect((await getRecord(file, 's3'))?.props.name).toBe('THE BRIDGE');
    const records = Object.fromEntries((await loadRecords(file)).map((r) => [r.id, r]));
    expect(sceneCharacters(records, records.new as SbdRecord).map((c) => c.props.name)).toEqual(['Deputy']);
  });

  it('read a restored scene’s names, never an unnamed character for an empty one', () => {
    const at2 = at;
    const make = (id: string, type: SbdRecord['type'], props: SbdRecord['props']): SbdRecord => ({ id, type, parentId: 'p', sortKey: id, props, trashedAt: null, trashedBy: null, createdAt: at2, updatedAt: at2 });
    const records = { a: make('a', 'character', {}), b: make('b', 'character', { name: 'Mary' }), s: make('s', 'scene', { characters: ['', 'MARY'] }) };
    expect(sceneCharacters(records, records.s).map((c) => c.id)).toEqual(['b']);
  });
});

describe('the change itself', () => {
  const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: SbdRecord['props']): SbdRecord => ({
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

  it('matches within the scene’s own project, and leaves a file without names as it is', () => {
    let n = 0;
    const id = () => `new${String(++n)}`;
    const { created, changes } = characterIdChanges(
      [record('p', 'project', null, {}), record('q', 'project', null, {}), record('mq', 'character', 'q', { name: 'Mary' }), record('s', 'scene', 'p', { characters: ['Mary'] })],
      at,
      id,
    );
    expect(created.map((c) => [c.id, c.parentId, c.props.name])).toEqual([['new1', 'p', 'Mary']]);
    expect(changes[0]?.props).toEqual({ character_ids: ['new1'] });
    expect(characterIdChanges([record('s', 'scene', 'p', { number: '1' })], at)).toEqual({ created: [], changes: [] });
  });

  it('changes nothing run again on what it made', () => {
    const list = [record('p', 'project', null, {}), record('m', 'character', 'p', { name: 'Mary' }), record('s', 'scene', 'p', { number: '1', characters: ['Mary', 'Tom'] })];
    const once = characterIdChanges(list, at);
    const after = [...list.filter((r) => r.id !== 's'), ...once.created, { ...(list[2] as SbdRecord), props: once.changes[0]?.props ?? {} }];
    expect(characterIdChanges(after, at)).toEqual({ created: [], changes: [] });
  });
});

describe('approvals through the upgrade (3.18)', () => {
  it('stay current when they were current before it, by whichever rule gave them; one changed before stays changed', async () => {
    const path = await v11File();
    // Approvals given on the scenes as they were: 3.6b's, 3.15's and 3.18's (as schema 9 now carries one), and one
    // given before a change.
    const file = await nodeDriver.open(path);
    const before = Object.fromEntries((await loadRecords(file)).map((r) => [r.id, r]));
    const sign = (basis: string) => [{ name: 'Sam Reyes', roles: ['dp'], at, basis }];
    const basis = (scene: string, department: string) => approvalBasis(before, scene, department);
    const given = {
      s1: { camera: sign(basis('s1', 'camera').legacy), sound: sign(basis('s1', 'sound').v2), art: sign(basis('s1', 'art').current), hmu: sign('stale') },
      s2: { camera: sign(basis('s2', 'camera').legacy) },
    };
    for (const [id, approvals] of Object.entries(given)) {
      await file.tx([{ sql: `UPDATE records SET props = json_set(props, '$.department_approvals', json(?)) WHERE id = ?`, params: [JSON.stringify(approvals), id] }]);
    }
    // Schema 12 alone: schema 13 would repair what it missed.
    await migrate(file, { isNew: false, migrations: MIGRATIONS.slice(0, 12), now: () => new Date(late) });
    const after = Object.fromEntries((await loadRecords(file)).map((r) => [r.id, r]));
    await file.close();
    const state = (scene: string, department: string) =>
      approvalState(sceneApprovals(after[scene]?.props ?? {})[department] ?? [], approvalBasis(after, scene, department));
    expect(after.s1?.props.character_ids).toHaveLength(2);
    for (const department of ['camera', 'sound', 'art']) expect(state('s1', department)).toBe('approved');
    expect(state('s2', 'camera')).toBe('approved');
    expect(state('s1', 'hmu')).toBe('changed');
    // Each keeps the rule it was given under.
    const s1 = sceneApprovals(after.s1?.props ?? {});
    expect([s1.camera?.[0]?.basis.includes(':'), s1.sound?.[0]?.basis.slice(0, 2), s1.art?.[0]?.basis.slice(0, 2)]).toEqual([false, '2:', '3:']);
  });
});

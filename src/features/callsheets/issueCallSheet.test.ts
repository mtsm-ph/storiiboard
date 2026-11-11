import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectStore } from '../../app/projectStore';
import { callSheetIssues } from '../../core/model/callsheet';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { writeIssue, type IssueWrite } from './issueCallSheet';

// Writing an issue (4.7) against a real store and file: one edit, one undo, and a refusal said as a refusal.

let folder: TestFolder;
beforeEach(() => {
  folder = makeTestFolder();
});
afterEach(() => {
  folder.remove();
});

async function setUp() {
  const store = createProjectStore();
  const project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
  await store.getState().open(project);
  await store.getState().apply([
    { kind: 'create', record: { id: 'd', type: 'shoot_day', parentId: project.projectId, sortKey: 'a', props: { date: '2030-11-16', call_time: '07:00' } } },
    { kind: 'create', record: { id: 's1', type: 'scene', parentId: project.projectId, sortKey: 'a', props: { number: '1', name: 'Diner' } } },
    { kind: 'create', record: { id: 'a', type: 'shot', parentId: 's1', sortKey: 'a', props: { number: '1A', shoot_day_id: 'd' } } },
  ]);
  const write = (version: number): IssueWrite => ({
    projectId: project.projectId,
    dayId: 'd',
    version,
    author: 'local',
    issuedAt: new Date('2030-11-16T23:04:00Z'),
    zone: 'America/New_York',
    sha256: 'abc123',
    bytes: new Uint8Array([37, 80, 68, 70, 45]),
    byteSize: 5,
    name: 'Call sheet.pdf',
    fingerprint: 'f',
  });
  return { store, project, write };
}

describe('writing an issue', () => {
  it('writes the PDF record, the call sheet and the lock as one edit that one undo and redo take back and bring again', async () => {
    const { store, write } = await setUp();
    const result = await writeIssue(store, write(1));
    expect(result.kind).toBe('issued');
    const issues = () => callSheetIssues(store.getState().records, 'd');
    expect(issues().map((i) => [i.version, i.zone])).toEqual([[1, 'America/New_York']]);
    expect(store.getState().records.s1?.props.numbers_locked).toBe(true);
    await store.getState().undo();
    expect(issues()).toEqual([]);
    expect(store.getState().records.s1?.props.numbers_locked).not.toBe(true);
    await store.getState().redo();
    expect(issues().map((i) => i.version)).toEqual([1]);
    expect(store.getState().records.s1?.props.numbers_locked).toBe(true);
    await store.getState().close();
  });

  it('shows a refusal, not success, when the version moved while the PDF was being made, and writes nothing', async () => {
    const { store, write } = await setUp();
    await writeIssue(store, write(1));
    const before = store.getState().records;
    const result = await writeIssue(store, write(1));
    expect(result).toEqual({ kind: 'refused', reason: 'versionTaken' });
    expect(store.getState().records).toEqual(before);
    await store.getState().close();
  });

  it('refuses a day whose date was cleared meanwhile', async () => {
    const { store, write } = await setUp();
    await store.getState().apply([{ kind: 'update', id: 'd', set: { date: '' } }]);
    expect(await writeIssue(store, write(1))).toEqual({ kind: 'refused', reason: 'noDate' });
    await store.getState().close();
  });

  it('says the edit was dropped when no project is open any more, rather than a write error', async () => {
    const { store, write } = await setUp();
    await store.getState().close();
    expect(await writeIssue(store, write(1))).toEqual({ kind: 'dropped' });
  });
});

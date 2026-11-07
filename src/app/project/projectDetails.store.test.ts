import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientChange, deliverablesChange, projectDetails } from '../../core/model/projectDetails';
import type { Props } from '../../core/model/record';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { changeLabel, changeValue, fieldChanges, valueLabel } from '../../features/history/summary';
import { createProjectStore } from '../projectStore';
import { detailsEdit } from './ProjectHome';

// Production details (3.1) as the store applies them: each change worked out from the project as it is at its turn,
// so edits a moment apart all land; and as History reads them.

let folder: TestFolder;
let project: Project;
beforeEach(async () => {
  folder = makeTestFolder();
  project = await createProject(folder.path('Bey County.sbd'), { driver: nodeDriver, backups: false });
});
afterEach(async () => {
  await project.close();
  folder.remove();
});

describe('production details in the store (3.1)', () => {
  it('lands two edits fired before the first is written: a rename and a tick, and two client fields', async () => {
    const store = createProjectStore();
    await store.getState().open(project);
    const id = project.projectId;
    // As Settings → Project applies them (ProjectHome).
    const change = (build: (props: Props) => Props) => store.getState().applyWith((now) => ({ changes: detailsEdit(now, id, build) }));
    await change((props) => deliverablesChange(props, () => [{ id: 'd1', text: 'Master', done: false }, { id: 'd2', text: 'Cutdowns', done: false }]));
    // Neither awaited before the other is fired.
    await Promise.all([
      change((props) => deliverablesChange(props, (items) => items.map((i) => (i.id === 'd1' ? { ...i, text: '60s master' } : i)))),
      change((props) => deliverablesChange(props, (items) => items.map((i) => (i.id === 'd2' ? { ...i, done: true } : i)))),
      change((props) => clientChange(props, 'name', 'Ana Ruiz')),
      change((props) => clientChange(props, 'company', 'Bey Foods')),
    ]);
    const details = projectDetails(store.getState().records[id]?.props);
    expect(details.deliverables).toEqual([
      { id: 'd1', text: '60s master', done: false },
      { id: 'd2', text: 'Cutdowns', done: true },
    ]);
    expect(details.client).toMatchObject({ name: 'Ana Ruiz', company: 'Bey Foods' });
    // A second Remove of a row already gone writes no step.
    const remove = () => change((props) => deliverablesChange(props, (items) => items.filter((i) => i.id !== 'd1')));
    await remove();
    const steps = (await project.file.query('SELECT count(*) AS n FROM op_groups'))[0]?.n;
    await remove();
    expect((await project.file.query('SELECT count(*) AS n FROM op_groups'))[0]?.n).toBe(steps);
  });
});

describe('production details in History (3.1)', () => {
  const record = (props: Props) => ({
    id: 'p',
    type: 'project' as const,
    parentId: null,
    sortKey: 'V',
    props,
    trashedAt: null,
    trashedBy: null,
    createdAt: '2026-11-07T12:00:00.000Z',
    updatedAt: '2026-11-07T12:00:00.000Z',
  });

  it('names a stage in words, and each deliverable that changed by its text, however long the list', () => {
    expect(valueLabel('stage', 'pending_invoice')).toBe('Pending invoice');
    const items = ['60s TVC master', '30s cutdown', '15s cutdown', '3 × 9:16 cutdowns'].map((text, i) => ({ id: `d${String(i)}`, text, done: false }));
    const line = (before: Props, after: Props) =>
      fieldChanges(record(before), record(after)).map((c) => `${changeLabel(c)}: ${changeValue(c, c.before)} → ${changeValue(c, c.after)}`);
    // The last one ticked: the line names it, not the whole list.
    expect(line({ deliverables: items }, { deliverables: items.map((i) => (i.id === 'd3' ? { ...i, done: true } : i)) })).toEqual([
      'deliverable: 3 × 9:16 cutdowns → 3 × 9:16 cutdowns (delivered)',
    ]);
    expect(line({ deliverables: items.slice(0, 1) }, { deliverables: items.slice(0, 2) })).toEqual(['deliverable: — → 30s cutdown']);
    expect(line({ deliverables: items.slice(0, 2) }, { deliverables: items.slice(1, 2) })).toEqual(['deliverable: 60s TVC master → —']);
  });

  it('lists a client change field by field, saying an email or phone was set without showing it', () => {
    const before = record({ client: { name: 'Ana', email: 'ana@example.com' } });
    const after = record({ client: { name: 'Ana Ruiz', email: 'ana.ruiz@example.com', phone: '+1 212 555 0100' } });
    const changes = fieldChanges(before, after);
    const lines = changes.map((c) => `${changeLabel(c)}: ${changeValue(c, c.before)} → ${changeValue(c, c.after)}`);
    expect(lines).toEqual(['client name: Ana → Ana Ruiz', 'client email: changed → changed', 'client phone: — → not shown']);
    expect(lines.join(' ')).not.toMatch(/example\.com|555/);
    // A field this version doesn't know (a later one's address) is never shown either.
    const later = fieldChanges(record({ client: {} }), record({ client: { address: '12 Diner Rd' } }));
    expect(later.map((c) => changeValue(c, c.after))).toEqual(['not shown']);
  });
});

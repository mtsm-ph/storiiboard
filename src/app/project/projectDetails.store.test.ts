import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clientChange, deliverablesChange, projectDetails } from '../../core/model/projectDetails';
import type { Props } from '../../core/model/record';
import { nodeDriver } from '../../core/storage/nodeDriver';
import { createProject, type Project } from '../../core/storage/project';
import { makeTestFolder, type TestFolder } from '../../core/storage/testFolder';
import { changeLabel, changeValue, fieldChanges, valueLabel } from '../../features/history/summary';
import { createProjectStore } from '../projectStore';

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
    const change = (build: (props: Props) => Props) =>
      store.getState().applyWith((now) => {
        const current = now[id];
        return { changes: current ? [{ kind: 'update', id, set: build(current.props) }] : [] };
      });
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

  it('names a stage in words, and a checklist by its items, never their ids', () => {
    expect(valueLabel('stage', 'pending_invoice')).toBe('Pending invoice');
    expect(valueLabel('deliverables', [{ id: 'd1', text: '60s master', done: true }, { id: 'd2', text: 'Cutdowns', done: false }])).toBe(
      '60s master (delivered), Cutdowns',
    );
    expect(valueLabel('deliverables', [])).toBe('—');
  });

  it('lists a client change field by field, saying an email or phone was set without showing it', () => {
    const before = record({ client: { name: 'Ana', email: 'ana@example.com' } });
    const after = record({ client: { name: 'Ana Ruiz', email: 'ana.ruiz@example.com', phone: '+1 212 555 0100' } });
    const changes = fieldChanges(before, after);
    const lines = changes.map((c) => `${changeLabel(c)}: ${changeValue(c, c.before)} → ${changeValue(c, c.after)}`);
    expect(lines).toEqual(['client name: Ana → Ana Ruiz', 'client email: not shown → not shown', 'client phone: — → not shown']);
    expect(lines.join(' ')).not.toMatch(/example\.com|555/);
  });
});

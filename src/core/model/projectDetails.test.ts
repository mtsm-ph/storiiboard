import { describe, expect, it } from 'vitest';
import { clientChange, deliverablesChange, PROJECT_STAGE_LABEL, PROJECT_STAGES, projectDetails } from './projectDetails';

// A project's production details (3.1): read from the project record's props, never dropping what this version
// doesn't know.

describe('a project’s production details', () => {
  it('reads each detail, and an unset or odd one as empty', () => {
    expect(projectDetails(undefined)).toEqual({
      stage: null,
      logline: '',
      format: '',
      runtime: '',
      client: { name: '', company: '', email: '', phone: '' },
      deliverables: [],
    });
    const details = projectDetails({
      stage: 'production',
      logline: 'A diner at the end of the county line.',
      format: 'TVC · 60s',
      runtime: '60s',
      client: { name: 'Ana Ruiz', company: 'Bey Foods', email: 'ana@example.com', phone: '+1 212 555 0100' },
      deliverables: [{ id: 'd1', text: '60s master', done: true }, { id: 'd2', text: '3 × 9:16 cutdowns' }, 'not one', { text: 'no id' }],
    });
    expect(details.stage).toBe('production');
    expect(details.client.company).toBe('Bey Foods');
    expect(details.deliverables).toEqual([
      { id: 'd1', text: '60s master', done: true },
      { id: 'd2', text: '3 × 9:16 cutdowns', done: false },
    ]);
    // A stage this version doesn't know isn't shown as one it does; the state is a different prop.
    expect(projectDetails({ stage: 'archived', state: 'archived' }).stage).toBeNull();
  });

  it('names every stage, in the order a job goes through them', () => {
    expect(PROJECT_STAGES[0]).toBe('discovery');
    expect(PROJECT_STAGES.at(-1)).toBe('complete');
    for (const stage of PROJECT_STAGES) expect(PROJECT_STAGE_LABEL[stage]).not.toBe('');
  });

  it('changes one client field or deliverable and keeps every other field, even ones it doesn’t know', () => {
    const props = { client: { name: 'Ana', agency: 'Bright' }, deliverables: [{ id: 'd1', text: 'Master', done: false, due: '2026-12-01' }] };
    expect(clientChange(props, 'phone', '555')).toEqual({ client: { name: 'Ana', agency: 'Bright', phone: '555' } });
    expect(deliverablesChange(props, (items) => items.map((item) => ({ ...item, done: true })))).toEqual({
      deliverables: [{ id: 'd1', text: 'Master', done: true, due: '2026-12-01' }],
    });
    expect(deliverablesChange(undefined, (items) => [...items, { id: 'd2', text: 'Cutdown', done: false }])).toEqual({
      deliverables: [{ id: 'd2', text: 'Cutdown', done: false }],
    });
  });
});

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SbdRecord } from '../../core/model/record';
import { ProjectFields } from './ProjectHome';

const record = (props: SbdRecord['props']): SbdRecord => ({
  id: 'p',
  type: 'project',
  parentId: null,
  sortKey: 'V',
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: '2026-11-02T14:05:00.000Z',
  updatedAt: '2026-11-02T14:05:00.000Z',
});

describe('the Project tile', () => {
  it('shows the project’s state, reading a file without one as active', () => {
    const checked = (html: string) => /aria-checked="true"[^>]*>([^<]+)</.exec(html)?.[1];
    expect(checked(renderToString(<ProjectFields record={record({ title: 'Bey', state: 'draft' })} error={null} onChange={() => undefined} />))).toBe('Draft');
    expect(checked(renderToString(<ProjectFields record={record({ title: 'Bey' })} error={null} onChange={() => undefined} />))).toBe('Active');
  });
});

describe('the Project tile’s production details (3.1)', () => {
  it('shows the stage, the client and each deliverable as a box its state can be read from', async () => {
    const { ProjectDetailsFields } = await import('./ProjectDetailsFields');
    const html = renderToString(
      <ProjectDetailsFields
        record={record({
          stage: 'editing',
          client: { company: 'Bey Foods' },
          deliverables: [
            { id: 'd1', text: '60s master', done: true },
            { id: 'd2', text: 'Cutdowns', done: false },
          ],
        })}
        onChange={() => undefined}
      />,
    );
    expect(html).toMatch(/<option value="editing" selected="">Editing<\/option>/);
    expect(html).toContain('value="Bey Foods"');
    expect(html).toMatch(/role="checkbox" aria-checked="true" aria-label="Delivered: 60s master"/);
    expect(html).toMatch(/role="checkbox" aria-checked="false" aria-label="Delivered: Cutdowns"/);
    expect(html).toContain('aria-label="Remove deliverable: Cutdowns"');
  });
});

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

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { personStretches } from '../../core/model/availability';
import type { Props, SbdRecord } from '../../core/model/record';
import { UnavailableDates } from './UnavailableDates';

// Cast and crew's unavailable dates (7.3, round 2): standing alone, each row and its Remove say the year, so two
// stretches a year apart never read, or are named, alike.

const at = '2026-11-21T10:00:00.000Z';
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
const away = (id: string, from: string, to: string) => record(id, 'availability', 'robin', { from, to, state: 'unavailable', note: '' });

describe('Cast and crew’s unavailable dates', () => {
  it('names two stretches a year apart differently, rows and Remove buttons alike', () => {
    const records = Object.fromEntries(
      [record('p', 'project', null, {}), record('robin', 'person', 'p', { name: 'Robin Vale' }), away('a', '2026-11-24', '2026-11-28'), away('b', '2027-11-24', '2027-11-28')].map((r) => [r.id, r]),
    );
    const html = renderToString(<UnavailableDates stretches={personStretches(records, 'robin')} onAdd={() => Promise.resolve(true)} onRemove={() => Promise.resolve(true)} />);
    expect(html).toContain('aria-label="Remove unavailable dates Nov 24 – Nov 28, 2026"');
    expect(html).toContain('aria-label="Remove unavailable dates Nov 24 – Nov 28, 2027"');
    expect(html).toContain('>Nov 24 – Nov 28, 2026<');
    expect(html).toContain('>Nov 24 – Nov 28, 2027<');
  });
});

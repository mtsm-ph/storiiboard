import { describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from '../../core/model/record';
import { keyBetween } from '../../core/ops/order';
import { newDay } from './dayEdits';

// A new shoot day past a sort key keyBetween can't read (6.23, Kevin: an odd imported file never makes the app throw):
// after the last key that can be read; a sound schedule's key is keyBetween's, as before.

const at = '2026-11-16T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt: null,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]) => Object.fromEntries(list.map((r) => [r.id, r]));

describe('a shoot day past an odd key (6.23)', () => {
  it('goes after the last readable key; a sound schedule’s key as before', () => {
    const project = record('p', 'project', null, { name: 'Odd' });
    const odd = recordsOf(project, record('d1', 'shoot_day', 'p', { date: '2026-12-01' }, 'b'), record('d2', 'shoot_day', 'p', { date: '2026-12-02' }, '~'));
    const made = newDay(odd, 'p', '2026-11-16', 'd3');
    expect(made.record.sortKey).toBe(keyBetween('b', null));
    expect(made.record.props?.date).toBe('2026-12-03');
    const sound = recordsOf(project, record('d1', 'shoot_day', 'p', { date: '2026-12-01' }, 'b'), record('d2', 'shoot_day', 'p', { date: '2026-12-02' }, 'd'));
    expect(newDay(sound, 'p', '2026-11-16', 'd3').record.sortKey).toBe(keyBetween('d', null));
  });
});

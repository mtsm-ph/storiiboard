import { describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from '../../core/model/record';
import { keyBetween } from '../../core/ops/order';
import { newGearItem } from './gearEdits';

// A new gear item past a sort key keyBetween can't read (6.23, Kevin: an odd imported file never makes the app throw): after
// the last key that can be read; a sound catalogue's key is keyBetween's, as before.

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

describe('a gear item past an odd key (6.23)', () => {
  it('goes after the last readable key; a sound catalogue’s key as before', () => {
    const project = record('p', 'project', null, { name: 'Odd' });
    const odd = recordsOf(project, record('g1', 'gear_item', 'p', { name: 'C-stand' }, 'b'), record('g2', 'gear_item', 'p', { name: 'Flag' }, '~'));
    expect(newGearItem(odd, 'p', 'g3').record.sortKey).toBe(keyBetween('b', null));
    const sound = recordsOf(project, record('g1', 'gear_item', 'p', { name: 'C-stand' }, 'b'), record('g2', 'gear_item', 'p', { name: 'Flag' }, 'd'));
    expect(newGearItem(sound, 'p', 'g3').record.sortKey).toBe(keyBetween('d', null));
    expect(newGearItem(recordsOf(project), 'p', 'g3').record.sortKey).toBe(keyBetween(null, null));
  });
});

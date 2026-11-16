import { describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from '../../core/model/record';
import { keyBetween } from '../../core/ops/order';
import { newPerson } from './personEdits';

// A new person past a sort key keyBetween can't read (6.23, Kevin: an odd imported file never makes the app throw): after
// the last key that can be read; a sound list's key is keyBetween's, as before.

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

describe('a person past an odd key (6.23)', () => {
  it('goes after the last readable key; a sound list’s key as before', () => {
    const project = record('p', 'project', null, { name: 'Odd' });
    const odd = recordsOf(project, record('a', 'person', 'p', { name: 'Ana' }, 'b'), record('b', 'person', 'p', { name: 'Ben' }, '~'));
    expect(newPerson(odd, 'p', 'c').record.sortKey).toBe(keyBetween('b', null));
    const sound = recordsOf(project, record('a', 'person', 'p', { name: 'Ana' }, 'b'), record('b', 'person', 'p', { name: 'Ben' }, 'd'));
    expect(newPerson(sound, 'p', 'c').record.sortKey).toBe(keyBetween('d', null));
  });
});

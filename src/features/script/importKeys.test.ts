import { describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import { keyBetween } from '../../core/ops/order';
import { importChanges, type ImportPlan } from './importScript';

// A script imported into a board holding sort keys keyBetween can't read (6.23, Kevin: an odd imported file never makes
// the app throw): each type's new records after its last readable key, each next after the one before; a sound board's
// keys are keyBetween's, as before.

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

const scene = (number: string) => ({
  scene: { number, heading: `INT. DINER - DAY`, intExt: 'INT' as const, location: 'DINER', dayNight: 'DAY' as const, otherTime: null, characters: ['ANA'], eighths: 8 },
  number,
  status: 'new' as const,
  note: null,
});
const plan: ImportPlan = { title: null, scenes: [scene('2'), scene('3')], locations: { created: ['DINER'], linked: [] }, characters: { created: ['ANA'], linked: [] } };

/** The keys made for each type, in order. */
const keysByType = (changes: readonly Change[]) => {
  const keys: Record<string, string[]> = {};
  for (const c of changes) if (c.kind === 'create') (keys[c.record.type] ??= []).push(c.record.sortKey);
  return keys;
};

describe('a script imported past odd keys (6.23)', () => {
  it('puts each type’s records after its last readable key; a sound board’s keys as before', () => {
    const project = record('p', 'project', null, { name: 'Odd' });
    const odd = recordsOf(
      project,
      record('s1', 'scene', 'p', { number: '1', name: '' }, 'b'),
      record('s9', 'scene', 'p', { number: '9', name: '' }, '~'),
      record('l1', 'location', 'p', { name: 'Motel' }, '~'),
      record('c1', 'character', 'p', { name: 'BEN' }, '!'),
    );
    const first = (key: string | null) => keyBetween(key, null);
    expect(keysByType(importChanges(odd, 'p', plan))).toEqual({
      location: [first(null)],
      character: [first(null)],
      scene: [first('b'), first(first('b'))],
    });
    const sound = recordsOf(
      project,
      record('s1', 'scene', 'p', { number: '1', name: '' }, 'b'),
      record('l1', 'location', 'p', { name: 'Motel' }, 'd'),
      record('c1', 'character', 'p', { name: 'BEN' }, 'e'),
    );
    expect(keysByType(importChanges(sound, 'p', plan))).toEqual({
      location: [first('d')],
      character: [first('e')],
      scene: [first('b'), first(first('b'))],
    });
  });
});

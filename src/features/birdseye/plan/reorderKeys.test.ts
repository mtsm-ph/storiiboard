import { describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from '../../../core/model/record';
import type { Change } from '../../../core/ops/ops';
import { keyBetween } from '../../../core/ops/order';
import { reorderPlanChanges } from './planItems';

// Bring to front and Send to back on a plan past a sort key keyBetween can't read (6.23, Kevin: "an unreadable one from
// an odd imported file never makes it throw"): the plan's items are written afresh in the order asked for; a sound
// file's keys are keyBetween's, as before.

type Records = Record<string, SbdRecord>;

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
const recordsOf = (...list: SbdRecord[]): Records => Object.fromEntries(list.map((r) => [r.id, r]));
const table = (id: string, sortKey: string, x: number) => record(id, 'plan_item', 'room', { kind: 'icon', icon: 'set-art/table', x, y: 0, width: 1, height: 1, rotation: 0 }, sortKey);

/** The changes as the store would apply them (moves only here). */
function applied(records: Records, changes: readonly Change[]): Records {
  const next: Records = { ...records };
  for (const change of changes) {
    if (change.kind !== 'move') throw new Error(`unexpected ${change.kind}`);
    const was = next[change.id];
    if (!was) throw new Error(`no ${change.id}`);
    next[change.id] = { ...was, parentId: change.parentId, sortKey: change.sortKey };
  }
  return next;
}

/** The room's items back to front, as their keys sort. */
const drawn = (records: Records): string[] =>
  Object.values(records)
    .filter((r) => r.parentId === 'room')
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    .map((r) => r.id);

const ODD = '~';

const plan = (keys: [string, string, string]) =>
  recordsOf(record('p', 'project', null, { name: 'Odd' }), record('room', 'plan', 'p', { kind: 'room', name: '' }), table('t1', keys[0], 0), table('t2', keys[1], 2), table('t3', keys[2], 4));

describe('Bring to front and Send to back on a plan past an odd key (6.23)', () => {
  it('gives the order asked for, the changes apply', () => {
    const odd = plan(['b', 'd', ODD]);
    expect(drawn(odd)).toEqual(['t1', 't2', 't3']);
    const front = reorderPlanChanges(odd, ['t1'], 'front');
    expect(drawn(applied(odd, front))).toEqual(['t2', 't3', 't1']);
    const forward = reorderPlanChanges(odd, ['t2'], 'forward');
    expect(drawn(applied(odd, forward))).toEqual(['t1', 't3', 't2']);
    // "!" sorts before every digit: an odd first key.
    const first = plan(['!', 'd', 'e']);
    const back = reorderPlanChanges(first, ['t3'], 'back');
    expect(drawn(applied(first, back))).toEqual(['t3', 't1', 't2']);
    const backward = reorderPlanChanges(first, ['t2'], 'backward');
    expect(drawn(applied(first, backward))).toEqual(['t2', 't1', 't3']);
  });

  it('a sound file’s key is keyBetween’s, the one item moved', () => {
    const sound = plan(['b', 'd', 'e']);
    expect(reorderPlanChanges(sound, ['t1'], 'front')).toEqual([{ kind: 'move', id: 't1', parentId: 'room', sortKey: keyBetween('e', null) }]);
    expect(reorderPlanChanges(sound, ['t3'], 'back')).toEqual([{ kind: 'move', id: 't3', parentId: 'room', sortKey: keyBetween(null, 'b') }]);
  });
});

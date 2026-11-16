import { describe, expect, it } from 'vitest';
import type { Change } from '../ops/ops';
import { keyBetween } from '../ops/order';
import type { Props, SbdRecord } from './record';
import { addSetup, moveSetup, sceneSetups } from './setup';

// Adding and reordering setups past a sort key keyBetween can't read (6.23, Kevin: "an unreadable one from an odd
// imported file never makes it throw"): a new setup goes after the last key that can be read; a reorder keeps the order
// asked for, the scene's setups written afresh in one group. A sound file's keys are keyBetween's.

type Records = Record<string, SbdRecord>;

const at = '2026-11-16T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = id, trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt,
  trashedBy: trashedAt === null ? null : 'local',
  createdAt: at,
  updatedAt: at,
});
const recordsOf = (...list: SbdRecord[]): Records => Object.fromEntries(list.map((r) => [r.id, r]));

/** The changes as the store would apply them: a create or a move. */
function applied(records: Records, changes: readonly Change[]): Records {
  const next: Records = { ...records };
  for (const change of changes) {
    if (change.kind === 'create') {
      const id = change.record.id;
      if (id) next[id] = { ...change.record, id, props: change.record.props ?? {}, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at };
    } else if (change.kind === 'move') {
      const was = next[change.id];
      if (!was) throw new Error(`no ${change.id}`);
      next[change.id] = { ...was, parentId: change.parentId, sortKey: change.sortKey };
    }
  }
  return next;
}

const ODD = '~';
const scene = (...setups: [string, string, boolean?][]) =>
  recordsOf(
    record('p', 'project', null, { name: 'Odd' }),
    record('s1', 'scene', 'p', { number: '1' }),
    ...setups.map(([id, key, trashed]) => record(id, 'setup', 's1', { name: '' }, key, trashed ? at : null)),
  );
const shown = (records: Records) => sceneSetups(records, 's1').map((s) => s.record.id);
/** Every setup of the scene, the Trash's too, as their keys sort. */
const everySetup = (records: Records) =>
  Object.values(records)
    .filter((r) => r.type === 'setup')
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
    .map((r) => r.id);

describe('setups past a key that can’t be read (6.23)', () => {
  it('adds a setup after the last readable key; a sound scene’s key as before', () => {
    const odd = scene(['u1', 'b'], ['u2', ODD]);
    const changes = addSetup(odd, 's1', 'u3');
    const after = applied(odd, changes);
    expect(after.u3?.sortKey).toBe(keyBetween('b', null));
    expect(shown(after)).toContain('u3');
    const sound = scene(['u1', 'b'], ['u2', 'd', true]);
    expect(addSetup(sound, 's1', 'u3')).toEqual([{ kind: 'create', record: { id: 'u3', type: 'setup', parentId: 's1', sortKey: keyBetween('d', null), props: { name: '' } } }]);
  });

  it('reorders setups past an odd key in the order asked for, the Trash’s keeping their place', () => {
    const odd = scene(['u1', 'b'], ['u2', 'd'], ['gone', 'e', true], ['u3', ODD]);
    expect(shown(odd)).toEqual(['u1', 'u2', 'u3']);
    const last = applied(odd, moveSetup(odd, 'u1', 2));
    expect(shown(last)).toEqual(['u2', 'u3', 'u1']);
    // The one in the Trash keeps its place among the rest: still between u2 and u3, so a restore puts it back there.
    expect(everySetup(last)).toEqual(['u2', 'gone', 'u3', 'u1']);
    const first = applied(odd, moveSetup(odd, 'u3', 0));
    expect(shown(first)).toEqual(['u3', 'u1', 'u2']);
    // Two sharing a key: the order shown, with the move made.
    const tied = scene(['u1', 'b'], ['u2', 'b'], ['u3', 'd']);
    const before = shown(tied);
    const moved = applied(tied, moveSetup(tied, before[2] ?? '', 1));
    expect(shown(moved)).toEqual([before[0], before[2], before[1]]);
    for (const records of [last, first, moved]) {
      const keys = Object.values(records).filter((r) => r.type === 'setup').map((r) => r.sortKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('a sound scene’s reorder writes the one move it wrote before', () => {
    const sound = scene(['u1', 'b'], ['u2', 'd'], ['u3', 'f']);
    expect(moveSetup(sound, 'u1', 1)).toEqual([{ kind: 'move', id: 'u1', parentId: 's1', sortKey: keyBetween('d', 'f') }]);
    expect(moveSetup(sound, 'u3', 0)).toEqual([{ kind: 'move', id: 'u3', parentId: 's1', sortKey: keyBetween(null, 'b') }]);
    expect(moveSetup(sound, 'u1', 2)).toEqual([{ kind: 'move', id: 'u1', parentId: 's1', sortKey: keyBetween('f', null) }]);
  });
});

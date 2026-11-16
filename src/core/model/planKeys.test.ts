import { describe, expect, it } from 'vitest';
import type { Change } from '../ops/ops';
import { keyBetween } from '../ops/order';
import { keyAfterLast, keyBetweenStored, lastKeyUnder, markFields, newRoomChanges, wallsAlong } from './plan';
import { movePositionChanges, placeMarkChanges, viewBlocking } from './planBlocking';
import { copySetupChanges, setupOnlyChanges } from './planRooms';
import type { Props, SbdRecord } from './record';

// The plan's writes never throw on a sort key an imported file holds that keyBetween can't read (6.22, Kevin: "an odd
// imported file must never make the app throw"): each new key goes after the last key that can be read, the odd records
// keeping theirs; a sound file gets exactly the key it got before.

type Records = Record<string, SbdRecord>;

const at = '2026-11-15T10:00:00.000Z';
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
const box = (x: number, y: number, size = 0.5) => ({ x: x - size / 2, y: y - size / 2, width: size, height: size, rotation: 0 });
const mark = (id: string, parentId: string, sortKey: string, props: Props, x = 0, y = 0) => record(id, 'plan_item', parentId, { kind: 'mark', icon: 'cast/cast-mark', ...box(x, y), ...props }, sortKey);
const table = (id: string, parentId: string, sortKey: string, trashed = false) =>
  record(id, 'plan_item', parentId, { kind: 'icon', icon: 'set-art/table', ...box(2, 2, 1) }, sortKey, trashed ? at : null);

/** The changes as the store would apply them: a create, an update or a move. */
function applied(records: Records, changes: readonly Change[]): Records {
  const next: Records = { ...records };
  for (const change of changes) {
    if (change.kind === 'create') {
      const id = change.record.id;
      if (id) next[id] = { ...change.record, id, props: change.record.props ?? {}, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at };
    } else if (change.kind === 'update') {
      const was = next[change.id];
      if (!was) throw new Error(`no ${change.id}`);
      const gone = new Set(change.unset ?? []);
      next[change.id] = { ...was, props: Object.fromEntries(Object.entries({ ...was.props, ...(change.set ?? {}) }).filter(([key]) => !gone.has(key))) };
    } else if (change.kind === 'move') {
      const was = next[change.id];
      if (!was) throw new Error(`no ${change.id}`);
      next[change.id] = { ...was, parentId: change.parentId, sortKey: change.sortKey };
    }
  }
  return next;
}

/** A key keyBetween can't go after: it sorts after every base-62 digit, as an imported file's might. */
const ODD = '~';

/** Every key a set of changes writes. */
const keysOf = (changes: readonly Change[]): string[] => changes.flatMap((c) => (c.kind === 'create' ? [c.record.sortKey] : c.kind === 'move' ? [c.sortKey] : []));

/** Scene 1 with ANA, a room, its blocking with three of ANA's marks, two setups each with its own plan, a camera in u1's. */
const base = (): Records =>
  recordsOf(
    record('p', 'project', null, { name: 'Bey County' }),
    record('ana', 'character', 'p', { name: 'ANA' }),
    record('room', 'plan', 'p', { kind: 'room', name: 'Diner' }),
    record('s1', 'scene', 'p', { number: '1', character_ids: ['ana'], room_id: 'room' }),
    record('blk', 'plan', 's1', { kind: 'blocking', name: '' }),
    record('u1', 'setup', 's1', { name: '' }, 'a'),
    record('u2', 'setup', 's1', { name: '' }, 'b'),
    record('own1', 'plan', 'u1', { kind: 'setup', name: '' }),
    record('own2', 'plan', 'u2', { kind: 'setup', name: '' }),
    mark('a1', 'blk', 'b', { character_id: 'ana', order: 'b' }, 0, 0),
    mark('a2', 'blk', 'd', { character_id: 'ana', icon: 'cast/next-position', order: 'd' }, 1, 0),
    mark('a3', 'blk', 'e', { character_id: 'ana', icon: 'cast/next-position', order: 'e' }, 2, 0),
    record('cam', 'plan_item', 'own1', { kind: 'camera', icon: 'camera/camera', ...box(0, 0, 0.4) }, 'a'),
  );
const v1 = { sceneId: 's1', setupId: 'u1' };

describe('a key between two stored ones (6.22)', () => {
  it('is keyBetween’s for two it can read in order, else after the last readable one', () => {
    expect(keyBetweenStored('b', 'c', 'e')).toBe(keyBetween('b', 'c'));
    expect(keyBetweenStored('e', null, 'e')).toBe(keyBetween('e', null));
    expect(keyBetweenStored(ODD, 'c', 'e')).toBe(keyBetween('e', null));
    expect(keyBetweenStored('b', ODD, 'e')).toBe(keyBetween('e', null));
    expect(keyBetweenStored('c', 'b', 'e')).toBe(keyBetween('e', null));
    expect(keyBetweenStored(ODD, null, ODD)).toBe(keyBetween(null, null));
  });

  it('after the last of a parent’s children: keyBetween’s in a sound file, after the last readable past an odd key', () => {
    expect(() => keyBetween(ODD, null)).toThrow();
    const sound = base();
    expect(keyAfterLast(sound, 'blk', 'plan_item')).toBe(keyBetween(lastKeyUnder(sound, 'blk', 'plan_item'), null));
    const odd = { ...sound, t: table('t', 'blk', ODD) };
    expect(keyAfterLast(odd, 'blk', 'plan_item')).toBe(keyBetween('e', null));
    expect(keyAfterLast(recordsOf(table('only', 'blk', ODD)), 'blk', 'plan_item')).toBe(keyBetween(null, null));
  });
});

describe('the plan’s writes past an odd key (6.22)', () => {
  it('draws a wall run after the last readable key, the changes apply; a sound file’s keys as before', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
    ];
    const sound = base();
    const plain = wallsAlong(sound, 'room', points);
    expect(keysOf(plain.changes)[0]).toBe(keyBetween(lastKeyUnder(sound, 'room', 'plan_item'), null));
    const odd = { ...sound, t: table('t', 'room', ODD) };
    const run = wallsAlong(odd, 'room', points);
    expect(run.ids).toHaveLength(2);
    const after = applied(odd, run.changes);
    expect(run.ids.map((id) => after[id]?.parentId)).toEqual(['room', 'room']);
    const [first = '', second = ''] = keysOf(run.changes);
    expect(first).toBe(keyBetween(null, null));
    expect(second > first).toBe(true);
  });

  it('starts a room after the project’s last readable plan key', () => {
    const sound = base();
    expect(keysOf(newRoomChanges(sound, 'p', 's1', 'r2'))).toEqual([keyBetween(lastKeyUnder(sound, 'p', 'plan'), null)]);
    const odd = { ...sound, gone: record('gone', 'plan', 'p', { kind: 'room', name: '' }, ODD, at) };
    const changes = newRoomChanges(odd, 'p', 's1', 'r2');
    expect(applied(odd, changes).s1?.props.room_id).toBe('r2');
  });

  it('places a mark past an odd key in the blocking, and makes a blocking plan past an odd plan key', () => {
    const sound = base();
    const plain = placeMarkChanges(sound, v1, { x: 3, y: 0 }, { width: 0.5, depth: 0.5 }, 'ana', 'm');
    expect(keysOf(plain)).toEqual([keyBetween(lastKeyUnder(sound, 'blk', 'plan_item'), null)]);
    const odd = { ...sound, t: table('t', 'blk', ODD) };
    const placed = placeMarkChanges(odd, v1, { x: 3, y: 0 }, { width: 0.5, depth: 0.5 }, 'ana', 'm');
    const after = applied(odd, placed);
    expect(after.m?.parentId).toBe('blk');
    expect((after.m?.sortKey ?? '') > 'e').toBe(true);
    // A scene with no blocking yet, a trashed plan under it holding an odd key: the plan is made after the readable ones.
    const bare = { ...sound, s3: record('s3', 'scene', 'p', { number: '3', room_id: 'room' }), old: record('old', 'plan', 's3', { kind: 'blocking', name: '' }, ODD, at) };
    const made = placeMarkChanges(bare, { sceneId: 's3', setupId: null }, { x: 0, y: 0 }, { width: 0.5, depth: 0.5 }, null, 'm3', 'blk3');
    expect(applied(bare, made).m3?.parentId).toBe('blk3');
  });

  it('reorders a mark among marks with odd keys and an order it can’t read; a sound file’s order as before', () => {
    const sound = base();
    expect(movePositionChanges(sound, v1, 'a2', 1)).toEqual([{ kind: 'update', id: 'a2', set: { order: keyBetween('e', null) } }]);
    expect(movePositionChanges(sound, v1, 'a2', -1)).toEqual([{ kind: 'update', id: 'a2', set: { order: keyBetween(null, 'b') } }]);
    // Odd sort keys on every mark, and a3's order one no key reads (it reads as none: made sound in the same group).
    const odd = {
      ...sound,
      a1: { ...(sound.a1 as SbdRecord), sortKey: ODD },
      a2: { ...(sound.a2 as SbdRecord), sortKey: `${ODD}${ODD}` },
      a3: { ...(sound.a3 as SbdRecord), sortKey: '!', props: { ...sound.a3?.props, order: ODD } },
    };
    for (const by of [1, -1] as const) {
      const changes = movePositionChanges(odd, v1, 'a2', by);
      expect(changes.length).toBeGreaterThan(0);
      const after = applied(odd, changes);
      expect(markFields(after.a2?.props ?? {})?.order).not.toBeNull();
    }
  });

  it('reorders among two marks sharing an order as the view shows them, renumbering the sequence (6.22 review)', () => {
    // A 'b' (made first), B 'b', C 'c': the view shows A, B, C; soundOrders would give B a fresh order after C's.
    const shared = recordsOf(
      ...Object.values(base()).filter((r) => !['a1', 'a2', 'a3'].includes(r.id)),
      { ...mark('ma', 'blk', 'b', { character_id: 'ana', order: 'b' }, 0, 0), createdAt: '2026-11-15T09:00:00.000Z' },
      mark('mb', 'blk', 'c', { character_id: 'ana', order: 'b' }, 1, 0),
      mark('mc', 'blk', 'd', { character_id: 'ana', order: 'c' }, 2, 0),
    );
    const viewIds = (records: Records) =>
      viewBlocking(records, 's1', 'u1').characters.find((c) => c.owner.id === 'ana')?.positions.map((p) => p.record.id) ?? [];
    expect(viewIds(shared)).toEqual(['ma', 'mb', 'mc']);
    const later = applied(shared, movePositionChanges(shared, v1, 'ma', 1));
    expect(viewIds(later)).toEqual(['mb', 'ma', 'mc']);
    const earlier = applied(shared, movePositionChanges(shared, v1, 'mc', -1));
    expect(viewIds(earlier)).toEqual(['ma', 'mc', 'mb']);
    // Each order unique after either move.
    for (const records of [later, earlier]) {
      const orders = ['ma', 'mb', 'mc'].map((id) => markFields(records[id]?.props ?? {})?.order);
      expect(new Set(orders).size).toBe(3);
    }
  });

  it('copies a setup into a plan whose last key (the Trash’s) is odd, and into a setup with an odd plan key', () => {
    const sound = base();
    const plain = copySetupChanges(sound, 'u1', 'u2');
    expect(keysOf(plain)[0]).toBe(keyBetween(lastKeyUnder(sound, 'own2', 'plan_item'), null));
    const odd = { ...sound, t: table('t', 'own2', ODD, true) };
    const copied = copySetupChanges(odd, 'u1', 'u2');
    expect(copied.length).toBeGreaterThan(0);
    const after = applied(odd, copied);
    expect(Object.values(after).filter((r) => r.parentId === 'own2' && r.props.copied_from === 'cam')).toHaveLength(1);
    // A third setup with no plan, but a plan in the Trash under it holding an odd key.
    const third = { ...sound, u3: record('u3', 'setup', 's1', { name: '' }, 'c'), dead: record('dead', 'plan', 'u3', { kind: 'setup', name: '' }, ODD, at) };
    const made = copySetupChanges(third, 'u1', 'u3', 'own3');
    expect(keysOf(made)[0]).toBe(keyBetween(null, null));
    const madeAfter = applied(third, made);
    expect(madeAfter.own3?.parentId).toBe('u3');
    expect(Object.values(madeAfter).filter((r) => r.parentId === 'own3')).toHaveLength(1);
  });

  it('moves a mark into a setup’s plan only past an odd key there', () => {
    const sound = base();
    const plain = setupOnlyChanges(sound, 's1', 'u1', ['a2'], true);
    expect(keysOf(plain)).toEqual([keyBetween(lastKeyUnder(sound, 'own1', 'plan_item'), null)]);
    const odd = { ...sound, t: table('t', 'own1', ODD, true) };
    const moved = setupOnlyChanges(odd, 's1', 'u1', ['a2'], true);
    expect(applied(odd, moved).a2?.parentId).toBe('own1');
  });
});

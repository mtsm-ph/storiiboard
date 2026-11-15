import { describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import type { Change } from '../ops/ops';
import { formatLength } from './length';
import { blockingPlanOf, markFields, setupPlanOf } from './plan';
import {
  blockingReadingsMade,
  cameraMarks,
  markLayer,
  markNotes,
  markOwner,
  markOwnerChanges,
  movePositionChanges,
  moveLength,
  nextPositionChanges,
  placeMarkChanges,
  repointCamera,
  staleLink,
  trashedWithCamera,
  viewBlocking,
} from './planBlocking';
import { planLegend } from './planLegend';
import { copySetupChanges, homeOf, separateCopyChanges, setupOnlyChanges, setupOnlyHeld } from './planRooms';
import type { Props, SbdRecord } from './record';

// Cast blocking and camera moves (6.7): numbering by plan order across the blocking and a setup's own marks, every
// stale link read as none, Earlier and Later among one owner's positions only, Next position, the blocking plan made
// on demand, what each view shows, a camera's marks in its setup alone, the move's length, copies, the camera's
// marks to the Trash and back with it, a trashed character, and the legend's cast section.

type Records = Record<string, SbdRecord>;

const at = '2026-11-14T10:00:00.000Z';
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
const camera = (id: string, parentId: string, sortKey: string, props: Props = {}, x = 0, y = 0) =>
  record(id, 'plan_item', parentId, { kind: 'camera', icon: 'camera/camera', ...box(x, y, 0.4), ...props }, sortKey);

function applied(records: Records, changes: readonly Change[]): Records {
  const next: Records = { ...records };
  for (const change of changes) {
    if (change.kind === 'create') {
      const id = change.record.id;
      if (id) next[id] = { ...change.record, id, props: change.record.props ?? {}, trashedAt: null, trashedBy: null, createdAt: at, updatedAt: at };
    } else if (change.kind === 'update') {
      const was = next[change.id];
      if (!was) continue;
      const gone = new Set(change.unset ?? []);
      next[change.id] = { ...was, props: Object.fromEntries(Object.entries({ ...was.props, ...(change.set ?? {}) }).filter(([key]) => !gone.has(key))) };
    } else if (change.kind === 'trash') {
      const was = next[change.id];
      if (was) next[change.id] = { ...was, trashedAt: at, trashedBy: 'local' };
    } else if (change.kind === 'restore') {
      const was = next[change.id];
      if (was) next[change.id] = { ...was, trashedAt: null, trashedBy: null };
    } else if (change.kind === 'move') {
      const was = next[change.id];
      if (was) next[change.id] = { ...was, parentId: change.parentId, sortKey: change.sortKey };
    }
  }
  return next;
}

const SIZE = { width: 0.5, depth: 0.5 };
const SIZES = { character: SIZE, plain: { width: 0.3, depth: 0.28 } };

/**
 * Scene 1 with ANA and BEN, a room, its blocking, two setups (u1 with its own plan and camera A, u2 with its own plan);
 * scene 2 elsewhere. ANA has three positions in the blocking, BEN one between them.
 */
const base = (): Records =>
  recordsOf(
    record('p', 'project', null, { name: 'Bey County' }),
    record('fx3', 'gear_item', 'p', { name: 'FX3', kind: 'camera_body', sensor_width_mm: 35.6, sensor_height_mm: 20, camera_letter: 'A' }),
    record('ana', 'character', 'p', { name: 'ANA' }),
    record('ben', 'character', 'p', { name: 'BEN' }),
    record('room', 'plan', 'p', { kind: 'room', name: 'Diner' }),
    record('s1', 'scene', 'p', { number: '1', character_ids: ['ana', 'ben'], room_id: 'room' }),
    record('s2', 'scene', 'p', { number: '2', character_ids: ['ana'], room_id: 'room' }),
    record('blk', 'plan', 's1', { kind: 'blocking', name: '' }),
    record('u1', 'setup', 's1', { name: '' }, 'a'),
    record('u2', 'setup', 's1', { name: '' }, 'b'),
    record('own1', 'plan', 'u1', { kind: 'setup', name: '' }),
    record('own2', 'plan', 'u2', { kind: 'setup', name: '' }),
    // Each character's mark has its own `order` (6.7 review), here the same as its sort key.
    mark('a1', 'blk', 'b', { character_id: 'ana', order: 'b' }, 0, 0),
    mark('b1', 'blk', 'c', { character_id: 'ben', order: 'c' }, 5, 5),
    mark('a2', 'blk', 'd', { character_id: 'ana', icon: 'cast/next-position', order: 'd' }, 1, 0),
    mark('a3', 'blk', 'e', { character_id: 'ana', icon: 'cast/next-position', order: 'e' }, 2, 0),
    camera('cam', 'own1', 'a', {}, 0, 0),
  );

const v1 = { sceneId: 's1', setupId: 'u1' };
const v2 = { sceneId: 's1', setupId: 'u2' };
const numberOf = (records: Records, view: { sceneId: string; setupId: string | null }, id: string) => viewBlocking(records, view.sceneId, view.setupId).numbers.get(id)?.number ?? null;
const anaIds = (records: Records, view: { sceneId: string; setupId: string | null }) =>
  viewBlocking(records, view.sceneId, view.setupId).characters.find((c) => c.owner.id === 'ana')?.positions.map((p) => p.record.id) ?? [];

describe('numbering a character’s positions (6.7)', () => {
  it('numbers by plan order, the blocking and this setup’s own marks together; another setup sees only the blocking’s', () => {
    let records = base();
    expect(anaIds(records, v1)).toEqual(['a1', 'a2', 'a3']);
    expect(viewBlocking(records, 's1', 'u1').numbers.get('a2')).toEqual({ owner: { kind: 'character', id: 'ana' }, number: 2, count: 3 });
    // Position 2 made Setup 1's only (a cheated mark): a fresh key at the front of Setup 1's plan (after its camera's),
    // its `order` untouched, so it is still position 2 there.
    const cheated = setupOnlyChanges(records, 's1', 'u1', ['a2'], true);
    expect(cheated).toHaveLength(1);
    expect(cheated[0]).toMatchObject({ kind: 'move', id: 'a2', parentId: 'own1' });
    expect(cheated[0]?.kind === 'move' && cheated[0].sortKey > 'a').toBe(true);
    records = applied(records, cheated);
    expect(anaIds(records, v1)).toEqual(['a1', 'a2', 'a3']);
    expect(numberOf(records, v1, 'a3')).toBe(3);
    // Setup 2 doesn't show it: ANA has two positions there.
    expect(anaIds(records, v2)).toEqual(['a1', 'a3']);
    expect(numberOf(records, v2, 'a3')).toBe(2);
    // Back to every setup: position 2 again in both.
    records = applied(records, setupOnlyChanges(records, 's1', 'u1', ['a2'], false));
    expect(records.a2?.parentId).toBe('blk');
    expect(anaIds(records, v2)).toEqual(['a1', 'a2', 'a3']);
  });

  it('is seen from both setups of the scene and the scene alone, never from another scene in the same room', () => {
    const records = base();
    for (const view of [v1, v2, { sceneId: 's1', setupId: null }]) expect(anaIds(records, view)).toEqual(['a1', 'a2', 'a3']);
    expect(viewBlocking(records, 's2', null).characters).toEqual([]);
  });

  it('reads each view once per records', () => {
    const records = base();
    const before = blockingReadingsMade();
    viewBlocking(records, 's1', 'u1');
    viewBlocking(records, 's1', 'u1');
    expect(blockingReadingsMade()).toBe(before + 1);
    viewBlocking({ ...records }, 's1', 'u1');
    expect(blockingReadingsMade()).toBe(before + 2);
  });
});

describe('stale links read as none (6.7)', () => {
  it('a character trashed, gone or no longer in the scene makes a plain mark, kept as it is', () => {
    const records = base();
    const trashed: Records = { ...records, ana: { ...(records.ana as SbdRecord), trashedAt: at } };
    expect(markOwner(trashed, trashed.a1 as SbdRecord)).toBeNull();
    expect(staleLink(trashed, trashed.a1 as SbdRecord)).toBe('character');
    expect(markFields(trashed.a1?.props ?? {})?.characterId).toBe('ana');
    const gone: Records = { ...records };
    delete gone.ana;
    expect(markOwner(gone, gone.a1 as SbdRecord)).toBeNull();
    const out: Records = { ...records, s1: { ...(records.s1 as SbdRecord), props: { ...records.s1?.props, character_ids: ['ben'] } } };
    expect(markOwner(out, out.a1 as SbdRecord)).toBeNull();
    expect(viewBlocking(out, 's1', 'u1').characters.map((c) => c.owner.id)).toEqual(['ben']);
    expect(staleLink(records, records.a1 as SbdRecord)).toBeNull();
  });

  it('a camera trashed, gone or in another setup makes a plain mark too', () => {
    const records: Records = { ...base(), m: mark('m', 'own1', 'b', { camera_id: 'cam' }, 1, 1) };
    expect(markOwner(records, records.m as SbdRecord)).toEqual({ kind: 'camera', id: 'cam' });
    const trashed: Records = { ...records, cam: { ...(records.cam as SbdRecord), trashedAt: at } };
    expect(markOwner(trashed, trashed.m as SbdRecord)).toBeNull();
    expect(staleLink(trashed, trashed.m as SbdRecord)).toBe('camera');
    const gone: Records = { ...records };
    delete gone.cam;
    expect(markOwner(gone, gone.m as SbdRecord)).toBeNull();
    // The same camera id, but the mark sits in Setup 2's plan.
    const elsewhere: Records = { ...records, m: { ...(records.m as SbdRecord), parentId: 'own2' } };
    expect(markOwner(elsewhere, elsewhere.m as SbdRecord)).toBeNull();
    // In the blocking, a camera mark is never its camera's.
    const blocking: Records = { ...records, m: { ...(records.m as SbdRecord), parentId: 'blk' } };
    expect(markOwner(blocking, blocking.m as SbdRecord)).toBeNull();
  });

  it('a trashed character leaves its marks, read as plain marks, and the legend lists only who reads', () => {
    const records = base();
    const trashed: Records = { ...records, ana: { ...(records.ana as SbdRecord), trashedAt: at } };
    expect(['a1', 'a2', 'a3'].every((id) => trashed[id]?.trashedAt === null)).toBe(true);
    expect(planLegend(trashed, 's1', 'u1', (icon) => icon).cast.map((c) => c.characterId)).toEqual(['ben']);
  });
});

describe('Earlier and Later (6.7)', () => {
  it('reorders among that owner’s positions only, never past either end', () => {
    let records = base();
    const earlier = movePositionChanges(records, v1, 'a3', -1);
    // Its `order` alone, between its new neighbours'; its sort key (drawing order) untouched.
    expect(earlier).toHaveLength(1);
    expect(earlier[0]?.kind === 'update' && Object.keys(earlier[0].set ?? {})).toEqual(['order']);
    expect(earlier[0]).toMatchObject({ kind: 'update', id: 'a3' });
    records = applied(records, earlier);
    expect(anaIds(records, v1)).toEqual(['a1', 'a3', 'a2']);
    // BEN's mark keeps its own number; the plan's other items aren't touched.
    expect(numberOf(records, v1, 'b1')).toBe(1);
    expect(records.b1?.sortKey).toBe('c');
    records = applied(records, movePositionChanges(records, v1, 'a3', -1));
    expect(anaIds(records, v1)).toEqual(['a3', 'a1', 'a2']);
    expect(movePositionChanges(records, v1, 'a3', -1)).toEqual([]);
    expect(movePositionChanges(records, v1, 'a2', 1)).toEqual([]);
    records = applied(records, movePositionChanges(records, v1, 'a3', 1));
    expect(anaIds(records, v1)).toEqual(['a1', 'a3', 'a2']);
    // A plain mark has no positions to move among.
    const plain: Records = { ...records, t: mark('t', 'blk', 'z', {}) };
    expect(movePositionChanges(plain, v1, 't', -1)).toEqual([]);
  });

  it('never moves a camera’s own item: its position 2 doesn’t go earlier', () => {
    let records: Records = { ...base(), m2: mark('m2', 'own1', 'b', { camera_id: 'cam' }, 1, 0), m3: mark('m3', 'own1', 'c', { camera_id: 'cam' }, 2, 0) };
    expect(movePositionChanges(records, v1, 'm2', -1)).toEqual([]);
    records = applied(records, movePositionChanges(records, v1, 'm3', -1));
    expect(viewBlocking(records, 's1', 'u1').cameras[0]?.positions.map((p) => p.record.id)).toEqual(['cam', 'm3', 'm2']);
  });
});

describe('Next position and placing (6.7)', () => {
  it('puts a character’s next position 1 m right of its last, after it, in the blocking', () => {
    const records = base();
    const changes = nextPositionChanges(records, v1, 'a1', SIZE, null, 'a4');
    expect(changes).toHaveLength(1);
    const made = applied(records, changes);
    expect(made.a4?.parentId).toBe('blk');
    expect(made.a4?.props).toMatchObject({ kind: 'mark', icon: 'cast/next-position', character_id: 'ana', x: 2.75, y: -0.25, width: 0.5, height: 0.5 });
    expect(anaIds(made, v1)).toEqual(['a1', 'a2', 'a3', 'a4']);
    // Dropped from the Library, where it was dropped.
    const dropped = applied(records, nextPositionChanges(records, v1, 'a2', SIZE, { x: 4, y: 4 }, 'a5'));
    expect(dropped.a5?.props).toMatchObject({ x: 3.75, y: 3.75 });
    // A plain mark has no next position.
    const plain: Records = { ...records, t: mark('t', 'blk', 'z', {}) };
    expect(nextPositionChanges(plain, v1, 't', SIZE)).toEqual([]);
  });

  it('puts a camera’s next position in its plan at its size, pointing where its last points; another setup can’t follow it', () => {
    const records: Records = { ...base(), cam: camera('cam', 'own1', 'a', { rotation: 30, width: 0.35, height: 0.4 }) };
    const first = applied(records, nextPositionChanges(records, v1, 'cam', SIZE, null, 'm2'));
    expect(first.m2?.parentId).toBe('own1');
    expect(first.m2?.props).toMatchObject({ kind: 'mark', camera_id: 'cam', width: 0.35, height: 0.4, rotation: 30 });
    const second = applied(first, nextPositionChanges(first, v1, 'm2', SIZE, null, 'm3'));
    expect(viewBlocking(second, 's1', 'u1').cameras[0]?.positions.map((p) => p.record.id)).toEqual(['cam', 'm2', 'm3']);
    expect(nextPositionChanges(records, v2, 'cam', SIZE)).toEqual([]);
  });

  it('makes the scene’s blocking plan in the same group when it has none', () => {
    const records: Records = Object.fromEntries(Object.entries(base()).filter(([id]) => !['blk', 'a1', 'a2', 'a3', 'b1'].includes(id)));
    const changes = placeMarkChanges(records, v1, { x: 1, y: 1 }, { width: 0.3, depth: 0.28 }, null, 'pm', 'newblk');
    expect(changes.map((c) => c.kind)).toEqual(['create', 'create']);
    const made = applied(records, changes);
    expect(blockingPlanOf(made, 's1')?.id).toBe('newblk');
    expect(made.pm?.props).toMatchObject({ kind: 'mark', icon: 'cast/tape-mark', x: 0.85, y: 0.86 });
    expect(markOwner(made, made.pm as SbdRecord)).toBeNull();
    // A character mark for one of the scene's characters only.
    expect(placeMarkChanges(made, v1, { x: 0, y: 0 }, SIZE, 'nobody')).toEqual([]);
    expect(placeMarkChanges(made, v1, { x: 0, y: 0 }, SIZE, 'ana', 'am')).toHaveLength(1);
  });
});

describe('a camera’s marks (6.7)', () => {
  it('show only in its own setup', () => {
    const records: Records = { ...base(), m2: mark('m2', 'own1', 'b', { camera_id: 'cam' }, 1, 0) };
    expect(viewBlocking(records, 's1', 'u1').cameras.map((c) => c.owner.id)).toEqual(['cam']);
    expect(viewBlocking(records, 's1', 'u2').cameras).toEqual([]);
    expect(viewBlocking(records, 's1', null).cameras).toEqual([]);
  });

  it('give a mark to a camera and back: into its plan at its size, then back to the blocking at a mark’s', () => {
    let records = base();
    const onto = markOwnerChanges(records, v1, ['b1'], { kind: 'camera', id: 'cam' }, SIZES);
    records = applied(records, onto);
    expect(records.b1?.parentId).toBe('own1');
    expect(records.b1?.props).toMatchObject({ camera_id: 'cam', width: 0.4, height: 0.4 });
    expect(records.b1?.props.character_id).toBeUndefined();
    expect(markOwner(records, records.b1 as SbdRecord)).toEqual({ kind: 'camera', id: 'cam' });
    records = applied(records, markOwnerChanges(records, v1, ['b1'], { kind: 'character', id: 'ben' }, SIZES));
    expect(records.b1?.parentId).toBe('blk');
    expect(records.b1?.props).toMatchObject({ character_id: 'ben', width: 0.5 });
    expect(records.b1?.props.camera_id).toBeUndefined();
    records = applied(records, markOwnerChanges(records, v1, ['b1'], { kind: 'plain' }, SIZES));
    expect(markOwner(records, records.b1 as SbdRecord)).toBeNull();
    // Plain, it is a tape mark's size about its middle; a character's again, a cast mark's.
    expect(records.b1?.props).toMatchObject({ width: 0.3, height: 0.28, x: 4.85, y: 4.86 });
    records = applied(records, markOwnerChanges(records, v1, ['b1'], { kind: 'character', id: 'ana' }, SIZES));
    expect(records.b1?.props).toMatchObject({ width: 0.5, height: 0.5, x: 4.75, y: 4.75 });
    records = applied(records, markOwnerChanges(records, v1, ['b1'], { kind: 'plain' }, SIZES));
    // Nothing for a mark that is that already, a character not in the scene, or a camera of another setup.
    expect(markOwnerChanges(records, v1, ['b1'], { kind: 'plain' }, SIZES)).toEqual([]);
    expect(markOwnerChanges(records, v1, ['b1'], { kind: 'character', id: 'nobody' }, SIZES)).toEqual([]);
    expect(markOwnerChanges(records, v2, ['b1'], { kind: 'camera', id: 'cam' }, SIZES)).toEqual([]);
  });

  it('measure the move centre to centre: a 3-4-5 move is 5.00 m, in feet too', () => {
    setLocale('en');
    const records: Records = { ...base(), m2: mark('m2', 'own1', 'b', { camera_id: 'cam' }, 3, 4) };
    const positions = viewBlocking(records, 's1', 'u1').cameras[0]?.positions ?? [];
    expect(moveLength(positions)).toBeCloseTo(5, 10);
    expect(formatLength(moveLength(positions), 'metres')).toBe('5.00 m');
    expect(formatLength(moveLength(positions), 'feet')).toBe(`16' 5"`);
    const three: Records = { ...records, m3: mark('m3', 'own1', 'c', { camera_id: 'cam' }, 3, 0) };
    expect(moveLength(viewBlocking(three, 's1', 'u1').cameras[0]?.positions ?? [])).toBeCloseTo(9, 10);
  });

  it('go to the Trash with their camera and come back with it', () => {
    const records: Records = { ...base(), m2: mark('m2', 'own1', 'b', { camera_id: 'cam' }, 1, 0), m3: mark('m3', 'own1', 'c', { camera_id: 'cam' }, 2, 0) };
    expect(cameraMarks(records, 'cam').map((r) => r.id)).toEqual(['m2', 'm3']);
    const gone = applied(records, [{ kind: 'trash', id: 'cam' }, { kind: 'trash', id: 'm2' }, { kind: 'trash', id: 'm3' }]);
    expect(trashedWithCamera(gone, gone.cam as SbdRecord).map((r) => r.id).sort()).toEqual(['m2', 'm3']);
  });
});

describe('copies (6.7)', () => {
  it('a setup started from another re-points its camera’s marks to the copied camera; with the camera in the Trash, plain marks', () => {
    const records: Records = { ...base(), m2: mark('m2', 'own1', 'b', { camera_id: 'cam' }, 1, 0) };
    delete records.own2;
    const copied = applied(records, copySetupChanges(records, 'u1', 'u2', 'own2'));
    const plan = setupPlanOf(copied, 'u2');
    const items = Object.values(copied).filter((r) => r.parentId === plan?.id);
    const cam = items.find((r) => r.props.kind === 'camera');
    const m = items.find((r) => r.props.kind === 'mark');
    expect(m?.props.camera_id).toBe(cam?.id);
    expect(m && markOwner(copied, m)).toEqual({ kind: 'camera', id: cam?.id });
    // Its camera in the Trash: the copy is a plain mark.
    const trashed: Records = { ...records, cam: { ...(records.cam as SbdRecord), trashedAt: at } };
    const plain = applied(trashed, copySetupChanges(trashed, 'u1', 'u2', 'own2'));
    const copy = Object.values(plain).find((r) => r.parentId === 'own2' && r.props.kind === 'mark');
    expect(copy?.props.camera_id).toBeUndefined();
  });

  it('a room’s separate copy never touches the blocking', () => {
    const records = base();
    const changes = separateCopyChanges(records, 'p', 's1', 'room2');
    expect(changes.some((c) => (c.kind === 'update' || c.kind === 'move') && ['a1', 'a2', 'a3', 'b1'].includes(c.id))).toBe(false);
    expect(changes.some((c) => c.kind === 'create' && c.record.props?.kind === 'mark')).toBe(false);
  });

  it('re-points a camera id only when the camera is copied with it', () => {
    const props = { kind: 'mark', camera_id: 'cam', character_id: 'ana' };
    expect(repointCamera(props, new Map([['cam', 'cam2']]))).toEqual({ ...props, camera_id: 'cam2' });
    expect(repointCamera(props, new Map())).toEqual({ kind: 'mark', character_id: 'ana' });
  });
});

describe('the legend’s cast section (6.7)', () => {
  it('lists each character with how many positions it has, and a moving camera’s length', () => {
    const records: Records = { ...base(), m2: mark('m2', 'own1', 'b', { camera_id: 'cam' }, 3, 4), t: mark('t', 'blk', 'z', { icon: 'cast/tape-mark' }) };
    const legend = planLegend(records, 's1', 'u1', (icon) => icon);
    expect(legend.cast).toEqual([
      { characterId: 'ana', positions: 3 },
      { characterId: 'ben', positions: 1 },
    ]);
    expect(legend.groups.find((g) => g.layer === 'camera')?.lines).toEqual([expect.objectContaining({ move: 5 })]);
    // A plain mark is a tape mark in the cast group; the character's and the camera's marks aren't lines of their own.
    expect(legend.groups.find((g) => g.layer === 'cast')?.lines).toEqual([expect.objectContaining({ label: 'cast/tape-mark', count: 1 })]);
    expect(planLegend(records, 's1', 'u2', (icon) => icon).groups.find((g) => g.layer === 'camera')).toBeUndefined();
  });
});

// 6.7 review: a mark's place among its owner's positions is its own `order`, never its sort key (drawing order).
describe('a position’s own order (6.7 review)', () => {
  const orders = (records: Records, owner: string) =>
    Object.values(records)
      .filter((r) => r.type === 'plan_item' && r.props.kind === 'mark' && r.props.character_id === owner)
      .map((r) => markFields(r.props)?.order ?? null);

  it('a cheated mark keeps its number, and Next position from another setup never ties with it (H1 b)', () => {
    let records = base();
    // ANA 3 made Setup 1's only: a fresh sort key in Setup 1's plan, its `order` untouched.
    records = applied(records, setupOnlyChanges(records, 's1', 'u1', ['a3'], true));
    expect(records.a3?.parentId).toBe('own1');
    expect(markFields(records.a3?.props ?? {})?.order).toBe('e');
    expect(numberOf(records, v1, 'a3')).toBe(3);
    // Next position from Setup 2 (which shows ANA 1 and 2): after every ANA mark of the scene, Setup 1's cheated one too.
    records = applied(records, nextPositionChanges(records, v2, 'a2', SIZE, null, 'a4'));
    expect(markFields(records.a4?.props ?? {})?.order).toBeTruthy();
    expect((markFields(records.a4?.props ?? {})?.order ?? '') > 'e').toBe(true);
    expect(anaIds(records, v1).map((id) => numberOf(records, v1, id))).toEqual([1, 2, 3, 4]);
    expect(anaIds(records, v1)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(anaIds(records, v2)).toEqual(['a1', 'a2', 'a4']);
    // Every ANA `order` is its own.
    const all = orders(records, 'ana');
    expect(new Set(all).size).toBe(all.length);
  });

  it('a camera’s mark with the same sort key as another item never ties: numbers by order (H1 a)', () => {
    // The camera and a cheated mark both "b" in Setup 1's plan, as the first 6.7 build could write them; then the mark
    // given a sort key above ANA 2's and 3's, its order still below theirs, so numbering by sort key would put it last.
    const records: Records = { ...base(), cam: camera('cam', 'own1', 'b'), a1: { ...(base().a1 as SbdRecord), parentId: 'own1' } };
    const above: Records = { ...records, a1: { ...(records.a1 as SbdRecord), sortKey: 'z' } };
    expect(numberOf(above, v1, 'a1')).toBe(1);
    expect(anaIds(above, v1)).toEqual(['a1', 'a2', 'a3']);
    expect(numberOf(records, v1, 'a1')).toBe(1);
    expect(anaIds(records, v1)).toEqual(['a1', 'a2', 'a3']);
  });

  it('Earlier and Later on two positions sharing an order (or none) give each a fresh one, never doing nothing (H1 c)', () => {
    const tied: Records = {
      ...base(),
      a2: { ...(base().a2 as SbdRecord), props: { ...base().a2?.props, order: 'e' } },
    };
    // a2 and a3 share "e": told apart by when each was made, then by id (a2 first), the same every time.
    expect(anaIds(tied, v1)).toEqual(['a1', 'a2', 'a3']);
    const later = movePositionChanges(tied, v1, 'a2', 1);
    expect(later.length).toBeGreaterThan(0);
    const moved = applied(tied, later);
    expect(anaIds(moved, v1)).toEqual(['a1', 'a3', 'a2']);
    const all = orders(moved, 'ana');
    expect(new Set(all).size).toBe(all.length);
    // Back again by Earlier: a single order between its neighbours.
    const back = movePositionChanges(moved, v1, 'a2', -1);
    expect(back).toHaveLength(1);
    expect(anaIds(applied(moved, back), v1)).toEqual(['a1', 'a2', 'a3']);
  });

  it('a mark with no order (an import’s) sorts after those with one, then by when made, then id: never by sort key', () => {
    const early = '2026-11-01T10:00:00.000Z';
    const records: Records = {
      ...base(),
      // No order, sort keys before every other ANA mark's: still after them.
      x1: { ...mark('x1', 'blk', '0', { character_id: 'ana' }), createdAt: at },
      x2: { ...mark('x2', 'blk', '1', { character_id: 'ana' }), createdAt: early },
      x0: { ...mark('x0', 'blk', '2', { character_id: 'ana' }), createdAt: at },
    };
    expect(anaIds(records, v1)).toEqual(['a1', 'a2', 'a3', 'x2', 'x0', 'x1']);
    // An `order` that isn't a key reads as none.
    expect(markFields({ kind: 'mark', ...box(0, 0), order: 'not a key!' })?.order).toBeNull();
    expect(markFields({ kind: 'mark', ...box(0, 0), order: 'V0' })?.order).toBeNull();
    expect(markFields({ kind: 'mark', ...box(0, 0), order: 'V' })?.order).toBe('V');
  });

  it('a setup started from another keeps a cheated character mark’s number', () => {
    let records = base();
    records = applied(records, setupOnlyChanges(records, 's1', 'u1', ['a2'], true));
    delete records.own2;
    records = applied(records, copySetupChanges(records, 'u1', 'u2', 'own2'));
    const copy = Object.values(records).find((r) => r.parentId === 'own2' && r.props.kind === 'mark');
    // 6.7 second review, M3: a fresh order just after the original's ("d"), below ANA 3's ("e"), never the same one.
    const order = (copy && markFields(copy.props)?.order) ?? '';
    expect(order > 'd' && order < 'e').toBe(true);
    expect(numberOf(records, v2, copy?.id ?? '')).toBe(2);
    expect(numberOf(records, v2, 'a3')).toBe(3);
  });

  it('a mark given to a camera becomes its last position; made plain, it has no order', () => {
    let records: Records = { ...base(), m2: mark('m2', 'own1', 'b', { camera_id: 'cam', order: 'l' }, 1, 0) };
    records = applied(records, markOwnerChanges(records, v1, ['b1'], { kind: 'camera', id: 'cam' }, SIZES));
    expect((markFields(records.b1?.props ?? {})?.order ?? '') > 'l').toBe(true);
    expect(viewBlocking(records, 's1', 'u1').cameras[0]?.positions.map((p) => p.record.id)).toEqual(['cam', 'm2', 'b1']);
    // Given to ANA: her last position.
    records = applied(records, markOwnerChanges(records, v1, ['b1'], { kind: 'character', id: 'ana' }, SIZES));
    expect(anaIds(records, v1)).toEqual(['a1', 'a2', 'a3', 'b1']);
    expect(records.b1?.parentId).toBe('blk');
    // Plain: no order.
    records = applied(records, markOwnerChanges(records, v1, ['b1'], { kind: 'plain' }, SIZES));
    expect(records.b1?.props.order).toBeUndefined();
  });

  it('a camera mark moved off its camera takes a fresh key at the front of the blocking, never its old one', () => {
    const records: Records = { ...base(), m2: mark('m2', 'own1', 'a', { camera_id: 'cam', order: 'V' }, 1, 0) };
    const changes = markOwnerChanges(records, v1, ['m2'], { kind: 'character', id: 'ben' }, SIZES);
    const move = changes.find((c) => c.kind === 'move');
    expect(move).toMatchObject({ kind: 'move', id: 'm2', parentId: 'blk' });
    expect(move?.kind === 'move' && move.sortKey > 'e').toBe(true);
  });

  it('a copy that loses its camera is a tape mark’s size about its middle, unturned, with no order (L2)', () => {
    const props = { kind: 'mark', icon: 'cast/next-position', x: 0, y: 0, width: 1, height: 3, rotation: 90, camera_id: 'cam', order: 'V' };
    expect(repointCamera(props, new Map())).toEqual({ kind: 'mark', icon: 'cast/next-position', x: 0.35, y: 1.36, width: 0.3, height: 0.28, rotation: 0 });
    expect(repointCamera(props, new Map([['cam', 'cam2']]))).toEqual({ ...props, camera_id: 'cam2' });
  });
});

describe('a mark’s layer and level read its camera link (6.7 review, L1)', () => {
  it('a mark whose camera is in the Trash is cast blocking’s, and "This setup only" is held for it', () => {
    const records: Records = { ...base(), m: mark('m', 'own1', 'b', { camera_id: 'cam', order: 'V' }, 1, 1) };
    expect(markLayer(records, records.m as SbdRecord)).toBe('camera');
    expect(homeOf(records, records.m as SbdRecord)).toBe('setup');
    const trashed: Records = { ...records, cam: { ...(records.cam as SbdRecord), trashedAt: at } };
    expect(markLayer(trashed, trashed.m as SbdRecord)).toBe('cast');
    expect(homeOf(trashed, trashed.m as SbdRecord)).toBe('blocking');
    // 6.7 second review, L3: "This setup only" is held for it (in the blocking its link could never read again).
    expect(setupOnlyChanges(trashed, 's1', 'u1', ['m'], false)).toEqual([]);
    expect(setupOnlyHeld(trashed, 's1', 'u1', ['m'])).toBe('staleCamera');
    expect(setupOnlyHeld(records, 's1', 'u1', ['m'])).toBeNull();
    // A dead camera link and a live character: the character's, on the cast layer.
    const both: Records = { ...trashed, m: { ...(trashed.m as SbdRecord), props: { ...trashed.m?.props, character_id: 'ana' } } };
    expect(markOwner(both, both.m as SbdRecord)).toEqual({ kind: 'character', id: 'ana' });
    expect(markLayer(both, both.m as SbdRecord)).toBe('cast');
    // The legend counts it with cast blocking.
    expect(planLegend(trashed, 's1', 'u1', (icon) => icon).groups.find((g) => g.layer === 'cast')?.lines).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'cast/tape-mark' })]));
  });
});

describe('two blocking plans under one scene (6.7 review, L8)', () => {
  it('shows the marks of both, numbers them together, and puts new marks in the first', () => {
    // The newer plan inserted first, so the older first can't come from insertion order.
    const records: Records = {
      blk2: { ...record('blk2', 'plan', 's1', { kind: 'blocking', name: '' }, 'blk'), createdAt: '2026-11-15T10:00:00.000Z' },
      ...base(),
      a9: mark('a9', 'blk2', 'a', { character_id: 'ana', order: 'c' }, 9, 9),
    };
    expect(Object.keys(records)[0]).toBe('blk2');
    // Same sort key: the older plan first.
    expect(blockingPlanOf(records, 's1')?.id).toBe('blk');
    expect(anaIds(records, v1)).toEqual(['a1', 'a9', 'a2', 'a3']);
    const made = placeMarkChanges(records, v1, { x: 0, y: 0 }, SIZE, 'ben', 'b2');
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ kind: 'create', record: { parentId: 'blk' } });
  });
});

describe('the Selection tile’s notes and the Trash’s timing (6.7 review, L9)', () => {
  it('says a character no longer in the scene, and a scene with no characters yet', () => {
    const records = base();
    const out: Records = { ...records, s1: { ...(records.s1 as SbdRecord), props: { ...records.s1?.props, character_ids: ['ben'] } } };
    expect(markNotes(out, v1, out.a1 as SbdRecord)).toEqual({ stale: 'character', noCharacters: false });
    expect(markNotes(records, v1, records.a1 as SbdRecord)).toEqual({ stale: null, noCharacters: false });
    const none: Records = { ...records, s1: { ...(records.s1 as SbdRecord), props: { ...records.s1?.props, character_ids: [] } }, t: mark('t', 'blk', 'z', {}) };
    expect(markNotes(none, v1, none.t as SbdRecord)).toEqual({ stale: null, noCharacters: true });
    // A stale character's mark in a scene with none says both.
    expect(markNotes(none, v1, none.a1 as SbdRecord)).toEqual({ stale: 'character', noCharacters: true });
  });

  it('a mark trashed earlier on its own stays in the Trash when its camera, trashed later, comes back', () => {
    const earlier = '2026-11-14T09:00:00.000Z';
    const records: Records = {
      ...base(),
      cam: { ...camera('cam', 'own1', 'a'), trashedAt: at, trashedBy: 'local' },
      m2: { ...mark('m2', 'own1', 'b', { camera_id: 'cam', order: 'V' }), trashedAt: at, trashedBy: 'local' },
      m3: { ...mark('m3', 'own1', 'c', { camera_id: 'cam', order: 'l' }), trashedAt: earlier, trashedBy: 'local' },
    };
    expect(trashedWithCamera(records, records.cam as SbdRecord).map((r) => r.id)).toEqual(['m2']);
  });
});

// 6.7 second review: a mark's `order` is unique among its owner's positions across the whole scene, Trash included,
// always. Every edit that writes one makes the owner's sound first (soundOrders), in the same group.
describe('one sound order per owner across the scene (6.7 second review)', () => {
  const orders = (records: Records, owner: string) =>
    Object.values(records)
      .filter((r) => r.type === 'plan_item' && r.props.kind === 'mark' && r.props.character_id === owner)
      .map((r) => markFields(r.props)?.order ?? null);
  const unique = (records: Records, owner: string) => {
    const all = orders(records, owner);
    return all.every((o) => o !== null) && new Set(all).size === all.length;
  };
  /** The test base without any `order`, as 6.7's first build or a JSON import leaves it. */
  const unordered = (): Records =>
    Object.fromEntries(
      Object.entries(base()).map(([id, r]) => {
        const props = { ...r.props };
        delete props.order;
        return [id, { ...r, props }];
      }),
    );
  const updated = (changes: readonly Change[]) => changes.flatMap((c) => (c.kind === 'update' ? [c.id] : []));

  it('Next position after ANA 3 with no orders lands as position 4, the older marks given theirs in the same group (M1)', () => {
    const records = unordered();
    expect(anaIds(records, v1)).toEqual(['a1', 'a2', 'a3']);
    const changes = nextPositionChanges(records, v1, 'a3', SIZE, null, 'a4');
    expect(updated(changes)).toEqual(['a1', 'a2', 'a3']);
    const made = applied(records, changes);
    expect(anaIds(made, v1)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(anaIds(made, v1).map((id) => numberOf(made, v1, id))).toEqual([1, 2, 3, 4]);
    expect(unique(made, 'ana')).toBe(true);
    // Placing and giving a mark do the same: BEN's mark given to ANA is her last.
    const given = applied(records, markOwnerChanges(records, v1, ['b1'], { kind: 'character', id: 'ana' }, SIZES));
    expect(anaIds(given, v1)).toEqual(['a1', 'a2', 'a3', 'b1']);
    expect(unique(given, 'ana')).toBe(true);
    const placed = applied(records, placeMarkChanges(records, v1, { x: 9, y: 9 }, SIZE, 'ana', 'a9'));
    expect(anaIds(placed, v1)).toEqual(['a1', 'a2', 'a3', 'a9']);
    expect(unique(placed, 'ana')).toBe(true);
  });

  it('a tie keeps the first, in position order; the rest take fresh orders after the last sound one (M1)', () => {
    const records: Records = { ...base(), a3: { ...(base().a3 as SbdRecord), props: { ...base().a3?.props, order: 'b' } } };
    // a1 and a3 share "b": a1 first by id.
    expect(anaIds(records, v1)).toEqual(['a1', 'a3', 'a2']);
    const changes = nextPositionChanges(records, v1, 'a2', SIZE, null, 'a4');
    expect(updated(changes)).toEqual(['a3']);
    const made = applied(records, changes);
    expect(anaIds(made, v1)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(unique(made, 'ana')).toBe(true);
  });

  it('Later in Setup 1 never renumbers Setup 2 but for the one mark moved, sound or not (M3)', () => {
    for (const start of [base(), unordered()]) {
      // A cheated ANA mark of Setup 2's only, between her 2 and 3 (or, with no orders, after them all).
      const hidden = mark('h', 'own2', 'z', { character_id: 'ana', ...(start.a1?.props.order ? { order: 'd5' } : {}) }, 9, 9);
      const records: Records = { ...start, h: hidden };
      const before = anaIds(records, v2);
      for (const id of ['a1', 'a2']) {
        const moved = applied(records, movePositionChanges(records, v1, id, 1));
        expect(anaIds(moved, v2).filter((m) => m !== id)).toEqual(before.filter((m) => m !== id));
        expect(unique(moved, 'ana')).toBe(true);
      }
    }
  });

  it('Earlier and Later pass as few hidden marks as they can: Later just after the mark it steps over, Earlier just before it (L2)', () => {
    // Setup 2's own ANA marks between her 1 and 2 ("c5") and between her 2 and 3 ("d5"); Setup 1 shows neither.
    const records: Records = {
      ...base(),
      h1: mark('h1', 'own2', 'y', { character_id: 'ana', order: 'c5' }, 8, 8),
      h2: mark('h2', 'own2', 'z', { character_id: 'ana', order: 'd5' }, 9, 9),
    };
    expect(anaIds(records, v2)).toEqual(['a1', 'h1', 'a2', 'h2', 'a3']);
    // Later on ANA 1 in Setup 1: past ANA 2 ("d") only, below h2.
    const later = applied(records, movePositionChanges(records, v1, 'a1', 1));
    const one = markFields(later.a1?.props ?? {})?.order ?? '';
    expect(one > 'd' && one < 'd5').toBe(true);
    expect(anaIds(later, v1)).toEqual(['a2', 'a1', 'a3']);
    expect(anaIds(later, v2)).toEqual(['h1', 'a2', 'a1', 'h2', 'a3']);
    // Earlier on ANA 3 in Setup 1: before ANA 2 ("d") only, above h1.
    const earlier = applied(records, movePositionChanges(records, v1, 'a3', -1));
    const three = markFields(earlier.a3?.props ?? {})?.order ?? '';
    expect(three > 'c5' && three < 'd').toBe(true);
    expect(anaIds(earlier, v1)).toEqual(['a1', 'a3', 'a2']);
    expect(anaIds(earlier, v2)).toEqual(['a1', 'h1', 'a3', 'a2', 'h2']);
    // A mark in the Trash between them counts as hidden too.
    const trashed: Records = { ...records, h1: { ...(records.h1 as SbdRecord), parentId: 'blk', trashedAt: at, trashedBy: 'local' } };
    const past = applied(trashed, movePositionChanges(trashed, v1, 'a3', -1));
    expect((markFields(past.a3?.props ?? {})?.order ?? '') > 'c5').toBe(true);
  });

  it('a setup copy’s cheated mark, then "This setup only" off on the copy: no tie (M3)', () => {
    let records = base();
    records = applied(records, setupOnlyChanges(records, 's1', 'u1', ['a2'], true));
    delete records.own2;
    records = applied(records, copySetupChanges(records, 'u1', 'u2', 'own2'));
    const copy = Object.values(records).find((r) => r.parentId === 'own2' && r.props.kind === 'mark');
    expect(numberOf(records, v2, copy?.id ?? '')).toBe(2);
    records = applied(records, setupOnlyChanges(records, 's1', 'u2', [copy?.id ?? ''], false));
    expect(records[copy?.id ?? '']?.parentId).toBe('blk');
    expect(unique(records, 'ana')).toBe(true);
    // Setup 1 shows the original and the copy, one after the other.
    expect(anaIds(records, v1)).toEqual(['a1', 'a2', copy?.id, 'a3']);
  });

  it('a setup copy of marks with no order gives them sound ones first (M3)', () => {
    let records = unordered();
    records = applied(records, setupOnlyChanges(records, 's1', 'u1', ['a2'], true));
    delete records.own2;
    records = applied(records, copySetupChanges(records, 'u1', 'u2', 'own2'));
    expect(unique(records, 'ana')).toBe(true);
    const copy = Object.values(records).find((r) => r.parentId === 'own2' && r.props.kind === 'mark');
    expect(numberOf(records, v2, copy?.id ?? '')).toBe(2);
  });
});

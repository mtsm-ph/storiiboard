import { describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import type { Change } from '../ops/ops';
import { formatLength } from './length';
import { blockingPlanOf, markFields, setupPlanOf } from './plan';
import {
  blockingReadingsMade,
  cameraMarks,
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
import { copySetupChanges, separateCopyChanges, setupOnlyChanges } from './planRooms';
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
    mark('a1', 'blk', 'b', { character_id: 'ana' }, 0, 0),
    mark('b1', 'blk', 'c', { character_id: 'ben' }, 5, 5),
    mark('a2', 'blk', 'd', { character_id: 'ana', icon: 'cast/next-position' }, 1, 0),
    mark('a3', 'blk', 'e', { character_id: 'ana', icon: 'cast/next-position' }, 2, 0),
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
    // Position 2 made Setup 1's only (a cheated mark): it keeps its sort key, so it is still position 2 there.
    const cheated = setupOnlyChanges(records, 's1', 'u1', ['a2'], true);
    expect(cheated).toEqual([{ kind: 'move', id: 'a2', parentId: 'own1', sortKey: 'd' }]);
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
    expect(earlier).toHaveLength(1);
    expect(earlier[0]).toMatchObject({ kind: 'move', id: 'a3', parentId: 'blk' });
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

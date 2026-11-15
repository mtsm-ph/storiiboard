import { describe, expect, it } from 'vitest';
import type { Props, SbdRecord } from './record';
import {
  defaultRoomName,
  normalDegrees,
  parseDegrees,
  planFields,
  planItemFields,
  plansShown,
  renamePlanChanges,
  sceneRoomId,
  scenesUsingRoom,
  shownItems,
  startRoomChanges,
  wallBetween,
  wallEnds,
  wallsAlong,
  WALL_THICKNESS,
} from './plan';

// The plan's records (6.2a): the three levels and the order a setup's plan shows them in, a scene's room read through
// one reader (a trashed or missing room is no room), the fields' validation, and the edits that start and name a room
// and draw walls.

const at = '2026-11-13T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = 'm', trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey,
  props,
  trashedAt,
  trashedBy: trashedAt ? 'local' : null,
  createdAt: at,
  updatedAt: at,
});
const wall = (id: string, parentId: string, x: number, sortKey = 'm', trashedAt: string | null = null) =>
  record(id, 'plan_item', parentId, { kind: 'wall', x, y: 0, width: 2, height: 0.1, rotation: 0 }, sortKey, trashedAt);
const of = (...list: SbdRecord[]): Record<string, SbdRecord> => Object.fromEntries(list.map((r) => [r.id, r]));

const project = record('p', 'project', null, {});
const location = record('loc', 'location', 'p', { name: 'Diner' });
const scene = record('sc4', 'scene', 'p', { number: '4', room_id: 'room', location_id: 'loc' });
const other = record('sc5', 'scene', 'p', { number: '5', room_id: 'room' });
const setup = record('u1', 'setup', 'sc4', { name: '' });
const room = record('room', 'plan', 'p', { kind: 'room', name: 'Diner' });
const blocking = record('blk', 'plan', 'sc4', { kind: 'blocking', name: '' });
const own = record('own', 'plan', 'u1', { kind: 'setup', name: '' });

describe('the plan’s levels', () => {
  const records = of(project, location, scene, other, setup, room, blocking, own, wall('w1', 'room', 0, 'b'), wall('w0', 'room', 5, 'a'), wall('b1', 'blk', 1), wall('s1', 'own', 2));

  it('shows a setup’s plan back to front: the room, then the scene’s blocking, then the setup’s own', () => {
    const shown = shownItems(records, 'sc4', 'u1');
    expect(shown.map((item) => [item.record.id, item.level])).toEqual([
      ['w0', 'room'],
      ['w1', 'room'],
      ['b1', 'blocking'],
      ['s1', 'setup'],
    ]);
  });

  it('shows a scene with no setup its room and its blocking', () => {
    expect(shownItems(records, 'sc4', null).map((item) => item.record.id)).toEqual(['w0', 'w1', 'b1']);
    // A setup of another scene, or one in the Trash, shows nothing of its own.
    expect(shownItems(records, 'sc5', 'u1').map((item) => item.record.id)).toEqual(['w0', 'w1']);
    expect(plansShown({ ...records, u1: { ...setup, trashedAt: at } }, 'sc4', 'u1').setup).toBeNull();
  });

  it('skips trashed items, and the items of a trashed plan', () => {
    const shown = shownItems({ ...records, w1: wall('w1', 'room', 0, 'b', at), blk: { ...blocking, trashedAt: at } }, 'sc4', 'u1');
    expect(shown.map((item) => item.record.id)).toEqual(['w0', 's1']);
  });

  it('reads a room that is trashed, missing or not a room as no room, and the scene keeps its id', () => {
    expect(sceneRoomId(records, scene)).toBe('room');
    expect(sceneRoomId({ ...records, room: { ...room, trashedAt: at } }, scene)).toBeNull();
    expect(sceneRoomId(records, { ...scene, props: { room_id: 'nothing' } })).toBeNull();
    expect(sceneRoomId(records, { ...scene, props: { room_id: 'blk' } })).toBeNull();
    expect(sceneRoomId(records, { ...scene, props: {} })).toBeNull();
    expect(shownItems({ ...records, room: { ...room, trashedAt: at } }, 'sc4', null).map((item) => item.record.id)).toEqual(['b1']);
  });

  it('counts the live scenes set in a room', () => {
    expect(scenesUsingRoom(records, 'room').map((s) => s.id).sort()).toEqual(['sc4', 'sc5']);
    expect(scenesUsingRoom({ ...records, sc5: { ...other, trashedAt: at } }, 'room')).toHaveLength(1);
  });
});

describe('the fields', () => {
  it('reads a plan’s kind, name and location, and refuses a kind it doesn’t know', () => {
    expect(planFields({ kind: 'room', name: ' Diner ', location_id: 'loc' })).toEqual({ kind: 'room', name: 'Diner', locationId: 'loc' });
    expect(planFields({ kind: 'stage' })).toBeNull();
  });

  it('reads a wall with defaults, and keeps a kind this version doesn’t show unseen', () => {
    expect(planItemFields({ kind: 'wall', x: 1, y: 2, width: 3 })).toEqual({ kind: 'wall', x: 1, y: 2, width: 3, height: WALL_THICKNESS, rotation: 0, heightM: null, name: '' });
    expect(planItemFields({ kind: 'wall', x: 0, y: 0, width: 3, height: -1, rotation: 450, height_m: 2.4, name: 'North' })).toMatchObject({ height: 0.1, rotation: 90, heightM: 2.4, name: 'North' });
    expect(planItemFields({ kind: 'wall', x: 0, y: 0, width: 0 })).toBeNull();
    expect(planItemFields({ kind: 'wall', x: 'a', y: 0, width: 1 })).toBeNull();
    expect(planItemFields({ kind: 'camera', x: 0, y: 0, width: 1, height: 1 })).toBeNull();
  });

  it('stores a wall as a rotated box whose ends are where it was drawn', () => {
    const g = wallBetween({ x: 0, y: 0 }, { x: 0, y: 3.5 });
    expect(g).toEqual({ x: -1.75, y: 1.7, width: 3.5, height: 0.1, rotation: 90 });
    const [start, end] = wallEnds(g);
    expect(start.x).toBeCloseTo(0, 6);
    expect(start.y).toBeCloseTo(0, 6);
    expect(end.x).toBeCloseTo(0, 6);
    expect(end.y).toBeCloseTo(3.5, 6);
  });

  it('keeps a rotation to a millionth of a degree', () => {
    expect(normalDegrees(36.86989764584)).toBe(36.869898);
    expect(normalDegrees(-90)).toBe(270);
    expect(normalDegrees(359.9999999)).toBe(0);
  });

  it('reads a typed rotation, a typographic minus and a bare decimal too', () => {
    expect(parseDegrees('90')).toBe(90);
    expect(parseDegrees('90°')).toBe(90);
    expect(parseDegrees('-45')).toBe(315);
    expect(parseDegrees('−45')).toBe(315);
    expect(parseDegrees('.5')).toBe(0.5);
    expect(parseDegrees('22,5 °')).toBe(22.5);
    for (const typed of ['', 'north', '1.2.3', '--5', '−']) expect(parseDegrees(typed)).toBeNull();
  });
});

describe('the edits', () => {
  it('starts a room named after the scene’s location, and points the scene at it, in one group', () => {
    const records = of(project, location, { ...scene, props: { number: '4', location_id: 'loc' } });
    const changes = startRoomChanges(records, 'p', 'sc4', 'r1');
    expect(changes).toEqual([
      { kind: 'create', record: { id: 'r1', type: 'plan', parentId: 'p', sortKey: expect.any(String) as string, props: { kind: 'room', name: 'Diner', location_id: 'loc' } } },
      { kind: 'update', id: 'sc4', set: { room_id: 'r1' } },
    ]);
    // A scene that has a live room starts no other.
    expect(startRoomChanges(of(project, scene, room), 'p', 'sc4')).toEqual([]);
  });

  it('names a room after the scene’s name, else its slate label, when it has no location', () => {
    expect(defaultRoomName({}, record('s', 'scene', 'p', { number: '4', name: 'Kitchen' }))).toBe('Kitchen');
    expect(defaultRoomName({}, record('s', 'scene', 'p', { number: '4' }))).toBe('SC 04');
  });

  it('renames a room, never to nothing', () => {
    const records = of(room);
    expect(renamePlanChanges(records, 'room', ' Kitchen ')).toEqual([{ kind: 'update', id: 'room', set: { name: 'Kitchen' } }]);
    expect(renamePlanChanges(records, 'room', ' ')).toEqual([]);
    expect(renamePlanChanges(records, 'room', 'Diner')).toEqual([]);
  });

  it('draws one wall a segment, each after the last, leaving out a segment of no length', () => {
    const made = wallsAlong(of(room, wall('w0', 'room', 0, 'a')), 'room', [
      { x: 0, y: 0 },
      { x: 3.5, y: 0 },
      { x: 3.5, y: 0 },
      { x: 3.5, y: 3.81 },
    ]);
    expect(made.ids).toHaveLength(2);
    const keys = made.changes.map((c) => (c.kind === 'create' ? c.record.sortKey : ''));
    expect(keys.every((k) => k > 'a')).toBe(true);
    expect((keys[0] ?? '') < (keys[1] ?? '')).toBe(true);
    expect(made.changes.map((c) => (c.kind === 'create' ? c.record.props : null))).toEqual([
      { kind: 'wall', x: 0, y: -0.05, width: 3.5, height: 0.1, rotation: 0 },
      { kind: 'wall', x: 1.595, y: 1.855, width: 3.81, height: 0.1, rotation: 90 },
    ]);
  });
});

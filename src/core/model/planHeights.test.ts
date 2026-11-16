import { describe, expect, it } from 'vitest';
import { parseLength } from './length';
import { openingFields, wallBetween, wallProps } from './plan';
import {
  ceilingHeightChanges,
  ceilingOver,
  doorHeightRefusal,
  openingHeights,
  openingRoomId,
  planHeights,
  roomHeights,
  storedCeilingRefusal,
  storedHeightsRefusal,
  windowHeightsChanges,
  windowHeightsRefusal,
} from './planHeights';
import type { Props, SbdRecord } from './record';

// Heights for the 3D set later (6.5.6): a room's ceiling, a window's sill and top, a door's height (its `height_m` of
// 6.2b), each optional, in metres, checked: above 0, a top above its sill, neither above the ceiling.

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
const patched = (records: Records, id: string, props: Props): Records => {
  const was = records[id];
  if (!was) throw new Error(id);
  return { ...records, [id]: { ...was, props: { ...was.props, ...props } } };
};

/** A room with one wall, a window and a door in it; a scene's setup with its own wall and a window in that. */
const project = (): Records =>
  recordsOf(
    record('p', 'project', null, { name: 'Bey County' }),
    record('room', 'plan', 'p', { kind: 'room', name: 'Diner' }),
    record('w1', 'plan_item', 'room', wallProps(wallBetween({ x: 0, y: 0 }, { x: 4, y: 0 }))),
    record('win', 'plan_item', 'room', { kind: 'window', wall_id: 'w1', along_m: 1, width_m: 1.2 }),
    record('door', 'plan_item', 'room', { kind: 'door', wall_id: 'w1', along_m: 3, width_m: 0.9, hinge: 'start', swing: 'left' }),
    record('s1', 'scene', 'p', { number: '1', room_id: 'room' }),
    record('u1', 'setup', 's1', { name: '' }),
    record('own', 'plan', 'u1', { kind: 'setup', name: '' }),
    record('w2', 'plan_item', 'own', wallProps(wallBetween({ x: 0, y: 3 }, { x: 4, y: 3 }))),
    record('win2', 'plan_item', 'own', { kind: 'window', wall_id: 'w2', along_m: 2, width_m: 1 }),
  );

describe('heights as read (6.5.6)', () => {
  it('reads a room’s ceiling, a window’s sill and top and a door’s height; anything else as not set', () => {
    expect(roomHeights({ kind: 'room', ceiling_height_m: 2.7 })).toEqual({ ceilingM: 2.7 });
    for (const bad of [0, -1, '2.7', null, Number.NaN, 5000]) expect(roomHeights({ kind: 'room', ceiling_height_m: bad })).toEqual({ ceilingM: null });
    expect(roomHeights({ kind: 'room' })).toEqual({ ceilingM: null });
    // With both its sill and top, a window is as high as the glass between them, whatever its `height_m` says (round 2).
    expect(openingHeights({ kind: 'window', sill_height_m: 0.9, top_height_m: 2.4, height_m: 1.2 })).toEqual({ kind: 'window', heightM: 1.5, heightFromGlass: true, sillM: 0.9, topM: 2.4 });
    // One of them alone: its stored `height_m` again.
    expect(openingHeights({ kind: 'window', sill_height_m: 0.9, height_m: 1.2 })).toEqual({ kind: 'window', heightM: 1.2, heightFromGlass: false, sillM: 0.9, topM: null });
    // A door's height is its `height_m` (6.2b); it has no sill or top, whatever is stored.
    expect(openingHeights({ kind: 'door', height_m: 2.03, sill_height_m: 1 })).toEqual({ kind: 'door', heightM: 2.03, heightFromGlass: false, sillM: null, topM: null });
    expect(openingHeights({ kind: 'wall' })).toBeNull();
  });

  it('the plan’s label and legend read the same height: openingFields gives top − sill, the stored one kept', () => {
    const window = { kind: 'window', wall_id: 'w1', along_m: 1, width_m: 1.2, height_m: 1.2 };
    expect(openingFields(window)?.heightM).toBe(1.2);
    expect(openingFields({ ...window, sill_height_m: 0.9, top_height_m: 2.15 })?.heightM).toBe(1.25);
    // A top not above the sill (only an import or an undo leaves one) gives no glass height: the stored one is read.
    expect(openingFields({ ...window, sill_height_m: 2, top_height_m: 1 })?.heightM).toBe(1.2);
    // A door's sill or top (no edit writes one) changes nothing.
    expect(openingFields({ ...window, kind: 'door', sill_height_m: 0.9, top_height_m: 2.15 })?.heightM).toBe(1.2);
  });

  it('finds the room over a door or window, its wall the room’s or one setup’s only', () => {
    const records = patched(project(), 'room', { ceiling_height_m: 2.6 });
    expect(openingRoomId(records, 'win')).toBe('room');
    expect(openingRoomId(records, 'win2')).toBe('room');
    expect(ceilingOver(records, 'win2')).toBe(2.6);
    expect(openingRoomId(records, 'w1')).toBeNull();
  });

  it('gives the room’s heights for get_plan and the 3D set', () => {
    const records = patched(patched(patched(project(), 'room', { ceiling_height_m: 2.6 }), 'win', { sill_height_m: 0.9, top_height_m: 2.1 }), 'door', { height_m: 2.03 });
    expect(planHeights(records, 'room')).toEqual({
      roomId: 'room',
      ceilingM: 2.6,
      openings: [
        { id: 'win', wallId: 'w1', kind: 'window', heightM: 1.2, heightFromGlass: true, sillM: 0.9, topM: 2.1 },
        { id: 'door', wallId: 'w1', kind: 'door', heightM: 2.03, heightFromGlass: false, sillM: null, topM: null },
      ],
    });
    expect(planHeights(records, 'own')).toBeNull();
  });
});

describe('heights as edited (6.5.6)', () => {
  it('checks a sill and top: above 0, the top above the sill, neither above the ceiling', () => {
    expect(windowHeightsRefusal(0.9, 2.1, null)).toBeNull();
    expect(windowHeightsRefusal(0, null, null)).toBe('notPositive');
    expect(windowHeightsRefusal(null, -1, null)).toBe('notPositive');
    expect(windowHeightsRefusal(2.1, 2.1, null)).toBe('topNotAboveSill');
    expect(windowHeightsRefusal(2.2, 2.1, null)).toBe('topNotAboveSill');
    expect(windowHeightsRefusal(0.9, 2.7, 2.6)).toBe('aboveCeiling');
    expect(windowHeightsRefusal(2.7, null, 2.6)).toBe('aboveCeiling');
    expect(windowHeightsRefusal(0.9, 2.6, 2.6)).toBeNull();
  });

  it('sets, refuses and clears a window’s sill and top, one update each', () => {
    const records = patched(project(), 'room', { ceiling_height_m: 2.6 });
    expect(windowHeightsChanges(records, ['win'], { sillM: 0.9 })).toEqual({ changes: [{ kind: 'update', id: 'win', set: { sill_height_m: 0.9 } }] });
    const sill = patched(records, 'win', { sill_height_m: 0.9 });
    expect(windowHeightsChanges(sill, ['win'], { topM: 0.5 })).toEqual({ refused: 'topNotAboveSill', id: 'win' });
    expect(windowHeightsChanges(sill, ['win'], { topM: 3 })).toEqual({ refused: 'aboveCeiling', id: 'win' });
    // A window in a setup's own wall is under the scene's room's ceiling too.
    expect(windowHeightsChanges(records, ['win2'], { topM: 3 })).toEqual({ refused: 'aboveCeiling', id: 'win2' });
    expect(windowHeightsChanges(sill, ['win'], { topM: 2.1 })).toEqual({ changes: [{ kind: 'update', id: 'win', set: { top_height_m: 2.1 } }] });
    // The same value again writes nothing; emptied takes it off.
    expect(windowHeightsChanges(sill, ['win'], { sillM: 0.9 })).toEqual({ changes: [] });
    expect(windowHeightsChanges(sill, ['win'], { sillM: null })).toEqual({ changes: [{ kind: 'update', id: 'win', unset: ['sill_height_m'] }] });
    // Several windows: one refused refuses all; a door in the selection is left alone.
    expect(windowHeightsChanges(sill, ['win', 'win2', 'door'], { topM: 0.8 })).toEqual({ refused: 'topNotAboveSill', id: 'win' });
    // The refusal names the window refused: here the second, under another room's lower ceiling (round 2).
    const two = recordsOf(
      ...Object.values(sill),
      record('room2', 'plan', 'p', { kind: 'room', name: 'Porch', ceiling_height_m: 2.2 }),
      record('w9', 'plan_item', 'room2', wallProps(wallBetween({ x: 0, y: 0 }, { x: 4, y: 0 }))),
      record('win9', 'plan_item', 'room2', { kind: 'window', wall_id: 'w9', along_m: 1, width_m: 1 }),
    );
    expect(windowHeightsChanges(two, ['win', 'win9'], { topM: 2.4 })).toEqual({ refused: 'aboveCeiling', id: 'win9' });
    expect(ceilingOver(two, 'win9')).toBe(2.2);
    expect(windowHeightsChanges(sill, ['win', 'win2', 'door'], { topM: 2 })).toEqual({
      changes: [
        { kind: 'update', id: 'win', set: { top_height_m: 2 } },
        { kind: 'update', id: 'win2', set: { top_height_m: 2 } },
      ],
    });
  });

  it('a length typed in feet is stored in metres', () => {
    const typed = parseLength('8ft', 'metres');
    expect(typed).toBe(2.4384);
    expect(ceilingHeightChanges(project(), 'room', typed)).toEqual({ changes: [{ kind: 'update', id: 'room', set: { ceiling_height_m: 2.4384 } }] });
    const inches = parseLength('7\' 6"', 'metres');
    expect(windowHeightsChanges(project(), ['win'], { topM: inches })).toEqual({ changes: [{ kind: 'update', id: 'win', set: { top_height_m: 2.286 } }] });
  });

  it('sets a ceiling, refuses one under a window or not above 0, and clears it', () => {
    const records = patched(project(), 'win', { sill_height_m: 0.9, top_height_m: 2.1 });
    expect(ceilingHeightChanges(records, 'room', 2.7)).toEqual({ changes: [{ kind: 'update', id: 'room', set: { ceiling_height_m: 2.7 } }] });
    expect(ceilingHeightChanges(records, 'room', 2)).toEqual({ refused: 'ceilingBelowWindow', id: 'win' });
    expect(ceilingHeightChanges(records, 'room', 0)).toEqual({ refused: 'notPositive' });
    const set = patched(records, 'room', { ceiling_height_m: 2.7 });
    expect(ceilingHeightChanges(set, 'room', 2.7)).toEqual({ changes: [] });
    expect(ceilingHeightChanges(set, 'room', null)).toEqual({ changes: [{ kind: 'update', id: 'room', unset: ['ceiling_height_m'] }] });
    expect(ceilingHeightChanges(records, 'room', null)).toEqual({ changes: [] });
    // Not a room: nothing.
    expect(ceilingHeightChanges(records, 'own', 2.7)).toEqual({ changes: [] });
  });

  it('a lower ceiling is checked against every window and door of the room, a setup’s own walls’ too (round 2)', () => {
    // The window in Setup 1's own wall: under the scene's room.
    const setupWindow = patched(project(), 'win2', { top_height_m: 2.5 });
    expect(ceilingHeightChanges(setupWindow, 'room', 2.4)).toEqual({ refused: 'ceilingBelowWindow', id: 'win2' });
    expect(ceilingHeightChanges(setupWindow, 'room', 2.5)).toEqual({ changes: [{ kind: 'update', id: 'room', set: { ceiling_height_m: 2.5 } }] });
    // A door's height.
    const door = patched(project(), 'door', { height_m: 2.1 });
    expect(ceilingHeightChanges(door, 'room', 2)).toEqual({ refused: 'ceilingBelowDoor', id: 'door' });
    // Not a window or door in the Trash.
    const trashed = { ...door, door: { ...(door.door as SbdRecord), trashedAt: at } };
    expect(ceilingHeightChanges(trashed, 'room', 2)).toEqual({ changes: [{ kind: 'update', id: 'room', set: { ceiling_height_m: 2 } }] });
  });

  it('a door’s height is checked against its room’s ceiling', () => {
    const records = patched(project(), 'room', { ceiling_height_m: 2.4 });
    expect(doorHeightRefusal(records, ['door'], 2.5)).toEqual({ refused: 'aboveCeiling', id: 'door' });
    expect(doorHeightRefusal(records, ['door'], 2.4)).toBeNull();
    expect(doorHeightRefusal(records, ['door'], null)).toBeNull();
    // A window's own height_m is not a door's: left as before.
    expect(doorHeightRefusal(records, ['win'], 3)).toBeNull();
    expect(doorHeightRefusal(project(), ['door'], 3)).toBeNull();
  });

  it('a value the file holds past the checks (an undo, a Put back) is read as stored and said', () => {
    const records = patched(patched(patched(project(), 'room', { ceiling_height_m: 2.4 }), 'win', { top_height_m: 2.6 }), 'door', { height_m: 2.5 });
    expect(openingHeights(records.win?.props ?? {})?.topM).toBe(2.6);
    expect(storedHeightsRefusal(records, 'win')).toBe('aboveCeiling');
    expect(storedHeightsRefusal(records, 'door')).toBe('aboveCeiling');
    expect(storedHeightsRefusal(project(), 'win')).toBeNull();
    expect(storedCeilingRefusal(records, 'room')).toEqual({ refused: 'ceilingBelowWindow', id: 'win' });
    expect(storedCeilingRefusal(project(), 'room')).toBeNull();
  });
});

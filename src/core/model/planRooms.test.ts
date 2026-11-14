import { describe, expect, it } from 'vitest';
import type { Change } from '../ops/ops';
import { setLocale } from '../i18n';
import { sceneRoomId, shownItems } from './plan';
import {
  alsoInRoom,
  copyName,
  copySetupChanges,
  deleteRoomChanges,
  deleteUnusedRoomChanges,
  itemLevel,
  kindHome,
  replaceRoomChanges,
  roomChoices,
  scenesLosing,
  separateCopyChanges,
  setRoomChanges,
  setupCopySources,
  setupHasItems,
  setupOnlyChanges,
  setupOnlyHeld,
} from './planRooms';
import type { Props, SbdRecord } from './record';

// Rooms shared and copied, a setup's state copied, and items in one setup only (6.2b), on records made here: the
// chooser's order and counts, a separate copy (deep, re-pointed, the other scene untouched), Delete room only when
// unshared, a setup started from another, and an item there and back with what every other view then shows.

const at = '2026-11-14T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, sortKey = 'm'): SbdRecord => ({
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
const of = (...list: SbdRecord[]): Record<string, SbdRecord> => Object.fromEntries(list.map((r) => [r.id, r]));
const wall = (id: string, parentId: string, sortKey = 'm') => record(id, 'plan_item', parentId, { kind: 'wall', x: 0, y: -0.05, width: 4, height: 0.1, rotation: 0 }, sortKey);
const door = (id: string, parentId: string, wallId: string, sortKey = 'n') => record(id, 'plan_item', parentId, { kind: 'door', wall_id: wallId, along_m: 1, width_m: 0.9, hinge: 'start', swing: 'left' }, sortKey);

/** The records after the changes, as the ops would leave them (creates, updates, moves and trashes). */
function applied(records: Record<string, SbdRecord>, changes: readonly Change[]): Record<string, SbdRecord> {
  const next = { ...records };
  for (const c of changes) {
    if (c.kind === 'create') {
      const id = c.record.id ?? '';
      next[id] = record(id, c.record.type, c.record.parentId, c.record.props ?? {}, c.record.sortKey);
    } else if (c.kind === 'update') {
      const was = next[c.id];
      if (!was) continue;
      const gone = new Set(c.unset ?? []);
      const props = Object.fromEntries(Object.entries({ ...was.props, ...(c.set ?? {}) }).filter(([key]) => !gone.has(key)));
      next[c.id] = { ...was, props };
    } else if (c.kind === 'move') {
      const was = next[c.id];
      if (was) next[c.id] = { ...was, parentId: c.parentId, sortKey: c.sortKey };
    } else if (c.kind === 'trash') {
      const was = next[c.id];
      if (was) next[c.id] = { ...was, trashedAt: at, trashedBy: 'local' };
    }
  }
  return next;
}

const project = record('p', 'project', null, {});
const diner = record('loc1', 'location', 'p', { name: 'Diner' });
const motel = record('loc2', 'location', 'p', { name: 'Motel' });
const sc2 = record('sc2', 'scene', 'p', { number: '2', location_id: 'loc1', room_id: 'r1' });
const sc4 = record('sc4', 'scene', 'p', { number: '4', location_id: 'loc1', room_id: 'r1' });
const sc7 = record('sc7', 'scene', 'p', { number: '7', location_id: 'loc2', room_id: 'r3' });
const sc9 = record('sc9', 'scene', 'p', { number: '9', location_id: 'loc1' });
const r1 = record('r1', 'plan', 'p', { kind: 'room', name: 'Counter', location_id: 'loc1' }, 'a');
const r2 = record('r2', 'plan', 'p', { kind: 'room', name: 'Back room', location_id: 'loc1' }, 'b');
const r3 = record('r3', 'plan', 'p', { kind: 'room', name: 'Lobby', location_id: 'loc2' }, 'c');
const base = of(project, diner, motel, sc2, sc4, sc7, sc9, r1, r2, r3, wall('w1', 'r1'), door('d1', 'r1', 'w1'));

describe('choosing a room', () => {
  it('lists the rooms at the scene’s location first, by name, then the rest, with their locations and counts', () => {
    expect(roomChoices(base, 'sc9')).toEqual([
      { id: 'r2', name: 'Back room', location: 'Diner', scenes: 0, here: true },
      { id: 'r1', name: 'Counter', location: 'Diner', scenes: 2, here: true },
      { id: 'r3', name: 'Lobby', location: 'Motel', scenes: 1, here: false },
    ]);
    // A scene's own room isn't offered to it again.
    expect(roomChoices(base, 'sc4').map((c) => c.id)).toEqual(['r2', 'r3']);
  });

  it('sets the scene in a room already drawn in one op, and leaves the room it had', () => {
    const changes = setRoomChanges(base, 'sc4', 'r3');
    expect(changes).toEqual([{ kind: 'update', id: 'sc4', set: { room_id: 'r3' } }]);
    const after = applied(base, changes);
    expect(sceneRoomId(after, after.sc4)).toBe('r3');
    expect(after.r1?.trashedAt).toBeNull();
    expect(setRoomChanges(base, 'sc4', 'r1')).toEqual([]);
    expect(setRoomChanges(base, 'sc4', 'loc1')).toEqual([]);
  });

  it('shows a shared room’s edits in every scene set in it, and says which others use it', () => {
    const moved = applied(base, [{ kind: 'update', id: 'w1', set: { x: 1 } }]);
    for (const scene of ['sc2', 'sc4']) expect(shownItems(moved, scene, null).find((i) => i.record.id === 'w1')?.fields).toMatchObject({ x: 1 });
    expect(alsoInRoom(base, 'sc4')).toEqual(['SC 02']);
    expect(alsoInRoom(base, 'sc7')).toEqual([]);
  });
});

describe('a separate copy', () => {
  it('copies the room and its items, the door pointing to the copied wall, and points only this scene at it', () => {
    const changes = separateCopyChanges(base, 'p', 'sc4', 'copy');
    const after = applied(base, changes);
    expect(after.copy?.props).toMatchObject({ kind: 'room', name: 'Counter (SC 04)', location_id: 'loc1' });
    expect(sceneRoomId(after, after.sc4)).toBe('copy');
    expect(sceneRoomId(after, after.sc2)).toBe('r1');
    const copied = shownItems(after, 'sc4', null);
    const [copiedWall, copiedDoor] = copied;
    expect(copied.map((i) => i.fields.kind)).toEqual(['wall', 'door']);
    expect(copiedWall?.record.id).not.toBe('w1');
    expect(copiedDoor?.record.props.wall_id).toBe(copiedWall?.record.id);
    // The other scene still shows the original, untouched.
    expect(shownItems(after, 'sc2', null).map((i) => i.record.id)).toEqual(['w1', 'd1']);
    // Moving the copy's wall leaves the original where it was.
    const apart = applied(after, [{ kind: 'update', id: copiedWall?.record.id ?? '', set: { x: 5 } }]);
    expect(apart.w1?.props.x).toBe(0);
  });

  it('is offered only for a room another scene uses', () => {
    expect(separateCopyChanges(base, 'p', 'sc7')).toEqual([]);
  });
});

describe('deleting a room', () => {
  it('trashes it with its items when no other scene uses it, and the scene then has none', () => {
    expect(deleteRoomChanges(base, 'sc4')).toEqual([]);
    const after = applied(base, deleteRoomChanges(base, 'sc7'));
    expect(after.r3?.trashedAt).not.toBeNull();
    expect(sceneRoomId(after, after.sc7)).toBeNull();
    expect(after.sc7?.props.room_id).toBe('r3');
  });
});

describe('a setup started from another', () => {
  const u1 = record('u1', 'setup', 'sc4', { name: 'Wide' }, 'a');
  const u2 = record('u2', 'setup', 'sc4', { name: '' }, 'b');
  const own = record('own1', 'plan', 'u1', { kind: 'setup', name: '' });
  const setups = { ...base, ...of(u1, u2, own, wall('sw', 'own1', 'a'), door('sd', 'own1', 'sw', 'b'), door('rd', 'own1', 'w1', 'c')) };

  it('offers the scene’s other setups that have items', () => {
    expect(setupHasItems(setups, 'u1')).toBe(true);
    expect(setupHasItems(setups, 'u2')).toBe(false);
    expect(setupCopySources(setups, 'sc4', 'u2').map((s) => s.record.id)).toEqual(['u1']);
    expect(setupCopySources(setups, 'sc4', 'u1')).toEqual([]);
  });

  it('copies the items into a plan made for it, in one group, a copied door in the copied wall, a room wall’s door kept in it', () => {
    const changes = copySetupChanges(setups, 'u1', 'u2', 'own2');
    const after = applied(setups, changes);
    const mine = shownItems(after, 'sc4', 'u2').filter((i) => i.level === 'setup');
    expect(mine.map((i) => i.fields.kind)).toEqual(['wall', 'door', 'door']);
    const [w, d, rd] = mine;
    expect(d?.record.props.wall_id).toBe(w?.record.id);
    expect(rd?.record.props.wall_id).toBe('w1');
    expect(after.own2?.parentId).toBe('u2');
    // Nothing links them afterwards; and a setup that has items is never copied into.
    expect(copySetupChanges(after, 'u1', 'u2')).toEqual([]);
  });
});

describe('this setup only', () => {
  const u1 = record('u1', 'setup', 'sc4', { name: '' }, 'a');
  const u2 = record('u2', 'setup', 'sc4', { name: '' }, 'b');
  const records = { ...base, ...of(u1, u2) };

  it('moves a wall and its door into the setup’s plan, then back to the room, with what each view shows', () => {
    expect(kindHome('wall')).toBe('room');
    expect(kindHome('mark')).toBe('blocking');
    const on = setupOnlyChanges(records, 'sc4', 'u1', ['w1'], true, 'own');
    expect(on.flatMap((c) => (c.kind === 'move' ? [[c.id, c.parentId]] : []))).toEqual([
      ['w1', 'own'],
      ['d1', 'own'],
    ]);
    const there = applied(records, on);
    expect(itemLevel(there, 'sc4', 'u1', 'w1')).toBe('setup');
    expect(shownItems(there, 'sc4', 'u1').map((i) => i.record.id)).toEqual(['w1', 'd1']);
    // The other setup, the scene on its own and the other scene in the room no longer show them.
    expect(shownItems(there, 'sc4', 'u2')).toEqual([]);
    expect(shownItems(there, 'sc4', null)).toEqual([]);
    expect(shownItems(there, 'sc2', null)).toEqual([]);
    const back = applied(there, setupOnlyChanges(there, 'sc4', 'u1', ['w1'], false));
    expect(itemLevel(back, 'sc4', 'u1', 'w1')).toBe('room');
    expect(shownItems(back, 'sc2', null).map((i) => i.record.id)).toEqual(['w1', 'd1']);
    expect(setupOnlyChanges(back, 'sc4', 'u1', ['w1'], false)).toEqual([]);
  });

  it('moves a door alone, which then shows in its room wall in that setup only', () => {
    const there = applied(records, setupOnlyChanges(records, 'sc4', 'u1', ['d1'], true, 'own'));
    expect(shownItems(there, 'sc4', 'u1').map((i) => [i.record.id, i.level])).toEqual([
      ['w1', 'room'],
      ['d1', 'setup'],
    ]);
    expect(shownItems(there, 'sc4', 'u2').map((i) => i.record.id)).toEqual(['w1']);
  });
});

// The 6.2b review: a scene's own doors and windows in a shared room's walls, copies that say what they were copied
// from and are named the same in every language, rooms left or deleted, and the switch's limits.

const setupA = record('u1', 'setup', 'sc4', { name: '' }, 'a');
const setupB = record('u2', 'setup', 'sc4', { name: '' }, 'b');
const withSetups = { ...base, ...of(setupA, setupB) };
/** SC 04's Setup 1 with the room's door d1 made its own. */
const doorInSetup = () => applied(withSetups, setupOnlyChanges(withSetups, 'sc4', 'u1', ['d1'], true, 'own'));

describe('a separate copy and a scene’s own doors (6.2b review)', () => {
  it('points a setup’s own door in a room wall at the copied wall: shown in that setup, gone from the other scene', () => {
    const there = doorInSetup();
    expect(there.d1?.parentId).toBe('own');
    const changes = separateCopyChanges(there, 'p', 'sc4', 'copy');
    const after = applied(there, changes);
    const copiedWall = Object.values(after).find((r) => r.parentId === 'copy' && r.props.kind === 'wall');
    expect(copiedWall).toBeDefined();
    // The door is re-pointed, not copied, in the same group.
    expect(changes).toContainEqual({ kind: 'update', id: 'd1', set: { wall_id: copiedWall?.id } });
    expect(shownItems(after, 'sc4', 'u1').map((i) => [i.record.id, i.level])).toEqual([
      [copiedWall?.id, 'room'],
      ['d1', 'setup'],
    ]);
    expect((shownItems(after, 'sc4', 'u1')[1]?.fields as { wallId?: string }).wallId).toBe(copiedWall?.id);
    // The other scene shows its wall with no door, and no live door is left in w1.
    expect(shownItems(after, 'sc2', null).map((i) => i.record.id)).toEqual(['w1']);
    expect(Object.values(after).filter((r) => r.props.wall_id === 'w1' && r.trashedAt === null)).toEqual([]);
  });

  it('copies no item in the Trash, and copies one of a kind this version doesn’t know with every prop', () => {
    const gone = { ...record('gone', 'plan_item', 'r1', { kind: 'wall', x: 9, y: 0, width: 1, height: 0.1, rotation: 0 }, 'p'), trashedAt: at };
    const later = record('later', 'plan_item', 'r1', { kind: 'hologram', glow: 3, nested: { a: [1, 2] } }, 'q');
    const records = { ...base, ...of(gone, later) };
    const after = applied(records, separateCopyChanges(records, 'p', 'sc4', 'copy'));
    const copied = Object.values(after).filter((r) => r.parentId === 'copy');
    expect(copied.map((r) => r.props.kind).sort()).toEqual(['door', 'hologram', 'wall']);
    expect(copied.find((r) => r.props.kind === 'hologram')?.props).toEqual({ kind: 'hologram', glow: 3, nested: { a: [1, 2] }, copied_from: 'later' });
    // Each copy names what it was copied from.
    expect(copied.find((r) => r.props.kind === 'wall')?.props.copied_from).toBe('w1');
  });

  it('names a copy the same in every language, an unnamed room’s copy unnamed, a copy of a copy without a stacked suffix', () => {
    setLocale('es');
    try {
      expect(applied(base, separateCopyChanges(base, 'p', 'sc4', 'copy')).copy?.props.name).toBe('Counter (SC 04)');
    } finally {
      setLocale('en');
    }
    expect(copyName('Diner (SC 02)', '4')).toBe('Diner (SC 04)');
    expect(copyName('Diner (ESC 02)', '12A')).toBe('Diner (SC 12A)');
    expect(copyName('Diner (main)', '4')).toBe('Diner (main) (SC 04)');
    const unnamed = { ...base, r1: record('r1', 'plan', 'p', { kind: 'room', location_id: 'loc1' }, 'a') };
    const after = applied(unnamed, separateCopyChanges(unnamed, 'p', 'sc4', 'copy'));
    expect(after.copy?.props).toEqual({ kind: 'room', location_id: 'loc1' });
  });
});

describe('leaving a room (6.2b review)', () => {
  it('trashes a scene’s own doors in the old room’s walls when it uses another room, in the same group', () => {
    const there = doorInSetup();
    const changes = setRoomChanges(there, 'sc4', 'r2');
    expect(changes).toEqual([
      { kind: 'trash', id: 'd1' },
      { kind: 'update', id: 'sc4', set: { room_id: 'r2' } },
    ]);
    // The room's own items stay for the scene still in it.
    const after = applied(there, changes);
    expect(after.w1?.trashedAt).toBeNull();
    expect(shownItems(after, 'sc2', null).map((i) => i.record.id)).toEqual(['w1']);
    // A new room does the same; a scene with no door of its own in the room trashes nothing.
    expect(replaceRoomChanges(there, 'p', 'sc4', 'r9')[0]).toEqual({ kind: 'trash', id: 'd1' });
    expect(setRoomChanges(base, 'sc4', 'r2')).toEqual([{ kind: 'update', id: 'sc4', set: { room_id: 'r2' } }]);
  });

  it('trashes them with the room on Delete room, and a room no scene uses from the chooser', () => {
    const alone = doorInSetup();
    const sharerGone = { ...alone, sc2: { ...(alone.sc2 as SbdRecord), trashedAt: at } };
    const changes = deleteRoomChanges(sharerGone, 'sc4');
    expect(changes.map((c) => (c.kind === 'trash' ? c.id : c.kind)).sort()).toEqual(['d1', 'r1', 'w1']);
    expect(deleteUnusedRoomChanges(base, 'r2')).toEqual([{ kind: 'trash', id: 'r2' }]);
    expect(deleteUnusedRoomChanges(base, 'r1')).toEqual([]);
    expect(deleteUnusedRoomChanges(base, 'loc1')).toEqual([]);
  });

  it('counts only live scenes in the chooser, and a trashed scene restored after Delete room reads as having no room', () => {
    const sharerGone = { ...base, sc2: { ...sc2, trashedAt: at } };
    expect(roomChoices(sharerGone, 'sc9').find((c) => c.id === 'r1')?.scenes).toBe(1);
    const deleted = applied(sharerGone, deleteRoomChanges(sharerGone, 'sc4'));
    expect(deleted.r1?.trashedAt).not.toBeNull();
    const restored = { ...deleted, sc2: { ...sc2, trashedAt: null } };
    expect(sceneRoomId(restored, restored.sc2)).toBeNull();
    expect(restored.sc2.props.room_id).toBe('r1');
    expect(shownItems(restored, 'sc2', null)).toEqual([]);
  });
});

describe('the switch’s limits (6.2b review)', () => {
  it('keeps a door with its setup-only wall, and says why', () => {
    const there = applied(withSetups, setupOnlyChanges(withSetups, 'sc4', 'u1', ['w1'], true, 'own'));
    expect(setupOnlyHeld(there, 'sc4', 'u1', ['d1'])).toBe('wallOnly');
    expect(setupOnlyChanges(there, 'sc4', 'u1', ['d1'], false)).toEqual([]);
    // With its wall, both go back.
    expect(setupOnlyHeld(there, 'sc4', 'u1', ['w1', 'd1'])).toBeNull();
    expect(setupOnlyChanges(there, 'sc4', 'u1', ['w1', 'd1'], false).filter((c) => c.kind === 'move')).toHaveLength(2);
  });

  it('can’t be turned off with no room, and goes back to the scene’s room as it is now', () => {
    const there = applied(withSetups, setupOnlyChanges(withSetups, 'sc4', 'u1', ['w1'], true, 'own'));
    const roomless = { ...there, sc4: { ...(there.sc4 as SbdRecord), props: { number: '4', location_id: 'loc1' } } };
    expect(setupOnlyHeld(roomless, 'sc4', 'u1', ['w1'])).toBe('noRoom');
    const moved = { ...there, sc4: { ...(there.sc4 as SbdRecord), props: { number: '4', location_id: 'loc1', room_id: 'r2' } } };
    const back = setupOnlyChanges(moved, 'sc4', 'u1', ['w1'], false);
    expect(back.flatMap((c) => (c.kind === 'move' ? [c.parentId] : []))).toEqual(['r2', 'r2']);
  });

  it('names the other scenes sharing the room that would stop showing a room item', () => {
    expect(scenesLosing(withSetups, 'sc4', 'u1', ['w1'])).toEqual(['SC 02']);
    expect(scenesLosing(doorInSetup(), 'sc4', 'u1', ['d1'])).toEqual([]);
  });

  it('copies a setup with each item saying what it was copied from', () => {
    const own = record('own1', 'plan', 'u1', { kind: 'setup', name: '' });
    const records = { ...withSetups, ...of(own, wall('sw', 'own1', 'a')) };
    const changes = copySetupChanges(records, 'u1', 'u2', 'own2');
    expect(changes.flatMap((c) => (c.kind === 'create' && c.record.type === 'plan_item' ? [c.record.props?.copied_from] : []))).toEqual(['sw']);
  });
});

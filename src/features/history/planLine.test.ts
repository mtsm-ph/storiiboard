import { afterEach, describe, expect, it } from 'vitest';
import { setPlanUnitsChoice } from '../../app/planUnits';
import { setLocale } from '../../core/i18n';
import type { Props, SbdRecord } from '../../core/model/record';
import type { LoggedOp } from '../../core/ops/ops';
import { changeLabel, changeText, changeValue, describeEdit, fieldChanges, fieldLabel, lineText, namedById, valueText } from './summary';

// A plan's steps in History (6.2a): a room started and renamed; walls drawn, moved, turned, resized, deleted and
// restored, each one line for its group, in English and Spanish.

const at = '2026-11-13T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props, trashedAt: string | null = null): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: 'm',
  props,
  trashedAt,
  trashedBy: null,
  createdAt: at,
  updatedAt: at,
});
const op = (kind: LoggedOp['kind'], before: SbdRecord | null, after: SbdRecord | null): LoggedOp => ({
  id: 'o',
  seq: 1,
  groupId: 'g',
  groupKind: 'edit',
  recordId: (after ?? before)?.id ?? '',
  kind,
  before,
  after,
  author: 'local',
  timestamp: at,
});

const scene = record('sc4', 'scene', 'p', { number: '4' });
const room = record('r', 'plan', 'p', { kind: 'room', name: 'Diner' });
const wall = (id: string, props: Props = {}) => record(id, 'plan_item', 'r', { kind: 'wall', x: 0, y: 0, width: 3.5, height: 0.1, rotation: 0, ...props });
const none = new Set<string>();
const say = (ops: LoggedOp[]) => lineText(describeEdit(ops, none, new Map([['sc4', scene]])));

afterEach(() => {
  setLocale('en');
  setPlanUnitsChoice('region');
});

describe('History for plans', () => {
  it('says a room was started for its scene, and renamed', () => {
    expect(say([op('create', null, room), op('update', scene, { ...scene, props: { ...scene.props, room_id: 'r' } })])).toBe('Started room “Diner” for SC 04');
    expect(say([op('update', room, { ...room, props: { kind: 'room', name: 'Kitchen' } })])).toBe('Renamed room “Diner” to “Kitchen”');
  });

  it('says walls were drawn, moved, turned, resized, deleted and restored, counted', () => {
    expect(say([op('create', null, wall('a'))])).toBe('Drew a wall');
    expect(say([op('create', null, wall('a')), op('create', null, wall('b')), op('create', null, wall('c'))])).toBe('Drew 3 walls');
    expect(say([op('update', wall('a'), wall('a', { x: 1, y: 2 }))])).toBe('Moved a wall');
    expect(say([op('update', wall('a'), wall('a', { x: 1, rotation: 90 }))])).toBe('Turned a wall');
    expect(say([op('update', wall('a'), wall('a', { width: 5 })), op('update', wall('b'), wall('b', { width: 5 }))])).toBe('Resized 2 walls');
    expect(say([op('update', wall('a'), wall('a', { height_m: 2.4 }))])).toBe('Changed a wall');
    expect(say([op('trash', wall('a'), { ...wall('a'), trashedAt: at })])).toBe('Deleted a wall');
    expect(say([op('restore', { ...wall('a'), trashedAt: at }, wall('a'))])).toBe('Restored a wall');
  });

  it('names a wall’s fields as the Selection tile does', () => {
    const changes = fieldChanges(wall('a'), wall('a', { width: 5, height_m: 2.4 }));
    expect(changes.map((c) => changeLabel(c))).toEqual(['length', 'height']);
  });

  it('names a scene’s room by its name, never by its id', () => {
    const kept = record('3f1c9a52-room', 'plan', 'p', { kind: 'room', name: 'Diner' });
    const linked = { ...scene, props: { ...scene.props, room_id: kept.id } };
    const text = lineText(describeEdit([op('update', scene, linked)], none, new Map([['sc4', scene], [kept.id, kept]])));
    expect(text).toContain('room “Diner”');
    expect(text).not.toContain(kept.id);
    expect(fieldLabel('room_id')).toBe('room');
    expect(valueText('room_id', kept.id)).toBe('a room');
    // An item's own history names it as the project has it now (HistoryTile's `places`).
    expect(namedById(kept)).toBe('Diner');
    expect(namedById(record('r2', 'plan', 'p', { kind: 'room' }))).toBeNull();
    setLocale('es');
    expect(fieldLabel('room_id')).toBe('espacio');
  });

  it('shows a wall’s lengths in the unit this computer shows, and its turn in degrees', () => {
    const [length, height] = fieldChanges(wall('a'), wall('a', { width: 3.81, height_m: 2.4 }));
    if (!length || !height) throw new Error('no changes');
    setPlanUnitsChoice('metres');
    expect([changeText(length, length.before), changeText(length, length.after), changeValue(height, height.after)]).toEqual(['3.50 m', '3.81 m', '2.40 m']);
    setPlanUnitsChoice('feet');
    expect(changeText(length, length.after)).toBe('12\' 6"');
    const [turn] = fieldChanges(wall('a'), wall('a', { rotation: 36.869898 }));
    if (!turn) throw new Error('no change');
    expect(changeText(turn, turn.after)).toBe('36.87°');
  });

  it('shows a wall’s lengths in the unit it is handed (the History tile reads it with usePlanUnit and hands it on), whatever the setting', () => {
    setPlanUnitsChoice('metres');
    const [length] = fieldChanges(wall('a'), wall('a', { width: 3.81 }));
    if (!length) throw new Error('no change');
    expect([changeText(length, length.after, 'feet'), changeValue(length, length.after, 'feet')]).toEqual(['12\' 6"', '12\' 6"']);
    setPlanUnitsChoice('feet');
    expect(changeText(length, length.after, 'metres')).toBe('3.81 m');
  });

  it('says a scene was set in a room already drawn, a room copied for a scene, and one deleted and restored (6.2b)', () => {
    const lobby = record('r2', 'plan', 'p', { kind: 'room', name: 'Lobby' });
    const set = lineText(describeEdit([op('update', scene, { ...scene, props: { ...scene.props, room_id: 'r2' } })], none, new Map([['sc4', scene], ['r2', lobby]])));
    expect(set).toBe('Set SC 04 in room “Lobby”');
    const copy = record('r3', 'plan', 'p', { kind: 'room', name: 'Diner (SC 04)' });
    const copied = [op('create', null, copy), op('create', null, { ...wall('c1', { copied_from: 'a' }), parentId: 'r3' }), op('update', scene, { ...scene, props: { ...scene.props, room_id: 'r3' } })];
    expect(say(copied)).toBe('Made a separate copy of the room for SC 04: room “Diner (SC 04)”');
    expect(say([op('trash', room, { ...room, trashedAt: at }), op('trash', wall('a'), { ...wall('a'), trashedAt: at })])).toBe('Deleted room “Diner”');
    expect(say([op('restore', { ...room, trashedAt: at }, room)])).toBe('Restored room “Diner”');
  });

  it('says doors and windows were put in, moved, resized, flipped and deleted, by what they are (6.2b)', () => {
    const door = (id: string, props: Props = {}) => record(id, 'plan_item', 'r', { kind: 'door', wall_id: 'a', along_m: 1, width_m: 0.9, hinge: 'start', swing: 'left', ...props });
    const window = (id: string) => record(id, 'plan_item', 'r', { kind: 'window', wall_id: 'a', along_m: 3, width_m: 1.2 });
    expect(say([op('create', null, door('d'))])).toBe('Put in a door');
    expect(say([op('create', null, window('n')), op('create', null, window('m'))])).toBe('Put in 2 windows');
    expect(say([op('update', door('d'), door('d', { along_m: 2 }))])).toBe('Moved a door');
    expect(say([op('update', door('d'), door('d', { along_m: 2, wall_id: 'b' }))])).toBe('Moved a door');
    expect(say([op('update', door('d'), door('d', { width_m: 0.8 }))])).toBe('Resized a door');
    expect(say([op('update', door('d'), door('d', { swing: 'right' }))])).toBe('Flipped a door');
    expect(say([op('trash', door('d'), { ...door('d'), trashedAt: at }), op('trash', window('n'), { ...window('n'), trashedAt: at })])).toBe('Deleted 2 doors and windows');
    // A wall with its door goes as the wall.
    expect(say([op('trash', wall('a'), { ...wall('a'), trashedAt: at }), op('trash', door('d'), { ...door('d'), trashedAt: at })])).toBe('Deleted a wall');
    // Fields as the Selection tile names them; a hinge in words, a wall never by its id.
    const [hinge] = fieldChanges(door('d'), door('d', { hinge: 'end' }));
    if (!hinge) throw new Error('no change');
    expect([changeLabel(hinge), changeText(hinge, hinge.after)]).toEqual(['hinge', 'At the wall’s end side']);
    const [moved] = fieldChanges(door('d'), door('d', { wall_id: '3f1c9a52-wall' }));
    if (!moved) throw new Error('no change');
    expect(changeText(moved, moved.after)).not.toContain('3f1c9a52');
  });

  it('says items were put in one setup only, back in every setup, and copied from another setup (6.2b)', () => {
    const own = record('own', 'plan', 'u1', { kind: 'setup', name: '' });
    const around = new Map([['sc4', scene], ['own', own], ['r', room]]);
    const into = [op('move', wall('a'), { ...wall('a'), parentId: 'own' }), op('move', wall('b'), { ...wall('b'), parentId: 'own' })];
    expect(lineText(describeEdit(into, none, around))).toBe('Put 2 plan items in one setup only');
    const back = [op('move', { ...wall('a'), parentId: 'own' }, wall('a'))];
    expect(lineText(describeEdit(back, none, around))).toBe('Put a plan item back in every setup');
    const copied = [op('create', null, own), op('create', null, { ...wall('c', { copied_from: 'a' }), parentId: 'own' })];
    expect(lineText(describeEdit(copied, none, around))).toBe('Copied a plan item from another setup');
    setLocale('es');
    expect(lineText(describeEdit(into, none, around))).toBe('Se dejaron 2 elementos de la planta solo en un emplazamiento');
    expect(say([op('create', null, record('d', 'plan_item', 'r', { kind: 'door', wall_id: 'a', along_m: 1 }))])).toBe('Se puso una puerta');
  });

  it('tells a copy from items put in by hand by what they were copied from, in English and Spanish (6.2b review)', () => {
    const own = record('own', 'plan', 'u1', { kind: 'setup', name: '' });
    const around = new Map([['sc4', scene], ['own', own], ['r', room]]);
    // A door put in a wall that is one setup's only sits in the setup's plan, yet it was put in, not copied.
    const door = record('d', 'plan_item', 'own', { kind: 'door', wall_id: 'a', along_m: 1, width_m: 0.9, hinge: 'start', swing: 'left' });
    expect(lineText(describeEdit([op('create', null, door)], none, around))).toBe('Put in a door');
    const setupCopy = [op('create', null, { ...wall('c', { copied_from: 'a' }), parentId: 'own' }), op('create', null, { ...door, id: 'd2', props: { ...door.props, copied_from: 'd' } })];
    expect(lineText(describeEdit(setupCopy, none, around))).toBe('Copied 2 plan items from another setup');
    const copy = record('r3', 'plan', 'p', { kind: 'room', name: 'Diner (SC 04)' });
    const roomCopy = [op('create', null, copy), op('create', null, { ...wall('c1', { copied_from: 'a' }), parentId: 'r3' }), op('update', scene, { ...scene, props: { ...scene.props, room_id: 'r3' } })];
    expect(say(roomCopy)).toBe('Made a separate copy of the room for SC 04: room “Diner (SC 04)”');
    setLocale('es');
    expect(lineText(describeEdit([op('create', null, door)], none, around))).toBe('Se puso una puerta');
    expect(lineText(describeEdit(setupCopy, none, around))).toBe('Se copiaron 2 elementos de la planta de otro emplazamiento');
    expect(say(roomCopy)).toBe('Se hizo una copia aparte del espacio para ESC 04: el espacio “Diner (SC 04)”');
  });

  it('says what went to the Trash when a scene left its room, and a wall resized from its start (6.2b review)', () => {
    const own = record('own', 'plan', 'u1', { kind: 'setup', name: '' });
    const lobby = record('r2', 'plan', 'p', { kind: 'room', name: 'Lobby' });
    const door = record('d', 'plan_item', 'own', { kind: 'door', wall_id: 'a', along_m: 1 });
    const around = new Map([['sc4', scene], ['own', own], ['r2', lobby]]);
    const left = [op('trash', door, { ...door, trashedAt: at }), op('update', scene, { ...scene, props: { ...scene.props, room_id: 'r2' } })];
    expect(lineText(describeEdit(left, none, around))).toBe('Set SC 04 in room “Lobby”; a door or window it had in that room only for this scene went to the Trash');
    const deleted = [op('trash', room, { ...room, trashedAt: at }), op('trash', wall('a'), { ...wall('a'), trashedAt: at }), op('trash', door, { ...door, trashedAt: at }), op('trash', { ...door, id: 'e' }, { ...door, id: 'e', trashedAt: at })];
    expect(say(deleted)).toBe('Deleted room “Diner”; 2 doors and windows it had in that room only for this scene went to the Trash');
    const shifted = [op('update', wall('a'), wall('a', { x: 0.5, width: 3 })), op('update', record('n', 'plan_item', 'r', { kind: 'door', wall_id: 'a', along_m: 1 }), record('n', 'plan_item', 'r', { kind: 'door', wall_id: 'a', along_m: 0.5 }))];
    expect(say(shifted)).toBe('Resized a wall');
    setLocale('es');
    expect(lineText(describeEdit(left, none, around))).toContain('se fue a la Papelera');
  });

  it('says it in Spanish too', () => {
    setLocale('es');
    expect(say([op('create', null, wall('a')), op('create', null, wall('b'))])).toBe('Se dibujaron 2 muros');
    expect(say([op('create', null, room), op('update', scene, { ...scene, props: { ...scene.props, room_id: 'r' } })])).toBe('Se empezó el espacio “Diner” para ESC 04');
  });
});

// 6.3: library icons, named as what they are.
describe('History for library icons (6.3)', () => {
  const own = record('own', 'plan', 'u1', { kind: 'setup', name: '' });
  const icon = (id: string, name: string, props: Props = {}, parentId = 'r') => record(id, 'plan_item', parentId, { kind: 'icon', icon: name, x: 0, y: 0, width: 2, height: 0.9, rotation: 0, ...props });
  const around = new Map([['sc4', scene], ['r', room], ['own', own]]);
  const tell = (ops: LoggedOp[]) => lineText(describeEdit(ops, none, around));

  it('says an icon was placed, moved, turned, resized, named, deleted and restored, naming it', () => {
    const sofa = icon('s', 'set-art/sofa');
    expect(tell([op('create', null, sofa)])).toBe('Placed a sofa in Diner');
    expect(tell([op('create', null, icon('c', 'grip/c-stand', {}, 'own'))])).toBe('Placed a C-stand');
    expect(tell([op('update', sofa, icon('s', 'set-art/sofa', { x: 1, y: 2 }))])).toBe('Moved a sofa');
    expect(tell([op('update', sofa, icon('s', 'set-art/sofa', { rotation: 90 }))])).toBe('Turned a sofa');
    expect(tell([op('update', sofa, icon('s', 'set-art/sofa', { width: 2.2, x: -0.1 }))])).toBe('Resized a sofa');
    expect(tell([op('update', sofa, icon('s', 'set-art/sofa', { name: 'Hero couch' }))])).toBe('Named a sofa “Hero couch”');
    expect(tell([op('update', icon('s', 'set-art/sofa', { name: 'Hero couch' }), sofa)])).toBe('Took the name off a sofa');
    expect(tell([op('update', sofa, icon('s', 'set-art/sofa', { height_m: 0.8 }))])).toBe('Changed a sofa');
    expect(tell([op('trash', sofa, { ...sofa, trashedAt: at })])).toBe('Deleted a sofa');
    expect(tell([op('restore', { ...sofa, trashedAt: at }, sofa)])).toBe('Restored a sofa');
    // An icon this version doesn't know, by what it is in general.
    expect(tell([op('create', null, icon('x', 'set-art/grand-piano'))])).toBe('Placed a plan item in Diner');
  });

  it('counts several, or icons with walls, as plan items', () => {
    const placed = [op('create', null, icon('a', 'set-art/sofa')), op('create', null, icon('b', 'set-art/table'))];
    expect(tell(placed)).toBe('Placed 2 plan items');
    expect(tell([op('update', icon('a', 'set-art/sofa'), icon('a', 'set-art/sofa', { x: 1 })), op('update', wall('w'), wall('w', { x: 1 }))])).toBe('Moved 2 plan items');
    expect(tell([op('trash', icon('a', 'set-art/sofa'), { ...icon('a', 'set-art/sofa'), trashedAt: at }), op('trash', wall('w'), { ...wall('w'), trashedAt: at })])).toBe('Deleted 2 plan items');
    // A setup's copy still says it was copied (6.2b).
    const copied = [op('create', null, icon('k', 'grip/c-stand', { copied_from: 'c' }, 'own'))];
    expect(tell(copied)).toBe('Copied a plan item from another setup');
  });

  it('names an icon’s width and depth as the Selection tile does', () => {
    const sofa = icon('s', 'set-art/sofa');
    // Typed about its middle, as the Selection tile does: its place didn't change, so it isn't listed.
    const changes = fieldChanges(sofa, icon('s', 'set-art/sofa', { width: 2.2, height: 1, x: -0.1, y: -0.05 }));
    expect(changes.map((c) => changeLabel(c))).toEqual(['width', 'depth']);
  });

  it('gives an icon’s place as its middle, as the Selection tile does, in the unit shown (6.3 review)', () => {
    setPlanUnitsChoice('metres');
    // A 2 m by 0.9 m sofa with its corner at (0, 0): its middle is (1, 0.45). Moved by 1 m and 2 m.
    const sofa = icon('s', 'set-art/sofa');
    const moved = fieldChanges(sofa, icon('s', 'set-art/sofa', { x: 1, y: 2 }));
    expect(moved.map((c) => [c.prop, c.before, c.after])).toEqual([
      ['x', 1, 2],
      ['y', 0.45, 2.45],
    ]);
    expect(moved.map((c) => `${changeValue(c, c.before, 'metres')} → ${changeValue(c, c.after, 'metres')}`)).toEqual(['1.00 m → 2.00 m', '0.45 m → 2.45 m']);
    expect(changeText(moved[0] ?? { prop: 'x', before: 0, after: 0 }, 2, 'feet')).toBe(`6' 6.5"`);
    // Stretched from its far corner: its corner stayed, its middle moved, so its place is listed.
    const stretched = fieldChanges(sofa, icon('s', 'set-art/sofa', { width: 3 }));
    expect(stretched.map((c) => [c.prop, c.before, c.after])).toEqual([
      ['width', 2, 3],
      ['x', 1, 1.5],
    ]);
    // A wall's place is still its corner.
    expect(fieldChanges(wall('a'), wall('a', { x: 1 })).map((c) => [c.prop, c.before, c.after])).toEqual([['x', 0, 1]]);
  });

  it('says it in Spanish too', () => {
    setLocale('es');
    expect(tell([op('create', null, icon('s', 'set-art/sofa'))])).toBe('Se colocó un sofá en Diner');
    expect(tell([op('update', icon('t', 'set-art/table'), icon('t', 'set-art/table', { rotation: 45 }))])).toBe('Se giró una mesa');
    expect(tell([op('create', null, icon('a', 'set-art/sofa')), op('create', null, icon('b', 'set-art/table'))])).toBe('Se colocaron 2 elementos de la planta');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../core/i18n';
import type { Props, SbdRecord } from '../../core/model/record';
import type { LoggedOp } from '../../core/ops/ops';
import { changeLabel, describeEdit, fieldChanges, lineText } from './summary';

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

  it('says it in Spanish too', () => {
    setLocale('es');
    expect(say([op('create', null, wall('a')), op('create', null, wall('b'))])).toBe('Se dibujaron 2 muros');
    expect(say([op('create', null, room), op('update', scene, { ...scene, props: { ...scene.props, room_id: 'r' } })])).toBe('Se empezó el espacio “Diner” para ESC 04');
  });
});

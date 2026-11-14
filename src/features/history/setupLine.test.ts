import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../core/i18n';
import type { Props, SbdRecord } from '../../core/model/record';
import type { LoggedOp } from '../../core/ops/ops';
import { describeEdit, lineText } from './summary';

// Setups in History (6.0): added, named, renamed, reordered, deleted and restored, and frames put into one or taken out,
// each one line named by the setup's name (its number is its place now, not then) and its scene, in English and Spanish.

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
const unnamed = record('u', 'setup', 'sc4', { name: '' });
const named = record('u', 'setup', 'sc4', { name: 'Window side' });
const frame = (id: string, number: string, props: Props = {}) => record(id, 'shot', 'sc4', { number, ...props });
const around = new Map<string, SbdRecord>([
  ['sc4', scene],
  ['u', named],
]);
const none = new Set<string>();
const say = (ops: LoggedOp[], near: ReadonlyMap<string, SbdRecord> = around) => lineText(describeEdit(ops, none, near));

afterEach(() => {
  setLocale('en');
});

describe('History for setups', () => {
  it('says a setup was added, made from frames, deleted and restored, with its scene', () => {
    expect(say([op('create', null, unnamed)])).toBe('Added a setup to SC 04');
    expect(say([op('create', null, unnamed), op('update', frame('a', '4A'), frame('a', '4A', { setup_id: 'u' })), op('update', frame('b', '4B'), frame('b', '4B', { setup_id: 'u' }))])).toBe(
      'Made a setup in SC 04 from 2 frames',
    );
    expect(say([op('trash', named, { ...named, trashedAt: at })])).toBe('Deleted setup “Window side” from SC 04');
    expect(say([op('restore', { ...named, trashedAt: at }, named)])).toBe('Restored setup “Window side” in SC 04');
    // Without its scene known, it still reads.
    expect(say([op('create', null, unnamed)], new Map())).toBe('Added a setup to a scene');
  });

  it('says a setup was named, renamed, had its name taken off, and that a scene’s setups were reordered', () => {
    expect(say([op('update', unnamed, named)])).toBe('Renamed a setup in SC 04 to “Window side”');
    expect(say([op('update', named, { ...named, props: { name: 'Door' } })])).toBe('Renamed setup “Window side” in SC 04 to “Door”');
    expect(say([op('update', named, unnamed)])).toBe('Took the name off setup “Window side” in SC 04');
    expect(say([op('move', named, { ...named, sortKey: 'a' })])).toBe('Reordered the setups in SC 04');
  });

  it('says frames were put into a setup or taken out of it', () => {
    expect(say([op('update', frame('a', '4A'), frame('a', '4A', { setup_id: 'u' }))])).toBe('Added 4A to setup “Window side” in SC 04');
    expect(
      say([op('update', frame('a', '4A'), frame('a', '4A', { setup_id: 'u' })), op('update', frame('b', '4B'), frame('b', '4B', { setup_id: 'u' }))]),
    ).toBe('Added 2 frames to setup “Window side” in SC 04');
    expect(say([op('update', frame('a', '4A', { setup_id: 'u' }), frame('a', '4A'))])).toBe('Took 4A out of setup “Window side” in SC 04');
    // A setup the step can't name reads as "a setup".
    expect(say([op('update', frame('a', '4A'), frame('a', '4A', { setup_id: 'gone' }))])).toBe('Added 4A to a setup in SC 04');
  });

  it('leaves a scene deleted with its setups as the scene’s step', () => {
    const trashed = { ...scene, trashedAt: at };
    expect(say([op('trash', scene, trashed), op('trash', named, { ...named, trashedAt: at })])).toBe('Deleted scene SC 04');
  });

  it('says it in Spanish too', () => {
    setLocale('es');
    expect(say([op('create', null, unnamed)])).toBe('Se agregó un emplazamiento a ESC 04');
    expect(say([op('update', frame('a', '4A'), frame('a', '4A', { setup_id: 'u' }))])).toBe('Ahora en el emplazamiento “Window side” de ESC 04: 4A');
    expect(say([op('move', named, { ...named, sortKey: 'a' })])).toBe('Se reordenaron los emplazamientos de ESC 04');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { setPlanUnitsChoice } from '../../app/planUnits';
import { setLocale } from '../../core/i18n';
import type { Props, SbdRecord } from '../../core/model/record';
import type { LoggedOp } from '../../core/ops/ops';
import { changeLabel, changeValue, describeEdit, fieldChanges, lineText } from './summary';

// Heights in History (6.5.6): a room's ceiling height said as that, never as a rename; a window's sill and top named
// and shown as lengths in the unit shown.

const at = '2026-11-16T10:00:00.000Z';
const record = (id: string, type: SbdRecord['type'], parentId: string | null, props: Props): SbdRecord => ({
  id,
  type,
  parentId,
  sortKey: 'm',
  props,
  trashedAt: null,
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

const room = record('r', 'plan', 'p', { kind: 'room', name: 'Diner' });
const window = (props: Props = {}) => record('win', 'plan_item', 'r', { kind: 'window', wall_id: 'w', along_m: 1, width_m: 1.2, ...props });
const say = (ops: LoggedOp[]) => lineText(describeEdit(ops, new Set<string>(), new Map()));

afterEach(() => {
  setLocale('en');
  setPlanUnitsChoice('region');
});

describe('History for heights (6.5.6)', () => {
  it('says a room’s ceiling changed, in English and Spanish', () => {
    const ceiling = op('update', room, { ...room, props: { ...room.props, ceiling_height_m: 2.7 } });
    expect(say([ceiling])).toBe('Changed the ceiling height of room “Diner”');
    // A rename is still a rename.
    expect(say([op('update', room, { ...room, props: { kind: 'room', name: 'Kitchen' } })])).toBe('Renamed room “Diner” to “Kitchen”');
    setLocale('es');
    expect(say([ceiling])).toMatch(/^Se cambió la altura del techo de /);
  });

  it('names a window’s sill and top and shows them as lengths', () => {
    setPlanUnitsChoice('metres');
    expect(say([op('update', window(), window({ sill_height_m: 0.9 }))])).toBe('Changed a window');
    const [sill, top] = fieldChanges(window(), window({ sill_height_m: 0.9, top_height_m: 2.1 }));
    if (!sill || !top) throw new Error('no changes');
    expect(changeLabel(sill)).toBe('sill height');
    expect(changeLabel(top)).toBe('top height');
    expect(changeValue(sill, 0.9)).toBe('0.90 m');
    expect(changeValue(top, 2.1)).toBe('2.10 m');
  });
});

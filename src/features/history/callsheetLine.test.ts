import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../core/i18n';
import type { Props, SbdRecord } from '../../core/model/record';
import type { LoggedOp } from '../../core/ops/ops';
import { changeLabel, describeEdit, fieldChanges, lineText } from './summary';

// A call sheet's note in History (4.1): the item is "Call sheet · <the day>", the field "General notes" or "Safety
// notes"; a call sheet made by its first note reads as that note set, not as a call sheet added.

const at = '2026-11-10T10:00:00.000Z';
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

const day = record('d', 'shoot_day', 'p', { date: '2026-11-16' });
const around = new Map([['d', day]]);
const none = new Set<string>();

afterEach(() => {
  setLocale('en');
});

describe('History for a call sheet’s notes', () => {
  it('names the item by its day and the field by the tile’s name for it', () => {
    const before = record('cs', 'callsheet', 'd', { notes: 'Park behind' });
    const after = record('cs', 'callsheet', 'd', { notes: 'Park in lot B' });
    expect(lineText(describeEdit([op('update', before, after)], none, around))).toBe('Call sheet · Mon, Nov 16: general notes changed → changed');
    const safety = record('cs', 'callsheet', 'd', { notes: 'Park behind', safety_notes: 'Hard hats' });
    expect(lineText(describeEdit([op('update', before, safety)], none, around))).toBe('Call sheet · Mon, Nov 16: safety notes — → not shown');
    expect(fieldChanges(before, safety).map((change) => changeLabel(change))).toEqual(['safety notes']);
  });

  it('reads a call sheet made with its first note as that note being set', () => {
    const made = record('cs', 'callsheet', 'd', { notes: 'Park behind' });
    expect(lineText(describeEdit([op('create', null, made)], none, around))).toBe('Call sheet · Mon, Nov 16: general notes — → not shown');
  });

  it('says it in Spanish too, and never names the record type', () => {
    setLocale('es');
    const made = record('cs', 'callsheet', 'd', { safety_notes: 'Cascos' });
    const line = lineText(describeEdit([op('create', null, made)], none, around));
    expect(line).toBe('Hoja de llamado · lun, 16 nov: notas de seguridad — → no se muestra');
    expect(line).not.toContain('callsheet');
    expect(line).not.toContain('Cascos');
    // Without the day (it was never read), the sheet is still named in words.
    expect(lineText(describeEdit([op('create', null, made)], none))).toBe('La hoja de llamado: notas de seguridad — → no se muestra');
  });
});

describe('History for an issued call sheet (4.7)', () => {
  const pdf = (version: number) =>
    record('m', 'media', 'cs', { kind: 'pdf', file: 'abc', source_name: 'Secret Contents.pdf', byte_size: 9, issue_version: version, fingerprint: 'x', fingerprint_version: 1 });
  const lock = op('update', record('s1', 'scene', 'p', { number: '1' }), record('s1', 'scene', 'p', { number: '1', numbers_locked: true }));

  it('is one line naming the day and the version, with the lock as part of the step and the PDF never listed', () => {
    const made = record('cs', 'callsheet', 'd', {});
    const ops = [op('create', null, made), op('create', null, pdf(2)), lock];
    expect(lineText(describeEdit(ops, none, around))).toBe('Issued the call sheet for Mon, Nov 16 (version 2)');
    expect(lineText(describeEdit(ops, none, around))).not.toContain('Secret');
  });

  it('names the day when the call sheet was already there (read through the call sheet, as the step left it)', () => {
    const sheet = record('cs', 'callsheet', 'd', {});
    expect(lineText(describeEdit([op('create', null, pdf(1))], none, new Map([['d', day], ['cs', sheet]])))).toBe('Issued the call sheet for Mon, Nov 16 (version 1)');
  });

  it('says it in Spanish', () => {
    setLocale('es');
    expect(lineText(describeEdit([op('create', null, pdf(1))], none, new Map([['d', day], ['cs', record('cs', 'callsheet', 'd', {})]])))).toBe(
      'Se emitió la hoja de llamado del lun, 16 nov (versión 1)',
    );
  });
});

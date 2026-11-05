import { customFieldsOf, hiddenFieldNames, withField, withoutField } from '../../core/model/customFields';
import type { JsonValue, SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import type { FieldChange } from './summary';

// Put back (1.22): an old value from an item's own history set again, as one step. Only the fields a person sets by
// hand go back on their own; numbers, pictures and framing the board keeps in step, so Restore to here is the way
// back for those. A scene's location is kept by id, and the location it named may be in the Trash or gone for good
// since, so it goes back only with Restore to here too.

/** Fields a person sets by hand, by kind of item, so an old value can go back on its own without leaving the board inconsistent. */
const PUTTABLE: Readonly<Partial<Record<SbdRecord['type'], ReadonlySet<string>>>> = {
  // Not department status (polish 6): an approval is a sign-off with a name and a time, never one to put back by hand.
  // Not the older departments list either: a frame reads its status now, so putting the list back would change nothing.
  shot: new Set(['size', 'lens_mm', 't_stop', 'support', 'height', 'move', 'status', 'action', 'dialogue', 'custom']),
  scene: new Set(['name', 'int_ext', 'day_night', 'page_eighths']),
  note: new Set(['text']),
};

// A frame's own empty and unset fields read the same in the inspector and in History (`—`), so neither is put back
// over the other: an empty text, say.
const blank = (v: JsonValue | undefined) => (v === undefined || v === '' ? null : v);
const same = (a: JsonValue | undefined, b: JsonValue | undefined) => JSON.stringify(blank(a)) === JSON.stringify(blank(b));

/** Whether this change's old value can be put back by hand on this kind of item. A custom field holding more than text never is (1.19). */
export function canPutBack(type: SbdRecord['type'], field: FieldChange): boolean {
  if (!PUTTABLE[type]?.has(field.prop)) return false;
  return field.key === undefined || field.before === undefined || typeof field.before === 'string';
}

/**
 * The update that puts `field`'s old value back on the record as it is now, or null when there's nothing to do: the
 * value is already there (an empty step in History helps no one), or it can't go back by hand. A custom field goes
 * back on its own, so the frame's other custom fields stay as they are now.
 */
export function putBackChange(record: SbdRecord | undefined, field: FieldChange): Change | null {
  if (!record || !canPutBack(record.type, field)) return null;
  const { key, before } = field;
  if (key !== undefined) {
    // Something this version can't show sits under that name now: never written over (1.19).
    if (hiddenFieldNames(record.props).includes(key)) return null;
    // Exact here: a field emptied and a field taken off read apart ("—", "no field"), so neither stands for the other.
    if (customFieldsOf(record.props)[key] === before) return null;
    return { kind: 'update', id: record.id, ...(typeof before === 'string' ? withField(record.props, key, before) : withoutField(record.props, key)) };
  }
  if (same(record.props[field.prop], before)) return null;
  return { kind: 'update', id: record.id, ...(before === undefined ? { unset: [field.prop] } : { set: { [field.prop]: before } }) };
}

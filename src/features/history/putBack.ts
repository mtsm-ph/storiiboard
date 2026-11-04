import { customFieldsOf, hiddenFieldNames, withField, withoutField } from '../../core/model/customFields';
import type { JsonValue, SbdRecord } from '../../core/model/record';
import type { Change } from '../../core/ops/ops';
import type { FieldChange } from './summary';

// Put back (1.22): an old value from an item's own history set again, as one step. Only the fields a person sets by
// hand go back on their own; numbers, pictures and framing the board keeps in step, so Restore to here is the way
// back for those.

/** Fields a person sets by hand, so an old value can go back on its own without leaving the board inconsistent. */
const PUTTABLE = new Set(['size', 'lens_mm', 't_stop', 'support', 'height', 'move', 'status', 'action', 'dialogue', 'departments', 'custom']);

// A frame's own empty and unset fields read the same in the inspector and in History (`—`), so neither is put back
// over the other: an empty text, or no departments ticked (an empty list, once a department was ticked and unticked).
const blank = (v: JsonValue | undefined) => (v === undefined || v === '' || (Array.isArray(v) && v.length === 0) ? null : v);
// Departments are a set: the inspector adds one to the end when it's ticked, so the same departments in another
// order are the same value, and putting the old order back would be a step that changes nothing a person sees.
const asSet = (v: JsonValue | null) => (Array.isArray(v) ? [...new Set(v.map((d) => JSON.stringify(d)))].sort() : v);
const same = (prop: string, a: JsonValue | undefined, b: JsonValue | undefined) => {
  const [x, y] = prop === 'departments' ? [asSet(blank(a)), asSet(blank(b))] : [blank(a), blank(b)];
  return JSON.stringify(x) === JSON.stringify(y);
};

/** Whether this change's old value can be put back by hand. A custom field holding more than text never is (1.19). */
export function canPutBack(field: FieldChange): boolean {
  if (!PUTTABLE.has(field.prop)) return false;
  return field.key === undefined || field.before === undefined || typeof field.before === 'string';
}

/**
 * The update that puts `field`'s old value back on the record as it is now, or null when there's nothing to do: the
 * value is already there (an empty step in History helps no one), or it can't go back by hand. A custom field goes
 * back on its own, so the frame's other custom fields stay as they are now.
 */
export function putBackChange(record: SbdRecord | undefined, field: FieldChange): Change | null {
  if (!record || !canPutBack(field)) return null;
  const { key, before } = field;
  if (key !== undefined) {
    // Something this version can't show sits under that name now: never written over (1.19).
    if (hiddenFieldNames(record.props).includes(key)) return null;
    // Exact here: a field emptied and a field taken off read apart ("—", "no field"), so neither stands for the other.
    if (customFieldsOf(record.props)[key] === before) return null;
    return { kind: 'update', id: record.id, ...(typeof before === 'string' ? withField(record.props, key, before) : withoutField(record.props, key)) };
  }
  if (same(field.prop, record.props[field.prop], before)) return null;
  return { kind: 'update', id: record.id, ...(before === undefined ? { unset: [field.prop] } : { set: { [field.prop]: before } }) };
}

import { dayCallsheet } from '../../core/model/callsheet';
import type { SbdRecord } from '../../core/model/record';
import { keyBetween } from '../../core/ops/order';
import type { Change } from '../../core/ops/ops';

// The edits the call sheet makes (4.1). Today only its two notes. The `callsheet` record under a day is made by the
// first note typed, in the same change list, so one ⌘Z takes both back; just viewing a day never makes one.

type Records = Readonly<Record<string, SbdRecord>>;

export type CallsheetNote = 'notes' | 'safety_notes';

/**
 * One of a day's notes; an empty value takes it off. Nothing when it's already so, or the day isn't live. The first
 * note of a day creates its call sheet with the note on it.
 */
export function callsheetNoteChange(records: Records, dayId: string, prop: CallsheetNote, value: string, id: string = crypto.randomUUID()): Change[] {
  const day = records[dayId];
  if (day?.type !== 'shoot_day' || day.trashedAt !== null) return [];
  const sheet = dayCallsheet(records, dayId);
  if (!sheet) {
    if (value === '') return [];
    // After every call sheet the day has had (in the Trash too), so a restored one never shares a key.
    const last = Object.values(records)
      .filter((r) => r.type === 'callsheet' && r.parentId === dayId)
      .reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);
    return [{ kind: 'create', record: { id, type: 'callsheet', parentId: dayId, sortKey: keyBetween(last, null), props: { [prop]: value } } }];
  }
  const current = typeof sheet.props[prop] === 'string' ? sheet.props[prop] : '';
  if (current === value) return [];
  return value === '' ? [{ kind: 'update', id: sheet.id, unset: [prop] }] : [{ kind: 'update', id: sheet.id, set: { [prop]: value } }];
}

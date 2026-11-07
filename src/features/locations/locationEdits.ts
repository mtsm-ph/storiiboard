import type { SbdRecord } from '../../core/model/record';
import { keyBetween } from '../../core/ops/order';
import type { Change } from '../../core/ops/ops';

// The edits the Locations tile makes (3.3): a new location, one field changed, one sent to the Trash. Each is one op
// group, so one ⌘Z. Scenes set there keep their link while it's in the Trash, so restoring it puts them back with it.

type Records = Readonly<Record<string, SbdRecord>>;

/** A new, empty location after the project's others (in the Trash too, so a restored one never shares a key). */
export function newLocation(records: Records, projectId: string, id: string = crypto.randomUUID()): Extract<Change, { kind: 'create' }> {
  const last = Object.values(records)
    .filter((r) => r.type === 'location' && r.parentId === projectId)
    .reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);
  return { kind: 'create', record: { id, type: 'location', parentId: projectId, sortKey: keyBetween(last, null), props: { name: '', status: 'tbd' } } };
}

/** One field of a location, from the location as it is at the edit's turn; nothing when it's already that, or gone. */
export function locationChange(records: Records, id: string, prop: string, value: string): Change[] {
  const location = records[id];
  if (location?.type !== 'location' || location.trashedAt !== null) return [];
  const current = typeof location.props[prop] === 'string' ? location.props[prop] : '';
  return current === value ? [] : [{ kind: 'update', id, set: { [prop]: value } }];
}

/** A location to the Trash; its scenes keep their link, so a restore brings them back with it. */
export function trashLocation(records: Records, id: string): Change[] {
  const location = records[id];
  return location?.type === 'location' && location.trashedAt === null ? [{ kind: 'trash', id }] : [];
}

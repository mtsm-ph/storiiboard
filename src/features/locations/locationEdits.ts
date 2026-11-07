import { imageStatements, mediaProps, type ImageSource, type PreparedImage } from '../../core/media/store';
import type { SbdRecord } from '../../core/model/record';
import type { Statement } from '../../core/storage/driver';
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

/**
 * Photos added to a location (3.3), after its others, in one edit: each a picture under the location, stored as a
 * frame's picture is. Nothing when the location isn't live.
 */
export function addLocationPhotos(
  records: Records,
  locationId: string,
  photos: readonly { image: PreparedImage; source: ImageSource }[],
  projectPath: string,
  now = new Date(),
): { changes: Change[]; alsoWrite: Statement[] } {
  const location = records[locationId];
  if (location?.type !== 'location' || location.trashedAt !== null || photos.length === 0) return { changes: [], alsoWrite: [] };
  let last = Object.values(records)
    .filter((r) => r.parentId === locationId)
    .reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);
  const changes: Change[] = [];
  const alsoWrite: Statement[] = [];
  for (const { image, source } of photos) {
    last = keyBetween(last, null);
    changes.push({ kind: 'create', record: { id: crypto.randomUUID(), type: 'media', parentId: locationId, sortKey: last, props: mediaProps(image, source, projectPath) } });
    alsoWrite.push(...imageStatements(image, now));
  }
  return { changes, alsoWrite };
}

/** A location's photo to the Trash. */
export function trashLocationPhoto(records: Records, photoId: string): Change[] {
  const photo = records[photoId];
  const parent = photo?.parentId ? records[photo.parentId] : undefined;
  return photo?.type === 'media' && photo.trashedAt === null && parent?.type === 'location' ? [{ kind: 'trash', id: photoId }] : [];
}

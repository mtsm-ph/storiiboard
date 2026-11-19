import { projectStore } from '../../app/projectStore';
import type { Coordinates } from '../../core/model/coordinates';
import { t, tn } from '../../core/i18n';
import { photoTakenOf, type ExifReason } from '../../core/model/scoutPhoto';
import type { Change } from '../../core/ops/ops';
import { clearLightPhotoChanges, photoPlaceTimeChanges } from './locationEdits';

// "Use this photo's place and time" and the light reference's "Clear" (6.27), written as the Locations tile writes
// every edit: worked out from the records as the edit lands, one op group each (one ⌘Z). Nothing is requested by the
// edit, ever: the photo's place was read from its EXIF on this computer when it was imported, and it goes on the
// location as pasted coordinates do (no address search, no lookup; the zone is found from the place afterwards,
// offline).

/**
 * How an edit ended: `written`; `nothing`, there was nothing to write (the location read so already); or `failed`, the
 * save was refused or threw (the store has said why in the app's own notice, as for every edit of the tile), which is
 * never said as "already".
 */
export type EditOutcome = 'written' | 'nothing' | 'failed';

/** An edit through the store, telling "nothing to write" from "the save failed": the store alone says only whether it failed. */
async function edit(build: (records: Parameters<typeof photoPlaceTimeChanges>[0]) => Change[]): Promise<EditOutcome> {
  // A holder, since the build sets it inside a callback.
  const made = { changes: 0 };
  const done = await projectStore.getState().applyWith((now) => {
    const changes = build(now);
    made.changes = changes.length;
    return { changes };
  });
  return !done ? 'failed' : made.changes > 0 ? 'written' : 'nothing';
}

export interface PhotoUsed {
  outcome: EditOutcome;
  /** The photo's place, when it has one. */
  place: Coordinates | null;
  /** Whether the photo has a time, so it is (now) the light reference. */
  time: boolean;
}

export async function applyPhotoPlaceTime(photoId: string): Promise<PhotoUsed> {
  const photo = projectStore.getState().records[photoId];
  const taken = photoTakenOf(photo?.props ?? {});
  const outcome = await edit((now) => photoPlaceTimeChanges(now, photoId));
  return { outcome, place: taken.place, time: taken.takenAt !== null };
}

/**
 * What the status line says after "Add photos…" (6.27 round 4's item 5, Kevin): one sentence that counts the photos
 * added and, of them, those with no date or place by reason: "12 photos added. 3 have no date or place: 2 are HEIC, 1
 * couldn't be read." A photo with no EXIF at all "had none". '' when every photo's EXIF was read, as before. `reasons`
 * are the imported photos', one each; a photo that couldn't be prepared at all wasn't imported and has its own notice.
 */
export function importNote(reasons: readonly ExifReason[]): string {
  const count = (reason: ExifReason) => reasons.filter((r) => r === reason).length;
  const parts = (
    [
      ['heic', 'location.photosHeic'],
      ['refused', 'location.photosUnread'],
      ['none', 'location.photosHadNone'],
    ] as const
  ).flatMap(([reason, key]) => {
    const n = count(reason);
    return n > 0 ? [tn(key, n)] : [];
  });
  const missing = reasons.length - count('read');
  if (missing === 0) return '';
  return `${tn('location.photosAdded', reasons.length)} ${tn('location.photosNoPlace', missing, { reasons: parts.join(t('list.separator')) })}`;
}

/** The light reference taken off. */
export const clearLightPhoto = (locationId: string): Promise<EditOutcome> => edit((now) => clearLightPhotoChanges(now, locationId));

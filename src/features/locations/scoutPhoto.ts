import { projectStore } from '../../app/projectStore';
import type { Coordinates } from '../../core/model/coordinates';
import { t } from '../../core/i18n';
import { locationPhotos } from '../../core/model/location';
import type { SbdRecord } from '../../core/model/record';
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
 * What the status line says after "Add photos…" (6.27 round 3, Kevin Nov 17): a line for each photo whose date and place
 * were left out, named as the tile names it ("Photo 5: …", its number among the location's photos, as in "Photo 5 of
 * Quay": round 4), all in one; '' when none needs one. A photo with no EXIF, or one read, says nothing new; a photo that
 * couldn't be prepared at all (a HEIC this webview can't decode) wasn't imported and has its own notice already. The
 * status line holds one string, so the lines are joined by a space.
 */
export function importNote(records: Readonly<Record<string, SbdRecord>>, locationId: string, imported: readonly { id: string; reason: ExifReason }[]): string {
  const photos = locationPhotos(records, locationId);
  return imported
    .flatMap(({ id, reason }) => {
      const at = photos.findIndex((photo) => photo.id === id);
      if (at < 0) return [];
      const n = at + 1;
      if (reason === 'refused') return [t('location.photoExifRefused', { n })];
      if (reason === 'heic') return [t('location.photoExifHeic', { n })];
      return [];
    })
    .join(' ');
}

/** The light reference taken off. */
export const clearLightPhoto = (locationId: string): Promise<EditOutcome> => edit((now) => clearLightPhotoChanges(now, locationId));

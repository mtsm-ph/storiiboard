import { useEffect, useId, useRef, useState } from 'react';
import { showNotice } from '../../app/notice';
import { readPhotoExif } from '../../app/photoExif';
import { choosePictures } from '../../app/pictures';
import { projectStore, useProject } from '../../app/projectStore';
import { t, tn } from '../../core/i18n';
import { prepareImage } from '../../core/media/image';
import { mediaFields, type ImageSource, type PreparedImage } from '../../core/media/store';
import { imageUrl } from '../../core/media/urls';
import { formatCoordinates } from '../../core/model/coordinates';
import { locationFields, locationPhotos } from '../../core/model/location';
import type { SbdRecord } from '../../core/model/record';
import { dateTimeLabel, exifReasonOf, lightReferenceOf, photoName, photoTakenOf, takenLabel, type ExifReason, type LightReference, type PhotoExif } from '../../core/model/scoutPhoto';
import { photoWhen } from '../../core/model/sunSources';
import { Button, IconButton } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { CloseGlyph } from '../../ui/glyphs';
import { addLocationPhotos, trashLocationPhoto } from './locationEdits';
import { applyPhotoPlaceTime, clearLightPhoto, importNote } from './scoutPhoto';

// A location's photos (3.3): recce pictures, stored in the project as frames' pictures are, so they travel with the
// file. Added in one edit (one ⌘Z for the lot), each removed to the Trash on its own. Shown small; Phase 4's call sheet
// prints them.
//
// Scout photos (6.27, Kevin Nov 16): on import each photo's date, time and place are read from its EXIF, on this
// computer (src/app/photoExif.ts), and kept on its record; the stored picture is drawn again from its pixels, so it
// carries none. A photo that has them says when and where it was taken, and offers "Use this photo's place and time":
// its place goes on the location as pasted coordinates do, and it becomes the location's light reference, which a sun
// path on a plan can be drawn for. Nothing is requested for any of it. A photo with neither looks as it did before.

export function LocationPhotos({ locationId, name }: { locationId: string; name: string }) {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const written = useProject((s) => s.picturesWritten);
  const photos = locationPhotos(records, locationId);
  const adding = useRef(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const list = useRef<HTMLUListElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  if (!project) return null;
  const location = records[locationId];
  const reference: LightReference = location ? lightReferenceOf(records, location) : { kind: 'none' };
  // When the light reference was taken (6.27 round 3, L-C): on the location's clock when its zone is typed (a photo
  // with its own offset is that instant, read there), else as the camera wrote it, said as "camera time".
  const referenceWhen = (takenAt: string, offset: string | null): string => {
    const zone = location ? locationFields(location.props).time_zone : '';
    const when = photoWhen(takenAt, offset, zone === '' ? null : zone);
    const label = dateTimeLabel(when.date, when.time);
    return when.instant ? label : t('location.photoCameraTime', { when: label });
  };
  const nameOf = (photo: SbdRecord): string => {
    const index = photos.findIndex((p) => p.id === photo.id);
    return photoName(photo) || (index >= 0 ? t('location.photoAlt', { name, n: index + 1 }) : t('photo.unnamed'));
  };

  const add = async () => {
    if (adding.current) return;
    adding.current = true;
    setBusy(true);
    try {
      const picked = await choosePictures(true);
      if (picked.length === 0) return;
      const prepared: { image: PreparedImage; source: ImageSource; exif: PhotoExif | null }[] = [];
      // Why each prepared photo's date and place were or weren't read (6.27 round 3), in the import's order; a photo
      // that couldn't be prepared isn't imported and has its own notice.
      const reasons: ExifReason[] = [];
      for (const file of picked) {
        try {
          const picture = await file.read();
          const image = await prepareImage(picture);
          // Only for a picture that was read: when and where it was taken, from the file's own bytes (6.27).
          const exif = await readPhotoExif(picture, file.name);
          prepared.push({ image, source: { name: file.name, ...(file.path ? { path: file.path } : {}) }, exif });
          reasons.push(exifReasonOf(exif));
        } catch (error) {
          showNotice(error);
        }
      }
      // The new photos' ids, in the import's order (one record each), so the note can name them as the tile does.
      const made: string[] = [];
      const done = await projectStore.getState().applyWith((now) => {
        const edit = addLocationPhotos(now, locationId, prepared, project.file.path);
        made.length = 0;
        for (const change of edit.changes) if (change.kind === 'create' && change.record.type === 'media' && change.record.id) made.push(change.record.id);
        return edit;
      });
      // One status update for the whole import: the photos added, and those without a date and place, by reason.
      const imported = made.flatMap((_, i) => {
        const reason = reasons[i];
        return reason ? [reason] : [];
      });
      const note = importNote(imported);
      if (done && note !== '') setSaid(note);
    } finally {
      adding.current = false;
      setBusy(false);
    }
  };

  const placeAndTime = (photo: SbdRecord) => {
    void applyPhotoPlaceTime(photo.id).then((used) => {
      // A save that failed is said by the app's own notice, as every failed edit of this tile: never as "already".
      if (used.outcome === 'failed') setSaid('');
      else if (used.outcome === 'nothing') setSaid(t('location.photoUsedAlready'));
      else if (used.place && used.time) setSaid(t('location.photoUsedPlaceTime', { coordinates: formatCoordinates(used.place) }));
      else if (used.place) setSaid(t('location.photoUsedPlace', { coordinates: formatCoordinates(used.place) }));
      else setSaid(t('location.photoUsedTime'));
    });
  };

  return (
    <div className="flex flex-col gap-2" data-location-photos="">
      <h4 className="sb-label">{t('location.photos')}</h4>
      {photos.length === 0 ? (
        <p className="text-[12px] text-text-muted">{t('location.noPhotos')}</p>
      ) : (
        <ul ref={list} aria-label={tn('location.photoCount', photos.length)} className="flex flex-wrap gap-2">
          {photos.map((photo, index) => (
            <Photo
              key={photo.id}
              photo={photo}
              written={written}
              alt={t('location.photoAlt', { name, n: index + 1 })}
              isReference={reference.kind !== 'none' && reference.photo.id === photo.id}
              onUse={() => {
                placeAndTime(photo);
              }}
              onRemove={() => {
                void projectStore
                  .getState()
                  .applyWith((now) => ({ changes: trashLocationPhoto(now, photo.id) }))
                  .then((done) => {
                    if (!done) return;
                    // Focus to the next photo's Remove, or Add photos when it was the last.
                    requestAnimationFrame(() => {
                      const buttons = list.current?.querySelectorAll<HTMLButtonElement>('button[data-remove-photo]');
                      (buttons?.[Math.min(index, buttons.length - 1)] ?? addButton.current)?.focus();
                    });
                  });
              }}
            />
          ))}
        </ul>
      )}
      {reference.kind !== 'none' && (
        <div className="flex flex-col gap-1" data-light-reference={reference.kind}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 text-[13px]" data-light-reference-words="">
              {reference.kind === 'ready'
                ? t('location.lightReference', { photo: nameOf(reference.photo), when: referenceWhen(reference.takenAt, reference.offset) })
                : reference.kind === 'trashed'
                  ? t('location.lightReferenceTrashed')
                  : t('location.lightReferenceNoTime', { photo: nameOf(reference.photo) })}
            </p>
            <Button
              aria-label={t('location.lightReferenceClearLabel')}
              data-light-reference-clear=""
              onClick={() => {
                void clearLightPhoto(locationId).then((outcome) => {
                  // A failed save is said by the app's own notice: the status line empties, as for "Use this photo's…".
                  if (outcome === 'failed') setSaid('');
                  if (outcome !== 'written') return;
                  setSaid(t('location.lightReferenceCleared'));
                  // The button goes with the reference: the focus to Add photos, which stays.
                  requestAnimationFrame(() => addButton.current?.focus());
                });
              }}
            >
              {t('location.lightReferenceClear')}
            </Button>
          </div>
          <p className="text-[12px] text-text-muted">{t('location.lightReferenceNote')}</p>
        </div>
      )}
      {/* Always in the page (out of sight while empty), so each new word is read out. */}
      <p role="status" className={said === '' ? 'sr-only' : 'text-[12px]'} data-photo-said="">
        {said}
      </p>
      <Button
        ref={addButton}
        className="self-start"
        aria-disabled={busy}
        onClick={() => {
          if (!busy) void add();
        }}
      >
        {t('location.addPhotos')}
      </Button>
    </div>
  );
}

interface PhotoProps {
  photo: SbdRecord;
  written: number;
  alt: string;
  /** It is the location's light reference (6.27). */
  isReference: boolean;
  onUse: () => void;
  onRemove: () => void;
}

function Photo({ photo, written, alt, isReference, onUse, onRemove }: PhotoProps) {
  const project = useProject((s) => s.project);
  const sha256 = mediaFields(photo.props)?.sha256 ?? null;
  const [url, setUrl] = useState<{ sha256: string; url: string | null } | null>(null);
  const file = project?.file ?? null;
  const caption = useId();
  useEffect(() => {
    if (!file || !sha256) return;
    let live = true;
    void imageUrl(file, sha256).then((next) => {
      if (live) setUrl({ sha256, url: next });
    });
    return () => {
      live = false;
    };
  }, [file, sha256, written]);
  const shown = sha256 && url?.sha256 === sha256 ? url.url : null;
  // What its EXIF said (6.27), through the one reader: nothing for a photo with none, which is drawn as before.
  const taken = photoTakenOf(photo.props);
  const told = taken.takenAt !== null || taken.place !== null;
  const action = taken.place && taken.takenAt !== null ? t('location.usePhotoPlaceTime') : taken.place ? t('location.usePhotoPlace') : t('location.usePhotoTime');
  const picture = (
    <div className="relative shrink-0">
      {shown ? (
        <img src={shown} alt={alt} className="block h-[72px] w-[96px] border border-border object-cover" />
      ) : (
        // Named as the photo is, so the flag says which one; missing in words and a dashed warning edge (two cues).
        <span
          role="img"
          aria-label={url ? t('location.photoMissingNamed', { photo: alt }) : alt}
          className={cx(
            'sb-label flex h-[72px] w-[96px] items-center justify-center border border-dashed',
            url ? 'border-warning text-warning dark:border-text dark:text-text' : 'border-border',
          )}
        >
          {url ? t('location.photoMissing') : ''}
        </span>
      )}
      <IconButton size="sm" label={t('location.removePhoto', { photo: alt })} className="absolute top-0 right-0 bg-surface" data-remove-photo="" onClick={onRemove}>
        <CloseGlyph />
      </IconButton>
    </div>
  );
  if (!told && !isReference) return <li className="relative">{picture}</li>;
  return (
    // A row of its own: the picture, then when and where it was taken and what can be done with that.
    <li className="flex basis-full gap-2" data-photo-taken={photo.id}>
      {picture}
      <div className="flex min-w-0 flex-col items-start gap-1">
        <div id={caption} className="flex flex-col text-[12px]">
          {isReference && (
            // Selection is an ink fill; the words are the second cue.
            <span className="sb-label self-start bg-text px-[5px] py-0.5 text-text-inverse" data-photo-reference="">
              {t('location.lightReferenceTag')}
            </span>
          )}
          {taken.takenAt !== null && <span data-photo-when="">{t('location.photoTaken', { when: takenLabel(taken.takenAt, true) })}</span>}
          {taken.place && (
            <span className="font-mono" data-photo-place="">
              {t('location.photoPlace', { coordinates: formatCoordinates(taken.place) })}
            </span>
          )}
        </div>
        {told && (
          // Named with its photo ("Use this photo's place and time: Photo 2 of Quay"), so two photos' buttons never
          // share a name; the name starts with the words on the button.
          <Button className="h-auto min-h-[34px] py-1 text-left" aria-label={t('location.usePhotoNamed', { action, photo: alt })} aria-describedby={caption} data-photo-use="" onClick={onUse}>
            {action}
          </Button>
        )}
      </div>
    </li>
  );
}

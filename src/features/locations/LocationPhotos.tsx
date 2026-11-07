import { useEffect, useRef, useState } from 'react';
import { showNotice } from '../../app/notice';
import { choosePictures } from '../../app/pictures';
import { projectStore, useProject } from '../../app/projectStore';
import { t, tn } from '../../core/i18n';
import { prepareImage } from '../../core/media/image';
import { mediaFields, type ImageSource, type PreparedImage } from '../../core/media/store';
import { imageUrl } from '../../core/media/urls';
import { locationPhotos } from '../../core/model/location';
import type { SbdRecord } from '../../core/model/record';
import { Button, IconButton } from '../../ui/Button';
import { CloseGlyph } from '../../ui/glyphs';
import { addLocationPhotos, trashLocationPhoto } from './locationEdits';

// A location's photos (3.3): recce pictures, stored in the project as frames' pictures are, so they travel with the
// file. Added in one edit (one ⌘Z for the lot), each removed to the Trash on its own. Shown small; Phase 4's call sheet
// prints them.

export function LocationPhotos({ locationId, name }: { locationId: string; name: string }) {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const written = useProject((s) => s.picturesWritten);
  const photos = locationPhotos(records, locationId);
  const adding = useRef(false);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  if (!project) return null;

  const add = async () => {
    if (adding.current) return;
    adding.current = true;
    setBusy(true);
    try {
      const picked = await choosePictures(true);
      if (picked.length === 0) return;
      const prepared: { image: PreparedImage; source: ImageSource }[] = [];
      for (const file of picked) {
        try {
          prepared.push({ image: await prepareImage(await file.read()), source: { name: file.name, ...(file.path ? { path: file.path } : {}) } });
        } catch (error) {
          showNotice(error);
        }
      }
      await projectStore.getState().applyWith((now) => addLocationPhotos(now, locationId, prepared, project.file.path));
    } finally {
      adding.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
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
              onRemove={() => {
                void projectStore
                  .getState()
                  .applyWith((now) => ({ changes: trashLocationPhoto(now, photo.id) }))
                  .then((done) => {
                    if (!done) return;
                    // Focus to the next photo's Remove, or Add photos when it was the last.
                    requestAnimationFrame(() => {
                      const buttons = list.current?.querySelectorAll<HTMLButtonElement>('button');
                      (buttons?.[Math.min(index, buttons.length - 1)] ?? addButton.current)?.focus();
                    });
                  });
              }}
            />
          ))}
        </ul>
      )}
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

function Photo({ photo, written, alt, onRemove }: { photo: SbdRecord; written: number; alt: string; onRemove: () => void }) {
  const project = useProject((s) => s.project);
  const sha256 = mediaFields(photo.props)?.sha256 ?? null;
  const [url, setUrl] = useState<{ sha256: string; url: string | null } | null>(null);
  const file = project?.file ?? null;
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
  return (
    <li className="relative">
      {shown ? (
        <img src={shown} alt={alt} className="block h-[72px] w-[96px] border border-border object-cover" />
      ) : (
        <span className="flex h-[72px] w-[96px] items-center justify-center border border-dashed border-border text-[11px] text-text-muted">
          {url ? t('location.photoMissing') : ''}
        </span>
      )}
      <IconButton size="sm" label={t('location.removePhoto', { photo: alt })} className="absolute top-0 right-0 bg-surface" onClick={onRemove}>
        <CloseGlyph />
      </IconButton>
    </li>
  );
}

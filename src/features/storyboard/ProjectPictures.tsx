import { useCallback, type ReactNode } from 'react';
import { useProject } from '../../app/projectStore';
import { imageUrl } from '../../core/media/urls';
import { PictureUrls, type PictureUrl } from './FrameImage';

/** Gives the frames inside it their pictures from the open project. */
export function ProjectPictures({ children }: { children: ReactNode }) {
  const file = useProject((s) => s.project?.file ?? null);
  // A new function once a picture is stored, so a frame that found its picture missing looks again; pictures already
  // shown come straight from imageUrl's cache.
  const written = useProject((s) => s.picturesWritten);
  const urlFor = useCallback<PictureUrl>(
    (sha256, size) => (file ? imageUrl(file, sha256, size) : Promise.resolve(null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `written` is the reason to make a new one
    [file, written],
  );
  return <PictureUrls.Provider value={urlFor}>{children}</PictureUrls.Provider>;
}

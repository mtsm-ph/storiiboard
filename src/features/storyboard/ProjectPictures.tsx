import { useCallback, type ReactNode } from 'react';
import { useProject } from '../../app/projectStore';
import { imageUrl } from '../../core/media/urls';
import { PictureUrls, type PictureUrl } from './FrameImage';

/** Gives the frames inside it their pictures from the open project. */
export function ProjectPictures({ children }: { children: ReactNode }) {
  const file = useProject((s) => s.project?.file ?? null);
  const urlFor = useCallback<PictureUrl>(
    (sha256, size) => (file ? imageUrl(file, sha256, size) : Promise.resolve(null)),
    [file],
  );
  return <PictureUrls.Provider value={urlFor}>{children}</PictureUrls.Provider>;
}

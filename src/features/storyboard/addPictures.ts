import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { showNotice } from '../../app/notice';
import type { PictureFile } from '../../app/pictures';
import { projectStore } from '../../app/projectStore';
import { prepareImage } from '../../core/media/image';
import { placePictures, type FramePicture, type PictureTarget } from './framePictures';
import { selectionStore } from './selection';

// Dropped, pasted or chosen files into the board: each is read and prepared (capped, colour kept, thumbnail made),
// then all of them land in one edit, so one undo takes back the whole drop. A file that can't be read is left out and
// named in a notice; the rest still go in.

/** How many pictures are being prepared now, so the board can say so; a 48 MP HEIC takes a second. */
export const picturesBusy = createStore<{ count: number }>()(() => ({ count: 0 }));

export function usePicturesBusy(): number {
  return useStore(picturesBusy, (s) => s.count);
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function addPictures(files: readonly PictureFile[], target: PictureTarget): Promise<void> {
  const { project } = projectStore.getState();
  if (!project || files.length === 0) return;
  picturesBusy.setState((s) => ({ count: s.count + files.length }));
  const prepared: FramePicture[] = [];
  const problems: { name: string; reason: string }[] = [];
  try {
    for (const file of files) {
      try {
        const blob = await file.read();
        const image = await prepareImage(new File([blob], file.name, { type: blob.type }));
        prepared.push({ image, source: { name: file.name, ...(file.path ? { path: file.path } : {}) } });
      } catch (error) {
        problems.push({ name: file.name, reason: reason(error) });
      }
    }
  } finally {
    picturesBusy.setState((s) => ({ count: s.count - files.length }));
  }

  // Another project may have opened while the pictures were prepared; they belong to the one they were dropped on.
  if (prepared.length > 0 && projectStore.getState().project === project) {
    let placed: ReturnType<typeof placePictures> | null = null;
    // Worked out in the edit queue, after any edit still landing: two drops close together never number frames from
    // the same records.
    await projectStore.getState().applyWith((records) => {
      placed = placePictures(records, project.projectId, target, prepared, project.file.path);
      return placed;
    });
    const result = placed as ReturnType<typeof placePictures> | null;
    // Selected only once written: an edit that failed has said why already, and leaves nothing to select.
    const written = result?.selectShotId ? projectStore.getState().records[result.selectShotId] : undefined;
    if (result?.selectShotId && written) selectionStore.getState().selectShot(result.selectShotId, result.sceneId);
    else if (result && !result.selectShotId) showNotice('The frame or scene those pictures were for isn’t on the board any more.');
  }
  const [first] = problems;
  if (first) {
    showNotice(
      files.length === 1
        ? first.reason
        : `${String(problems.length)} of ${String(files.length)} files weren’t added. ${first.name}: ${first.reason}`,
    );
  }
}

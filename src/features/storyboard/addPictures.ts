import { showNotice } from '../../app/notice';
import type { PictureFile } from '../../app/pictures';
import type { VideoFile } from '../../app/video';
import { isVideoName } from '../../core/media/video';
import { placeFiles, type PreparedFile } from '../video/linkVideos';
import { prepareVideo } from '../video/prepareVideo';
import { picturesBusy } from './picturesBusy';
import { projectStore } from '../../app/projectStore';
import { prepareImage } from '../../core/media/image';
import type { PictureTarget } from './framePictures';
import { selectionStore } from './selection';
import { localizeError, t } from '../../core/i18n';

// Dropped, pasted or chosen files into the board: each is read and prepared (a picture capped, colour kept, thumbnail
// made; a video probed and its first frame grabbed, 2.2b), then all of them land in one edit, in the order they came,
// so one undo takes back the whole drop, pictures and videos alike. A file that can't be read is left out and named
// in one notice; the rest still go in.

export { usePicturesBusy } from './picturesBusy';

/** A file to add: a picture to store, or a video to link. */
export type AddedFile = { kind: 'picture'; file: PictureFile } | { kind: 'video'; file: VideoFile };

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function prepare(added: AddedFile, handle: number | undefined): Promise<PreparedFile> {
  if (added.kind === 'video') return { kind: 'video', video: await prepareVideo(added.file, handle) };
  const { file } = added;
  const blob = await file.read();
  const image = await prepareImage(new File([blob], file.name, { type: blob.type }));
  return { kind: 'picture', picture: { image, source: { name: file.name, ...(file.path ? { path: file.path } : {}) } } };
}

export async function addFiles(files: readonly AddedFile[], target: PictureTarget): Promise<void> {
  const { project } = projectStore.getState();
  if (!project || files.length === 0) return;
  picturesBusy.setState((s) => ({ count: s.count + files.length }));
  const prepared: PreparedFile[] = [];
  const problems: { name: string; reason: string }[] = [];
  try {
    for (const added of files) {
      try {
        prepared.push(await prepare(added, project.file.nativeHandle));
      } catch (error) {
        problems.push({ name: added.file.name, reason: reason(error) });
      }
    }
  } finally {
    picturesBusy.setState((s) => ({ count: s.count - files.length }));
  }

  // Another project may have opened while the files were prepared; they belong to the one they were dropped on.
  if (prepared.length > 0 && projectStore.getState().project === project) {
    let placed: ReturnType<typeof placeFiles> | null = null;
    // Worked out in the edit queue, after any edit still landing: two drops close together never number frames from
    // the same records.
    const saved = await projectStore.getState().applyWith((records, slate) => {
      placed = placeFiles(records, project.projectId, target, prepared, project.file.path, slate);
      return placed;
    });
    // Not written (a full disk, say): the store has said why, and none of the files went in, so the count of files
    // left out below would read as if the rest had. Its notice stays (quality pass).
    // A project switched meanwhile drops the edit without a word; the files left out are still worth saying.
    if (!saved && projectStore.getState().project === project) return;
    const result = placed as ReturnType<typeof placeFiles> | null;
    // Selected only once written: an edit that failed has said why already, and leaves nothing to select.
    const written = result?.selectShotId ? projectStore.getState().records[result.selectShotId] : undefined;
    if (result?.selectShotId && written) selectionStore.getState().selectShot(result.selectShotId, result.sceneId);
    else if (result && !result.selectShotId) showNotice(t('pictures.targetGone'));
  }
  const [first] = problems;
  if (first) {
    showNotice(
      files.length === 1
        ? localizeError(first.reason)
        : t('pictures.someNotAdded', { failed: problems.length, total: files.length, name: first.name, reason: localizeError(first.reason) }),
    );
  }
}

/** Files as a drop, a paste or the Choose picture dialog hands them over: a video by its name goes in as a video. */
export function addPictures(files: readonly PictureFile[], target: PictureTarget): Promise<void> {
  return addFiles(
    files.map((file): AddedFile =>
      isVideoName(file.name)
        ? {
            kind: 'video',
            file: { name: file.name, ...(file.path ? { path: file.path } : {}), ...(file.file ? { file: file.file, size: file.file.size } : {}) },
          }
        : { kind: 'picture', file },
    ),
    target,
  );
}

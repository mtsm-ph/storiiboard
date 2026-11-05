import { showNotice } from '../../app/notice';
import { projectStore } from '../../app/projectStore';
import { videoDriver, type VideoFile } from '../../app/video';
import { localizeError, t } from '../../core/i18n';
import { prepareImage } from '../../core/media/image';
import { picturesBusy } from '../storyboard/picturesBusy';
import type { PictureTarget } from '../storyboard/framePictures';
import { selectionStore } from '../storyboard/selection';
import { linkVideos, type PreparedVideo } from './linkVideos';

// Videos dropped, chosen or pasted into the board (2.2b): each is read with ffprobe and its first frame grabbed from
// the original and prepared like any picture; then all of them land in one edit. A file that can't be read is left
// out and named in a notice; the rest still go in. Only a file the person hands over gets here, so a poster is never
// made from a file the app can read only because it sits in the project's folder.

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A file's size: the browser build knows it; the desktop app asks Rust. Null when it can't be told. */
async function sizeOf(file: VideoFile, handle: number | undefined): Promise<number | null> {
  if (file.size !== undefined) return file.size;
  if (!file.path) return null;
  const [status] = await videoDriver.status([file.path], handle);
  return status?.size ?? null;
}

async function prepare(file: VideoFile, handle: number | undefined): Promise<PreparedVideo> {
  const probe = await videoDriver.probe(file, handle);
  const png = await videoDriver.still(file, 0, { num: probe.fpsNum, den: probe.fpsDen }, handle);
  const still = await prepareImage(new File([png], `${file.name}.png`, { type: 'image/png' }));
  // Its size, to tell it from another clip with its name when relinking.
  const size = await sizeOf(file, handle);
  return {
    probe,
    still,
    source: { name: file.name, ...(file.path ? { path: file.path } : {}), ...(size !== null ? { size } : {}) },
  };
}

export async function addVideos(files: readonly VideoFile[], target: PictureTarget): Promise<void> {
  const { project } = projectStore.getState();
  if (!project || files.length === 0) return;
  const handle = project.file.nativeHandle;
  picturesBusy.setState((s) => ({ count: s.count + files.length }));
  const prepared: PreparedVideo[] = [];
  const problems: { name: string; reason: string }[] = [];
  try {
    for (const file of files) {
      try {
        prepared.push(await prepare(file, handle));
      } catch (error) {
        problems.push({ name: file.name, reason: reason(error) });
      }
    }
  } finally {
    picturesBusy.setState((s) => ({ count: s.count - files.length }));
  }

  // They belong to the project they were dropped on, if another opened meanwhile.
  if (prepared.length > 0 && projectStore.getState().project === project) {
    let linked: ReturnType<typeof linkVideos> | null = null;
    const saved = await projectStore.getState().applyWith((records, slate) => {
      linked = linkVideos(records, project.projectId, target, prepared, project.file.path, slate);
      return linked;
    });
    if (!saved && projectStore.getState().project === project) return;
    const result = linked as ReturnType<typeof linkVideos> | null;
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

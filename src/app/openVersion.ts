import { restoreTo } from '../core/ops/ops';
import { keepCopyAtFree, versionCopyPaths } from '../core/storage/openBackup';
import { freshFileId, type NamedVersion } from '../core/storage/versions';
import { openProjectFile, type OpenFileOptions } from './openFiles';
import { t } from '../core/i18n';

// Open version (1.23, CLAUDE.md: Going back in time): copies the open project, restores the copy to the version's
// step and opens it as a separate project. Everything up to the open happens on the copy's own connection, under a
// draft name, so nothing ever runs on the original: not when the open is cancelled at "open on another computer",
// and not when a step fails. A copy that fails partway is deleted, never left beside the project looking finished
// under the version's name.

/** What Open version made: the copy, and whether it's open (Cancel at "open on another computer" leaves it closed). */
export interface VersionCopy {
  path: string;
  opened: boolean;
}

export async function openVersionCopy(version: NamedVersion, options: OpenFileOptions): Promise<VersionCopy> {
  const project = options.store.getState().project;
  if (!project) throw new Error(t('project.noneOpenSentence'));
  const { draft, path: pathFor } = versionCopyPaths(project.file.path, version.name, crypto.randomUUID().slice(0, 8));
  // Through the open project's own connection, with the same on-disk check as a write (driver.ts).
  await project.file.saveCopy(draft);
  let path: string;
  try {
    const copy = await options.driver.open(draft);
    try {
      // Its own file id, so its backups never mix with the original's (docs/PLAN.md, F).
      await freshFileId(copy);
      // A step of its own in the copy's History, so ⌘Z there takes it back.
      await restoreTo(copy, version.opGroupId);
    } finally {
      await copy.close();
    }
    path = await keepCopyAtFree(draft, options.driver, pathFor);
  } catch (error) {
    await options.driver.dropCopy(draft).catch(() => undefined);
    throw error;
  }
  return { path, opened: await openProjectFile(path, options) };
}

import type { StoreApi } from 'zustand';
import { showNotice } from '../../app/notice';
import type { ProjectState } from '../../app/projectStore';
import { CHANGED_ON_DISK } from '../../core/storage/driver';
import { deleteVersion, nameVersion } from '../../core/storage/versions';

// Naming and deleting a version (1.23) write outside the op log, so the store's own handling of a refused edit never
// sees them. Refused because a sync replaced the file, each is handled like a refused edit: the shell reopens the newer
// version (CLAUDE.md: stop writing and reopen the new version). Anything else says why.

function failed(store: StoreApi<ProjectState>, error: unknown): false {
  if (error instanceof Error && error.message === CHANGED_ON_DISK) store.setState({ changedOnDisk: true });
  else showNotice(error);
  return false;
}

/** Names the step `opGroupId`. Resolves to whether it was written. */
export async function nameThisPoint(store: StoreApi<ProjectState>, name: string, opGroupId: string): Promise<boolean> {
  const project = store.getState().project;
  if (!project) return false;
  try {
    await nameVersion(project.file, { name, opGroupId });
    return true;
  } catch (error) {
    return failed(store, error);
  }
}

/** Deletes a named version (after its confirm). Resolves to whether it was deleted. */
export async function removeNamedVersion(store: StoreApi<ProjectState>, id: string): Promise<boolean> {
  const project = store.getState().project;
  if (!project) return false;
  try {
    await deleteVersion(project.file, id);
    // Pictures only that version kept are History's alone now: Settings → Storage counts them again.
    store.setState((s) => ({ deletedForGood: s.deletedForGood + 1 }));
    return true;
  } catch (error) {
    return failed(store, error);
  }
}

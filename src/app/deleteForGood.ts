import type { StoreApi } from 'zustand';
import { trashedRoots } from '../core/ops/ops';
import { emptyTrashMessage, oldCompanyLogos, rowsGone, trashItems } from '../features/trash/trash';
import { forGood, type ForGood } from './forGood';
import type { ProjectState } from './projectStore';
import { tn } from '../core/i18n';

// The two deletes for good (1.21), as the Trash tile and Settings → Storage run them: what the confirm counts is taken
// from the project as it is at the click, and only that goes, only in that project. Kept out of the tiles so the tests
// drive them with a confirm that lets edits land, or another project open, before it's answered.

/** Asks the person, given the confirm's text; true only for the action itself. */
export type Ask = (text: string) => Promise<boolean>;

/** Empty Trash after a confirm. `hidden` counts the Trash tile's rows its filters hide, which go too. */
export function emptyTrashConfirmed(
  store: StoreApi<ProjectState>,
  running: { current: boolean },
  ask: Ask,
  hidden = 0,
): Promise<ForGood<{ items: number; freed: number } | null>> {
  const { project, records, slateUnknown } = store.getState();
  if (!project) return Promise.resolve({ ran: false, why: 'cancelled' });
  const rows = trashItems(records, project.projectId);
  const confirmed = new Set(trashedRoots(Object.values(records)));
  return forGood(
    running,
    () => ask(emptyTrashMessage(records, rows.length, hidden, slateUnknown, oldCompanyLogos(records, project.projectId))),
    () => store.getState().project === project,
    async () => {
      const done = await store.getState().emptyTrash(confirmed);
      // Rows as the Trash listed them (a frame's sketch and picture go with it, unlisted).
      return done ? { items: rowsGone(store.getState().records, rows), freed: done.freed } : null;
    },
  );
}

/** Clean up old pictures after a confirm: only `counted`, the pictures the tile showed as only History's. */
export function cleanUpConfirmed(
  store: StoreApi<ProjectState>,
  running: { current: boolean },
  counted: ReadonlySet<string>,
  ask: Ask,
): Promise<ForGood<{ removed: number; freed: number } | null>> {
  const { project } = store.getState();
  if (!project || counted.size === 0) return Promise.resolve({ ran: false, why: 'cancelled' });
  const n = counted.size;
  return forGood(
    running,
    () =>
      ask(
        tn('storage.cleanUpConfirm', n),
      ),
    () => store.getState().project === project,
    () => store.getState().cleanUpPictures(counted),
  );
}

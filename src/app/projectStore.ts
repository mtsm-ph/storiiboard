import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { SbdRecord } from '../core/model/record';
import { apply, history, loadRecords, redo, undo, type Change, type Touched } from '../core/ops/ops';
import { CHANGED_ON_DISK } from '../core/storage/driver';
import type { Project } from '../core/storage/project';

// The open project as the UI sees it. Every edit goes through src/core/ops, which writes it to disk before the store
// updates, so the screen never shows a change the file doesn't have.

export interface ProjectState {
  project: Project | null;
  /** Every record by id, trashed ones included; views filter. */
  records: Record<string, SbdRecord>;
  canUndo: boolean;
  canRedo: boolean;
  /** The last edit that failed, in words a person can read. */
  error: string | null;
  /**
   * True once a write was refused because a sync replaced the file (CHANGED_ON_DISK). Nothing was written; the app
   * reopens the newer version and this goes back to false.
   */
  changedOnDisk: boolean;
  open: (project: Project) => Promise<void>;
  close: () => Promise<void>;
  apply: (changes: readonly Change[]) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export function createProjectStore(): StoreApi<ProjectState> {
  // Edits run one at a time, in the order they were made: each reads the records the previous one wrote.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = (work: () => Promise<void>) => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  return createStore<ProjectState>()((set, get) => {
    const merge = async (project: Project, touched: Touched | null) => {
      if (touched === null) return;
      const records = Object.fromEntries(Object.entries(get().records).filter(([id]) => !touched.has(id)));
      for (const [id, record] of touched) if (record) records[id] = record;
      set({ records, ...(await history(project.file)), error: null });
    };

    const edit = (run: (project: Project) => Promise<Touched | null>) =>
      enqueue(async () => {
        const { project } = get();
        if (!project) return;
        try {
          await merge(project, await run(project));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === CHANGED_ON_DISK) set({ changedOnDisk: true });
          else set({ error: message });
        }
      });

    return {
      project: null,
      records: {},
      canUndo: false,
      canRedo: false,
      error: null,
      changedOnDisk: false,
      open: (project) =>
        enqueue(async () => {
          const records = Object.fromEntries((await loadRecords(project.file)).map((r) => [r.id, r]));
          set({ project, records, ...(await history(project.file)), error: null, changedOnDisk: false });
        }),
      close: () =>
        enqueue(async () => {
          await get().project?.close();
          set({ project: null, records: {}, canUndo: false, canRedo: false, error: null, changedOnDisk: false });
        }),
      apply: (changes) => edit((project) => apply(project.file, changes)),
      undo: () => edit((project) => undo(project.file)),
      redo: () => edit((project) => redo(project.file)),
    };
  });
}

/** The app's one project store. Tests make their own with createProjectStore. */
export const projectStore = createProjectStore();

export function useProject<T>(select: (state: ProjectState) => T): T {
  return useStore(projectStore, select);
}

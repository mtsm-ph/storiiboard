import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { SbdRecord } from '../core/model/record';
import { releaseImageUrls } from '../core/media/urls';
import { apply, history, loadRecords, redo, undo, type Change, type OpOptions, type Touched } from '../core/ops/ops';
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
  /** `alsoWrite` saves a picture's bytes in the same transaction as the edit that uses them. */
  apply: (changes: readonly Change[], options?: Pick<OpOptions, 'alsoWrite'>) => Promise<void>;
  /**
   * An edit worked out from the records as they are when its turn comes, after every edit queued before it. For edits
   * that take a while to prepare (pictures), so two of them never number frames from the same records. Resolves to
   * whether it was written; a refusal has set `error` (or `changedOnDisk`) already.
   */
  applyWith: (build: (records: Readonly<Record<string, SbdRecord>>) => { changes: readonly Change[]; alsoWrite?: OpOptions['alsoWrite'] }) => Promise<boolean>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export function createProjectStore(): StoreApi<ProjectState> {
  // Edits run one at a time, in the order they were made: each reads the records the previous one wrote.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
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

    const edit = (run: (project: Project) => Promise<Touched | null>) => {
      // The project the edit was made in. If a switch replaced it before the edit's turn, the edit is dropped: it
      // never lands in the other project.
      const madeIn = get().project;
      return enqueue(async () => {
        const { project } = get();
        if (!project || project !== madeIn) return false;
        try {
          await merge(project, await run(project));
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === CHANGED_ON_DISK) set({ changedOnDisk: true });
          else set({ error: message });
          return false;
        }
      });
    };

    return {
      project: null,
      records: {},
      canUndo: false,
      canRedo: false,
      error: null,
      changedOnDisk: false,
      open: (project) =>
        enqueue(async () => {
          let loaded: Pick<ProjectState, 'records' | 'canUndo' | 'canRedo'>;
          try {
            const records = Object.fromEntries((await loadRecords(project.file)).map((r) => [r.id, r]));
            loaded = { records, ...(await history(project.file)) };
          } catch (error) {
            // It can't be read: it closes again (its lock with it), and the project open now stays as it was.
            await project.close().catch(() => undefined);
            throw error;
          }
          // A project already open (a switch) closes only after the new one is on screen, so there's never a
          // moment with none, and nothing on screen reads a closed file.
          const before = get().project;
          set({ project, ...loaded, error: null, changedOnDisk: false });
          if (before && before !== project) {
            // Closing the old one can only fail to tidy its lock, which another computer then counts stale.
            await before.close().catch(() => undefined);
            await releaseImageUrls(before.file);
          }
        }),
      close: () =>
        enqueue(async () => {
          const { project } = get();
          try {
            if (project) {
              await project.close();
              await releaseImageUrls(project.file);
            }
          } finally {
            // Closed or not, it's no longer the open project.
            set({ project: null, records: {}, canUndo: false, canRedo: false, error: null, changedOnDisk: false });
          }
        }),
      apply: async (changes, options) => {
        await edit((project) => apply(project.file, changes, options));
      },
      applyWith: (build) =>
        edit(async (project) => {
          const { changes, alsoWrite } = build(get().records);
          return changes.length === 0 ? null : apply(project.file, changes, alsoWrite ? { alsoWrite } : {});
        }),
      undo: async () => {
        await edit((project) => undo(project.file));
      },
      redo: async () => {
        await edit((project) => redo(project.file));
      },
    };
  });
}

/** The app's one project store. Tests make their own with createProjectStore. */
export const projectStore = createProjectStore();

export function useProject<T>(select: (state: ProjectState) => T): T {
  return useStore(projectStore, select);
}

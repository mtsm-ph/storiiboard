import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { SbdRecord } from '../core/model/record';
import { NO_SLATE_NUMBERS, type SlateNumbers } from '../core/model/shotNumbers';
import { forgetImageUrls, releaseImageUrls } from '../core/media/urls';
import { apply, cleanUpPictures, emptyTrash, history, loadRecords, redo, restoreTo, undo, type Change, type OpOptions, type Touched } from '../core/ops/ops';
import { CHANGED_ON_DISK } from '../core/storage/driver';
import { compactProject, type Compacted } from '../core/storage/compact';
import type { Project } from '../core/storage/project';
import { slateNumbersAfter, slateNumbersUnknown } from '../core/storage/slateNumbers';

// The open project as the UI sees it. Every edit goes through src/core/ops, which writes it to disk before the store
// updates, so the screen never shows a change the file doesn't have.

export interface ProjectState {
  project: Project | null;
  /** Every record by id, trashed ones included; views filter. */
  records: Record<string, SbdRecord>;
  /** Every slate number (1.26): what locked scenes have given out, read again after each group touching a shot or scene. */
  slateNumbers: SlateNumbers;
  /** Whether some numbers given out before schema 5 are unknown (an Empty Trash had run); the Empty Trash confirm says so. */
  slateUnknown: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** The last edit that failed, in words a person can read. */
  error: string | null;
  /**
   * True once a write was refused because a sync replaced the file (CHANGED_ON_DISK). Nothing was written; the app
   * reopens the newer version and this goes back to false.
   */
  changedOnDisk: boolean;
  /**
   * Counts edits that stored a picture's bytes. A frame that read a picture as missing (deleted for good, 1.21) looks
   * again when it changes, so the same photo added back shows on every frame that names it.
   */
  picturesWritten: number;
  /**
   * Counts Empty Trash and Clean up old pictures runs that deleted something, and named versions made or deleted (1.23). These
   * change no record and no undo state, yet older steps in History now read "(picture removed)" and Settings → Storage's
   * count changes, so both read again on this.
   */
  deletedForGood: number;
  /**
   * True from a Restore to here's click until it lands or fails (1.22). On a long project it rewrites thousands of
   * records, which takes a while: the History tile says so and takes no more clicks meanwhile, even if it was closed
   * and opened again, since it's kept here rather than in the tile.
   */
  restoring: boolean;
  open: (project: Project) => Promise<void>;
  close: () => Promise<void>;
  /** `alsoWrite` saves a picture's bytes in the same transaction as the edit that uses them. */
  apply: (changes: readonly Change[], options?: Pick<OpOptions, 'alsoWrite'>) => Promise<void>;
  /**
   * An edit worked out from the records as they are when its turn comes, after every edit queued before it. For edits
   * that take a while to prepare (pictures), so two of them never number frames from the same records. Resolves to
   * whether it was written; a refusal has set `error` (or `changedOnDisk`) already.
   */
  applyWith: (
    build: (
      records: Readonly<Record<string, SbdRecord>>,
      slateNumbers: SlateNumbers,
    ) => { changes: readonly Change[]; alsoWrite?: OpOptions['alsoWrite'] },
  ) => Promise<boolean>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  /**
   * Empty Trash (1.21): deletes the Trash for good, after the person has confirmed it. Resolves to what went, or null
   * when nothing did (an empty Trash, or a refusal, which has set `error`).
   */
  emptyTrash: (only?: ReadonlySet<string>) => Promise<{ removed: number; freed: number } | null>;
  /**
   * Restores the project to how it was right after a step in History (1.22), or as created with null, as one new op
   * group that undo takes back. Resolves to whether it changed anything.
   */
  restoreTo: (groupId: string | null) => Promise<boolean>;
  /** Clean up old pictures (1.21): deletes the stored pictures only History uses, after a confirm. */
  cleanUpPictures: (only?: ReadonlySet<string>) => Promise<{ removed: number; freed: number } | null>;
  /** Compact project (1.27): a backup, then the file rewritten without its free space. Null when it failed (`error` says why). */
  compact: () => Promise<Compacted | null>;
}

export function createProjectStore(): StoreApi<ProjectState> {
  // Edits run one at a time, in the order they were made: each reads the records the previous one wrote.
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  let restoresInFlight = 0;
  // The last slate number row the store has read, for the open project.
  let slateRead = 0;

  return createStore<ProjectState>()((set, get) => {
    const merge = async (project: Project, touched: Touched | null) => {
      if (touched === null) return;
      const before = get().records;
      // Only a group that touched a shot or a scene can have added slate numbers (1.26).
      const numbered = [...touched].some(([id, record]) => {
        const type = (record ?? before[id])?.type;
        return type === 'shot' || type === 'scene';
      });
      const records = Object.fromEntries(Object.entries(before).filter(([id]) => !touched.has(id)));
      for (const [id, record] of touched) if (record) records[id] = record;
      const stacks = await history(project.file);
      // Read last, and kept in the same step as it's stored, so a read that fails never skips rows next time.
      const slateNumbers = numbered ? await newSlateNumbers(project) : null;
      set({ records, ...(slateNumbers ? { slateNumbers } : {}), ...stacks, error: null });
    };

    const newSlateNumbers = async (project: Project) => {
      const { rows, last } = await slateNumbersAfter(project.file, slateRead);
      slateRead = last;
      return rows.length > 0 ? [...get().slateNumbers, ...rows] : get().slateNumbers;
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
      slateNumbers: NO_SLATE_NUMBERS,
      slateUnknown: false,
      canUndo: false,
      canRedo: false,
      error: null,
      changedOnDisk: false,
      picturesWritten: 0,
      deletedForGood: 0,
      restoring: false,
      open: (project) =>
        enqueue(async () => {
          let loaded: Pick<ProjectState, 'records' | 'slateNumbers' | 'slateUnknown' | 'canUndo' | 'canRedo'>;
          let read = 0;
          try {
            const records = Object.fromEntries((await loadRecords(project.file)).map((r) => [r.id, r]));
            const slate = await slateNumbersAfter(project.file, 0);
            read = slate.last;
            loaded = {
              records,
              slateNumbers: slate.rows,
              slateUnknown: await slateNumbersUnknown(project.file),
              ...(await history(project.file)),
            };
          } catch (error) {
            // It can't be read: it closes again (its lock with it), and the project open now stays as it was.
            await project.close().catch(() => undefined);
            throw error;
          }
          // A project already open (a switch) closes only after the new one is on screen, so there's never a
          // moment with none, and nothing on screen reads a closed file.
          const before = get().project;
          slateRead = read;
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
            slateRead = 0;
            set({
              project: null,
              records: {},
              slateNumbers: NO_SLATE_NUMBERS,
              slateUnknown: false,
              canUndo: false,
              canRedo: false,
              error: null,
              changedOnDisk: false,
            });
          }
        }),
      apply: async (changes, options) => {
        await edit(async (project) => {
          const touched = await apply(project.file, changes, options);
          if (options?.alsoWrite?.length) set((s) => ({ picturesWritten: s.picturesWritten + 1 }));
          return touched;
        });
      },
      applyWith: (build) =>
        edit(async (project) => {
          const { changes, alsoWrite } = build(get().records, get().slateNumbers);
          if (changes.length === 0) return null;
          const touched = await apply(project.file, changes, alsoWrite ? { alsoWrite } : {});
          if (alsoWrite?.length) set((s) => ({ picturesWritten: s.picturesWritten + 1 }));
          return touched;
        }),
      undo: async () => {
        await edit((project) => undo(project.file));
      },
      emptyTrash: async (only) => {
        let result: { removed: number; freed: number } | null = null;
        await edit(async (project) => {
          const done = await emptyTrash(project.file, only ? { only } : {});
          if (!done) return null;
          result = { removed: done.removed, freed: done.freed };
          await forgetImageUrls(project.file, done.pictures);
          set((s) => ({ deletedForGood: s.deletedForGood + 1 }));
          return done.touched;
        });
        return result;
      },
      restoreTo: async (groupId) => {
        let changed = false;
        // Counted, so a second restore queued behind the first doesn't clear it while that one still runs.
        restoresInFlight += 1;
        set({ restoring: true });
        try {
          await edit(async (project) => {
            const touched = await restoreTo(project.file, groupId);
            changed = touched !== null;
            return touched;
          });
        } finally {
          restoresInFlight -= 1;
          if (restoresInFlight === 0) set({ restoring: false });
        }
        return changed;
      },
      cleanUpPictures: async (only) => {
        let result: { removed: number; freed: number } | null = null;
        // In the queue like an edit, so no edit lands between reading what's unused and deleting it.
        await edit(async (project) => {
          const done = await cleanUpPictures(project.file, only);
          result = { removed: done.removed, freed: done.freed };
          await forgetImageUrls(project.file, done.pictures);
          if (done.removed > 0) set((s) => ({ deletedForGood: s.deletedForGood + 1 }));
          return null;
        });
        return result;
      },
      redo: async () => {
        await edit((project) => redo(project.file));
      },
      compact: async () => {
        let result: Compacted | null = null;
        // In the queue like an edit: nothing is written while the file is rewritten.
        await edit(async (project) => {
          result = await compactProject(project.file);
          // Compacting may renumber the table's rows, so the slate numbers are read again from the start.
          const slate = await slateNumbersAfter(project.file, 0);
          slateRead = slate.last;
          set({ slateNumbers: slate.rows });
          return null;
        });
        return result;
      },
    };
  });
}

/** The app's one project store. Tests make their own with createProjectStore. */
export const projectStore = createProjectStore();

export function useProject<T>(select: (state: ProjectState) => T): T {
  return useStore(projectStore, select);
}

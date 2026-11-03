import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { TILES, WORKSPACES, type WorkspaceId } from '../workspaces';
import { isLayout, sameLayout, tilesIn, type Layout } from './layout';

// Each workspace's layout belongs to the person, not the project (decided Nov 2): it lives in the app's settings,
// never in a .sbd. A workspace keeps its current layout and the one last saved; the tab shows a dot when they differ.
// ⌘Z belongs to the project alone; layout changes undo from the Layout menu, for this session only. The saved layouts
// survive restarts.

export const LAYOUTS_KEY = 'storiiboard.layouts';

interface WorkspaceLayouts {
  current: Layout;
  saved: Layout;
}

interface LayoutChange {
  workspace: WorkspaceId;
  before: Layout;
  after: Layout;
}

export interface LayoutState {
  layouts: Record<WorkspaceId, WorkspaceLayouts>;
  past: LayoutChange[];
  /** Replaces a workspace's layout as one undoable step. */
  change: (workspace: WorkspaceId, next: Layout) => void;
  /** Takes back the workspace's last change this session. False when there is none. */
  undo: (workspace: WorkspaceId) => boolean;
  /** Makes the current layout the saved one, clearing the dot. */
  save: (workspace: WorkspaceId) => void;
  resetToSaved: (workspace: WorkspaceId) => void;
  resetToDefault: (workspace: WorkspaceId) => void;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** A saved layout is used only if it's well formed and holds no tile this app doesn't know. */
function usable(value: unknown): value is Layout {
  return isLayout(value) && tilesIn(value).every((tile) => tile in TILES);
}

function load(storage: Storage | undefined): Record<WorkspaceId, WorkspaceLayouts> {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(LAYOUTS_KEY) ?? '{}');
    if (typeof parsed === 'object' && parsed !== null) saved = parsed as Record<string, unknown>;
  } catch {
    // A corrupt entry only costs the custom layouts, never the session.
  }
  const entries = WORKSPACES.map((workspace) => {
    const entry = saved[workspace.id] as Partial<Record<'current' | 'saved', unknown>> | undefined;
    const fallback = workspace.defaultLayout();
    const savedLayout = usable(entry?.saved) ? entry.saved : fallback;
    const current = usable(entry?.current) ? entry.current : savedLayout;
    return [workspace.id, { current, saved: savedLayout }] as const;
  });
  return Object.fromEntries(entries) as Record<WorkspaceId, WorkspaceLayouts>;
}

export function createLayoutStore(storage: Storage | undefined = browserStorage()): StoreApi<LayoutState> {
  return createStore<LayoutState>()((set, get) => {
    const persist = () => {
      try {
        storage?.setItem(LAYOUTS_KEY, JSON.stringify(get().layouts));
      } catch {
        // A full or blocked store loses the layout, not the session.
      }
    };
    const setCurrent = (workspace: WorkspaceId, current: Layout) => {
      const layouts = get().layouts;
      set({ layouts: { ...layouts, [workspace]: { ...layouts[workspace], current } } });
      persist();
    };

    return {
      layouts: load(storage),
      past: [],
      change: (workspace, next) => {
        const before = get().layouts[workspace].current;
        if (before === next) return;
        set({ past: [...get().past, { workspace, before, after: next }] });
        setCurrent(workspace, next);
      },
      undo: (workspace) => {
        // Per workspace: the menu undoes what's on screen, never a change hidden in another workspace.
        const past = get().past;
        const index = past.findLastIndex((c) => c.workspace === workspace);
        const last = past[index];
        if (!last) return false;
        set({ past: past.filter((_, i) => i !== index) });
        setCurrent(workspace, last.before);
        return true;
      },
      save: (workspace) => {
        const layouts = get().layouts;
        set({ layouts: { ...layouts, [workspace]: { ...layouts[workspace], saved: layouts[workspace].current } } });
        persist();
      },
      resetToSaved: (workspace) => {
        get().change(workspace, get().layouts[workspace].saved);
      },
      resetToDefault: (workspace) => {
        const fresh = WORKSPACES.find((w) => w.id === workspace)?.defaultLayout();
        if (fresh) get().change(workspace, fresh);
      },
    };
  });
}

export const layoutStore = createLayoutStore();

export function useLayouts<T>(select: (state: LayoutState) => T): T {
  return useStore(layoutStore, select);
}

/** True when the workspace's layout has changes that haven't been saved: the tab's dot. */
/** True when the workspace has a layout change this session that "Undo layout change" can take back. */
export function canUndoLayout(past: LayoutState['past'], workspace: WorkspaceId): boolean {
  return past.some((c) => c.workspace === workspace);
}

export function isUnsaved(layouts: WorkspaceLayouts): boolean {
  return !sameLayout(layouts.current, layouts.saved);
}

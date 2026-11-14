import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { ALL_WORKSPACES, isCustomWorkspaceId, TILES, workspaceById, type WorkspaceId } from '../workspaces';
import { loadSettings, saveSettings } from '../../../core/storage/settings';
import { dropTile, isLayout, openTile, removeTile, sameLayout, stackOf, tilesIn, type DropZone, type Layout, type TileId } from './layout';

// Each workspace's layout belongs to the person, not the project (decided Nov 2): it lives in the app's settings,
// never in a .sbd. A workspace keeps its current layout and the one last saved; the tab shows a dot when they differ.
// ⌘Z belongs to the project alone; layout changes undo from the Layout menu, for this session only. The saved layouts
// survive restarts.

// Versioned by the set of workspaces: D3's seven replaced D2's four, so layouts saved under the old key start over.
// PB's six (Settings became a window) keep the key: the five left read as they were saved. The department workspaces
// (3.6a) keep it too: one saved before they existed starts them on their defaults. So do the person's own (3.6d),
// whose entries come and go with them.
export const LAYOUTS_KEY = 'storiiboard.layouts.2';

export interface WorkspaceLayouts {
  current: Layout;
  saved: Layout;
}

interface LayoutChange {
  workspace: WorkspaceId;
  before: Layout;
  after: Layout;
}

export interface LayoutState {
  /** By workspace; one with no entry (a custom workspace just deleted, a moment before the shell moves on) reads as its default. */
  layouts: Partial<Record<WorkspaceId, WorkspaceLayouts>>;
  past: LayoutChange[];
  /** Replaces a workspace's layout as one undoable step. */
  change: (workspace: WorkspaceId, next: Layout) => void;
  /** Takes back the workspace's last change this session. False when there is none. */
  undo: (workspace: WorkspaceId) => boolean;
  /** Makes the current layout the saved one, clearing the dot. */
  save: (workspace: WorkspaceId) => void;
  resetToSaved: (workspace: WorkspaceId) => void;
  resetToDefault: (workspace: WorkspaceId) => void;
  /** A new workspace of the person's own (3.6d), current and saved both `layout`. */
  add: (workspace: WorkspaceId, layout: Layout) => void;
  /** A deleted one's layouts and its layout undo steps go with it. */
  remove: (workspace: WorkspaceId) => void;
}

/** The default each workspace falls back on when it has no entry: one object per workspace, so a selector stays still. */
const fallbacks = new Map<WorkspaceId, WorkspaceLayouts>();

/** A workspace's layouts, or its default's when it has none. */
export function layoutsOf(layouts: LayoutState['layouts'], workspace: WorkspaceId): WorkspaceLayouts {
  const entry = layouts[workspace];
  if (entry) return entry;
  let fallback = fallbacks.get(workspace);
  if (!fallback) {
    const layout = workspaceById(workspace).defaultLayout();
    fallback = { current: layout, saved: layout };
    fallbacks.set(workspace, fallback);
  }
  return fallback;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * A saved layout as this version can use it: well formed, with any tile it no longer has taken out (polish B moved the
 * Settings tiles into the Settings window), the rest keeping their places. Null when nothing it knows is left.
 */
export function usable(value: unknown): Layout | null {
  if (!isLayout(value)) return null;
  const gone = tilesIn(value).filter((tile) => !Object.hasOwn(TILES, tile));
  if (gone.length === tilesIn(value).length) return null;
  // removeTile keeps a workspace's last tile, which can't be one of these: at least one known tile is left.
  return gone.reduce((layout, tile) => removeTile(layout, tile), value);
}

/**
 * Tiles added to a built-in workspace's default layout after people could save that layout. A saved layout keeps what
 * the person made of the old default, so each is put into it once (where the default has it: on `zone` of the stack
 * holding `near`, else as opening it would), and Settings remembers it was offered, so closing it then is for good.
 * One line per tile, never removed: a line taken out would offer the tile again to nobody, but one left costs nothing.
 */
export const TILES_ADDED: readonly { tile: TileId; workspace: WorkspaceId; near: TileId; zone: DropZone }[] = [
  // 6.0: the Setup section went live with its Setups tile, above Layers in the left column.
  { tile: 'setups', workspace: 'setup', near: 'layers', zone: 'top' },
];

const offeredKey = (added: (typeof TILES_ADDED)[number]) => `${added.workspace}:${added.tile}`;

function withAdded(layout: Layout, added: (typeof TILES_ADDED)[number]): Layout {
  if (tilesIn(layout).includes(added.tile)) return layout;
  const near = stackOf(layout, added.near);
  return near ? dropTile(layout, added.tile, near.id, added.zone) : openTile(layout, added.tile);
}

function load(storage: Storage | undefined, settings: Storage | undefined): Partial<Record<WorkspaceId, WorkspaceLayouts>> {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(LAYOUTS_KEY) ?? '{}');
    if (typeof parsed === 'object' && parsed !== null) saved = parsed as Record<string, unknown>;
  } catch {
    // A corrupt entry only costs the custom layouts, never the session.
  }
  const offered = loadSettings(settings).tilesOffered;
  const due = TILES_ADDED.filter((added) => !offered.includes(offeredKey(added)));
  const entries = ALL_WORKSPACES.map((workspace) => {
    const entry = saved[workspace.id] as Partial<Record<'current' | 'saved', unknown>> | undefined;
    const fromSaved = usable(entry?.saved);
    const fromCurrent = usable(entry?.current);
    let savedLayout = fromSaved ?? workspace.defaultLayout();
    let current = fromCurrent ?? savedLayout;
    // A default has its new tiles already; only a layout the person saved can be missing one.
    for (const added of due.filter((a) => a.workspace === workspace.id)) {
      if (fromSaved) savedLayout = withAdded(savedLayout, added);
      current = fromCurrent ? withAdded(current, added) : savedLayout;
    }
    return [workspace.id, { current, saved: savedLayout }] as const;
  });
  // The person's own workspaces: their layouts as saved, else the layout each was made from.
  const own = loadSettings().customWorkspaces.flatMap((custom) => {
    const made = usable(custom.layout);
    if (!isCustomWorkspaceId(custom.id) || !made) return [];
    const entry = saved[custom.id] as Partial<Record<'current' | 'saved', unknown>> | undefined;
    const savedLayout = usable(entry?.saved) ?? made;
    return [[custom.id, { current: usable(entry?.current) ?? savedLayout, saved: savedLayout }] as const];
  });
  const layouts: Partial<Record<WorkspaceId, WorkspaceLayouts>> = Object.fromEntries([...entries, ...own]);
  if (due.length > 0) {
    // Written before they're marked offered: a store that fails in between offers them again, never loses them.
    // Only a workspace with layouts of the person's own has anything to write.
    if (due.some((added) => saved[added.workspace] !== undefined)) {
      try {
        storage?.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
      } catch {
        // A full or blocked store loses the layout, not the session.
      }
    }
    // Marked even where the default was used: it has the tile, and one closed from it stays closed.
    saveSettings({ tilesOffered: [...offered, ...due.map(offeredKey)] }, settings);
  }
  return layouts;
}

/** `settings` holds which added tiles were offered (`TILES_ADDED`); the app's own settings unless a test says. */
export function createLayoutStore(
  storage: Storage | undefined = browserStorage(),
  settings: Storage | undefined = storage,
): StoreApi<LayoutState> {
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
      set({ layouts: { ...layouts, [workspace]: { ...layoutsOf(layouts, workspace), current } } });
      persist();
    };

    return {
      layouts: load(storage, settings),
      past: [],
      change: (workspace, next) => {
        const before = layoutsOf(get().layouts, workspace).current;
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
        const entry = layoutsOf(layouts, workspace);
        set({ layouts: { ...layouts, [workspace]: { ...entry, saved: entry.current } } });
        persist();
      },
      resetToSaved: (workspace) => {
        get().change(workspace, layoutsOf(get().layouts, workspace).saved);
      },
      resetToDefault: (workspace) => {
        get().change(workspace, workspaceById(workspace).defaultLayout());
      },
      add: (workspace, layout) => {
        set({ layouts: { ...get().layouts, [workspace]: { current: layout, saved: layout } } });
        persist();
      },
      remove: (workspace) => {
        const layouts = Object.fromEntries(Object.entries(get().layouts).filter(([id]) => id !== workspace));
        set({ layouts, past: get().past.filter((c) => c.workspace !== workspace) });
        fallbacks.delete(workspace);
        persist();
      },
    };
  });
}

export const layoutStore = createLayoutStore();

export function useLayouts<T>(select: (state: LayoutState) => T): T {
  return useStore(layoutStore, select);
}

/** True when the workspace has a layout change this session that "Undo layout change" can take back. */
export function canUndoLayout(past: LayoutState['past'], workspace: WorkspaceId): boolean {
  return past.some((c) => c.workspace === workspace);
}

/** True when the workspace's layout has changes that haven't been saved: the section's dot. */
export function isUnsaved(layouts: WorkspaceLayouts): boolean {
  return !sameLayout(layouts.current, layouts.saved);
}

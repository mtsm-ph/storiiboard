import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { TILES, WORKSPACES, type WorkspaceId } from '../workspaces';
import { isLayout, openTile, sameLayout, stackOf, tilesIn, type Layout, type LayoutNode, type TileId } from './layout';

// Each workspace's layout belongs to the person, not the project (decided Nov 2): it lives in the app's settings,
// never in a .sbd. A workspace keeps its current layout and the one last saved; the tab shows a dot when they differ.
// ⌘Z belongs to the project alone; layout changes undo from the Layout menu, for this session only. The saved layouts
// survive restarts.

// Versioned by the set of workspaces: D3's seven replaced D2's four, so layouts saved under the old key start over.
export const LAYOUTS_KEY = 'storiiboard.layouts.2';

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

/**
 * Tiles added to a workspace's default layout after people had saved their own. Each is put in once, as a tab beside
 * a tile they already have, so it shows without resetting their layout; closed after that, it stays closed.
 */
export const NEW_TILES: readonly { workspace: WorkspaceId; tile: TileId; beside: TileId }[] = [
  // Settings → App (polish 1): the app's language.
  { workspace: 'settings', tile: 'app', beside: 'project' },
];

/** Which of NEW_TILES this person's layouts have been given already, as `workspace:tile`. */
export const INTRODUCED_KEY = 'storiiboard.layouts.introduced';

function introduce(layout: Layout, tile: TileId, beside: TileId): Layout {
  if (tilesIn(layout).includes(tile)) return layout;
  const holder = stackOf(layout, beside);
  // Added as a tab without opening it, so the layout looks as it did until the tab is picked.
  return holder ? { ...layout, root: addTab(layout.root, holder.id, tile) } : openTile(layout, tile);
}

function addTab(node: LayoutNode, stackId: string, tile: TileId): LayoutNode {
  if (node.kind === 'stack') return node.id === stackId ? { ...node, tiles: [...node.tiles, tile] } : node;
  return { ...node, children: node.children.map((child) => addTab(child, stackId, tile)) };
}

function load(storage: Storage | undefined): Record<WorkspaceId, WorkspaceLayouts> {
  let saved: Record<string, unknown> = {};
  let introduced: string[] = [];
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(LAYOUTS_KEY) ?? '{}');
    if (typeof parsed === 'object' && parsed !== null) saved = parsed as Record<string, unknown>;
    const marks: unknown = JSON.parse(storage?.getItem(INTRODUCED_KEY) ?? '[]');
    if (Array.isArray(marks)) introduced = marks.filter((m): m is string => typeof m === 'string');
  } catch {
    // A corrupt entry only costs the custom layouts, never the session.
  }
  const grew: WorkspaceId[] = [];
  const entries = WORKSPACES.map((workspace) => {
    const entry = saved[workspace.id] as Partial<Record<'current' | 'saved', unknown>> | undefined;
    const fallback = workspace.defaultLayout();
    let savedLayout = usable(entry?.saved) ? entry.saved : fallback;
    let current = usable(entry?.current) ? entry.current : savedLayout;
    for (const tile of NEW_TILES.filter((n) => n.workspace === workspace.id && !introduced.includes(`${n.workspace}:${n.tile}`))) {
      const nextSaved = introduce(savedLayout, tile.tile, tile.beside);
      const nextCurrent = introduce(current, tile.tile, tile.beside);
      if (nextSaved !== savedLayout || nextCurrent !== current) grew.push(workspace.id);
      savedLayout = nextSaved;
      current = nextCurrent;
    }
    return [workspace.id, { current, saved: savedLayout }] as const;
  });
  const layouts = Object.fromEntries(entries) as Record<WorkspaceId, WorkspaceLayouts>;
  try {
    // The layouts with their new tiles first, then the note that they were given: a write that fails costs a second
    // offer next time, never the tile itself.
    if (grew.length > 0) storage?.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
    storage?.setItem(INTRODUCED_KEY, JSON.stringify([...new Set([...introduced, ...NEW_TILES.map((n) => `${n.workspace}:${n.tile}`)])]));
  } catch {
    // Not remembered: the tile is offered again next time, which is harmless.
  }
  return layouts;
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

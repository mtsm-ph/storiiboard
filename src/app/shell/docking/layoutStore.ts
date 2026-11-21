import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { ALL_WORKSPACES, isCustomWorkspaceId, TILES, workspaceById, type WorkspaceId } from '../workspaces';
import { loadSettings, saveSettings } from '../../../core/storage/settings';
import {
  dropTile,
  findStack,
  isLayout,
  openTile,
  removeTile,
  sameLayout,
  split,
  stack,
  stackOf,
  tilesIn,
  type DropZone,
  type Layout,
  type LayoutNode,
  type TileId,
} from './layout';

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
  /** A workspace's layouts set whole, current and saved (saved = current when not given), its layout undo steps cleared: a settings preset applied (6.5.8). */
  put: (workspace: WorkspaceId, layout: Layout, saved?: Layout) => void;
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
export const TILES_ADDED: readonly {
  tile: TileId;
  workspace: WorkspaceId;
  near: TileId;
  zone: DropZone;
  /** Its share of the split it lands in, as the new default gives it; the rest keep their proportions. */
  share: number;
  /** The workspace's default before the tile: a saved layout still exactly that takes the new default instead. */
  previousDefault: () => Layout;
}[] = [
  // 6.0: the Setup section went live with its Setups tile, above Layers in the left column, about half of it.
  {
    tile: 'setups',
    workspace: 'setup',
    near: 'layers',
    zone: 'top',
    share: 0.5,
    previousDefault: () => ({
      root: split(
        'row',
        [
          split('column', [stack(['layers']), stack(['library'])], [120, 688]),
          split('column', [stack(['plan']), stack(['frames'])], [658, 150]),
          stack(['selection']),
        ],
        [248, 824, 336],
      ),
      maximized: null,
    }),
  },
  // 7.4: the Checks tile, under the call sheet in the middle column, about a quarter of it.
  {
    tile: 'checks',
    workspace: 'production',
    near: 'sheet',
    zone: 'bottom',
    share: 220 / 808,
    previousDefault: () => ({
      root: split(
        'row',
        [
          split('column', [stack(['days']), stack(['calendar'])], [404, 404]),
          stack(['sheet']),
          split('column', [stack(['locations']), stack(['gear']), stack(['people'])], [270, 269, 269]),
        ],
        [400, 680, 336],
      ),
      maximized: null,
    }),
  },
];

/**
 * A built-in workspace's earlier defaults (6.9 review, L12). The store writes every workspace's layouts whenever any
 * one is changed or saved, so a person who never touched this workspace has its default of that day stored as theirs.
 * A stored layout still exactly one of these is read as never changed: it takes the default of today. One line per
 * default replaced, never removed (TILES_ADDED's `previousDefault` did this for one case in 6.0).
 */
export const PREVIOUS_DEFAULTS: Readonly<Partial<Record<WorkspaceId, readonly (() => Layout)[]>>> = {
  setup: [
    // 6.0 to 6.8: Setups, Layers and the Library in the left column; the Selection tile alone at the right.
    () => setupLeftColumn([400, 120, 288]),
    // 6.8's review rounds, before the Library moved under the Selection tile in 6.9.
    () => setupLeftColumn([272, 288, 248]),
    () => setupLeftColumn([304, 256, 248]),
  ],
};

/** The Setup workspace's default as it was from 6.0 to 6.8, its left column's three heights as given. */
function setupLeftColumn(heights: number[]): Layout {
  return {
    root: split(
      'row',
      [split('column', [stack(['setups']), stack(['layers']), stack(['library'])], heights), split('column', [stack(['plan']), stack(['frames'])], [658, 150]), stack(['selection'])],
      [248, 824, 336],
    ),
    maximized: null,
  };
}

/** The workspace's default of today when `layout` is exactly one of its earlier ones (a default never changed), else `layout`. */
export function withoutOldDefault(workspace: WorkspaceId, layout: Layout): Layout {
  const old = PREVIOUS_DEFAULTS[workspace] ?? [];
  return old.some((made) => sameLayout(layout, made())) ? workspaceById(workspace).defaultLayout() : layout;
}

const offeredKey = (added: (typeof TILES_ADDED)[number]) => `${added.workspace}:${added.tile}`;

/**
 * Gives the tile's lone stack `share` of its parent split. The stack it was split from (`nearId`) first takes back
 * the half it gave, so every sibling keeps the ratio to the others it had before the tile came.
 */
function giveShare(node: LayoutNode, tile: TileId, share: number, nearId: string): LayoutNode {
  if (node.kind === 'stack') return node;
  const index = node.children.findIndex((child) => child.kind === 'stack' && child.tiles.length === 1 && child.tiles[0] === tile);
  if (index < 0) return { ...node, children: node.children.map((child) => giveShare(child, tile, share, nearId)) };
  const before = [...node.sizes];
  const near = node.children.findIndex((child) => child.id === nearId);
  if (near >= 0) before[near] = (before[near] ?? 0) + (before[index] ?? 0);
  const others = before.reduce((sum, size, i) => (i === index ? sum : sum + size), 0);
  if (others <= 0) return node;
  const sizes = before.map((size, i) => (i === index ? share : (size / others) * (1 - share)));
  return { ...node, sizes };
}

function withAdded(saved: Layout, added: (typeof TILES_ADDED)[number]): Layout {
  if (tilesIn(saved).includes(added.tile)) return saved;
  // Never changed from the old default: the new one is what the person would have had.
  if (sameLayout(saved, added.previousDefault())) return workspaceById(added.workspace).defaultLayout();
  const near = stackOf(saved, added.near);
  let next = near ? dropTile(saved, added.tile, near.id, added.zone) : openTile(saved, added.tile);
  // Split from its neighbour, it would get half that one tile's room; it gets its share of the column instead.
  if (near && added.zone !== 'center') next = { ...next, root: giveShare(next.root, added.tile, added.share, near.id) };
  // Dropping a tile clears a maximized stack; one the person left maximized stays so when it still exists.
  if (saved.maximized && findStack(next, saved.maximized)) next = { ...next, maximized: saved.maximized };
  return next;
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
    // An earlier default kept only because another workspace was written is the default of today (PREVIOUS_DEFAULTS).
    const keptSaved = usable(entry?.saved);
    const keptCurrent = usable(entry?.current);
    const fromSaved = keptSaved && withoutOldDefault(workspace.id, keptSaved);
    const fromCurrent = keptCurrent && withoutOldDefault(workspace.id, keptCurrent);
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
    const needsWrite = (added: (typeof TILES_ADDED)[number]) => saved[added.workspace] !== undefined;
    let written = true;
    if (due.some(needsWrite)) {
      try {
        storage?.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
      } catch {
        // A full or blocked store loses the layout, not the session; the tile is offered again next time.
        written = false;
      }
    }
    // Marked even where the default was used: it has the tile, and one closed from it stays closed.
    const marked = due.filter((added) => written || !needsWrite(added));
    if (marked.length > 0) saveSettings({ tilesOffered: [...offered, ...marked.map(offeredKey)] }, settings);
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
      put: (workspace, layout, saved = layout) => {
        set({ layouts: { ...get().layouts, [workspace]: { current: layout, saved } }, past: get().past.filter((c) => c.workspace !== workspace) });
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

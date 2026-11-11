import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Geometry, Side, Tool, Viewport } from '../../ui/canvas/types';
import { DEFAULT_VIEWPORT } from '../../ui/canvas/viewport';
import type { ClipConnector } from './connectors';
import type { ClipItem, ItemSeed } from './items';

// Where the person is in the Moodboard: the board open, what's selected on each, each board's view and the tool. View
// state, never an op and never in the project (decision 11): it lasts the session. The clipboard is inside the app
// and shared by every board and project open in this window; nothing goes to the system's clipboard in 5.0.

/**
 * A text box or sticky note being typed into (5.1a). A new one is only a draft until editing ends: nothing is in the
 * project before then, so a text box left empty leaves no step behind. `draft` is null for an item that exists.
 */
export interface Editing {
  boardId: string;
  id: string;
  draft: ItemSeed | null;
  /** A new text box made with a connector from this item's side (5.2 quick-create): both are written when typing ends, or neither. */
  join?: { item: string; side: Side };
}

/** The Link tool has placed a card and is asking for its address (5.1b); nothing is in the project until it is given. */
export interface LinkAsk {
  boardId: string;
  geometry: Geometry;
}

interface MoodboardState {
  /** Null shows the picker. */
  openBoardId: string | null;
  selections: Readonly<Record<string, readonly string[]>>;
  viewports: Readonly<Record<string, Viewport>>;
  tool: Tool;
  clipboard: readonly ClipItem[];
  /** The connectors copied with them (5.2), their ends naming the copied items by place in `clipboard`. */
  clipConnectors: readonly ClipConnector[];
  /** The project the clipboard's items were copied from: its id and path. */
  clipSource: { projectId: string; path: string } | null;
  editing: Editing | null;
  linkAsk: LinkAsk | null;
  /** What the last layout command did, in words, for the board's live region (5.3). */
  announcement: string;
  openBoard: (boardId: string | null) => void;
  select: (boardId: string, ids: readonly string[]) => void;
  setViewport: (boardId: string, view: Viewport) => void;
  setTool: (tool: Tool) => void;
  copy: (items: readonly ClipItem[], source?: { projectId: string; path: string } | null, connectors?: readonly ClipConnector[]) => void;
  startEditing: (editing: Editing) => void;
  stopEditing: () => void;
  askLink: (ask: LinkAsk | null) => void;
  announce: (text: string) => void;
}

export const moodboardStore = createStore<MoodboardState>()((set) => ({
  openBoardId: null,
  selections: {},
  viewports: {},
  tool: 'select',
  clipboard: [],
  clipConnectors: [],
  clipSource: null,
  editing: null,
  linkAsk: null,
  announcement: '',
  openBoard: (openBoardId) => {
    set({ openBoardId, tool: 'select', editing: null, linkAsk: null, announcement: '' });
  },
  select: (boardId, ids) => {
    set((s) => ({ selections: { ...s.selections, [boardId]: ids }, announcement: '' }));
  },
  setViewport: (boardId, view) => {
    set((s) => ({ viewports: { ...s.viewports, [boardId]: view } }));
  },
  setTool: (tool) => {
    set({ tool });
  },
  copy: (clipboard, source = null, clipConnectors = []) => {
    set({ clipboard, clipSource: source, clipConnectors });
  },
  startEditing: (editing) => {
    set({ editing, tool: 'select' });
  },
  stopEditing: () => {
    set({ editing: null });
  },
  askLink: (linkAsk) => {
    set({ linkAsk, tool: 'select' });
  },
  // Cleared first and set on the next tick, so the same words said twice are read out twice.
  announce: (announcement) => {
    set({ announcement: '' });
    setTimeout(() => {
      set({ announcement });
    }, 0);
  },
}));

export function useMoodboard<T>(select: (state: MoodboardState) => T): T {
  return useStore(moodboardStore, select);
}

export const viewportOf = (viewports: Readonly<Record<string, Viewport>>, boardId: string): Viewport => viewports[boardId] ?? DEFAULT_VIEWPORT;

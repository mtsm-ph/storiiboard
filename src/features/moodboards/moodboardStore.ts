import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Tool, Viewport } from '../../ui/canvas/types';
import { DEFAULT_VIEWPORT } from '../../ui/canvas/viewport';
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
}

interface MoodboardState {
  /** Null shows the picker. */
  openBoardId: string | null;
  selections: Readonly<Record<string, readonly string[]>>;
  viewports: Readonly<Record<string, Viewport>>;
  tool: Tool;
  clipboard: readonly ClipItem[];
  editing: Editing | null;
  openBoard: (boardId: string | null) => void;
  select: (boardId: string, ids: readonly string[]) => void;
  setViewport: (boardId: string, view: Viewport) => void;
  setTool: (tool: Tool) => void;
  copy: (items: readonly ClipItem[]) => void;
  startEditing: (editing: Editing) => void;
  stopEditing: () => void;
}

export const moodboardStore = createStore<MoodboardState>()((set) => ({
  openBoardId: null,
  selections: {},
  viewports: {},
  tool: 'select',
  clipboard: [],
  editing: null,
  openBoard: (openBoardId) => {
    set({ openBoardId, tool: 'select', editing: null });
  },
  select: (boardId, ids) => {
    set((s) => ({ selections: { ...s.selections, [boardId]: ids } }));
  },
  setViewport: (boardId, view) => {
    set((s) => ({ viewports: { ...s.viewports, [boardId]: view } }));
  },
  setTool: (tool) => {
    set({ tool });
  },
  copy: (clipboard) => {
    set({ clipboard });
  },
  startEditing: (editing) => {
    set({ editing, tool: 'select' });
  },
  stopEditing: () => {
    set({ editing: null });
  },
}));

export function useMoodboard<T>(select: (state: MoodboardState) => T): T {
  return useStore(moodboardStore, select);
}

export const viewportOf = (viewports: Readonly<Record<string, Viewport>>, boardId: string): Viewport => viewports[boardId] ?? DEFAULT_VIEWPORT;

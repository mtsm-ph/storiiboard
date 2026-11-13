import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Tool, Viewport } from '../../ui/canvas/types';
import { DEFAULT_VIEWPORT } from '../../ui/canvas/viewport';
import type { ClipItem } from './items';

// Where the person is in the Moodboard: the board open, what's selected on each, each board's view and the tool. View
// state, never an op and never in the project (decision 11): it lasts the session. The clipboard is inside the app
// and shared by every board and project open in this window; nothing goes to the system's clipboard in 5.0.

interface MoodboardState {
  /** Null shows the picker. */
  openBoardId: string | null;
  selections: Readonly<Record<string, readonly string[]>>;
  viewports: Readonly<Record<string, Viewport>>;
  tool: Tool;
  clipboard: readonly ClipItem[];
  openBoard: (boardId: string | null) => void;
  select: (boardId: string, ids: readonly string[]) => void;
  setViewport: (boardId: string, view: Viewport) => void;
  setTool: (tool: Tool) => void;
  copy: (items: readonly ClipItem[]) => void;
}

export const moodboardStore = createStore<MoodboardState>()((set) => ({
  openBoardId: null,
  selections: {},
  viewports: {},
  tool: 'select',
  clipboard: [],
  openBoard: (openBoardId) => {
    set({ openBoardId, tool: 'select' });
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
}));

export function useMoodboard<T>(select: (state: MoodboardState) => T): T {
  return useStore(moodboardStore, select);
}

export const viewportOf = (viewports: Readonly<Record<string, Viewport>>, boardId: string): Viewport => viewports[boardId] ?? DEFAULT_VIEWPORT;

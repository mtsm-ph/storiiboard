import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Tool, Viewport } from '../../../ui/canvas/types';
import { DEFAULT_VIEWPORT } from '../../../ui/canvas/viewport';
import type { PlanClip } from './planItems';

// Where the person is on a plan (6.2a): what's selected and the view, per plan view (a setup, or a scene with no setup),
// the tool, and what was copied. View state, never an op and never in the project, as the Moodboard's is.

interface PlanState {
  selections: Readonly<Record<string, readonly string[]>>;
  viewports: Readonly<Record<string, Viewport>>;
  tool: Tool;
  clipboard: readonly PlanClip[];
  select: (key: string, ids: readonly string[]) => void;
  setViewport: (key: string, view: Viewport) => void;
  setTool: (tool: Tool) => void;
  copy: (clip: readonly PlanClip[]) => void;
}

export const planStore = createStore<PlanState>()((set) => ({
  selections: {},
  viewports: {},
  tool: 'select',
  clipboard: [],
  select: (key, ids) => {
    set((s) => ({ selections: { ...s.selections, [key]: ids } }));
  },
  setViewport: (key, view) => {
    set((s) => ({ viewports: { ...s.viewports, [key]: view } }));
  },
  setTool: (tool) => {
    set({ tool });
  },
  copy: (clipboard) => {
    set({ clipboard });
  },
}));

export function usePlan<T>(select: (state: PlanState) => T): T {
  return useStore(planStore, select);
}

export const planViewportOf = (viewports: Readonly<Record<string, Viewport>>, key: string): Viewport => viewports[key] ?? DEFAULT_VIEWPORT;

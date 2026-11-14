import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { projectStore } from '../../../app/projectStore';
import type { Tool, Viewport } from '../../../ui/canvas/types';
import { DEFAULT_VIEWPORT } from '../../../ui/canvas/viewport';
import type { PlanClip } from './planItems';
import { SCALE_TOOL } from './planScale';

// Where the person is on a plan (6.2a): what's selected and the view, per plan view (a setup, or a scene with no setup),
// the tool, and what was copied. View state, never an op and never in the project, as the Moodboard's is.

interface PlanState {
  selections: Readonly<Record<string, readonly string[]>>;
  viewports: Readonly<Record<string, Viewport>>;
  tool: Tool;
  clipboard: readonly PlanClip[];
  /**
   * Whether what was copied on the plan is newer than anything copied elsewhere (6.9): true from a copy until this window
   * loses the focus (something else may be copied there). A paste with pictures on the system clipboard takes them as an
   * underlay unless the plan's own copy is fresh.
   */
  clipFresh: boolean;
  /** The underlay "Set scale" is clicking on (6.9), while its tool is picked; null otherwise. */
  scaling: string | null;
  select: (key: string, ids: readonly string[]) => void;
  setViewport: (key: string, view: Viewport) => void;
  setTool: (tool: Tool) => void;
  copy: (clip: readonly PlanClip[]) => void;
  /** "Set scale" (6.9): its two clicks for this underlay, the tool picked. */
  startScale: (underlayId: string) => void;
}

export const planStore = createStore<PlanState>()((set) => ({
  selections: {},
  viewports: {},
  tool: 'select',
  clipboard: [],
  clipFresh: false,
  scaling: null,
  select: (key, ids) => {
    set((s) => ({ selections: { ...s.selections, [key]: ids } }));
  },
  setViewport: (key, view) => {
    set((s) => ({ viewports: { ...s.viewports, [key]: view } }));
  },
  setTool: (tool) => {
    // Any other tool ends Set scale's clicks.
    set((s) => ({ tool, scaling: tool === SCALE_TOOL ? s.scaling : null }));
  },
  startScale: (underlayId) => {
    set({ tool: SCALE_TOOL, scaling: underlayId });
  },
  copy: (clipboard) => {
    set({ clipboard, clipFresh: true });
  },
}));

// Another project opened: nothing selected and the Select tool, since a version or a backup shares the original's ids
// and a selection or a half-drawn run must never act on the other file. The clipboard stays, as a board's does.
projectStore.subscribe((state, before) => {
  if (state.project !== before.project) planStore.setState({ selections: {}, tool: 'select', scaling: null });
});

if (typeof window !== 'undefined') {
  window.addEventListener('blur', () => {
    if (planStore.getState().clipFresh) planStore.setState({ clipFresh: false });
  });
}

export function usePlan<T>(select: (state: PlanState) => T): T {
  return useStore(planStore, select);
}

export const planViewportOf = (viewports: Readonly<Record<string, Viewport>>, key: string): Viewport => viewports[key] ?? DEFAULT_VIEWPORT;

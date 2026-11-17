import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { projectStore } from '../../../app/projectStore';
import type { Tool, Viewport } from '../../../ui/canvas/types';
import { RULER_SIZE } from '../../../ui/canvas/Rulers';
import { STRIP_INSET } from '../../../ui/canvas/stripTools';
import { evenInset, firstViewBeside } from '../../../ui/canvas/viewport';
import type { PlanClip } from './planItems';
import { SCALE_TOOL } from './planScale';
import { useShownPlan } from './shownPlan';

// Where the person is on a plan (6.2a): what's selected and the view, per plan view (a setup, or a scene with no setup),
// the tool, and what was copied. View state, never an op and never in the project, as the Moodboard's is.

interface PlanState {
  selections: Readonly<Record<string, readonly string[]>>;
  viewports: Readonly<Record<string, Viewport>>;
  tool: Tool;
  clipboard: readonly PlanClip[];
  /**
   * The opening of a project the clipboard was copied in (6.9 review, M1: shownPlan.ts's `openingKey`), '' for none.
   * Copied cameras, marks, lights and underlays name bodies, frames, characters, gear and pictures of that project
   * alone, so a paste into any other pastes nothing.
   */
  clipFrom: string;
  /** The underlay "Set scale" was started for (6.9), while its tool is picked; null otherwise. */
  scaling: string | null;
  /** The underlay Set scale's first click landed on, among several (6.9 review, L2): the hint names it. Null otherwise. */
  scaleFirst: string | null;
  setScaleFirst: (underlayId: string | null) => void;
  select: (key: string, ids: readonly string[]) => void;
  setViewport: (key: string, view: Viewport) => void;
  setTool: (tool: Tool) => void;
  copy: (clip: readonly PlanClip[], from: string) => void;
  /** "Set scale" (6.9): its two clicks for this underlay, the tool picked. */
  startScale: (underlayId: string) => void;
}

export const planStore = createStore<PlanState>()((set) => ({
  selections: {},
  viewports: {},
  tool: 'select',
  clipboard: [],
  clipFrom: '',
  scaling: null,
  scaleFirst: null,
  setScaleFirst: (scaleFirst) => {
    set({ scaleFirst });
  },
  select: (key, ids) => {
    set((s) => ({ selections: { ...s.selections, [key]: ids } }));
  },
  setViewport: (key, view) => {
    set((s) => ({ viewports: { ...s.viewports, [key]: view } }));
  },
  setTool: (tool) => {
    // Any other tool ends Set scale's clicks; any change of tool forgets their first click.
    set((s) => ({ tool, scaling: tool === SCALE_TOOL ? s.scaling : null, scaleFirst: null }));
  },
  startScale: (underlayId) => {
    set({ tool: SCALE_TOOL, scaling: underlayId, scaleFirst: null });
  },
  copy: (clipboard, from) => {
    set({ clipboard, clipFrom: from });
  },
}));

// Another project opened: nothing selected and the Select tool, since a version or a backup shares the original's ids
// and a selection or a half-drawn run must never act on the other file. The clipboard stays, as a board's does, but
// pastes only into the opening it was copied in (`clipFrom`).
projectStore.subscribe((state, before) => {
  if (state.project !== before.project) planStore.setState({ selections: {}, tool: 'select', scaling: null, scaleFirst: null });
});

// Another scene or setup shown (6.9 review, L1): Set scale's clicks were for an underlay of the view it began in, so
// they end with it, back to Select.
useShownPlan.subscribe((state, before) => {
  if (state.sceneId === before.sceneId && state.setupId === before.setupId) return;
  const { tool, scaling } = planStore.getState();
  if (tool === SCALE_TOOL || scaling !== null) planStore.setState({ tool: tool === SCALE_TOOL ? 'select' : tool, scaling: null, scaleFirst: null });
});

export function usePlan<T>(select: (state: PlanState) => T): T {
  return useStore(planStore, select);
}

/**
 * What the tools' strip takes along a plan's left edge, px (6.5.2 round 3): the strip's own, plus the left ruler, since on
 * a plan the strip sits inside the rulers. An even number (6.28: 51 + 18 = 69 made 70), so the half of it that the first
 * view, the keyboard's middle and every fit move by is whole pixels, and at 100% a whole centimetre is on a whole pixel.
 */
export const PLAN_STRIP_INSET = evenInset(STRIP_INSET + RULER_SIZE);

/** A plan's view, or its first: at 100%, the plan's origin in the middle of what is seen beside the tools' strip (6.5.2). */
const FIRST_VIEW = firstViewBeside(PLAN_STRIP_INSET);
export const planViewportOf = (viewports: Readonly<Record<string, Viewport>>, key: string): Viewport => viewports[key] ?? FIRST_VIEW;

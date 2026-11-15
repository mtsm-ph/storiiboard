import { create } from 'zustand';

// What the Setup workspace shows (6.2a): the setup picked in the Setups tile, or a scene picked by its heading with no
// setup. The Setups, Plan and Selection tiles all read it, as Shoot days and the Inspector share the shown day
// (src/features/schedule/shownDay.ts). In memory only, never in the project; ids that aren't live read as nothing.

export interface ShownPlan {
  sceneId: string | null;
  setupId: string | null;
}

export const useShownPlan = create<ShownPlan>(() => ({ sceneId: null, setupId: null }));

/** Shows a setup (in its scene), or a scene with no setup, or nothing. */
export const showPlan = (sceneId: string | null, setupId: string | null = null): void => {
  useShownPlan.setState({ sceneId, setupId: sceneId === null ? null : setupId });
};

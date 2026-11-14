import { create } from 'zustand';
import { projectStore } from '../../../app/projectStore';
import type { Project } from '../../../core/storage/project';

// What the Setup workspace shows (6.2a): the setup picked in the Setups tile, or a scene picked by its heading with no
// setup. The Setups, Plan and Selection tiles all read it, as Shoot days and the Inspector share the shown day
// (src/features/schedule/shownDay.ts). In memory only, never in the project; ids that aren't live read as nothing.
// Another project opened (a switch, Open version, Open backup, a reopen after a sync) shows nothing: a version or a
// backup shares the original's ids, and nothing picked in one must carry into the other.

export interface ShownPlan {
  sceneId: string | null;
  setupId: string | null;
}

export const useShownPlan = create<ShownPlan>(() => ({ sceneId: null, setupId: null }));

/** Shows a setup (in its scene), or a scene with no setup, or nothing. */
export const showPlan = (sceneId: string | null, setupId: string | null = null): void => {
  useShownPlan.setState({ sceneId, setupId: sceneId === null ? null : setupId });
};

projectStore.subscribe((state, before) => {
  if (state.project !== before.project) showPlan(null);
});

// Each opening of a file is a Project object of its own (a reopen of the same file is a new one), so the object, not
// its id or path (a version's copy keeps the project's id), is what tells one open project from another.
const opened = new WeakMap<Project, string>();
let openings = 0;

/** A key for this opening of a project, the same for as long as it stays open: '' for none. */
export function openingKey(project: Project | null): string {
  if (!project) return '';
  let key = opened.get(project);
  if (key === undefined) {
    openings += 1;
    key = `open${String(openings)}`;
    opened.set(project, key);
  }
  return key;
}

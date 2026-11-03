import type { Layout } from './shell/docking/layout';
import { layoutStore } from './shell/docking/layoutStore';
import type { WorkspaceId } from './shell/workspaces';
import { onProjectEdit, projectStore } from './projectStore';

// One ⌘Z for two histories. Project edits undo through src/core/ops and survive restarts; layout changes live in
// settings and undo for this session only. ⌘Z undoes whichever of the two changed last, as one timeline would.

type Domain = 'project' | 'layout';

const done: Domain[] = [];
let undone: Domain[] = [];

/** Called after every layout change or project edit made by the person (not by undo or redo). */
export function noteChange(domain: Domain): void {
  done.push(domain);
  // A new change ends that history's redo tail, as in each store.
  undone = undone.filter((d) => d !== domain);
}

export async function undoLast(): Promise<void> {
  // After a restart nothing is noted yet, but the project's history is on disk.
  const domain = done.pop() ?? 'project';
  if (domain === 'layout') {
    if (layoutStore.getState().undo()) undone.push('layout');
    return;
  }
  const before = projectStore.getState().canUndo;
  await projectStore.getState().undo();
  if (before) undone.push('project');
}

export async function redoLast(): Promise<void> {
  const domain = undone.pop() ?? 'project';
  if (domain === 'layout') {
    if (layoutStore.getState().redo()) done.push('layout');
    return;
  }
  const before = projectStore.getState().canRedo;
  await projectStore.getState().redo();
  if (before) done.push('project');
}

/** Every layout change made by the person goes through here, so ⌘Z knows a layout changed last. */
export function changeLayout(workspace: WorkspaceId, next: Layout): void {
  const before = layoutStore.getState().layouts[workspace].current;
  layoutStore.getState().change(workspace, next);
  if (layoutStore.getState().layouts[workspace].current !== before) noteChange('layout');
}

onProjectEdit(() => {
  noteChange('project');
});

/** For tests: start each one with an empty timeline. */
export function resetUndoTimeline(): void {
  done.length = 0;
  undone = [];
}

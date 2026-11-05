import { showInfo } from '../../app/notice';
import { projectStore } from '../../app/projectStore';
import { isMac } from '../../app/shell/undoShortcuts';
import { t, tn } from '../../core/i18n';
import { sceneFields, sceneLabel } from '../../core/model/storyboard';
import { board, trashScene } from './board';
import { selectionStore } from './selection';

/** Where focus goes once a scene is gone: the scene that took its place in a list, found by its id. */
export function focusSceneAfterDelete(next: string | null, attribute: string, fallback: () => HTMLElement | null | undefined): void {
  requestAnimationFrame(() => {
    const row = next === null ? null : document.querySelector<HTMLElement>(`[${attribute}="${CSS.escape(next)}"]`);
    (row ?? fallback())?.focus();
  });
}

/**
 * Delete scene (polish 5), from the Scenes tile or the sidebar: the scene and its frames and notes go to the Trash in
 * one step, undoable, and Restore in the Trash brings them back. The active scene moves to its neighbour. No confirm:
 * nothing is lost, and the notice says how to take it back. Resolves to whether it was written.
 */
export async function deleteScene(sceneId: string): Promise<{ written: boolean; next: string | null }> {
  const { project } = projectStore.getState();
  if (!project) return { written: false, next: null };
  let said = '';
  let next: string | null = null;
  const written = await projectStore.getState().applyWith((records) => {
    const changes = trashScene(records, sceneId);
    if (changes.length === 0) return { changes };
    const scenes = board(records, project.projectId);
    const at = scenes.findIndex((s) => s.record.id === sceneId);
    next = (scenes[at + 1] ?? scenes[at - 1])?.record.id ?? null;
    const frames = scenes[at]?.shots.length ?? 0;
    const notes = (scenes[at]?.items.length ?? 0) - frames;
    const scene = sceneLabel(sceneFields(records[sceneId]?.props ?? {}).number);
    const undo = isMac() ? '⌘Z' : 'Ctrl+Z';
    // What went with it, as the board counts it: frames, else notes, else nothing.
    said =
      frames > 0
        ? t('scene.deleted', { scene, what: tn('count.frames', frames), undo })
        : notes > 0
          ? t('scene.deleted', { scene, what: tn('count.notes', notes), undo })
          : t('scene.deletedEmpty', { scene, undo });
    return { changes };
  });
  // Nothing to write (the scene went already: a second click or a held key before the list caught up) is no delete.
  if (!written || said === '') return { written: false, next: null };
  if (selectionStore.getState().sceneId === sceneId) selectionStore.getState().selectScene(next);
  showInfo(said);
  return { written: true, next };
}

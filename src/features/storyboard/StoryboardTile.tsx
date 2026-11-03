import { useEffect, useState } from 'react';
import { useProject } from '../../app/projectStore';
import { aspectRatioValue, projectStoryboard, specLine } from '../../core/model/storyboard';
import { addScene, addShot, board, moveShot, trashShot, type BoardScene } from './board';
import { headingOf } from './ScenesView';
import { selectionStore, useSelection } from './selection';
import { BOARD_VIEWS, StoryboardView, type BoardView, type SceneGroup } from './StoryboardView';

/** Which view the board shows is the person's choice, not the project's: kept in this browser, like the layouts. */
export const BOARD_VIEW_KEY = 'storiiboard.board-view';

function savedView(): BoardView {
  try {
    const value = globalThis.localStorage.getItem(BOARD_VIEW_KEY);
    return BOARD_VIEWS.find((v) => v.value === value)?.value ?? 'grid';
  } catch {
    return 'grid';
  }
}

/**
 * Puts focus back on a frame once React has drawn it where it now is (after an add, a move or a delete). With
 * `focus` false it only scrolls the frame into view, as after a change of view, where focus stays on the switch.
 */
function focusFrame(shotId: string | null, focus = true) {
  requestAnimationFrame(() => {
    if (!shotId) return;
    const frame = document.querySelector<HTMLElement>(`[data-shot-id="${CSS.escape(shotId)}"]`);
    if (focus) frame?.focus();
    else frame?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

/** Where a frame goes when moved one place earlier or later, crossing into the neighbouring scene at either end. */
export function moveTarget(
  scenes: readonly BoardScene[],
  shotId: string,
  direction: -1 | 1,
): { sceneId: string; beforeShotId: string | null } | null {
  const sceneIndex = scenes.findIndex((s) => s.shots.some((shot) => shot.record.id === shotId));
  const scene = scenes[sceneIndex];
  if (!scene) return null;
  const shots = scene.shots.map((s) => s.record.id);
  const at = shots.indexOf(shotId);
  if (direction === -1) {
    if (at > 0) return { sceneId: scene.record.id, beforeShotId: shots[at - 1] ?? null };
    const previous = scenes[sceneIndex - 1];
    return previous ? { sceneId: previous.record.id, beforeShotId: null } : null;
  }
  if (at < shots.length - 1) return { sceneId: scene.record.id, beforeShotId: shots[at + 2] ?? null };
  const next = scenes[sceneIndex + 1];
  return next ? { sceneId: next.record.id, beforeShotId: next.shots[0]?.record.id ?? null } : null;
}

export function StoryboardTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const apply = useProject((s) => s.apply);
  const selectedShotId = useSelection((s) => s.shotId);
  const activeSceneId = useSelection((s) => s.sceneId);
  const projectId = project?.projectId ?? '';
  const scenes = project ? board(records, projectId) : [];
  const { aspectRatio } = projectStoryboard(records[projectId]?.props);
  const [view, setView] = useState<BoardView>(savedView);

  // A scene picked in the sidebar or the Scenes tile comes into view, unless the pick came from a frame in it.
  useEffect(() => {
    if (!activeSceneId) return;
    const { shotId } = selectionStore.getState();
    const fromBoard = shotId !== null && records[shotId]?.parentId === activeSceneId;
    if (!fromBoard) document.querySelector(`[data-scene-group="${CSS.escape(activeSceneId)}"]`)?.scrollIntoView({ block: 'start' });
    // Only a change of scene should scroll, not every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSceneId]);

  const groups: SceneGroup[] = scenes.map((scene) => ({
    id: scene.record.id,
    number: scene.fields.number,
    heading: headingOf(scene.fields),
    pageEighths: scene.fields.pageEighths,
    locked: scene.fields.numbersLocked,
    counts: scene.counts,
    frames: scene.shots.map((shot) => ({
      id: shot.record.id,
      number: shot.fields.number,
      spec: specLine(shot.fields),
      status: shot.fields.status,
      fields: shot.fields,
    })),
  }));

  return (
    <StoryboardView
      scenes={groups}
      view={view}
      onViewChange={(next) => {
        setView(next);
        try {
          globalThis.localStorage.setItem(BOARD_VIEW_KEY, next);
        } catch {
          // A blocked store only loses the preference.
        }
        // The selected frame stays selected and in view in the new layout.
        focusFrame(selectionStore.getState().shotId, false);
      }}
      aspectRatio={aspectRatioValue(aspectRatio)}
      selectedShotId={selectedShotId}
      canEdit={project !== null}
      onSelect={(shotId, sceneId) => {
        selectionStore.getState().selectShot(shotId, sceneId);
      }}
      onAddFrame={(sceneId) => {
        // After the selected frame when it's in this scene, so a frame goes where the person is working.
        const selected = selectedShotId && records[selectedShotId]?.parentId === sceneId ? selectedShotId : null;
        const { changes, shotId } = addShot(records, projectId, sceneId, selected);
        void apply(changes).then(() => {
          selectionStore.getState().selectShot(shotId, sceneId);
          focusFrame(shotId);
        });
      }}
      onAddScene={() => {
        const change = addScene(records, projectId);
        void apply([change]).then(() => {
          selectionStore.getState().selectScene(change.record.id);
        });
      }}
      onTrash={(shotId) => {
        // Selection moves to the next frame (or the one before at the end), where the keys can carry on.
        const flat = scenes.flatMap((s) => s.shots.map((shot) => ({ id: shot.record.id, sceneId: s.record.id })));
        const at = flat.findIndex((f) => f.id === shotId);
        const next = flat[at + 1] ?? flat[at - 1] ?? null;
        void apply(trashShot(records, projectId, shotId)).then(() => {
          selectionStore.getState().selectShot(next?.id ?? null, next?.sceneId ?? null);
          focusFrame(next?.id ?? null);
        });
      }}
      onOpen={() => {
        // The inspector already shows the selected frame; Enter takes focus there, when the tile is open.
        document.querySelector<HTMLElement>('[data-inspector] [role="radio"][tabindex="0"], [data-inspector] input')?.focus();
      }}
      onMove={(shotId, direction) => {
        const target = moveTarget(scenes, shotId, direction);
        if (!target) return;
        void apply(moveShot(records, projectId, shotId, target.sceneId, target.beforeShotId)).then(() => {
          selectionStore.getState().selectShot(shotId, target.sceneId);
          focusFrame(shotId);
        });
      }}
    />
  );
}

import { useEffect, useState } from 'react';
import { showNotice } from '../../app/notice';
import { choosePictures } from '../../app/pictures';
import { useProject } from '../../app/projectStore';
import { aspectRatioValue, projectStoryboard, specLine } from '../../core/model/storyboard';
import { addPictures, usePicturesBusy } from './addPictures';
import { addNote, addScene, addShot, board, locations, moveItem, setSceneLocation, trashShot, type BoardScene, type BoardShot } from './board';
import { pictureView } from './framePictures';
import { ProjectPictures } from './ProjectPictures';
import { headingOf } from './ScenesView';
import { selectionStore, useSelection } from './selection';
import {
  BOARD_VIEWS,
  StoryboardView,
  type BoardEntry,
  type BoardView,
  type DropHover,
  type FrameCard,
  type SceneGroup,
} from './StoryboardView';
import { useBoardDrops } from './useBoardDrops';

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

const itemIds = (scene: BoardScene) => scene.items.map((item) => (item.kind === 'shot' ? item.shot.record.id : item.note.record.id));

/**
 * Where a frame or a note goes when moved one place earlier or later, past frames and notes alike, crossing into the
 * neighbouring scene at either end.
 */
export function moveTarget(
  scenes: readonly BoardScene[],
  id: string,
  direction: -1 | 1,
): { sceneId: string; beforeShotId: string | null } | null {
  const sceneIndex = scenes.findIndex((s) => itemIds(s).includes(id));
  const scene = scenes[sceneIndex];
  if (!scene) return null;
  const ids = itemIds(scene);
  const at = ids.indexOf(id);
  if (direction === -1) {
    if (at > 0) return { sceneId: scene.record.id, beforeShotId: ids[at - 1] ?? null };
    const previous = scenes[sceneIndex - 1];
    return previous ? { sceneId: previous.record.id, beforeShotId: null } : null;
  }
  if (at < ids.length - 1) return { sceneId: scene.record.id, beforeShotId: ids[at + 2] ?? null };
  const next = scenes[sceneIndex + 1];
  return next ? { sceneId: next.record.id, beforeShotId: itemIds(next)[0] ?? null } : null;
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
  const [dropHover, setDropHover] = useState<DropHover>(null);
  const busy = usePicturesBusy();
  useBoardDrops(project !== null, setDropHover);

  // A scene picked in the sidebar or the Scenes tile comes into view, unless the pick came from a frame in it.
  useEffect(() => {
    if (!activeSceneId) return;
    const { shotId } = selectionStore.getState();
    const fromBoard = shotId !== null && records[shotId]?.parentId === activeSceneId;
    if (!fromBoard) document.querySelector(`[data-scene-group="${CSS.escape(activeSceneId)}"]`)?.scrollIntoView({ block: 'start' });
    // Only a change of scene should scroll, not every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSceneId]);

  const frameCard = (shot: BoardShot): FrameCard => ({
    id: shot.record.id,
    number: shot.fields.number,
    spec: specLine(shot.fields),
    status: shot.fields.status,
    fields: shot.fields,
    picture: pictureView(records, shot.fields),
  });

  const groups: SceneGroup[] = scenes.map((scene) => ({
    id: scene.record.id,
    number: scene.fields.number,
    heading: headingOf(scene.fields),
    pageEighths: scene.fields.pageEighths,
    locked: scene.fields.numbersLocked,
    counts: scene.counts,
    frames: scene.shots.map((shot) => frameCard(shot)),
    items: scene.items.map((item): BoardEntry =>
      item.kind === 'shot' ? { kind: 'frame', frame: frameCard(item.shot) } : { kind: 'note', id: item.note.record.id, text: item.note.text },
    ),
  }));

  return (
    <ProjectPictures>
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
        onTrash={(id) => {
          // Focus moves to the next item (or the one before at the end), where the keys can carry on.
          const flat = scenes.flatMap((s) => s.items.map((item) => ({ item, sceneId: s.record.id })));
          const at = flat.findIndex((f) => (f.item.kind === 'shot' ? f.item.shot.record.id : f.item.note.record.id) === id);
          const next = flat[at + 1] ?? flat[at - 1] ?? null;
          const nextId = next ? (next.item.kind === 'shot' ? next.item.shot.record.id : next.item.note.record.id) : null;
          const changes = records[id]?.type === 'note' ? [{ kind: 'trash' as const, id }] : trashShot(records, projectId, id);
          void apply(changes).then(() => {
            if (next?.item.kind === 'shot') selectionStore.getState().selectShot(nextId, next.sceneId);
            else selectionStore.getState().selectShot(null, next?.sceneId ?? null);
            focusFrame(nextId);
          });
        }}
        onOpen={() => {
          // The inspector already shows the selected frame; Enter takes focus to its camera, the first thing set for a
          // shot, when the tile is open. The picture's framing sits above it, a Shift+Tab away.
          document
            .querySelector<HTMLElement>('[data-inspector-start] [role="radio"][tabindex="0"], [data-inspector-start] input')
            ?.focus();
        }}
        onMove={(shotId, direction) => {
          const target = moveTarget(scenes, shotId, direction);
          if (!target) return;
          void apply(moveItem(records, projectId, shotId, target.sceneId, target.beforeShotId)).then(() => {
            if (records[shotId]?.type === 'shot') selectionStore.getState().selectShot(shotId, target.sceneId);
            focusFrame(shotId);
          });
        }}
        onMoveTo={(id, place) => {
          void apply(moveItem(records, projectId, id, place.sceneId, place.beforeId)).then(() => {
            if (records[id]?.type === 'shot') selectionStore.getState().selectShot(id, place.sceneId);
          });
        }}
        onSelectScene={(sceneId) => {
          selectionStore.getState().selectShot(null, sceneId);
        }}
        locationNames={locations(records, projectId).map((l) => l.name)}
        onSetLocation={(sceneId, name) => {
          void apply(setSceneLocation(records, projectId, sceneId, name));
        }}
        onNoteText={(noteId, text) => {
          void apply([{ kind: 'update', id: noteId, set: { text } }]);
        }}
        onInsert={async (choice, place) => {
          if (choice.kind === 'scene') {
            const change = addScene(records, projectId, place.sceneId);
            await apply([change]);
            selectionStore.getState().selectScene(change.record.id);
            return change.record.id;
          }
          if (choice.kind === 'note') {
            const change = addNote(records, place.sceneId, place.afterId);
            await apply([change]);
            selectionStore.getState().selectShot(null, place.sceneId);
            return change.record.id;
          }
          const { changes, shotId } = addShot(records, projectId, place.sceneId, place.afterId);
          await apply(changes);
          selectionStore.getState().selectShot(shotId, place.sceneId);
          return shotId;
        }}
        busy={busy}
        dropHover={dropHover}
        onAddPictures={() => {
          // Into the selected scene, after the selected frame when there is one; else the last scene.
          const { shotId, sceneId } = selectionStore.getState();
          const scene = scenes.find((s) => s.record.id === sceneId) ?? scenes.at(-1);
          if (!scene) return;
          const after = shotId && records[shotId]?.parentId === scene.record.id ? shotId : null;
          choosePictures(true)
            .then((files) => addPictures(files, { kind: 'scene', sceneId: scene.record.id, afterShotId: after }))
            .catch(showNotice);
        }}
      />
    </ProjectPictures>
  );
}

import { useEffect, useState } from 'react';
import { showInfo, showNotice } from '../../app/notice';
import { choosePictures } from '../../app/pictures';
import { projectStore, useProject } from '../../app/projectStore';
import { aspectRatioValue, projectStoryboard, specLine } from '../../core/model/storyboard';
import { addPictures, usePicturesBusy } from './addPictures';
import {
  addNote,
  addScene,
  addShot,
  board,
  leavesLockedScene,
  locations,
  moveItem,
  setSceneLocation,
  trashShot,
  type BoardScene,
  type BoardShot,
} from './board';
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
    // Any board item, frame or note, whichever view draws it.
    const frame = document.querySelector<HTMLElement>(`[data-board] [data-item-id="${CSS.escape(shotId)}"]`);
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
  // Edits worked out in the queue, from the records as the edits before them left them: a key held down on + Frame
  // never numbers two frames from the same records.
  const applyWith = useProject((s) => s.applyWith);
  const selectedShotId = useSelection((s) => s.shotId);
  const selectedNoteId = useSelection((s) => s.noteId);
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
    const { shotId, noteId } = selectionStore.getState();
    const picked = shotId ?? noteId;
    const fromBoard = picked !== null && records[picked]?.parentId === activeSceneId;
    if (!fromBoard) document.querySelector(`[data-scene-group="${CSS.escape(activeSceneId)}"]`)?.scrollIntoView({ block: 'start' });
    // Only a change of scene should scroll, not every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSceneId]);

  /** A frame or a note to a new place; a frame stays in a scene whose numbers are locked, and the person is told why. */
  const moveTo = async (id: string, sceneId: string, beforeId: string | null) => {
    if (leavesLockedScene(records, id, sceneId)) {
      showInfo('This scene’s shot numbers are locked, so its frames stay in it. Unlock them to move a frame out.');
      return;
    }
    await applyWith((now) => ({ changes: moveItem(now, projectId, id, sceneId, beforeId) }));
    if (projectStore.getState().records[id]?.type === 'shot') selectionStore.getState().selectShot(id, sceneId);
  };

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
          let shotId = '';
          void applyWith((now) => {
            // After the selected frame when it's in this scene, so a frame goes where the person is working.
            const { shotId: selected } = selectionStore.getState();
            const after = selected && now[selected]?.parentId === sceneId ? selected : null;
            const added = addShot(now, projectId, sceneId, after);
            shotId = added.shotId;
            return added;
          }).then(() => {
            selectionStore.getState().selectShot(shotId, sceneId);
            focusFrame(shotId);
          });
        }}
        onAddScene={() => {
          let sceneId = '';
          void applyWith((now) => {
            const change = addScene(now, projectId);
            sceneId = change.record.id;
            return { changes: [change] };
          }).then(() => {
            selectionStore.getState().selectScene(sceneId);
          });
        }}
        onTrash={(id) => {
          // Focus moves to the next item (or the one before at the end), where the keys can carry on.
          const flat = scenes.flatMap((s) => s.items.map((item) => ({ item, sceneId: s.record.id })));
          const at = flat.findIndex((f) => (f.item.kind === 'shot' ? f.item.shot.record.id : f.item.note.record.id) === id);
          const next = flat[at + 1] ?? flat[at - 1] ?? null;
          const nextId = next ? (next.item.kind === 'shot' ? next.item.shot.record.id : next.item.note.record.id) : null;
          void applyWith((now) => ({
            changes: now[id]?.type === 'note' ? [{ kind: 'trash' as const, id }] : trashShot(now, projectId, id),
          })).then(() => {
            if (next?.item.kind === 'shot') selectionStore.getState().selectShot(nextId, next.sceneId);
            else if (next) selectionStore.getState().selectNote(nextId, next.sceneId);
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
        onMove={(id, direction) => {
          const target = moveTarget(scenes, id, direction);
          if (!target) return;
          void moveTo(id, target.sceneId, target.beforeShotId).then(() => {
            focusFrame(id);
          });
        }}
        onMoveTo={(id, place) => moveTo(id, place.sceneId, place.beforeId)}
        onSelectScene={(sceneId, noteId) => {
          selectionStore.getState().selectNote(noteId, sceneId);
        }}
        selectedNoteId={selectedNoteId}
        locationNames={locations(records, projectId).map((l) => l.name)}
        onSetLocation={(sceneId, name) => {
          void applyWith((now) => ({ changes: setSceneLocation(now, projectId, sceneId, name) }));
        }}
        onNoteText={(noteId, text) => {
          void apply([{ kind: 'update', id: noteId, set: { text } }]);
        }}
        onInsert={async (choice, place) => {
          let id = '';
          await applyWith((now) => {
            if (choice.kind === 'scene') {
              const change = addScene(now, projectId, place.sceneId);
              id = change.record.id;
              return { changes: [change] };
            }
            if (choice.kind === 'note') {
              const change = addNote(now, place.sceneId, place.afterId);
              id = change.record.id;
              return { changes: [change] };
            }
            const added = addShot(now, projectId, place.sceneId, place.afterId);
            id = added.shotId;
            return added;
          });
          // Only once written: a failed edit has said why, and leaves nothing to go to.
          if (!projectStore.getState().records[id]) return null;
          if (choice.kind === 'scene') selectionStore.getState().selectScene(id);
          else if (choice.kind === 'note') selectionStore.getState().selectNote(id, place.sceneId);
          else selectionStore.getState().selectShot(id, place.sceneId);
          return id;
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

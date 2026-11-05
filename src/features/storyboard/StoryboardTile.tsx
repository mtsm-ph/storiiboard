import { useEffect, useMemo, useState } from 'react';
import { customFieldNames, customFieldsOf } from '../../core/model/customFields';
import { showInfo, showNotice } from '../../app/notice';
import { choosePictures } from '../../app/pictures';
import { projectStore, useProject } from '../../app/projectStore';
import type { SbdRecord } from '../../core/model/record';
import { aspectRatioValue, projectStoryboard, specLine } from '../../core/model/storyboard';
import { addPictures, usePicturesBusy } from './addPictures';
import { readClip } from '../../core/media/video';
import { useMissingVideos } from '../video/videoStatus';
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
import { openSketch } from './sketch/sketchStore';
import { stableStrokesByShot } from './sketch/strokes';
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
import { t } from '../../core/i18n';

/** No department has opened the frame yet (polish 6b). */
const NOTHING_SEEN: readonly string[] = [];

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

  const lockedNotice = () => {
    showInfo(t('board.lockedStays'));
  };

  /** Selects a frame or a note where it now is, once an edit has put it there. */
  const selectItem = (id: string) => {
    const record = projectStore.getState().records[id];
    if (!record?.parentId || record.trashedAt !== null) return;
    if (record.type === 'shot') selectionStore.getState().selectShot(id, record.parentId);
    else if (record.type === 'note') selectionStore.getState().selectNote(id, record.parentId);
  };

  /**
   * A frame or a note to a new place, worked out in the edit queue from the board as it is then. A frame stays in a
   * scene whose numbers are locked, and the person is told why. Resolves to whether it moved.
   */
  const moveTo = async (
    id: string,
    place: (now: Readonly<Record<string, SbdRecord>>) => { sceneId: string; beforeId: string | null } | null,
  ) => {
    // Set by the builder, which runs in the queue.
    const outcome = { refused: false, moved: false };
    const written = await applyWith((now, slate) => {
      const target = place(now);
      if (!target) return { changes: [] };
      if (leavesLockedScene(now, id, target.sceneId)) {
        outcome.refused = true;
        return { changes: [] };
      }
      const changes = moveItem(now, projectId, id, target.sceneId, target.beforeId, slate);
      outcome.moved = changes.length > 0;
      return { changes };
    });
    if (outcome.refused) lockedNotice();
    // A move that failed to save has said why; it didn't move.
    const moved = outcome.moved && written;
    if (moved) selectItem(id);
    return moved;
  };

  // Worked out once per edit, keeping each shot's list as it was while its strokes are unchanged, so a card's
  // sketch redraws only when its own strokes do.
  const strokes = useMemo(() => stableStrokesByShot(records), [records]);
  const seen = useProject((s) => s.seen);
  const missingVideos = useMissingVideos();
  const clipOf = (props: SbdRecord['props']): FrameCard['clip'] => {
    const clip = readClip(props);
    if (!clip) return undefined;
    // A video gone from the project (Empty Trash, a History restore) is as missing as one whose file moved.
    const video = records[clip.videoId];
    const gone = !video || video.trashedAt !== null || video.props.kind !== 'video';
    return { missing: gone || missingVideos[clip.videoId] === true };
  };
  const frameCard = (shot: BoardShot): FrameCard => {
    const clip = clipOf(shot.record.props);
    return {
      id: shot.record.id,
      number: shot.fields.number,
      spec: specLine(shot.fields),
      status: shot.fields.status,
      fields: shot.fields,
      picture: pictureView(records, shot.fields),
      strokes: strokes.get(shot.record.id) ?? [],
      custom: customFieldsOf(shot.record.props),
      seen: seen[shot.record.id] ?? NOTHING_SEEN,
      ...(clip ? { clip } : {}),
    };
  };

  const groups: SceneGroup[] = scenes.map((scene) => ({
    id: scene.record.id,
    number: scene.fields.number,
    heading: headingOf(scene.fields),
    name: scene.fields.name,
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
      {/* Keyed by project, so a menu or a drag open when the project switches never acts on the new one. */}
      <StoryboardView
        key={projectId}
        scenes={groups}
        customNames={customFieldNames(records)}
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
        // Each is one edit, so one undo takes it back; an emptied title is taken off rather than kept empty.
        onRenameScene={(sceneId, name) => {
          void apply([{ kind: 'update', id: sceneId, set: { name } }]);
        }}
        onRetitleShot={(shotId, title) => {
          void apply([title === '' ? { kind: 'update', id: shotId, unset: ['title'] } : { kind: 'update', id: shotId, set: { title } }]);
        }}
        onAddFrame={(sceneId) => {
          let shotId = '';
          void applyWith((now, slate) => {
            // After the selected frame when it's in this scene, so a frame goes where the person is working.
            const { shotId: selected } = selectionStore.getState();
            const after = selected && now[selected]?.parentId === sceneId ? selected : null;
            const added = addShot(now, projectId, sceneId, after, {}, slate);
            shotId = added.shotId;
            return added;
          }).then(() => {
            // Only once written: a failed edit has said why, and leaves nothing to go to.
            if (!projectStore.getState().records[shotId]) return;
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
            if (projectStore.getState().records[sceneId]) selectionStore.getState().selectScene(sceneId);
          });
        }}
        onTrash={(id) => {
          // Focus moves to the next item (or the one before at the end), where the keys can carry on.
          const flat = scenes.flatMap((s) => s.items.map((item) => ({ item, sceneId: s.record.id })));
          const at = flat.findIndex((f) => (f.item.kind === 'shot' ? f.item.shot.record.id : f.item.note.record.id) === id);
          const next = flat[at + 1] ?? flat[at - 1] ?? null;
          const nextId = next ? (next.item.kind === 'shot' ? next.item.shot.record.id : next.item.note.record.id) : null;
          void applyWith((now, slate) => {
            const item = now[id];
            // A key held down can ask twice; the second finds it in the Trash already.
            if (!item || item.trashedAt !== null) return { changes: [] };
            return { changes: item.type === 'note' ? [{ kind: 'trash' as const, id }] : trashShot(now, projectId, id, slate) };
          }).then((written) => {
            // Refused or dropped (a project switched in between): nothing moved, so neither does the selection.
            if (!written) return;
            if (next?.item.kind === 'shot') selectionStore.getState().selectShot(nextId, next.sceneId);
            else if (next) selectionStore.getState().selectNote(nextId, next.sceneId);
            // The last item gone: nothing selected, so the board's Tab stop falls to what's left on it, and focus goes
            // to the scene's + Frame rather than off the board.
            else selectionStore.getState().selectShot(null, null);
            if (nextId) focusFrame(nextId);
            else {
              const sceneId = flat[at]?.sceneId;
              requestAnimationFrame(() => {
                if (sceneId) document.querySelector<HTMLElement>(`[data-scene-group="${CSS.escape(sceneId)}"] [data-board-item]`)?.focus();
              });
            }
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
          // From the board as earlier moves left it, so holding ⌘ and an arrow steps one place each time.
          void moveTo(id, (now) => {
            const target = moveTarget(board(now, projectId), id, direction);
            return target ? { sceneId: target.sceneId, beforeId: target.beforeShotId } : null;
          }).then(() => {
            focusFrame(id);
          });
        }}
        onMoveTo={(id, place) => moveTo(id, () => place)}
        onSelectScene={(sceneId, noteId) => {
          selectionStore.getState().selectNote(noteId, sceneId);
        }}
        selectedNoteId={selectedNoteId}
        locationNames={locations(records, projectId).map((l) => l.name)}
        onSketch={openSketch}
        onSetLocation={(sceneId, name) => {
          void applyWith((now) => ({ changes: setSceneLocation(now, projectId, sceneId, name) }));
        }}
        onNoteText={(noteId, text) => {
          void apply([{ kind: 'update', id: noteId, set: { text } }]);
        }}
        onInsert={async (choice, place) => {
          let id = '';
          await applyWith((now, slate) => {
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
            const added = addShot(now, projectId, place.sceneId, place.afterId, {}, slate);
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

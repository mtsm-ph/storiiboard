import { useEffect } from 'react';
import { isTauriApp } from '../../app/fileAccess';
import { showInfo } from '../../app/notice';
import { fromFile, onWindowDrag, onWindowDrop, type PagePoint, type PictureFile } from '../../app/pictures';
import { projectStore } from '../../app/projectStore';
import { addPictures } from './addPictures';
import { canPlace, type PictureTarget } from './framePictures';
import { selectionStore } from './selection';
import type { DropHover } from './StoryboardView';

// Pictures dropped on the board or pasted (1.11). Whatever carries the drop, frames and scenes say what they are
// with data-drop-shot and data-drop-scene, so the board, the strip, the shot list and the inspector's Picture section
// all take drops the same way. In the desktop app Tauri catches file drops before the page sees them and Rust reports
// a point; in the browser build the page's own drag events carry the files. The listeners live with the board tile,
// so drops and pastes work while the board is open.

/** The frame or scene under an element, if it's one that takes pictures. */
function targetOf(element: Element | null): PictureTarget | null {
  const shotId = element?.closest<HTMLElement>('[data-drop-shot]')?.dataset.dropShot;
  if (shotId) return { kind: 'frame', shotId };
  const sceneId = element?.closest<HTMLElement>('[data-drop-scene]')?.dataset.dropScene;
  return sceneId ? { kind: 'scene', sceneId, afterShotId: null } : null;
}

const targetAt = (point: PagePoint) => targetOf(document.elementFromPoint(point.x, point.y));

/**
 * Whether a drop or a paste is someone else's: anything while a modal dialog is open (onboarding, the sketch editor),
 * or one on Settings → Theme, which takes a picture as the project's image.
 */
function takenElsewhere(element: Element | null): boolean {
  return document.querySelector('dialog[open]') !== null || element?.closest('[data-theme-well], [data-theme-tile]') != null;
}

function hoverOf(target: PictureTarget | null): DropHover {
  if (!target) return null;
  return target.kind === 'frame' ? { shotId: target.shotId } : { sceneId: target.sceneId };
}

function drop(files: PictureFile[], target: PictureTarget | null) {
  if (files.length === 0) return;
  if (!target) {
    showInfo('Drop pictures on a frame to set its picture, or on a scene to add frames.');
    return;
  }
  void addPictures(files, target);
}

/** Whether focus is where typing goes, so a paste there is the field's. */
function typing(element: Element | null): boolean {
  return element instanceof HTMLElement && (element.isContentEditable || element.closest('input, textarea, select') !== null);
}

/**
 * ⌘V with a picture on the clipboard: into the selected frame, or a new frame at the end of the selected scene. A
 * selection that no longer names anything live (after an undo, say) falls back to its scene, then to nothing.
 */
function onPaste(event: ClipboardEvent) {
  const files = [...(event.clipboardData?.files ?? [])];
  if (files.length === 0) return;
  // A text field pastes text as it always does.
  if (typing(document.activeElement) || takenElsewhere(document.activeElement)) return;
  event.preventDefault();
  const { shotId, sceneId } = selectionStore.getState();
  const { project, records } = projectStore.getState();
  const projectId = project?.projectId ?? '';
  const frame: PictureTarget | null = shotId ? { kind: 'frame', shotId } : null;
  const scene: PictureTarget | null = sceneId ? { kind: 'scene', sceneId, afterShotId: null } : null;
  const target = [frame, scene].find((t): t is PictureTarget => t !== null && canPlace(records, projectId, t)) ?? null;
  if (!target) {
    showInfo('Select a frame or a scene, then paste the picture.');
    return;
  }
  void addPictures(files.map(fromFile), target);
}

/** Takes picture drops and pastes while a project is open, and reports what a drag of files is over. */
export function useBoardDrops(enabled: boolean, onHover: (hover: DropHover) => void): void {
  useEffect(() => {
    if (!enabled) return;
    // A drag reports dozens of times a second; the board redraws only when what's under it changes.
    let shown = '';
    const setHover = (hover: DropHover) => {
      const key = hover === null ? '' : 'shotId' in hover ? `shot:${hover.shotId}` : `scene:${hover.sceneId}`;
      if (key === shown) return;
      shown = key;
      onHover(hover);
    };
    document.addEventListener('paste', onPaste);
    if (isTauriApp) {
      let live = true;
      let stops: (() => void)[] = [];
      void Promise.all([
        onWindowDrag((at) => {
          setHover(at && !takenElsewhere(document.elementFromPoint(at.x, at.y)) ? hoverOf(targetAt(at)) : null);
        }),
        onWindowDrop((files, at) => {
          setHover(null);
          if (!takenElsewhere(document.elementFromPoint(at.x, at.y))) drop(files, targetAt(at));
        }),
      ]).then((unlisten) => {
        if (live) stops = unlisten;
        else for (const stop of unlisten) stop();
      });
      return () => {
        live = false;
        for (const stop of stops) stop();
        document.removeEventListener('paste', onPaste);
      };
    }

    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true;
    const over = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // Without this the browser opens the file in place of the app, even over a drop that's someone else's.
      event.preventDefault();
      if (takenElsewhere(event.target instanceof Element ? event.target : null)) {
        setHover(null);
        return;
      }
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setHover(hoverOf(targetOf(event.target instanceof Element ? event.target : null)));
    };
    const leave = (event: DragEvent) => {
      if (event.relatedTarget === null) setHover(null);
    };
    const dropped = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setHover(null);
      if (takenElsewhere(event.target instanceof Element ? event.target : null)) return;
      drop([...(event.dataTransfer?.files ?? [])].map(fromFile), targetOf(event.target instanceof Element ? event.target : null));
    };
    document.addEventListener('dragover', over);
    document.addEventListener('dragleave', leave);
    document.addEventListener('drop', dropped);
    return () => {
      document.removeEventListener('dragover', over);
      document.removeEventListener('dragleave', leave);
      document.removeEventListener('drop', dropped);
      document.removeEventListener('paste', onPaste);
    };
  }, [enabled, onHover]);
}

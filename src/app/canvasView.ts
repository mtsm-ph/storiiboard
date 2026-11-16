import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { loadCanvasViews, saveCanvasViews, type CanvasViewChoice, type CanvasViews } from '../core/storage/settings';

// Paper or Dark (6.5.1, Kevin, Nov 16): how plans and boards are looked at on this computer, one choice for every plan and
// one for every board and deck, kept in its storage. A view, never an edit: no op, nothing in History, nothing undone by
// ⌘Z, nothing written to the project, so a change never counts as the project changing or calls for a backup.

export type CanvasKind = keyof CanvasViews;

const store = createStore<CanvasViews>()(() => loadCanvasViews());

/** The view every canvas of this kind is drawn in now. */
export const useCanvasView = (kind: CanvasKind): CanvasViewChoice => useStore(store, (s) => s[kind]);

/** Both views as they are now, read outside React (a settings preset, 6.5.8). */
export const canvasViewsNow = (): CanvasViews => ({ ...store.getState() });

/** Sets the view for every canvas of this kind on this computer; the other kind's stays as it is. */
export function setCanvasView(kind: CanvasKind, view: CanvasViewChoice): void {
  if (store.getState()[kind] === view) return;
  store.setState(saveCanvasViews({ ...store.getState(), [kind]: view }));
}

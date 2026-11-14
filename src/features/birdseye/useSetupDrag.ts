import { useEffect, useRef, useState, type PointerEvent } from 'react';

// Reordering a scene's setups by drag (6.0), on pointer events as the board's frames are (useItemDrag), never HTML5
// drag and drop: the desktop app keeps the OS file drop on, which turns HTML5 drag and drop off inside the page on
// Windows (docs/DESKTOP_GAPS.md, B1). The drag starts from a row's handle, so the row's name field stays an ordinary
// field. A press that moves less than 4px does nothing. An ink bar shows where the setup will land among its scene's
// rows; Escape cancels; one drop is one move. Up and Down on each row do the same from the keyboard.

const THRESHOLD_PX = 4;

export interface SetupDrag {
  id: string;
  /** Its place among the scene's live setups once dropped (0 for first), as moveSetup takes it. */
  to: number;
  bar: { left: number; top: number; width: number };
}

/** The scene's rows as drawn, in order. */
const rowsOf = (sceneId: string) => [...document.querySelectorAll<HTMLElement>(`[data-setup-row][data-scene="${CSS.escape(sceneId)}"]`)];

function placeAt(sceneId: string, id: string, x: number, y: number): SetupDrag | null {
  // Outside its scene's own box (over another scene's rows, or out of the tile) there is no place: no bar, no drop.
  const scene = document.querySelector<HTMLElement>(`[data-setups-scene="${CSS.escape(sceneId)}"]`);
  const area = scene?.getBoundingClientRect();
  if (!area || x < area.left || x > area.right || y < area.top || y > area.bottom) return null;
  const rows = rowsOf(sceneId);
  const others = rows.filter((row) => row.dataset.setupRow !== id);
  if (others.length === 0) return null;
  // The place is how many of the other rows sit above the pointer, by their middles.
  const to = others.filter((row) => {
    const box = row.getBoundingClientRect();
    return y > box.top + box.height / 2;
  }).length;
  const anchor = others[Math.min(to, others.length - 1)];
  if (!anchor) return null;
  const box = anchor.getBoundingClientRect();
  return { id, to, bar: { left: box.left, top: to < others.length ? box.top - 1.75 : box.bottom - 1.75, width: box.width } };
}

export function useSetupDrag(onDrop: (id: string, to: number) => void) {
  const [drag, setDrag] = useState<SetupDrag | null>(null);
  // The drag as last drawn, for the release to read; a state updater must not do the drop (it may run twice).
  const latest = useRef<SetupDrag | null>(null);
  const pressed = useRef<{ id: string; sceneId: string; y: number; x: number; started: boolean } | null>(null);
  const dropRef = useRef(onDrop);
  useEffect(() => {
    dropRef.current = onDrop;
  }, [onDrop]);

  useEffect(() => {
    const cancel = () => {
      pressed.current = null;
      latest.current = null;
      setDrag(null);
    };
    const move = (event: globalThis.PointerEvent) => {
      const press = pressed.current;
      if (!press) return;
      // The release went somewhere this window never heard of (it lost focus mid-press): the drag is over.
      if ((event.buttons & 1) === 0) {
        cancel();
        return;
      }
      if (!press.started && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= THRESHOLD_PX) return;
      press.started = true;
      latest.current = placeAt(press.sceneId, press.id, event.clientX, event.clientY);
      setDrag(latest.current);
    };
    const up = () => {
      const press = pressed.current;
      const current = latest.current;
      cancel();
      if (press?.started && current) dropRef.current(current.id, current.to);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !pressed.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    // A pointer the system takes away (a gesture, a window switch) cancels the drag; it never drops.
    window.addEventListener('pointercancel', cancel);
    // So does the window losing focus: its pointerup may never arrive, and an armed drag would drop on the next click.
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key, true);
    };
  }, []);

  /** Handlers for a row's handle. */
  const handleProps = (id: string, sceneId: string) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || event.pointerType === 'touch') return;
      // No text selection starts under the pointer while it drags.
      event.preventDefault();
      pressed.current = { id, sceneId, x: event.clientX, y: event.clientY, started: false };
    },
  });

  return { drag, handleProps };
}

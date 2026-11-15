import { useEffect, useRef, useState, type PointerEvent } from 'react';

// Reordering a list's rows by drag, on pointer events as the board's frames are (useItemDrag), never HTML5 drag and
// drop: the desktop app keeps the OS file drop on, which turns HTML5 drag and drop off inside the page on Windows
// (docs/DESKTOP_GAPS.md, B1; CLAUDE.md: lists reorder by pointer events). Built for the Setups tile (6.0) and shared
// with a deck's Pages panel (6.15). The drag starts from a row's handle, so the rest of the row stays ordinary buttons
// and fields. A press that moves less than 4px does nothing. An ink bar shows where the row will land among its group's
// rows; outside the group's own box there is no place and no drop; Escape cancels; one drop is one move. The handle's
// pointerdown default is prevented, so no text selection starts and a press on it moves no focus (src/ui/clickFocus.ts).

const THRESHOLD_PX = 4;

export interface RowDrag {
  id: string;
  /** Its place among the group's rows once dropped (0 for first), counting the others above it. */
  to: number;
  bar: { left: number; top: number; width: number };
}

export interface RowDragList {
  /** The group's rows as drawn, in order. */
  rows: (group: string) => HTMLElement[];
  /** The id a row stands for. */
  idOf: (row: HTMLElement) => string | undefined;
  /** The box a drop must land in; outside it there is no place. */
  area: (group: string) => HTMLElement | null;
  /** A touch pointer drags too (a pen and a mouse always do). The handle needs `touch-none` so touch doesn't scroll. */
  touch?: boolean;
  /** The handle captures the pointer, so a drag that leaves the window or the panel still hears its release. */
  capture?: boolean;
}

function placeAt(list: RowDragList, group: string, id: string, x: number, y: number): RowDrag | null {
  const area = list.area(group)?.getBoundingClientRect();
  if (!area || x < area.left || x > area.right || y < area.top || y > area.bottom) return null;
  const others = list.rows(group).filter((row) => list.idOf(row) !== id);
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

/** `list` is read once, at the first render: pass a constant. */
export function useRowDrag(list: RowDragList, onDrop: (id: string, to: number) => void) {
  const [drag, setDrag] = useState<RowDrag | null>(null);
  // The drag as last drawn, for the release to read; a state updater must not do the drop (it may run twice).
  const latest = useRef<RowDrag | null>(null);
  const pressed = useRef<{ id: string; group: string; y: number; x: number; started: boolean } | null>(null);
  const listRef = useRef(list);
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
      latest.current = placeAt(listRef.current, press.group, press.id, event.clientX, event.clientY);
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
  const handleProps = (id: string, group: string) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || (event.pointerType === 'touch' && listRef.current.touch !== true)) return;
      // No text selection starts under the pointer while it drags.
      event.preventDefault();
      if (listRef.current.capture === true) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // A pointer that is already gone: the window's own listeners still end the drag.
        }
      }
      pressed.current = { id, group, x: event.clientX, y: event.clientY, started: false };
    },
  });

  return { drag, handleProps };
}

import { useEffect, useRef, useState, type PointerEvent } from 'react';

// Reordering a list's rows by drag, on pointer events as the board's frames are (useItemDrag), never HTML5 drag and
// drop: the desktop app keeps the OS file drop on, which turns HTML5 drag and drop off inside the page on Windows
// (docs/DESKTOP_GAPS.md, B1; CLAUDE.md: lists reorder by pointer events). Built for the Setups tile (6.0) and shared
// with a deck's Pages panel (6.15). The drag starts from a row's handle, so the rest of the row stays ordinary buttons
// and fields. A press that moves less than 4px does nothing. An ink bar shows where the row will land among its group's
// rows; outside the group's own box there is no place and no drop; Escape cancels; one drop is one move. The handle's
// pointerdown default is prevented, so no text selection starts and a press on it moves no focus (src/ui/clickFocus.ts).
// One pointer drives a drag: another's moves, releases and cancels are ignored until it ends (6.15 review). A list that
// scrolls inside a box (a deck's pages) names that box: a drop lands only where the list shows through it, near its top
// or bottom edge the drag scrolls it, and any scroll places the drop again from where the pointer last was.

const THRESHOLD_PX = 4;
/** How close to a scrolling box's top or bottom edge the pointer scrolls it, and by how much each frame (about 360px a second). */
const EDGE_PX = 24;
const SCROLL_STEP_PX = 6;

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
  /** The box the group's area scrolls in, when it does: only what shows through it takes a drop, and its edges scroll it. */
  scroller?: (group: string) => HTMLElement | null;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The part of the group's box a drop can land in: all of it, or what shows through the box it scrolls in. */
function dropBox(list: RowDragList, group: string): Box | null {
  const area = list.area(group)?.getBoundingClientRect();
  if (!area) return null;
  const view = list.scroller?.(group)?.getBoundingClientRect();
  if (!view) return area;
  const box = { left: Math.max(area.left, view.left), top: Math.max(area.top, view.top), right: Math.min(area.right, view.right), bottom: Math.min(area.bottom, view.bottom) };
  return box.left < box.right && box.top < box.bottom ? box : null;
}

function placeAt(list: RowDragList, group: string, id: string, x: number, y: number): RowDrag | null {
  const area = dropBox(list, group);
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
  const at = to < others.length ? box.top - 1.75 : box.bottom - 1.75;
  // In a list that scrolls inside a box, kept inside what shows of it, never drawn over the panel's header or controls.
  // With no such box the bar sits exactly where it always has (the Setups tile, 6.0).
  const top = list.scroller ? Math.min(Math.max(at, area.top), area.bottom - 3.5) : at;
  return { id, to, bar: { left: box.left, top, width: box.width } };
}

interface Press {
  id: string;
  group: string;
  x: number;
  y: number;
  started: boolean;
  pointer: number;
  mouse: boolean;
  last: { x: number; y: number } | null;
}

/**
 * Whether an event is the drag's own pointer's. A window has one mouse, whatever its id says (an event made by script
 * may carry none), so for a mouse's drag only a finger or a pen is another pointer.
 */
function ours(press: Press, event: globalThis.PointerEvent | PointerEvent<HTMLElement>): boolean {
  if (event.pointerId === press.pointer) return true;
  return press.mouse && event.pointerType !== 'touch' && event.pointerType !== 'pen';
}

/** `list` is read once, at the first render: pass a constant. */
export function useRowDrag(list: RowDragList, onDrop: (id: string, to: number) => void) {
  const [drag, setDrag] = useState<RowDrag | null>(null);
  // The drag as last drawn, for the release to read; a state updater must not do the drop (it may run twice).
  const latest = useRef<RowDrag | null>(null);
  // `pointer` is the one pointer driving it; `last` where it last was, for a scroll to place the drop again from.
  const pressed = useRef<Press | null>(null);
  const listRef = useRef(list);
  const dropRef = useRef(onDrop);
  useEffect(() => {
    dropRef.current = onDrop;
  }, [onDrop]);

  useEffect(() => {
    let frame: number | null = null;
    const stopScrolling = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };
    const cancel = () => {
      stopScrolling();
      pressed.current = null;
      latest.current = null;
      setDrag(null);
    };
    /** The drop placed again from where the pointer last was: after a move, and after the list scrolled under it. */
    const place = () => {
      const press = pressed.current;
      if (!press?.started || !press.last) return;
      latest.current = placeAt(listRef.current, press.group, press.id, press.last.x, press.last.y);
      setDrag(latest.current);
    };
    // Near the scrolling box's top or bottom edge, inside it, the box scrolls a step each frame, until the pointer
    // leaves the edge or the list's end is reached.
    const scrollStep = () => {
      frame = null;
      const press = pressed.current;
      const box = press?.started ? listRef.current.scroller?.(press.group) : null;
      if (!press?.last || !box) return;
      const view = box.getBoundingClientRect();
      const { x, y } = press.last;
      const inside = x >= view.left && x <= view.right && y >= view.top && y <= view.bottom;
      const way = !inside ? 0 : y < view.top + EDGE_PX ? -1 : y > view.bottom - EDGE_PX ? 1 : 0;
      if (way === 0) return;
      const before = box.scrollTop;
      box.scrollTop = before + way * SCROLL_STEP_PX;
      if (box.scrollTop === before) return;
      place();
      frame = requestAnimationFrame(scrollStep);
    };
    const move = (event: globalThis.PointerEvent) => {
      const press = pressed.current;
      if (!press || !ours(press, event)) return;
      // The release went somewhere this window never heard of (it lost focus mid-press): the drag is over.
      if ((event.buttons & 1) === 0) {
        cancel();
        return;
      }
      if (!press.started && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= THRESHOLD_PX) return;
      press.started = true;
      press.last = { x: event.clientX, y: event.clientY };
      place();
      frame ??= requestAnimationFrame(scrollStep);
    };
    const up = (event: globalThis.PointerEvent) => {
      const press = pressed.current;
      if (press && !ours(press, event)) return;
      const current = latest.current;
      cancel();
      if (press?.started && current) dropRef.current(current.id, current.to);
    };
    const lost = (event: globalThis.PointerEvent) => {
      const press = pressed.current;
      if (press && !ours(press, event)) return;
      cancel();
    };
    const scrolled = () => {
      place();
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
    window.addEventListener('pointercancel', lost);
    // So does the window losing focus: its pointerup may never arrive, and an armed drag would drop on the next click.
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
    // Any scroll under the pointer (the edge's, the wheel's, a script's): in the capture phase, as scroll doesn't bubble.
    window.addEventListener('scroll', scrolled, true);
    return () => {
      stopScrolling();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', lost);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', scrolled, true);
    };
  }, []);

  /** Handlers for a row's handle. */
  const handleProps = (id: string, group: string) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || (event.pointerType === 'touch' && listRef.current.touch !== true)) return;
      // Another pointer is already dragging: this one waits until that drag ends. (A press that never moved gives way.)
      if (pressed.current?.started && !ours(pressed.current, event)) return;
      // No text selection starts under the pointer while it drags.
      event.preventDefault();
      if (listRef.current.capture === true) {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // A pointer that is already gone: the window's own listeners still end the drag.
        }
      }
      pressed.current = { id, group, x: event.clientX, y: event.clientY, started: false, pointer: event.pointerId, mouse: event.pointerType === 'mouse', last: null };
    },
  });

  return { drag, handleProps };
}

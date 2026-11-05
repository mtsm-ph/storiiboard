import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

// Dragging frames and notes to a new place on the board (1.12), on pointer events like the tiles' own drag. A press
// that moves less than 4px is a click. While dragging, an ink bar shows where the item will land: before or after the
// frame under the pointer (left or right half in the grid and strip, top or bottom in the shot list), or at the end of
// a scene. Escape cancels. One drop is one move op group, so ⌘Z takes it back.

const THRESHOLD_PX = 4;

/** Where a dragged item lands: in a scene, before an item there, or at its end with null. */
export interface DropPlace {
  sceneId: string;
  beforeId: string | null;
}

interface Bar {
  left: number;
  top: number;
  /** Vertical in the grid and strip, horizontal in the shot list. */
  vertical: boolean;
  length: number;
}

export interface ItemDrag {
  id: string;
  label: string;
  x: number;
  y: number;
  place: DropPlace | null;
  bar: Bar | null;
}

/** The items of one scene in board order, as the board draws them. */
function sceneItems(sceneId: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-board] [data-item-id][data-scene-id="${CSS.escape(sceneId)}"]`)];
}

/** The box an item takes on the board: its card, or its row in the shot list. */
const boxOf = (element: HTMLElement) => (element.closest('tr') ?? element).getBoundingClientRect();

/** The item an element is part of: its card, or in the shot list any cell of its row. */
function itemOf(node: Element): HTMLElement | null {
  const own = node.closest<HTMLElement>('[data-item-id]');
  if (own) return own;
  return node.closest('tr')?.querySelector<HTMLElement>('[data-item-id]') ?? null;
}

/** The scene's item nearest a point, for a pointer in the gaps between cards. */
function nearestItem(sceneId: string, x: number, y: number, draggedId: string): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestDistance = Infinity;
  for (const node of sceneItems(sceneId)) {
    if (node.dataset.itemId === draggedId) continue;
    const box = boxOf(node);
    const dx = Math.max(box.left - x, 0, x - box.right);
    const dy = Math.max(box.top - y, 0, y - box.bottom);
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

function placeAt(x: number, y: number, draggedId: string, vertical: boolean): { place: DropPlace; bar: Bar } | null {
  const under = document.elementsFromPoint(x, y);
  const direct = under
    .map((node) => itemOf(node))
    .find((node): node is HTMLElement => node !== null && node.closest('[data-board]') !== null);
  const scene = under
    .map((node) => (node instanceof HTMLElement ? node.closest<HTMLElement>('[data-drop-scene]') : null))
    .find((node): node is HTMLElement => node !== null);
  // Over the scene's + Frame, its end; over its heading, its start. In a gap between cards (the 8px between rows
  // included), the nearest card in the same row decides (or in the shot list, the nearest row), so crossing a gap
  // doesn't jump to the scene's end; past the last card in a row that has none, the end again.
  const onAdd = under.some((node) => node instanceof HTMLElement && node.closest('[data-board-item]:not([data-item-id])'));
  const onHeading = !direct && under.some((node) => node instanceof HTMLElement && node.closest('[data-drop-scene] h3, [data-drop-scene] [data-heading-row]'));
  if (onHeading && scene?.dataset.dropScene) {
    const first = sceneItems(scene.dataset.dropScene).find((node) => node.dataset.itemId !== draggedId);
    if (first?.dataset.itemId) {
      const box = boxOf(first);
      const bar: Bar = vertical
        ? { left: box.left, top: box.top - 3.5, vertical: false, length: box.width }
        : { left: box.left - 5.5, top: box.top, vertical: true, length: box.height };
      return { place: { sceneId: scene.dataset.dropScene, beforeId: first.dataset.itemId }, bar };
    }
  }
  const nearest = !direct && !onAdd && scene?.dataset.dropScene ? nearestItem(scene.dataset.dropScene, x, y, draggedId) : null;
  const nearestBox = nearest ? boxOf(nearest) : null;
  const ROW_GAP = 8;
  const sameRow = nearestBox !== null && (vertical || (y >= nearestBox.top - ROW_GAP && y <= nearestBox.bottom + ROW_GAP));
  const item = direct ?? (sameRow ? nearest : null);
  if (item?.dataset.sceneId && item.dataset.itemId) {
    const sceneId = item.dataset.sceneId;
    const siblings = sceneItems(sceneId);
    const box = boxOf(item);
    const after = vertical ? y > box.top + box.height / 2 : x > box.left + box.width / 2;
    const beforeId = after ? (siblings[siblings.indexOf(item) + 1]?.dataset.itemId ?? null) : item.dataset.itemId;
    const bar: Bar = vertical
      ? { left: box.left, top: after ? box.bottom + 2 : box.top - 3.5, vertical: false, length: box.width }
      : { left: after ? box.right + 2 : box.left - 5.5, top: box.top, vertical: true, length: box.height };
    return item.dataset.itemId === draggedId ? null : { place: { sceneId, beforeId }, bar };
  }
  const sceneId = scene?.dataset.dropScene;
  if (!sceneId) return null;
  // Past the last item in a scene: its end, marked after the last item (or at the scene's + Frame when it has none).
  const last = sceneItems(sceneId).filter((node) => node.dataset.itemId !== draggedId).at(-1);
  const anchor = last ?? scene.querySelector<HTMLElement>('[data-board-item]');
  if (!anchor) return null;
  const box = boxOf(anchor);
  const bar: Bar = vertical
    ? { left: box.left, top: last ? box.bottom + 2 : box.top - 3.5, vertical: false, length: box.width }
    : { left: last ? box.right + 2 : box.left - 5.5, top: box.top, vertical: true, length: box.height };
  return { place: { sceneId, beforeId: null }, bar };
}

/** A move that would leave the item where it is. */
function staysPut(id: string, place: DropPlace): boolean {
  const element = document.querySelector<HTMLElement>(`[data-board] [data-item-id="${CSS.escape(id)}"]`);
  if (element?.dataset.sceneId !== place.sceneId) return false;
  const siblings = sceneItems(place.sceneId);
  const next = siblings[siblings.indexOf(element) + 1]?.dataset.itemId ?? null;
  return place.beforeId === id || place.beforeId === next;
}

export function useItemDrag(vertical: boolean, onDrop: (id: string, place: DropPlace) => void) {
  const [drag, setDrag] = useState<ItemDrag | null>(null);
  // The drag as last drawn, for the release to read; a state updater must not do the drop (it may run twice).
  const latest = useRef<ItemDrag | null>(null);
  const pressed = useRef<{ id: string; label: string; x: number; y: number; started: boolean } | null>(null);
  // The click that follows a drag's release isn't a click on the item.
  const swallowClick = useRef(false);
  // A drag cancelled with Escape: the release still to come swallows its click too.
  const cancelled = useRef(false);
  const dropRef = useRef(onDrop);
  useEffect(() => {
    dropRef.current = onDrop;
  }, [onDrop]);

  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      const press = pressed.current;
      if (!press) return;
      if (!press.started && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= THRESHOLD_PX) return;
      press.started = true;
      const found = placeAt(event.clientX, event.clientY, press.id, vertical);
      latest.current = { id: press.id, label: press.label, x: event.clientX, y: event.clientY, place: found?.place ?? null, bar: found?.bar ?? null };
      setDrag(latest.current);
    };
    // The click a release sends lands at once, in the same task, on the item or whatever holds both ends of the
    // drag; it's swallowed if it reaches an item, and the flag clears straight after, so the next click counts.
    const swallowNextClick = () => {
      swallowClick.current = true;
      setTimeout(() => {
        swallowClick.current = false;
      }, 0);
    };
    const cancel = () => {
      if (pressed.current?.started) cancelled.current = true;
      pressed.current = null;
      latest.current = null;
      setDrag(null);
    };
    const up = () => {
      const press = pressed.current;
      pressed.current = null;
      if (cancelled.current) {
        cancelled.current = false;
        swallowNextClick();
        return;
      }
      if (!press?.started) return;
      swallowNextClick();
      const current = latest.current;
      latest.current = null;
      setDrag(null);
      if (current?.place && !staysPut(current.id, current.place)) dropRef.current(current.id, current.place);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !pressed.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    // A pointer the system takes away (a gesture, a window switch) cancels the drag; it never drops.
    const lost = () => {
      cancel();
      cancelled.current = false;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', lost);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', lost);
      window.removeEventListener('keydown', key, true);
    };
  }, [vertical]);

  /** Handlers for an item that can be dragged. */
  const dragHandlers = (id: string, label: string) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      // A release that never came after an Escape mustn't count against this press.
      cancelled.current = false;
      if (event.button !== 0 || event.pointerType === 'touch') return;
      pressed.current = { id, label, x: event.clientX, y: event.clientY, started: false };
    },
    onClickCapture: (event: MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  });

  return { drag, dragHandlers };
}

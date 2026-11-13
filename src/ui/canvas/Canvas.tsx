import type Konva from 'konva';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Group, Layer, Rect, Stage, Transformer } from 'react-konva';
import { t, tn } from '../../core/i18n';
import { cx } from '../cx';
import { CanvasMenu } from './CanvasMenu';
import { boundsOf, marqueeTouches, rectFromCorners, topmostAt } from './hitTest';
import { commandForKey, isCommand, toolForKey, zoomShortcut, zoomStepFor } from './keys';
import { Minimap } from './Minimap';
import { atLeastMinimum, MIN_SIZE, normalisedRotation, nudgeFor, placedAt, tidy } from './placement';
import type { CanvasCommand, CanvasItem, Geometry, GeometryChange, Point, Rect as WorldRect, Size, Tool, Viewport } from './types';
import { useCanvasColours } from './useCanvasColours';
import { centreOn, fitBounds, panBy, rectsMeet, toWorld, unionBounds, visibleWorld, zoomAround } from './viewport';

// The canvas core (decision 11): a react-konva stage that pans, zooms, selects, moves, resizes and rotates rectangles in
// world units and reports each finished gesture, never a half-done one. It knows nothing of boards: the host gives it
// items (back to front), the selection, the tool and the view, and turns what comes back into edits.
//
// Gestures are worked out here from pointer events and the pure modules beside this file (viewport, hitTest, placement),
// not from Konva's own dragging, so several items move as one and a click is never a one-unit drag. Konva draws, and its
// Transformer does the handles. Only the items whose bounds meet the view are drawn (5.7 does the rest of the performance
// work).

const ARROW_PAN = 48;
const ARROW_PAN_LONG = 192;
const ZOOM_STEP = 1.25;
const MENU_WIDTH = 212;
const MENU_HEIGHT = 330;
const WHEEL_ZOOM = 0.004;
const DRAG_THRESHOLD = 3;
const BUTTON = 'sb-label flex h-7 items-center justify-center px-2.5 focus-visible:-outline-offset-4';
const ZOOM_BUTTON = cx(BUTTON, 'text-text hover:bg-surface-raised');
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const ALL_ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-right', 'bottom-right', 'bottom-center', 'bottom-left', 'middle-left'];
const ROTATION_SNAPS = Array.from({ length: 24 }, (_, i) => i * 15);

type Gesture =
  | { kind: 'pan'; last: Point }
  | { kind: 'move'; start: Point; screen: Point; origins: Map<string, Geometry>; moved: boolean; collapseTo: string | null }
  | { kind: 'marquee'; start: Point; screen: Point; base: string[]; moved: boolean }
  | { kind: 'draw'; start: Point; screen: Point; moved: boolean };

export interface CanvasProps {
  /** The board's name: the container's label. */
  label: string;
  /** Back to front: the first is drawn at the back. */
  items: readonly CanvasItem[];
  selection: readonly string[];
  onSelectionChange: (ids: string[]) => void;
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  viewport: Viewport;
  onViewportChange: (view: Viewport) => void;
  /** A finished move, resize, rotate or nudge: every item it changed, once. May resolve when the edit is written. */
  onGeometry: (changes: GeometryChange[]) => unknown;
  /** An arrow key's nudge, as a distance: the host adds it to the items as they are when the edit is written. */
  onNudge: (ids: string[], dx: number, dy: number) => unknown;
  /** A rectangle drawn, clicked into place or placed with Enter. */
  onCreate: (geometry: Geometry) => unknown;
  onCommand: (command: CanvasCommand) => void;
  /** Whether Paste has something to paste (the host keeps the clipboard). */
  canPaste: boolean;
}

const isMac = () => typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

/** The GestureEvent WebKit sends for a trackpad pinch. */
interface PinchEvent extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}

export function Canvas({
  label,
  items,
  selection,
  onSelectionChange,
  tool,
  onToolChange,
  viewport,
  onViewportChange,
  onGeometry,
  onNudge,
  onCreate,
  onCommand,
  canPaste,
}: CanvasProps) {
  const colours = useCanvasColours();
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const transformer = useRef<Konva.Transformer>(null);
  const nodes = useRef(new Map<string, Konva.Group>());
  const gesture = useRef<Gesture | null>(null);
  const space = useRef(false);
  // The pointer's place on the canvas in screen pixels: turned into world units when a paste needs it, so a view that
  // moved under a still pointer (a scroll) pastes where the pointer is now.
  const pointer = useRef<Point | null>(null);
  // Counts the commits and the moves begun, so only the latest gesture's finished write clears the drawing's hold.
  const generation = useRef(0);
  const [size, setSize] = useState<Size>({ width: 640, height: 400 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [shift, setShift] = useState(false);
  const [draft, setDraft] = useState<ReadonlyMap<string, Geometry> | null>(null);
  const [preview, setPreview] = useState<{ kind: 'marquee' | 'draw'; rect: WorldRect } | null>(null);
  const [menu, setMenu] = useState<{ at: Point; world: Point } | null>(null);
  const [minimap, setMinimap] = useState(false);
  const describedBy = useId();

  const shown = useMemo(() => items.map((item) => ({ ...item, ...(draft?.get(item.id) ?? item) })), [items, draft]);
  const view = viewport;
  const world = visibleWorld(view, size);
  // What is drawn: the items that meet the view, and always the selected ones, so the handles have every node.
  const pickedSet = new Set(selection);
  const drawn = shown.filter((item) => pickedSet.has(item.id) || rectsMeet(boundsOf(item), world));
  const handleIds = tool === 'select' ? selection.filter((id) => drawn.some((item) => item.id === id)) : [];
  const handleKey = handleIds.join('|');
  // Konva turns a group resized from the side handles into a skew once the items are turned differently: with mixed
  // rotations only the corners work, and they keep the proportions.
  // A group's box is axis-aligned, so it also counts when any item is turned off the right angles: stretching those
  // unevenly would skew them, and on release the saved rotation would change.
  const turned = handleIds.map((id) => shown.find((item) => item.id === id)?.rotation ?? 0);
  const mixed = handleIds.length > 1 && (new Set(turned).size > 1 || turned.some((r) => r % 90 !== 0));

  // What the handlers read, as it is now: they are set up once and must never act on an old view.
  const latest = useRef({ items, shown, selection, tool, viewport, size, draft, onViewportChange });
  useLayoutEffect(() => {
    latest.current = { items, shown, selection, tool, viewport, size, draft, onViewportChange };
  });

  // The canvas follows the tile's size.
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      setSize({ width: Math.max(80, Math.round(element.clientWidth)), height: Math.max(80, Math.round(element.clientHeight)) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const local = (event: { clientX: number; clientY: number }): Point => {
    const box = frame.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };
  const worldOf = (screen: Point): Point => toWorld(latest.current.viewport, latest.current.size, screen);

  // Shift snaps a rotation to 15 degrees and keeps the proportions in a resize.
  useEffect(() => {
    const track = (event: KeyboardEvent) => {
      setShift(event.shiftKey);
    };
    const clear = () => {
      setShift(false);
      space.current = false;
      setSpaceHeld(false);
    };
    window.addEventListener('keydown', track);
    window.addEventListener('keyup', track);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', track);
      window.removeEventListener('keyup', track);
      window.removeEventListener('blur', clear);
    };
  }, []);

  // The wheel and a trackpad pinch. Native listeners, since React's wheel handler is passive and can't stop the page
  // zooming. Chromium sends a pinch as Ctrl + wheel; WebKit sends gesturestart and gesturechange (and may send the
  // wheel too, which is ignored between gesturestart and gestureend so it doesn't zoom twice). Set up once: everything
  // it reads comes through `latest`, so a gesture in progress never loses its start zoom.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const at = (event: { clientX: number; clientY: number }): Point => {
      const box = element.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    let startZoom = 1;
    let pinching = false;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { viewport: view, size: box, onViewportChange: change } = latest.current;
      const lines = event.deltaMode === 1 ? 16 : 1;
      if (event.ctrlKey || event.metaKey) {
        if (pinching) return;
        change(zoomAround(view, box, view.zoom * Math.exp(-event.deltaY * lines * WHEEL_ZOOM), at(event)));
      } else if (event.shiftKey && event.deltaX === 0) {
        change(panBy(view, -event.deltaY * lines, 0));
      } else {
        change(panBy(view, -event.deltaX * lines, -event.deltaY * lines));
      }
    };
    const onPinchStart = (event: Event) => {
      event.preventDefault();
      pinching = true;
      startZoom = latest.current.viewport.zoom;
    };
    const onPinch = (event: Event) => {
      event.preventDefault();
      const pinch = event as PinchEvent;
      const { viewport: view, size: box, onViewportChange: change } = latest.current;
      change(zoomAround(view, box, startZoom * pinch.scale, at(pinch)));
    };
    const onPinchEnd = (event: Event) => {
      event.preventDefault();
      pinching = false;
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('gesturestart', onPinchStart);
    element.addEventListener('gesturechange', onPinch);
    element.addEventListener('gestureend', onPinchEnd);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('gesturestart', onPinchStart);
      element.removeEventListener('gesturechange', onPinch);
      element.removeEventListener('gestureend', onPinchEnd);
    };
  }, []);

  // The handles are given their nodes only when the picked ones change: Konva detaches and resets a transform in
  // progress when its nodes are set again (pressing Shift mid-turn would do it).
  useLayoutEffect(() => {
    const tr = transformer.current;
    if (!tr) return;
    tr.nodes(handleIds.map((id) => nodes.current.get(id)).filter((n): n is Konva.Group => n !== undefined));
    tr.getLayer()?.batchDraw();
    // handleIds is read through its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleKey]);
  // And follow the items when they move or are resized under the handles (a nudge, an undo, a drag's draft).
  useLayoutEffect(() => {
    const tr = transformer.current;
    if (!tr || tr.nodes().length === 0) return;
    tr.forceUpdate();
    tr.getLayer()?.batchDraw();
  }, [shown]);

  const commit = (real: GeometryChange[]) => {
    generation.current += 1;
    if (real.length === 0) {
      setDraft(null);
      return;
    }
    const mine = generation.current;
    setDraft(new Map(real.map((c) => [c.id, c])));
    // The drawing holds the new place until the edit is written and the records say the same; a later gesture's own
    // hold is not let go by this one finishing. Whether it changes anything is the host's to say when it writes, from
    // the records as they are then (a change that equals them writes no step).
    void Promise.resolve(onGeometry(real)).finally(() => {
      if (generation.current === mine) setDraft(null);
    });
  };

  const onTransformEnd = () => {
    const changes: GeometryChange[] = [];
    for (const item of latest.current.items) {
      const node = nodes.current.get(item.id);
      if (!node || !latest.current.selection.includes(item.id)) continue;
      const g = latest.current.draft?.get(item.id) ?? item;
      const width = tidy(atLeastMinimum(g.width * node.scaleX()));
      const height = tidy(atLeastMinimum(g.height * node.scaleY()));
      // The node's position is its middle (it is offset by half its size), whatever the handles did.
      changes.push({ id: item.id, x: tidy(node.x() - width / 2), y: tidy(node.y() - height / 2), width, height, rotation: normalisedRotation(node.rotation()) });
      node.scale({ x: 1, y: 1 });
      node.skew({ x: 0, y: 0 });
    }
    commit(changes);
  };

  const fitView = (which: 'all' | 'selection') => {
    const pool = which === 'all' ? latest.current.shown : latest.current.shown.filter((i) => latest.current.selection.includes(i.id));
    // Fitting the selection with nothing selected does nothing.
    if (which === 'selection' && pool.length === 0) return;
    onViewportChange(fitBounds(unionBounds(pool.map(boundsOf)), latest.current.size));
  };

  const zoomTo = (zoom: number) => {
    const { viewport: view, size: box } = latest.current;
    onViewportChange(zoomAround(view, box, zoom, { x: box.width / 2, y: box.height / 2 }));
  };

  const cancelGesture = () => {
    const g = gesture.current;
    gesture.current = null;
    setPanning(false);
    setPreview(null);
    // Only a drag that began its own hold lets it go: a pending write's hold is not this gesture's to drop.
    if (g?.kind === 'move' && g.moved) setDraft(null);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget && !(event.target instanceof HTMLCanvasElement)) return;
    if (event.button === 2) return;
    frame.current?.focus({ preventScroll: true });
    const screen = local(event);
    // The handles are Konva's: it resizes and rotates, and tells us when it is done.
    const hit = stage.current?.getIntersection(screen);
    if (hit?.findAncestor('Transformer')) return;
    if (event.button === 1 || space.current || latest.current.tool === 'hand') {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { kind: 'pan', last: screen };
      setPanning(true);
      return;
    }
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const world = worldOf(screen);
    const { shown: all, selection: picked, tool: current } = latest.current;
    if (current === 'rect') {
      gesture.current = { kind: 'draw', start: world, screen, moved: false };
      return;
    }
    const top = topmostAt(all, world);
    if (top) {
      if (event.shiftKey) {
        // Shift adds or removes; a removed item isn't dragged.
        const next = picked.includes(top.id) ? picked.filter((id) => id !== top.id) : [...picked, top.id];
        onSelectionChange(next);
        if (!next.includes(top.id)) return;
        gesture.current = { kind: 'move', start: world, screen, origins: new Map(all.filter((i) => next.includes(i.id)).map((i) => [i.id, i as Geometry])), moved: false, collapseTo: null };
        return;
      }
      const inSelection = picked.includes(top.id);
      const ids = inSelection ? [...picked] : [top.id];
      if (!inSelection) onSelectionChange(ids);
      gesture.current = {
        kind: 'move',
        start: world,
        screen,
        origins: new Map(all.filter((i) => ids.includes(i.id)).map((i) => [i.id, i as Geometry])),
        moved: false,
        // A click on one of several selected, without a drag, selects just that one.
        collapseTo: inSelection && picked.length > 1 ? top.id : null,
      };
      return;
    }
    if (!event.shiftKey) onSelectionChange([]);
    gesture.current = { kind: 'marquee', start: world, screen, base: event.shiftKey ? [...picked] : [], moved: false };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const screen = local(event);
    const world = worldOf(screen);
    pointer.current = screen;
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pan') {
      onViewportChange(panBy(latest.current.viewport, screen.x - g.last.x, screen.y - g.last.y));
      g.last = screen;
      return;
    }
    if (!g.moved && Math.hypot(screen.x - g.screen.x, screen.y - g.screen.y) < DRAG_THRESHOLD) return;
    if (!g.moved && g.kind === 'move') generation.current += 1;
    g.moved = true;
    if (g.kind === 'move') {
      const dx = tidy(world.x - g.start.x);
      const dy = tidy(world.y - g.start.y);
      setDraft(new Map([...g.origins].map(([id, o]) => [id, { ...o, x: tidy(o.x + dx), y: tidy(o.y + dy) }])));
    } else {
      setPreview({ kind: g.kind, rect: rectFromCorners(g.start, world) });
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    setPanning(false);
    if (!g || g.kind === 'pan') return;
    const world = worldOf(local(event));
    if (g.kind === 'move') {
      if (!g.moved) {
        if (g.collapseTo) onSelectionChange([g.collapseTo]);
        return;
      }
      const dx = tidy(world.x - g.start.x);
      const dy = tidy(world.y - g.start.y);
      commit([...g.origins].map(([id, o]) => ({ id, ...o, x: tidy(o.x + dx), y: tidy(o.y + dy) })));
    } else if (g.kind === 'marquee') {
      setPreview(null);
      if (!g.moved) return;
      const box = rectFromCorners(g.start, world);
      const touched = latest.current.shown.filter((item) => marqueeTouches(item, box)).map((item) => item.id);
      onSelectionChange([...new Set([...g.base, ...touched])]);
    } else {
      setPreview(null);
      const box = rectFromCorners(g.start, world);
      // Only a click (under 3 px) places the standard rectangle; any drag draws what was dragged, at least 8 a side.
      void onCreate(
        g.moved
          ? { x: tidy(box.x), y: tidy(box.y), width: tidy(Math.max(MIN_SIZE, box.width)), height: tidy(Math.max(MIN_SIZE, box.height)), rotation: 0 }
          : placedAt(g.start),
      );
      onToolChange('select');
    }
  };

  // The menu stays inside the canvas, whichever way it was opened.
  const openMenu = (screen: Point, worldPoint = worldOf(screen)) => {
    const { size: box } = latest.current;
    setMenu({ at: { x: Math.max(0, Math.min(screen.x, box.width - MENU_WIDTH)), y: Math.max(0, Math.min(screen.y, box.height - MENU_HEIGHT)) }, world: worldPoint });
  };

  const closeMenu = useCallback(() => {
    setMenu(null);
    frame.current?.focus({ preventScroll: true });
  }, []);

  const runCommand = (command: CanvasCommand) => {
    // A paste from the menu lands where the menu was opened.
    onCommand(command.kind === 'paste' && command.at === null && menu ? { kind: 'paste', at: menu.world } : command);
  };

  const cycle = (direction: 1 | -1) => {
    const ids = latest.current.items.map((i) => i.id);
    if (ids.length === 0) return;
    const picked = ids.map((id, i) => (latest.current.selection.includes(id) ? i : -1)).filter((i) => i >= 0);
    const from = direction === 1 ? Math.max(...picked) : Math.min(...picked);
    const next = ids[(from + direction + ids.length) % ids.length];
    if (next === undefined) return;
    onSelectionChange([next]);
    // An item out of view is brought into it.
    const item = latest.current.shown.find((i) => i.id === next);
    const { viewport: now, size: box } = latest.current;
    if (item && !rectsMeet(boundsOf(item), visibleWorld(now, box))) {
      const b = boundsOf(item);
      onViewportChange(centreOn(now, { x: b.x + b.width / 2, y: b.y + b.height / 2 }));
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Keys pressed on the buttons inside (zoom, minimap, the menu) are theirs.
    if (event.target !== event.currentTarget) return;
    const mac = isMac();
    const modifiers = event.metaKey || event.ctrlKey || event.altKey;
    const picked = latest.current.selection;
    if (event.key === ' ' && !modifiers) {
      event.preventDefault();
      space.current = true;
      setSpaceHeld(true);
      return;
    }
    if (event.key === 'Tab' && !modifiers && picked.length > 0) {
      event.preventDefault();
      cycle(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelGesture();
      onSelectionChange([]);
      if (latest.current.tool !== 'select') onToolChange('select');
      return;
    }
    if ((event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) && !modifiers) {
      event.preventDefault();
      const { shown: all, viewport: view, size: box } = latest.current;
      const bounds = unionBounds(all.filter((i) => picked.includes(i.id)).map(boundsOf));
      const centre = bounds ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : { x: view.cx, y: view.cy };
      const screen = bounds ? { x: (centre.x - view.cx) * view.zoom + box.width / 2, y: (centre.y - view.cy) * view.zoom + box.height / 2 } : { x: box.width / 2, y: box.height / 2 };
      openMenu(screen, centre);
      return;
    }
    if (isCommand(event, mac) && event.key.toLowerCase() === 'a' && !event.shiftKey) {
      event.preventDefault();
      onSelectionChange(latest.current.items.map((i) => i.id));
      return;
    }
    const command = commandForKey(event, mac, pointer.current ? worldOf(pointer.current) : null);
    if (command) {
      event.preventDefault();
      // A held key would delete or paste again and again.
      if (event.repeat && (command.kind === 'delete' || command.kind === 'paste' || command.kind === 'duplicate' || command.kind === 'cut')) return;
      if (command.kind === 'paste' || picked.length > 0) onCommand(command);
      return;
    }
    const zoomKey = zoomShortcut(event);
    if (zoomKey) {
      event.preventDefault();
      if (zoomKey === 'actual') zoomTo(1);
      else fitView(zoomKey);
      return;
    }
    const step = zoomStepFor(event);
    if (step !== 0) {
      event.preventDefault();
      zoomTo(latest.current.viewport.zoom * (step === 1 ? ZOOM_STEP : 1 / ZOOM_STEP));
      return;
    }
    if (!modifiers) {
      const arrow = nudgeFor(event.key, event.shiftKey);
      if (arrow) {
        event.preventDefault();
        if (picked.length > 0) {
          // One group per key press.
          void onNudge([...picked], arrow.x, arrow.y);
        } else {
          const by = event.shiftKey ? ARROW_PAN_LONG : ARROW_PAN;
          onViewportChange(panBy(latest.current.viewport, -arrow.x * by, -arrow.y * by));
        }
        return;
      }
      if (event.key === 'Enter' && latest.current.tool === 'rect') {
        event.preventDefault();
        const { viewport: view } = latest.current;
        void onCreate(placedAt({ x: view.cx, y: view.cy }));
        onToolChange('select');
        return;
      }
      const next = toolForKey(event);
      if (next) {
        event.preventDefault();
        onToolChange(next);
      }
    }
  };

  const cursor = panning ? 'grabbing' : spaceHeld || tool === 'hand' ? 'grab' : tool === 'rect' ? 'crosshair' : 'default';
  const percent = Math.round(view.zoom * 100);
  const live =
    selection.length === 0
      ? ''
      : selection.length === 1
        ? t('canvas.selectedAt', { label: items.find((i) => i.id === selection[0])?.label ?? '', n: items.findIndex((i) => i.id === selection[0]) + 1, total: items.length })
        : tn('canvas.itemsSelected', selection.length);
  const data = useMemo(() => JSON.stringify(items.map(({ id, x, y, width, height, rotation }) => ({ id, x, y, width, height, rotation }))), [items]);
  const chosen = useMemo(() => JSON.stringify(selection), [selection]);

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- an application region: it takes the canvas's own keys and pointer
    <div
      ref={frame}
      role="application"
      aria-label={label}
      aria-describedby={describedBy}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the canvas is one focus stop, as the crop editor is
      tabIndex={0}
      data-canvas=""
      data-zoom={view.zoom}
      data-cx={view.cx}
      data-cy={view.cy}
      // What is drawn, as plain data: the canvas itself is pixels, so the end-to-end tests read the board from here.
      data-items={data}
      data-selection={chosen}
      data-tool={tool}
      style={{ cursor }}
      className="relative h-full min-h-60 w-full touch-none overflow-hidden bg-surface select-none focus-visible:-outline-offset-4"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancelGesture}
      onPointerLeave={() => {
        pointer.current = null;
      }}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key === ' ') {
          space.current = false;
          setSpaceHeld(false);
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          space.current = false;
          setSpaceHeld(false);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        // The menu key's own contextmenu event (no right button) is handled by its keydown: it would reopen the menu
        // at the top left.
        if (event.button !== 2 && !event.ctrlKey) return;
        const screen = local(event);
        const top = topmostAt(latest.current.shown, worldOf(screen));
        if (top && !latest.current.selection.includes(top.id)) onSelectionChange([top.id]);
        openMenu(screen);
      }}
    >
      <p id={describedBy} className="sr-only">
        {t('canvas.keys')}
      </p>
      <p role="status" className="sr-only">
        {live}
      </p>
      <Stage ref={stage} width={size.width} height={size.height} listening>
        <Layer x={size.width / 2 - view.cx * view.zoom} y={size.height / 2 - view.cy * view.zoom} scaleX={view.zoom} scaleY={view.zoom}>
          {drawn.map((item) => (
            <Group
              key={item.id}
              ref={(node) => {
                if (node) nodes.current.set(item.id, node);
                else nodes.current.delete(item.id);
              }}
              x={item.x + item.width / 2}
              y={item.y + item.height / 2}
              offsetX={item.width / 2}
              offsetY={item.height / 2}
              width={item.width}
              height={item.height}
              rotation={item.rotation}
              listening={false}
            >
              {item.draw ? (
                item.draw({ width: item.width, height: item.height, colours })
              ) : (
                <Rect width={item.width} height={item.height} fill={colours.raised} stroke={colours.ink} strokeWidth={1.5} strokeScaleEnabled={false} />
              )}
            </Group>
          ))}
          {preview && (
            <Rect
              x={preview.rect.x}
              y={preview.rect.y}
              width={preview.rect.width}
              height={preview.rect.height}
              stroke={colours.ink}
              strokeWidth={1.5}
              strokeScaleEnabled={false}
              dash={preview.kind === 'marquee' ? [4, 3] : []}
              listening={false}
            />
          )}
          <Transformer
            ref={transformer}
            flipEnabled={false}
            // Shift keeps the proportions (Konva's own rule when this is off), and snaps a turn to 15 degrees.
            keepRatio={mixed}
            enabledAnchors={mixed ? CORNERS : ALL_ANCHORS}
            ignoreStroke
            anchorSize={8}
            anchorCornerRadius={0}
            anchorFill={colours.ink}
            anchorStroke={colours.paper}
            anchorStrokeWidth={1}
            borderStroke={colours.ink}
            borderStrokeWidth={1.5}
            rotateAnchorOffset={24}
            rotationSnaps={shift ? ROTATION_SNAPS : []}
            rotationSnapTolerance={shift ? 7.5 : 0}
            boundBoxFunc={(was, next) => (next.width < MIN_SIZE * view.zoom || next.height < MIN_SIZE * view.zoom ? was : next)}
            onTransformEnd={onTransformEnd}
          />
        </Layer>
      </Stage>
      <div className="absolute bottom-2 left-2 flex items-center border border-text bg-surface">
        <button type="button" aria-label={t('canvas.zoomOut')} className={ZOOM_BUTTON} onClick={() => { zoomTo(view.zoom / ZOOM_STEP); }}>
          −
        </button>
        <button type="button" aria-label={t('canvas.zoomReset', { percent })} className={cx(ZOOM_BUTTON, 'min-w-14 font-mono')} onClick={() => { zoomTo(1); }}>
          {percent}%
        </button>
        <button type="button" aria-label={t('canvas.zoomIn')} className={ZOOM_BUTTON} onClick={() => { zoomTo(view.zoom * ZOOM_STEP); }}>
          +
        </button>
        <button type="button" className={ZOOM_BUTTON} onClick={() => { fitView('all'); }}>
          {t('canvas.fitAll')}
        </button>
      </div>
      <div className="absolute right-2 bottom-2 flex flex-col items-end gap-1">
        {minimap && (
          <Minimap
            items={shown}
            view={view}
            size={size}
            onCentre={(centre) => {
              onViewportChange(centreOn(view, centre));
            }}
          />
        )}
        <button
          type="button"
          aria-pressed={minimap}
          // Selection is an ink fill; the text on it is the inverse, never two text colours at once.
          className={cx(BUTTON, 'border border-text', minimap ? 'bg-text font-bold text-text-inverse focus-visible:outline-text-inverse' : 'bg-surface text-text hover:bg-surface-raised')}
          onClick={() => { setMinimap((on) => !on); }}
        >
          {t('canvas.minimap')}
        </button>
      </div>
      {menu && (
        <CanvasMenu
          at={menu.at}
          hasSelection={selection.length > 0}
          canPaste={canPaste}
          mac={isMac()}
          onCommand={runCommand}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

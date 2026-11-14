import type Konva from 'konva';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Circle, Layer, Line, Rect, Shape, Stage, Transformer } from 'react-konva';
import { t, tn } from '../../core/i18n';
import { cx } from '../cx';
import { CanvasMenu } from './CanvasMenu';
import { boundsFor, boundsOf, rectFromCorners, topmostAt } from './hitTest';
import { arrangeForKey, commandForKey, hostToolForKey, isCommand, quickSideFor, toolForKey, zoomShortcut, zoomStepFor, type KeyLike } from './keys';
import { ItemNodes, type RegisterNode } from './ItemNodes';
import { createZoomSettle } from './zoomSettle';
import { anchorOf, resolveLinks, type RouteEntry } from './resolveLinks';
import { LinkShape, type ResolvedLink } from './LinkShapes';
import { Minimap } from './Minimap';
import { PASTE_WAIT, pasteEventSeen, pasteStep, waitFoundNoEvent } from './pasteFallback';
import { atLeastMinimum, MIN_SIZE, normalisedRotation, nudgeFor, placedAt, tidy } from './placement';
import { drawOrder, sectionContents, tabRect, topmostSectionAt } from './sections';
import { mergeGuides, snapMove, snapPoint, type Guide } from './snapping';
import { pathBounds, pathHits, pathMiddle, pathTouchesRect, PICK_DISTANCE, routeBetween, sideMidpoint, sideNormal, SIDES, snapEnd } from './routing';
import { itemAt, marqueePicks, menuPickAt, pickable, pickOrder } from './picking';
import { END_SNAP, nextPoint, NO_MODS, pathAngle, runClick, runKey, runPoints, runStart, toolEndsRun, type PathDraft, type PathMods } from './pathRun';
import { Rulers, RULER_SIZE } from './Rulers';
import { gridLines, gridPull, pointAlong, scaleBarLength, snapMoveByPoints, snapToGrid, type GridSnap } from './scale';
import {
  isAttached,
  isHostTool,
  isPlaceTool,
  type CanvasColours,
  type CanvasCommand,
  type CanvasItem,
  type CanvasLink,
  type CanvasScale,
  type ConnectDrop,
  type Geometry,
  type GeometryChange,
  type HostToolId,
  type LinkEnd,
  type PlaceTool,
  type Point,
  type Rect as WorldRect,
  type Side,
  type Size,
  type Tool,
  type ToolSpec,
  type Viewport,
  type ZoomLimits,
} from './types';
import { useCanvasColours } from './useCanvasColours';
import { BOARD_ZOOM, centreOn, FIT_PADDING, fitBounds, panBy, rectsMeet, toScreen, toWorld, unionBounds, visibleWorld, zoomAround } from './viewport';

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
const WHEEL_ZOOM = 0.004;
/** How long the zoom holds still before the items are drawn for it (pictures change size with it). */
const ZOOM_SETTLE = 150;
/** A zoom that follows a wheel or pinch this soon is theirs: it settles; any other zoom is a jump. */
const WHEEL_WINDOW = 250;
const DRAG_THRESHOLD = 3;
const BUTTON = 'sb-label flex h-7 items-center justify-center px-2.5 focus-visible:-outline-offset-4';
const ZOOM_BUTTON = cx(BUTTON, 'text-text hover:bg-surface-raised');
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const ALL_ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-right', 'bottom-right', 'bottom-center', 'bottom-left', 'middle-left'];
const ROTATION_SNAPS = Array.from({ length: 24 }, (_, i) => i * 15);
/** The "+" handles of a quick connected copy (5.2) sit this far outside a side, in screen pixels; the rotate handle is further. */
const QUICK_OFFSET = 13;
const QUICK_SIZE = 12;
/** How near (screen pixels) the pointer must be to a selected connector's end to take it. */
const END_GRAB = 9;
/** A section's name is typed in room for this many world units at least, however short the name was. */
const EDITING_NAME_WIDTH = 180;
/** The grid's light and strong lines (6.2a): ink this strong on the paper. */
const GRID_LIGHT = 0.1;
const GRID_STRONG = 0.24;
const QUICK_LABEL: Readonly<Record<Side, () => string>> = {
  top: () => t('canvas.quick.top'),
  right: () => t('canvas.quick.right'),
  bottom: () => t('canvas.quick.bottom'),
  left: () => t('canvas.quick.left'),
};

type Gesture =
  | { kind: 'pan'; last: Point }
  // `origins` is everything that moves (a section's contents too); `lead` the ones picked, which snap, and `targets` the lines they snap to.
  // `anchors` (6.2a): the lead's own snap points where they started (null when none gives them), and `anchorTargets` the other items' they join.
  | { kind: 'move'; start: Point; screen: Point; origins: Map<string, Geometry>; lead: string[]; targets: WorldRect[] | null; moved: boolean; collapseTo: string | null; anchors?: Point[] | null; anchorTargets?: Point[] }
  | { kind: 'marquee'; start: Point; screen: Point; base: string[]; moved: boolean }
  | { kind: 'draw'; tool: PlaceTool | HostToolId; start: Point; screen: Point; targets: WorldRect[] | null; moved: boolean }
  // A connector drawn (the tool, or a "+" handle) or one of its ends dragged: `fixed` stays, the other end follows the pointer.
  | { kind: 'connect'; id: string | null; fixed: LinkEnd; moving: 'from' | 'to'; screen: Point; moved: boolean; quick: string | null; quickSide: Side | null };

/** A connector being drawn or re-ended: the ends as the pointer makes them, and the side it would join. */
interface ConnectDraft {
  id: string | null;
  from: LinkEnd;
  to: LinkEnd;
  mark: Point | null;
}

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
  /** An item drawn, clicked into place or placed with Enter (`by` the key: 6.2b), by the tool that placed it. */
  onCreate: (geometry: Geometry, tool: PlaceTool | HostToolId, by?: 'pointer' | 'key') => unknown;
  /** Enter or a double-click on an editable item (text, sticky): the host edits it in place. */
  onEdit?: (id: string) => void;
  /** The item being edited in place, if any: the host draws its editor over it (renderEditor). */
  editing?: string | null;
  /** The editor for the item being edited, given the zoom; it fills the item's box on screen, turned as the item is. */
  renderEditor?: (item: CanvasItem, zoom: number) => ReactNode;
  /** Enter or a double-click on an openable item (a video card, a link card): the host opens it. */
  onOpen?: (id: string) => void;
  /**
   * Something pasted into the focused canvas (⌘V): the system clipboard's data, and where the pointer is in world units
   * (null when it's off the canvas). True when the host took it (a picture, an address); otherwise the canvas pastes
   * the items it copied.
   */
  onPasteData?: (data: DataTransfer, at: Point | null) => boolean;
  /**
   * The items were copied or cut: the host marks the system clipboard as the app's own (so a stale address or picture
   * there can't win over them), in the copy event's data when there is one, else best effort with none.
   */
  onSystemCopy?: (data: DataTransfer | null, native: Event | null) => void;
  onCommand: (command: CanvasCommand) => void;
  /** The connectors (5.2), back to front: drawn under the items, picked within 6 px of their path, each end following its item live. */
  links?: readonly CanvasLink[];
  /** A connector drawn, or one of its ends dragged, finished (the host writes it). */
  onConnect?: (drop: ConnectDrop) => unknown;
  /** The "+" handle on a quick-create item, or ⌘⌥ + an arrow: make a connected copy on that side (the host does it). */
  onQuickCreate?: (id: string, side: Side) => void;
  /** Whether Paste has something to paste (the host keeps the clipboard). */
  canPaste: boolean;
  /** What the last layout command did, in words ("Aligned 3 items left"): read out in place of the selection until that changes. */
  announcement?: string;
  /**
   * Fixed colours for the world, the items' defaults, the selection and the handles, in place of the theme's: a host
   * whose content is never themed (a board) gives its own paper and ink. The controls around the canvas still follow the theme.
   */
  fixedColours?: CanvasColours;
  /** A host's own tools (6.2a): their letters take the place of a board's. */
  tools?: readonly ToolSpec[];
  /** A real scale (6.2a): a grid, rulers and a scale bar, grid snapping, and the scale bar as the zoom label. */
  scale?: CanvasScale;
  /** How far the view zooms (a board's 10% to 800% without). */
  zoomLimits?: ZoomLimits;
  /**
   * A point-to-point tool's run finished (Enter, a double-click, Escape, another tool, or the canvas going away: a host
   * keys its canvas per view, so a run never outlives the view it began in): its fixed points, two or more, world units.
   * A run's clicks join the items' `snapPoints`.
   */
  onPath?: (points: Point[], tool: HostToolId) => unknown;
  /**
   * Where a move puts what it moves (6.2b, a plan's doors and windows): the moving items' geometry as the pointer and
   * the snapping made it, and how it snaps (Alt fine, ⌘ or Ctrl off); the host gives back what is drawn and written in
   * its place, which may hold items moving with them (an opening on a moving wall). Without it, a move is as made.
   */
  constrainMove?: (moving: ReadonlyMap<string, Geometry>, snap: GridSnap) => ReadonlyMap<string, Geometry>;
  /** The pointer over the canvas with no gesture under way, world units; null once it leaves (6.2b: a door's preview). */
  onHover?: (at: Point | null) => void;
  /** A key the canvas has no use for, offered to the host first: true when it took it (6.2b: F flips a door's swing). */
  onKey?: (event: KeyLike & { repeat: boolean }) => boolean;
}

/** The items as boxes for snapping, back to front. */
/** Whether a point picks a connector: within 6 screen px of its line (and half its width), or on its label's patch. */
const linkHit = (r: ResolvedLink, p: Point, zoom: number): boolean =>
  pathHits(r.path, p, PICK_DISTANCE / zoom + r.link.width / 2) ||
  (r.patch !== null && p.x >= r.patch.x && p.x <= r.patch.x + r.patch.width && p.y >= r.patch.y && p.y <= r.patch.y + r.patch.height);
const pathBoundsOf = (r: ResolvedLink): WorldRect => pathBounds(r.path);
const boxesOf = (items: readonly CanvasItem[]) => items.map((item) => ({ id: item.id, box: item }));

/** The geometry alone of an item, as a gesture keeps it. */
const geometryOf = (item: Geometry): Geometry => ({ x: item.x, y: item.y, width: item.width, height: item.height, rotation: item.rotation });

/** What moves when these are picked: they, and what each picked section holds (once, whoever else picked it). */
function movingWith(ids: readonly string[], all: readonly CanvasItem[]): Map<string, Geometry> {
  const picked = new Set(ids);
  const moving = new Map<string, Geometry>();
  for (const item of all) if (picked.has(item.id)) moving.set(item.id, geometryOf(item));
  for (const item of all) {
    if (!item.section || !picked.has(item.id)) continue;
    const inside = new Set(sectionContents(item, all));
    for (const other of all) if (inside.has(other.id) && !moving.has(other.id)) moving.set(other.id, geometryOf(other));
  }
  return moving;
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
  onEdit,
  editing = null,
  renderEditor,
  onOpen,
  onPasteData,
  onSystemCopy,
  links = [],
  onConnect,
  onQuickCreate,
  onCommand,
  canPaste,
  announcement = '',
  fixedColours,
  tools,
  scale,
  zoomLimits,
  onPath,
  constrainMove,
  onHover,
  onKey,
}: CanvasProps) {
  const limits = zoomLimits ?? BOARD_ZOOM;
  const themed = useCanvasColours();
  const colours = fixedColours ?? themed;
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
  const pasteTurn = useRef(0);
  const pasteArmed = useRef(0);
  const pasteFallen = useRef(false);
  const canPasteRef = useRef(canPaste);
  const fallenTimer = useRef<number | undefined>(undefined);
  /** A paste the key made itself drops the paste event that may follow it, for a moment or until the key is let go. */
  const holdFallen = (on: boolean) => {
    window.clearTimeout(fallenTimer.current);
    pasteFallen.current = on;
    if (on) {
      fallenTimer.current = window.setTimeout(() => {
        pasteFallen.current = false;
      }, 300);
    }
  };
  const [size, setSize] = useState<Size>({ width: 640, height: 400 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [shift, setShift] = useState(false);
  const [draft, setDraft] = useState<ReadonlyMap<string, Geometry> | null>(null);
  const [preview, setPreview] = useState<{ kind: 'marquee' | 'draw'; rect: WorldRect } | null>(null);
  const [menu, setMenu] = useState<{ at: Point; world: Point } | null>(null);
  const [minimap, setMinimap] = useState(false);
  const [connecting, setConnecting] = useState<ConnectDraft | null>(null);
  // The snap guides of a move or a drawing, for as long as the gesture lasts (5.3).
  const [guides, setGuides] = useState<readonly Guide[]>([]);
  // Where the items being resized or turned by the handles are right now, so the connectors follow before the gesture ends.
  const [transforming, setTransforming] = useState<{ key: string; live: ReadonlyMap<string, Geometry> } | null>(null);
  // A point-to-point run (6.2a), in a ref too so the handlers always read it as it is now.
  const [path, setPathState] = useState<PathDraft | null>(null);
  const pathRef = useRef<PathDraft | null>(null);
  const setPath = (next: PathDraft | null) => {
    pathRef.current = next;
    setPathState(next);
  };
  // What the run said last for a screen reader (a typed length taken or refused).
  const [pathSaid, setPathSaid] = useState('');
  const describedBy = useId();

  // Only an item the gesture moves is a new object: the others stay the items they were, so what is drawn for them is kept (5.7).
  const shown = useMemo(
    () =>
      draft
        ? items.map((item) => {
            const moved = draft.get(item.id);
            return moved ? { ...item, ...moved } : item;
          })
        : items,
    [items, draft],
  );
  // Sections are drawn under the connectors and the other items; each group keeps the board's order among itself (5.3).
  const sectionsShown = useMemo(() => drawOrder(shown.filter((item) => item.section)), [shown]);
  const itemsShown = useMemo(() => shown.filter((item) => !item.section), [shown]);
  // What a click, a marquee, Tab and Select all can pick: a locked item is drawn, never picked (6.2a).
  const pickSections = useMemo(() => pickable(sectionsShown), [sectionsShown]);
  const pickPlain = useMemo(() => pickable(itemsShown), [itemsShown]);
  // The connectors, each end joined to its item as it is drawn now (a drag's draft included), so they follow live.
  // The handles' live geometry counts only for the selection it was made on.
  const liveBoxes = transforming && transforming.key === selection.join('|') ? transforming.live : null;
  // A cache the render fills as it goes: it only saves routing and making shapes again, never changes what is drawn.
  const [routes] = useState(() => new Map<string, RouteEntry>());
  const resolved = useMemo(
    (): ResolvedLink[] => resolveLinks({ links, items, shown, draft, connecting, editing, liveBoxes, routes }),
    [links, items, draft, shown, connecting, editing, liveBoxes, routes],
  );
  // A connector being drawn is shown with the others, lighter.
  const drawing = useMemo((): ResolvedLink | null => {
    if (!connecting || connecting.id !== null) return null;
    const boxes = new Map(shown.map((item) => [item.id, item]));
    const a = anchorOf(boxes, connecting.from);
    const b = anchorOf(boxes, connecting.to);
    if (!a || !b) return null;
    const path = routeBetween(a, b, 'straight');
    return { link: { id: '', label: '', from: connecting.from, to: connecting.to, route: 'straight', startHead: 'none', endHead: 'arrow', color: null, width: 1.5, text: '' }, path, middle: pathMiddle(path), patch: null };
  }, [connecting, shown]);
  const view = viewport;
  // What the items are drawn for: the zoom once a wheel or pinch has held still for a moment. A picture changes size by the zoom
  // (the stored one up close), and during a zoom that would redraw every item on every wheel step; the level already drawn
  // stays until the zoom settles (5.7, decision 4). Any other jump (Fit, Reset, the keys) is applied at once. Items that come
  // into view meanwhile are drawn at the smaller of this and the live zoom (ItemNodes), so a zoom out never asks them for full size.
  const [drawZoom, setDrawZoom] = useState(viewport.zoom);
  const wheeledAt = useRef(-Infinity);
  useEffect(() => {
    const settle = createZoomSettle(
      ZOOM_SETTLE,
      (zoom) => {
        setDrawZoom(zoom);
      },
      () => gesture.current !== null,
    );
    settle.follow(viewport.zoom, performance.now() - wheeledAt.current < WHEEL_WINDOW);
    return settle.cancel;
  }, [viewport.zoom]);
  // The screen's pixel ratio (a picture picks its size by it): kept, and read again when the window moves to another screen.
  const [ratio, setRatio] = useState(() => window.devicePixelRatio);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(`(resolution: ${String(ratio)}dppx)`);
    const changed = () => {
      setRatio(window.devicePixelRatio);
    };
    query.addEventListener('change', changed);
    return () => {
      query.removeEventListener('change', changed);
    };
  }, [ratio]);
  const register: RegisterNode = useCallback((id, node) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);
  const world = visibleWorld(view, size);
  // What is drawn: the items that meet the view, and always the selected ones, so the handles have every node.
  const pickedSet = new Set(selection);
  // A section's name tab counts as part of it, or its name would vanish while the section's corner is just off the view.
  const reach = (item: CanvasItem): WorldRect => {
    const tab = tabRect(item);
    return (tab ? unionBounds([boundsFor(item), tab]) : null) ?? boundsFor(item);
  };
  const drawn = shown.filter((item) => pickedSet.has(item.id) || rectsMeet(reach(item), world));
  // A picked item out of the view is still drawn (its handles need the node), but not as in view: its picture stays small.
  const awayFrom = (list: readonly CanvasItem[]) => list.filter((item) => !rectsMeet(boundsFor(item), world)).map((item) => item.id).join('|');
  const drawnSections = drawn.filter((item) => item.section);
  const drawnPlain = drawn.filter((item) => !item.section);
  const handleIds = tool === 'select' ? selection.filter((id) => drawn.some((item) => item.id === id)) : [];
  const handleKey = handleIds.join('|');
  // Konva turns a group resized from the side handles into a skew once the items are turned differently: with mixed
  // rotations only the corners work, and they keep the proportions.
  // A group's box is axis-aligned, so it also counts when any item is turned off the right angles: stretching those
  // unevenly would skew them, and on release the saved rotation would change.
  const turned = handleIds.map((id) => shown.find((item) => item.id === id)?.rotation ?? 0);
  const mixed = handleIds.length > 1 && (new Set(turned).size > 1 || turned.some((r) => r % 90 !== 0));
  // Pictures and video cards keep their shape: corners only.
  const locked = handleIds.some((id) => shown.find((item) => item.id === id)?.keepRatio === true);
  // A door or window (6.2b) takes its shape and turn from its wall: no anchors and no turning while one is picked.
  const moveOnly = handleIds.some((id) => shown.find((item) => item.id === id)?.moveOnly === true);

  // What the handlers read, as it is now: they are set up once and must never act on an old view.
  const latest = useRef({ items, shown, sectionsShown, itemsShown, pickSections, pickPlain, resolved, selection, tool, viewport, size, draft, onViewportChange, onToolChange, onPath, limits, scale });
  useLayoutEffect(() => {
    canPasteRef.current = canPaste;
    latest.current = { items, shown, sectionsShown, itemsShown, pickSections, pickPlain, resolved, selection, tool, viewport, size, draft, onViewportChange, onToolChange, onPath, limits, scale };
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
      const { viewport: view, size: box, onViewportChange: change, limits: range } = latest.current;
      const lines = event.deltaMode === 1 ? 16 : 1;
      if (event.ctrlKey || event.metaKey) {
        if (pinching) return;
        wheeledAt.current = performance.now();
        change(zoomAround(view, box, view.zoom * Math.exp(-event.deltaY * lines * WHEEL_ZOOM), at(event), range));
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
      wheeledAt.current = performance.now();
      const { viewport: view, size: box, onViewportChange: change, limits: range } = latest.current;
      change(zoomAround(view, box, startZoom * pinch.scale, at(pinch), range));
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

  // WebKit fires paste, copy and cut events on a plain focused element only if it is told they are welcome.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const welcome = (event: Event) => {
      if (event.target === element) event.preventDefault();
    };
    for (const name of ['beforepaste', 'beforecopy', 'beforecut']) element.addEventListener(name, welcome);
    return () => {
      for (const name of ['beforepaste', 'beforecopy', 'beforecut']) element.removeEventListener(name, welcome);
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

  // The handles' live geometry for the nodes they hold, as onTransformEnd would write it.
  const nodeGeometry = (g: Geometry, node: Konva.Group): Geometry => {
    const width = tidy(atLeastMinimum(g.width * node.scaleX()));
    const height = tidy(atLeastMinimum(g.height * node.scaleY()));
    return { x: tidy(node.x() - width / 2), y: tidy(node.y() - height / 2), width, height, rotation: normalisedRotation(node.rotation()) };
  };
  const onTransform = () => {
    const live = new Map<string, Geometry>();
    for (const item of latest.current.items) {
      const node = nodes.current.get(item.id);
      if (!node || !latest.current.selection.includes(item.id)) continue;
      live.set(item.id, nodeGeometry(latest.current.draft?.get(item.id) ?? item, node));
    }
    setTransforming({ key: latest.current.selection.join('|'), live });
  };

  const onTransformEnd = () => {
    setTransforming(null);
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
    const { limits: range } = latest.current;
    onViewportChange(fitBounds(unionBounds(pool.map(boundsOf)), latest.current.size, FIT_PADDING, range.fitMax, range));
  };

  const zoomTo = (zoom: number) => {
    const { viewport: view, size: box, limits: range } = latest.current;
    onViewportChange(zoomAround(view, box, zoom, { x: box.width / 2, y: box.height / 2 }, range));
  };

  const cancelGesture = () => {
    const g = gesture.current;
    gesture.current = null;
    setPanning(false);
    setPreview(null);
    setConnecting(null);
    setTransforming(null);
    setGuides([]);
    // Only a drag that began its own hold lets it go: a pending write's hold is not this gesture's to drop.
    if (g?.kind === 'move' && g.moved) setDraft(null);
  };

  /** The lines moving things snap to: the items in view (sections too) that are not themselves moving or carried. */
  const snapTargets = (moving: ReadonlySet<string>): WorldRect[] => {
    const { shown: all, viewport: now, size: box } = latest.current;
    const seen = visibleWorld(now, box);
    return all.filter((item) => !moving.has(item.id)).map(boundsOf).filter((b) => rectsMeet(b, seen));
  };

  /**
   * How far a move has gone and the guides it snaps to; Ctrl (⌘ on a Mac) held turns snapping off. With a scale (6.2a),
   * an axis no item line took snaps to the grid; Alt (`fine`) snaps to its fine step.
   */
  const movement = (g: Extract<Gesture, { kind: 'move' }>, world: Point, off: boolean, fine = false): { dx: number; dy: number; guides: Guide[] } => {
    const dx = tidy(world.x - g.start.x);
    const dy = tidy(world.y - g.start.y);
    if (off || g.lead.length === 0) return { dx, dy, guides: [] };
    // Items that give their own snap points (6.2a: a wall's middle line ends) snap by those, to the grid and to other
    // items' points, never by their box, so a wall on a grid line stays on it. Only when a lead item gives them: a
    // board's move is as it always was.
    if (g.anchors === undefined) {
      const { items: all, viewport: now, size: box } = latest.current;
      const lead = new Set(g.lead);
      const anchored = all.some((item) => lead.has(item.id) && item.snapPoints !== undefined);
      g.anchors = anchored
        ? all
            .filter((item) => lead.has(item.id))
            .flatMap((item) => {
              if (item.snapPoints) return [...item.snapPoints];
              const b = boundsOf(item);
              return [
                { x: b.x, y: b.y },
                { x: b.x + b.width, y: b.y + b.height },
              ];
            })
        : null;
      const seen = visibleWorld(now, box);
      g.anchorTargets = anchored ? all.filter((item) => !g.origins.has(item.id) && rectsMeet(boundsOf(item), seen)).flatMap((item) => item.snapPoints ?? []) : [];
    }
    if (g.anchors) {
      const zoom = latest.current.viewport.zoom;
      const moved = snapMoveByPoints(g.anchors, dx, dy, g.anchorTargets ?? [], latest.current.scale?.grid, zoom, fine ? 'fine' : 'magnet', END_SNAP / zoom);
      return { dx: tidy(moved.dx), dy: tidy(moved.dy), guides: [] };
    }
    g.targets ??= snapTargets(new Set(g.origins.keys()));
    const lead = g.lead.flatMap((id) => {
      const o = g.origins.get(id);
      return o ? [boundsOf({ ...o, x: o.x + dx, y: o.y + dy })] : [];
    });
    const zoom = latest.current.viewport.zoom;
    const bounds = unionBounds(lead);
    const snap = snapMove(bounds, dx, dy, g.targets, zoom, off);
    const grid = latest.current.scale?.grid;
    if (!grid || !bounds) return { dx: tidy(snap.dx), dy: tidy(snap.dy), guides: snap.guides };
    const pulled = gridPull({ ...bounds, x: bounds.x + snap.dx - dx, y: bounds.y + snap.dy - dy }, grid, zoom, fine ? 'fine' : 'magnet');
    const onX = snap.guides.some((guide) => guide.axis === 'x');
    const onY = snap.guides.some((guide) => guide.axis === 'y');
    return { dx: tidy(snap.dx + (onX ? 0 : pulled.dx)), dy: tidy(snap.dy + (onY ? 0 : pulled.dy)), guides: snap.guides };
  };

  /** Where a move by dx, dy puts what it moves, as the host places it when it does (6.2b). */
  const placedBy = (g: Extract<Gesture, { kind: 'move' }>, dx: number, dy: number, snap: GridSnap): ReadonlyMap<string, Geometry> => {
    const moved = new Map([...g.origins].map(([id, o]) => [id, { ...o, x: tidy(o.x + dx), y: tidy(o.y + dy) }]));
    return constrainMove ? constrainMove(moved, snap) : moved;
  };

  /** A point onto the grid on the axes no item line took (6.2a); unchanged without a scale. */
  const gridded = (point: Point, guides: readonly Guide[]): Point => {
    const grid = latest.current.scale?.grid;
    if (!grid) return point;
    const onGrid = snapToGrid(point, grid, latest.current.viewport.zoom, 'magnet');
    return {
      x: guides.some((guide) => guide.axis === 'x' && Math.abs(guide.at - point.x) < 0.01) ? point.x : onGrid.x,
      y: guides.some((guide) => guide.axis === 'y' && Math.abs(guide.at - point.y) < 0.01) ? point.y : onGrid.y,
    };
  };

  /** Where a point-to-point run's next point goes (6.2a): another item's snap point near it, else the grid; Shift holds to 15° steps. */
  const pathPoint = (raw: Point, mods: PathMods, draft: PathDraft | null): Point =>
    nextPoint(raw, mods, draft, { ends: latest.current.shown.flatMap((item) => item.snapPoints ?? []), grid: latest.current.scale?.grid, zoom: latest.current.viewport.zoom });

  /** The run ends: its fixed points are the host's to write (one edit), and the tool is Select again unless another was picked. */
  const finishPath = (toSelect = true) => {
    const draft = pathRef.current;
    if (!draft) return;
    setPath(null);
    setPathSaid('');
    const points = runPoints(draft);
    if (points) void latest.current.onPath?.(points, draft.tool);
    if (toSelect) onToolChange('select');
  };

  // Another tool picked mid-run finishes the run as it stands.
  useEffect(() => {
    if (toolEndsRun(pathRef.current, tool)) finishPath(false);
    // finishPath reads the run through its ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  // The canvas going away (a host keys it per view, so a new view is a new canvas; the tile closed; another workspace)
  // ends a run as Escape does: its fixed points go to the host it began with, so they're written into that view.
  useEffect(
    () => () => {
      const draft = pathRef.current;
      pathRef.current = null;
      const points = runPoints(draft);
      if (draft && points) void latest.current.onPath?.(points, draft.tool);
      if (draft) latest.current.onToolChange('select');
    },
    [],
  );

  /** The rectangle a drawing drag makes, its corners snapped to other items' lines unless snapping is off. */
  const drawnRect = (g: Extract<Gesture, { kind: 'draw' }>, world: Point, off: boolean): { rect: WorldRect; guides: Guide[] } => {
    if (off) return { rect: rectFromCorners(g.start, world), guides: [] };
    g.targets ??= snapTargets(new Set());
    const zoom = latest.current.viewport.zoom;
    const a = snapPoint(g.start, g.targets, zoom);
    const b = snapPoint(world, g.targets, zoom);
    const ga = gridded(a.point, a.guides);
    const gb = gridded(b.point, b.guides);
    return { rect: rectFromCorners({ x: tidy(ga.x), y: tidy(ga.y) }, { x: tidy(gb.x), y: tidy(gb.y) }), guides: mergeGuides([...a.guides, ...b.guides]) };
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
    const { shown: all, pickPlain: plain, pickSections: sections, selection: picked, tool: current, resolved: lines, viewport: now } = latest.current;
    const spec = tools?.find((each) => each.id === current);
    // A point-to-point tool (6.2a): the first click starts a run, each one after ends a segment and starts the next.
    if (spec?.pointToPoint && isHostTool(current)) {
      const run = pathRef.current;
      const at = pathPoint(world, event, run);
      // A double-click's second press adds nothing, however far it jittered: the double-click finishes the run.
      const next = run ? runClick(run, at, now.zoom, event.detail) : runStart(current, at);
      if (next !== run) setPath(next);
      return;
    }
    if (current === 'connector') {
      // Drag from an item (or empty space) to an item (or empty space): the first end snaps as the second does. A section is no end.
      const start = snapEnd(boxesOf(plain), world, now.zoom);
      gesture.current = { kind: 'connect', id: null, fixed: start.end, moving: 'to', screen, moved: false, quick: null, quickSide: null };
      return;
    }
    // A selected connector's ends are taken first: they sit over the items they join.
    const only = picked.length === 1 ? lines.find((r) => r.link.id === picked[0]) : undefined;
    if (only && current === 'select') {
      const ends = [
        { moving: 'from' as const, at: only.path.points[0] },
        { moving: 'to' as const, at: only.path.points[only.path.points.length - 1] },
      ];
      for (const end of ends) {
        const there = end.at ? toScreen(now, latest.current.size, end.at) : null;
        if (there && Math.hypot(there.x - screen.x, there.y - screen.y) <= END_GRAB) {
          gesture.current = { kind: 'connect', id: only.link.id, fixed: end.moving === 'from' ? only.link.to : only.link.from, moving: end.moving, screen, moved: false, quick: null, quickSide: null };
          return;
        }
      }
    }
    if (isPlaceTool(current) || isHostTool(current)) {
      gesture.current = { kind: 'draw', tool: current, start: world, screen, targets: null, moved: false };
      return;
    }
    // The topmost item; else a connector near the pointer; else a section, but only by its name or its edge band, so a
    // click on its empty middle starts a marquee and what is inside stays easy to pick.
    const item = topmostAt(plain, world);
    const line = item ? undefined : [...lines].reverse().find((r) => linkHit(r, world, now.zoom));
    const top = item ?? (line ? undefined : topmostSectionAt(sections, world, now.zoom));
    if (top) {
      if (event.shiftKey) {
        // Shift adds or removes; a removed item isn't dragged.
        const next = picked.includes(top.id) ? picked.filter((id) => id !== top.id) : [...picked, top.id];
        onSelectionChange(next);
        if (!next.includes(top.id)) return;
        gesture.current = { kind: 'move', start: world, screen, origins: movingWith(next, all), lead: next, targets: null, moved: false, collapseTo: null };
        return;
      }
      const inSelection = picked.includes(top.id);
      const ids = inSelection ? [...picked] : [top.id];
      if (!inSelection) onSelectionChange(ids);
      gesture.current = {
        kind: 'move',
        start: world,
        screen,
        origins: movingWith(ids, all),
        lead: ids,
        targets: null,
        moved: false,
        // A click on one of several selected, without a drag, selects just that one.
        collapseTo: inSelection && picked.length > 1 ? top.id : null,
      };
      return;
    }
    if (line) {
      onSelectionChange(event.shiftKey ? (picked.includes(line.link.id) ? picked.filter((id) => id !== line.link.id) : [...picked, line.link.id]) : [line.link.id]);
      return;
    }
    if (!event.shiftKey) onSelectionChange([]);
    gesture.current = { kind: 'marquee', start: world, screen, base: event.shiftKey ? [...picked] : [], moved: false };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const screen = local(event);
    const world = worldOf(screen);
    pointer.current = screen;
    const run = pathRef.current;
    if (run) setPath({ ...run, cursor: pathPoint(world, event, run) });
    const g = gesture.current;
    if (!g) {
      onHover?.(world);
      return;
    }
    if (g.kind === 'pan') {
      onViewportChange(panBy(latest.current.viewport, screen.x - g.last.x, screen.y - g.last.y));
      g.last = screen;
      return;
    }
    if (!g.moved && Math.hypot(screen.x - g.screen.x, screen.y - g.screen.y) < DRAG_THRESHOLD) return;
    if (!g.moved && g.kind === 'move') generation.current += 1;
    g.moved = true;
    if (g.kind === 'connect') {
      const snap = snapEnd(boxesOf(latest.current.itemsShown), world, latest.current.viewport.zoom, isAttached(g.fixed) ? g.fixed.item : null);
      setConnecting({ id: g.id, from: g.moving === 'to' ? g.fixed : snap.end, to: g.moving === 'to' ? snap.end : g.fixed, mark: snap.mark });
      return;
    }
    const off = event.ctrlKey || event.metaKey;
    if (g.kind === 'move') {
      const { dx, dy, guides: aligned } = movement(g, world, off, event.altKey);
      setGuides(aligned);
      setDraft(placedBy(g, dx, dy, off ? 'off' : event.altKey ? 'fine' : 'magnet'));
    } else if (g.kind === 'draw') {
      const made = drawnRect(g, world, off);
      setGuides(made.guides);
      setPreview({ kind: 'draw', rect: made.rect });
    } else {
      setPreview({ kind: g.kind, rect: rectFromCorners(g.start, world) });
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    setPanning(false);
    setGuides([]);
    if (!g || g.kind === 'pan') return;
    const world = worldOf(local(event));
    if (g.kind === 'connect') {
      setConnecting(null);
      if (!g.moved) {
        // A press on a "+" handle without a drag makes the connected copy; any other press does nothing.
        if (g.quick !== null && g.quickSide !== null) {
          onQuickCreate?.(g.quick, g.quickSide);
          return;
        }
        // A press on a selected connector's end that doesn't drag is an ordinary click there: the item or connector under
        // it is picked, or nothing is.
        if (g.id !== null) {
          const { pickPlain: plain, resolved: lines, viewport: now } = latest.current;
          const top = topmostAt(plain, world);
          const line = [...lines].reverse().find((r) => linkHit(r, world, now.zoom));
          onSelectionChange(top ? [top.id] : line ? [line.link.id] : []);
        }
        return;
      }
      const snap = snapEnd(boxesOf(latest.current.itemsShown), world, latest.current.viewport.zoom, isAttached(g.fixed) ? g.fixed.item : null);
      void onConnect?.({ id: g.id, from: g.moving === 'to' ? g.fixed : snap.end, to: g.moving === 'to' ? snap.end : g.fixed });
      if (g.id === null) onToolChange('select');
      return;
    }
    const off = event.ctrlKey || event.metaKey;
    if (g.kind === 'move') {
      if (!g.moved) {
        if (g.collapseTo) onSelectionChange([g.collapseTo]);
        return;
      }
      const { dx, dy } = movement(g, world, off, event.altKey);
      commit([...placedBy(g, dx, dy, off ? 'off' : event.altKey ? 'fine' : 'magnet')].map(([id, o]) => ({ id, ...o })));
    } else if (g.kind === 'marquee') {
      setPreview(null);
      if (!g.moved) return;
      const box = rectFromCorners(g.start, world);
      const touched = [
        ...latest.current.resolved.filter((r) => pathTouchesRect(r.path, box)).map((r) => r.link.id),
        // A section is picked by a marquee only when it holds the whole of it: one drawn inside a section picks what is inside.
        ...marqueePicks(latest.current.shown, box),
      ];
      onSelectionChange([...new Set([...g.base, ...touched])]);
    } else {
      setPreview(null);
      const box = g.moved ? drawnRect(g, world, off).rect : rectFromCorners(g.start, world);
      // Only a click (under 3 px) places the standard rectangle; any drag draws what was dragged, at least 8 a side.
      void onCreate(
        g.moved
          ? { x: tidy(box.x), y: tidy(box.y), width: tidy(Math.max(MIN_SIZE, box.width)), height: tidy(Math.max(MIN_SIZE, box.height)), rotation: 0 }
          : placedAt(g.start, isPlaceTool(g.tool) ? g.tool : 'rect', tools?.find((each) => each.id === g.tool)?.size),
        g.tool,
        'pointer',
      );
      onToolChange('select');
    }
  };

  // The menu stays inside the canvas, whichever way it was opened.
  const openMenu = (screen: Point, worldPoint = worldOf(screen)) => {
    const { size: box } = latest.current;
    // The menu moves up by its own measured height when it would run off the bottom (CanvasMenu).
    setMenu({ at: { x: Math.max(0, Math.min(screen.x, box.width - MENU_WIDTH)), y: Math.max(0, Math.min(screen.y, box.height - 40)) }, world: worldPoint });
  };

  const closeMenu = useCallback(() => {
    setMenu(null);
    frame.current?.focus({ preventScroll: true });
  }, []);

  const runCommand = (command: CanvasCommand) => {
    // A paste from the menu lands where the menu was opened.
    onCommand(command.kind === 'paste' && command.at === null && menu ? { kind: 'paste', at: menu.world } : command);
    // Copy and cut from the menu mark the system clipboard too (no copy event comes from a click, so by the clipboard API).
    if (command.kind === 'copy' || command.kind === 'cut') onSystemCopy?.(null, null);
  };

  /** The menu's Select contents: what the picked sections hold becomes the selection. */
  const selectContents = () => {
    const { shown: all, selection: picked } = latest.current;
    const inside = new Set<string>();
    for (const item of all) {
      if (!item.section || !picked.includes(item.id)) continue;
      for (const id of sectionContents(item, all)) inside.add(id);
    }
    if (inside.size > 0) onSelectionChange([...inside]);
  };

  const cycle = (direction: 1 | -1) => {
    // Sections draw first, then the connectors, then the items: Tab goes back to front like the rest.
    const ids = pickOrder(latest.current.sectionsShown, latest.current.resolved.map((r) => r.link.id), latest.current.itemsShown);
    if (ids.length === 0) return;
    const picked = ids.map((id, i) => (latest.current.selection.includes(id) ? i : -1)).filter((i) => i >= 0);
    const from = direction === 1 ? Math.max(...picked) : Math.min(...picked);
    const next = ids[(from + direction + ids.length) % ids.length];
    if (next === undefined) return;
    onSelectionChange([next]);
    // An item out of view is brought into it.
    const item = latest.current.shown.find((i) => i.id === next);
    const line = latest.current.resolved.find((r) => r.link.id === next);
    const { viewport: now, size: box } = latest.current;
    const b = item ? boundsOf(item) : line ? pathBoundsOf(line) : null;
    if (b && !rectsMeet(b, visibleWorld(now, box))) {
      onViewportChange(centreOn(now, { x: b.x + b.width / 2, y: b.y + b.height / 2 }));
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Keys pressed on the buttons inside (zoom, minimap, the menu) are theirs.
    if (event.target !== event.currentTarget) return;
    const mac = isMac();
    const modifiers = event.metaKey || event.ctrlKey || event.altKey;
    const picked = latest.current.selection;
    // A run in progress (6.2a) takes typed lengths, Enter, Escape and the arrows (its direction) first.
    // Backspace and Delete are always the run's: they take its last point off, and never reach the delete command.
    const run = pathRef.current;
    const ran = run ? runKey(run, event, (text) => (latest.current.scale ? latest.current.scale.parse(text) : Number(text.replace(',', '.')))) : null;
    if (ran) {
      event.preventDefault();
      if (ran.kind === 'finish') finishPath();
      else if (ran.kind === 'refused') setPathSaid(t('canvas.path.refused', { typed: ran.typed }));
      else if (ran.kind === 'taken') {
        setPath(ran.run);
        setPathSaid(t('canvas.path.taken', { length: latest.current.scale ? latest.current.scale.format(ran.length) : String(tidy(ran.length)) }));
      } else {
        setPath(ran.run);
        // A run dropped by taking its only point off has nothing left to say.
        if (ran.run === null) setPathSaid('');
      }
      return;
    }
    if (event.key === ' ' && !modifiers) {
      event.preventDefault();
      space.current = true;
      setSpaceHeld(true);
      return;
    }
    // ⌘⌥ + an arrow (Ctrl+Shift on Windows): a connected copy of the one selected item on that side.
    const quickSide = quickSideFor(event, mac);
    if (quickSide && picked.length === 1) {
      const only = latest.current.items.find((i) => i.id === picked[0]);
      if (only?.quick && onQuickCreate) {
        event.preventDefault();
        if (!event.repeat) onQuickCreate(only.id, quickSide);
        return;
      }
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
      onSelectionChange(pickOrder(latest.current.sectionsShown, latest.current.resolved.map((r) => r.link.id), latest.current.itemsShown));
      return;
    }
    // The layout keys (5.3) need a selection to act on: with none, they are the page's again.
    const arrange = arrangeForKey(event, mac);
    if (arrange && picked.length > 0) {
      event.preventDefault();
      if (!event.repeat) onCommand(arrange);
      return;
    }
    const command = commandForKey(event, mac, pointer.current ? worldOf(pointer.current) : null);
    // Paste is left to the browser first: its paste event carries the system clipboard (a picture, an address), which the
    // host may take (onPasteData); if not, the paste event pastes the items copied inside the app. A webview that fires
    // no paste event on a plain focused element (WebKit) gets the in-app paste a moment after the key instead. One paste
    // per key press, and none for a held key.
    if (command?.kind === 'paste') {
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      const step = pasteStep();
      if (step === 'event') return;
      const at = pointer.current ? worldOf(pointer.current) : null;
      if (step === 'now') {
        // No paste event has ever come in this webview: paste the items now. (If one does come, the flag below drops it.)
        holdFallen(canPasteRef.current);
        onCommand({ kind: 'paste', at });
        return;
      }
      const turn = ++pasteTurn.current;
      pasteArmed.current = turn;
      pasteFallen.current = false;
      window.setTimeout(() => {
        if (pasteArmed.current !== turn) return;
        pasteArmed.current = 0;
        waitFoundNoEvent();
        // Only a fallback that pasted something may drop a late event.
        holdFallen(canPasteRef.current);
        onCommand({ kind: 'paste', at });
      }, PASTE_WAIT);
      return;
    }
    // Copy and cut set the in-app clip at once, whether or not the webview fires its copy event, and let that event
    // through to mark the system clipboard.
    if ((command?.kind === 'copy' || command?.kind === 'cut') && picked.length > 0) {
      if (event.repeat && command.kind === 'cut') {
        event.preventDefault();
        return;
      }
      onCommand(command);
      onSystemCopy?.(null, null);
      return;
    }
    if (command) {
      event.preventDefault();
      // A held key would delete or duplicate again and again.
      if (event.repeat && (command.kind === 'delete' || command.kind === 'duplicate' || command.kind === 'cut')) return;
      if (picked.length > 0) onCommand(command);
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
      const pointTool = tools?.find((each) => each.id === latest.current.tool);
      if (event.key === 'Enter' && pointTool?.pointToPoint && isHostTool(pointTool.id)) {
        // From the keyboard: a run starts at the middle of the view; typed lengths and the arrows draw it.
        event.preventDefault();
        const { viewport: view } = latest.current;
        setPath(runStart(pointTool.id, pathPoint({ x: view.cx, y: view.cy }, NO_MODS, null), null));
        setPathSaid(t('canvas.path.started'));
        return;
      }
      const placing = latest.current.tool;
      if (event.key === 'Enter' && (isPlaceTool(placing) || isHostTool(placing))) {
        event.preventDefault();
        const { viewport: view } = latest.current;
        void onCreate(placedAt({ x: view.cx, y: view.cy }, isPlaceTool(placing) ? placing : 'rect', pointTool?.size), placing, 'key');
        onToolChange('select');
        return;
      }
      // Enter on one selected video or link card opens it.
      if (event.key === 'Enter' && onOpen && picked.length === 1) {
        const only = latest.current.items.find((i) => i.id === picked[0]);
        if (only?.openable) {
          event.preventDefault();
          onOpen(only.id);
          return;
        }
      }
      // Enter on one selected text or sticky item edits it in place.
      if (event.key === 'Enter' && onEdit && picked.length === 1) {
        const only = latest.current.items.find((i) => i.id === picked[0]);
        if (!only && latest.current.resolved.some((r) => r.link.id === picked[0])) {
          event.preventDefault();
          onEdit(picked[0] as string);
          return;
        }
        if (only?.editable) {
          event.preventDefault();
          onEdit(only.id);
          return;
        }
      }
      // The host's own keys come before the tool letters (6.2b: F and Shift+F flip a door).
      if (onKey?.(event)) {
        event.preventDefault();
        return;
      }
      const next = tools ? hostToolForKey(event, tools) : toolForKey(event);
      if (next) {
        event.preventDefault();
        onToolChange(next);
      }
    }
  };

  const cursor = panning ? 'grabbing' : spaceHeld || tool === 'hand' ? 'grab' : tool === 'connector' || isHostTool(tool) ? 'crosshair' : isPlaceTool(tool) ? (tool === 'text' ? 'text' : 'crosshair') : 'default';
  // The item being typed into, or a connector's label (its patch, as wide as the words need and no less than 120).
  const editingLine = editing ? resolved.find((r) => r.link.id === editing) : undefined;
  const editingBox = editing ? shown.find((i) => i.id === editing) : undefined;
  // A section's name is typed on its tab, above its corner, not over the whole section.
  const editingTab = editingBox ? tabRect(editingBox) : null;
  const editingItem: CanvasItem | undefined = editing
    ? (editingBox && editingTab
        ? { ...editingBox, ...editingTab, width: Math.max(editingTab.width, EDITING_NAME_WIDTH), rotation: 0 }
        : editingBox) ??
      (editingLine?.patch ? { id: editingLine.link.id, label: editingLine.link.label, ...editingLine.patch, rotation: 0, editable: true } : undefined)
    : undefined;
  const percent = Math.round(view.zoom * 100);
  // A real scale (6.2a): the grid in view, the scale bar's round length, and the run being drawn with its next segment.
  const grid = scale ? gridLines(view, size, scale.grid) : [];
  const bar = scale ? scaleBarLength(view.zoom, scale.rounds) : 0;
  const barLabel = scale ? scale.label(bar) : '';
  const runSpec = path ? tools?.find((each) => each.id === path.tool) : undefined;
  const runLast = path?.points.at(-1);
  const typedLength = path && path.typed !== '' ? (scale ? scale.parse(path.typed) : Number(path.typed)) : null;
  const runNext =
    path && runLast
      ? typedLength !== null && Number.isFinite(typedLength) && typedLength > 0
        ? pointAlong(runLast, pathAngle(path), typedLength)
        : path.cursor && (path.cursor.x !== runLast.x || path.cursor.y !== runLast.y)
          ? path.cursor
          : null
      : null;
  const segmentLength = runLast && runNext ? Math.hypot(runNext.x - runLast.x, runNext.y - runLast.y) : 0;
  const lengthAt = runLast && (runNext || path?.typed) ? toScreen(view, size, runNext ? { x: (runLast.x + runNext.x) / 2, y: (runLast.y + runNext.y) / 2 } : runLast) : null;
  const runWidth = runSpec?.pathWidth;
  // One item that can be copied with a connector selected, at rest: its four "+" handles show.
  const quickItem =
    tool === 'select' && selection.length === 1 && !editing && !draft && !connecting && !liveBoxes && onQuickCreate
      ? shown.find((item) => item.id === selection[0] && item.quick === true)
      : undefined;
  const live =
    selection.length === 0
      ? ''
      : selection.length === 1
        ? t('canvas.selectedAt', {
            label: items.find((i) => i.id === selection[0])?.label ?? links.find((l) => l.id === selection[0])?.label ?? '',
            n: [...links, ...items].findIndex((i) => i.id === selection[0]) + 1,
            total: links.length + items.length,
          })
        : tn('canvas.itemsSelected', selection.length);
  const data = useMemo(() => JSON.stringify(items.map(({ id, x, y, width, height, rotation }) => ({ id, x, y, width, height, rotation }))), [items]);
  const chosen = useMemo(() => JSON.stringify(selection), [selection]);
  // The snap guides showing right now, as plain data for the end-to-end tests.
  const guideData = useMemo(() => JSON.stringify(guides.map((g) => ({ axis: g.axis, at: tidy(g.at), from: tidy(g.from), to: tidy(g.to) }))), [guides]);
  // The connectors' paths, as plain data for the end-to-end tests (the canvas is pixels).
  const lineData = useMemo(
    () => JSON.stringify(resolved.map((r) => ({ id: r.link.id, kind: r.path.kind, points: r.path.points.map((p) => ({ x: tidy(p.x), y: tidy(p.y) })) }))),
    [resolved],
  );

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
      data-links={lineData}
      data-guides={guideData}
      data-tool={tool}
      data-path={path ? JSON.stringify(path.points) : undefined}
      style={{ cursor, ...(fixedColours ? { background: fixedColours.paper, outlineColor: fixedColours.ink } : {}) }}
      className="relative h-full min-h-60 w-full touch-none overflow-hidden bg-surface select-none focus-visible:-outline-offset-4"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancelGesture}
      onPointerLeave={() => {
        pointer.current = null;
        onHover?.(null);
      }}
      onKeyDown={onKeyDown}
      onDoubleClick={(event) => {
        // A double-click finishes a run (6.2a).
        if (pathRef.current) {
          finishPath();
          return;
        }
        if ((!onEdit && !onOpen) || (event.target !== event.currentTarget && !(event.target instanceof HTMLCanvasElement))) return;
        const at = worldOf(local(event));
        const { itemsShown: plain, pickSections: sections, viewport: now } = latest.current;
        // A locked item is never picked, by a double-click either.
        const top = itemAt(plain, at);
        if (top?.editable) onEdit?.(top.id);
        else if (top?.openable) onOpen?.(top.id);
        else if (!top) {
          // A connector's label is typed in place; a section's name is typed where it is picked (its tab or its edge).
          const line = [...latest.current.resolved].reverse().find((r) => linkHit(r, at, now.zoom));
          if (line) onEdit?.(line.link.id);
          else {
            const section = topmostSectionAt(sections, at, now.zoom);
            if (section) onEdit?.(section.id);
          }
        }
      }}
      onCopy={(event) => {
        if (event.target !== event.currentTarget || selection.length === 0) return;
        event.preventDefault();
        onSystemCopy?.(event.clipboardData, event.nativeEvent);
      }}
      onCut={(event) => {
        if (event.target !== event.currentTarget || selection.length === 0) return;
        event.preventDefault();
        onSystemCopy?.(event.clipboardData, event.nativeEvent);
      }}
      onPaste={(event) => {
        // Pasting into the text editor over the canvas is the editor's.
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        // An event comes in this webview: the key never needs to wait or paste on its own again.
        pasteEventSeen();
        pasteArmed.current = 0;
        // The key's own fallback already pasted: this late event must not paste again.
        if (pasteFallen.current) {
          pasteFallen.current = false;
          return;
        }
        // Stops the storyboard's own paste listener on the document (a picture pasted here is for the board).
        event.stopPropagation();
        const at = pointer.current ? worldOf(pointer.current) : null;
        if (onPasteData?.(event.clipboardData, at)) return;
        onCommand({ kind: 'paste', at });
      }}
      onKeyUp={(event) => {
        // The key press is over: a paste event from somewhere else is its own.
        if (event.key.toLowerCase() === 'v') holdFallen(false);
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
        const there = worldOf(screen);
        const top = menuPickAt(latest.current.itemsShown, latest.current.sectionsShown, there, latest.current.viewport.zoom);
        if (top && !latest.current.selection.includes(top.id)) onSelectionChange([top.id]);
        openMenu(screen);
      }}
    >
      <p id={describedBy} className="sr-only">
        {t('canvas.keys')}
      </p>
      <p role="status" className="sr-only">
        {pathSaid !== '' ? pathSaid : announcement !== '' ? announcement : live}
      </p>
      <Stage ref={stage} width={size.width} height={size.height} listening>
        <Layer x={size.width / 2 - view.cx * view.zoom} y={size.height / 2 - view.cy * view.zoom} scaleX={view.zoom} scaleY={view.zoom}>
          {grid.length > 0 && (
            <Shape
              listening={false}
              sceneFunc={(context) => {
                // World lines, a hairline at any zoom: light every step, stronger every major step.
                const world = visibleWorld(view, size);
                for (const strong of [false, true]) {
                  context.beginPath();
                  for (const line of grid) {
                    if (line.strong !== strong) continue;
                    if (line.axis === 'x') {
                      context.moveTo(line.at, world.y);
                      context.lineTo(line.at, world.y + world.height);
                    } else {
                      context.moveTo(world.x, line.at);
                      context.lineTo(world.x + world.width, line.at);
                    }
                  }
                  context.setAttr('globalAlpha', strong ? GRID_STRONG : GRID_LIGHT);
                  context.setAttr('strokeStyle', colours.ink);
                  context.setAttr('lineWidth', 1 / view.zoom);
                  context.stroke();
                }
              }}
            />
          )}
          <ItemNodes items={drawnSections} colours={colours} zoom={drawZoom} liveZoom={view.zoom} ratio={ratio} away={awayFrom(drawnSections)} register={register} />
          {resolved.map((r) => (
            <LinkShape
              key={r.link.id}
              resolved={r}
              colours={colours}
              selected={pickedSet.has(r.link.id)}
              hideText={editing === r.link.id}
              handles={selection.length === 1 && selection[0] === r.link.id && tool === 'select'}
              zoom={pickedSet.has(r.link.id) ? view.zoom : 1}
            />
          ))}
          <ItemNodes items={drawnPlain} colours={colours} zoom={drawZoom} liveZoom={view.zoom} ratio={ratio} away={awayFrom(drawnPlain)} register={register} />
          {drawing && <LinkShape resolved={drawing} colours={colours} selected={false} hideText handles={false} zoom={view.zoom} draft />}
          {connecting?.mark && <Circle x={connecting.mark.x} y={connecting.mark.y} radius={6 / view.zoom} stroke={colours.ink} strokeWidth={1.5} strokeScaleEnabled={false} fill={colours.paper} listening={false} />}
          {path && path.points.length > 1 && (
            <Line
              points={path.points.flatMap((p) => [p.x, p.y])}
              stroke={colours.ink}
              strokeWidth={runWidth ?? 1.5}
              strokeScaleEnabled={runWidth !== undefined}
              lineCap="square"
              lineJoin="miter"
              listening={false}
            />
          )}
          {runLast && runNext && (
            <Line
              points={[runLast.x, runLast.y, runNext.x, runNext.y]}
              stroke={colours.ink}
              strokeWidth={runWidth ?? 1.5}
              strokeScaleEnabled={runWidth !== undefined}
              lineCap="square"
              opacity={0.5}
              listening={false}
            />
          )}
          {path?.points.map((p, i) => (
            <Circle key={i} x={p.x} y={p.y} radius={3 / view.zoom} fill={colours.paper} stroke={colours.ink} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
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
          {guides.map((guide) => (
            <Line
              key={`${guide.axis}${String(guide.at)}`}
              points={guide.axis === 'x' ? [guide.at, guide.from, guide.at, guide.to] : [guide.from, guide.at, guide.to, guide.at]}
              stroke={colours.ink}
              strokeWidth={1}
              strokeScaleEnabled={false}
              dash={[4, 3]}
              listening={false}
            />
          ))}
          <Transformer
            ref={transformer}
            flipEnabled={false}
            // Shift keeps the proportions (Konva's own rule when this is off), and snaps a turn to 15 degrees.
            keepRatio={mixed || locked}
            enabledAnchors={moveOnly ? [] : mixed || locked ? CORNERS : ALL_ANCHORS}
            ignoreStroke
            anchorSize={8}
            anchorCornerRadius={0}
            anchorFill={colours.ink}
            anchorStroke={colours.paper}
            anchorStrokeWidth={1}
            borderStroke={colours.ink}
            borderStrokeWidth={1.5}
            rotateAnchorOffset={24}
            // A section is always upright.
            rotateEnabled={!moveOnly && !handleIds.some((id) => shown.find((item) => item.id === id)?.section)}
            rotationSnaps={shift ? ROTATION_SNAPS : []}
            rotationSnapTolerance={shift ? 7.5 : 0}
            boundBoxFunc={(was, next) => (next.width < MIN_SIZE * view.zoom || next.height < MIN_SIZE * view.zoom ? was : next)}
            onTransform={onTransform}
            onTransformEnd={onTransformEnd}
          />
        </Layer>
      </Stage>
      {scale && <Rulers view={view} size={size} scale={scale} colours={colours} />}
      {lengthAt && (
        // The segment's length as it is drawn, or what is being typed for it (6.2a).
        <div
          aria-hidden="true"
          data-path-length={path?.typed !== '' ? (path?.typed ?? '') : scale ? scale.format(segmentLength) : String(tidy(segmentLength))}
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] border-[1.5px] px-1.5 py-0.5 font-mono text-[11px] leading-none whitespace-nowrap"
          style={{ left: lengthAt.x, top: lengthAt.y, background: colours.paper, color: colours.ink, borderColor: colours.ink }}
        >
          {path?.typed !== '' ? `${path?.typed ?? ''}▏` : scale ? scale.format(segmentLength) : String(tidy(segmentLength))}
        </div>
      )}
      {/* Clear of the left ruler when there is one. */}
      <div className={cx('absolute bottom-2 flex items-center border border-text bg-surface', !scale && 'left-2')} style={scale ? { left: RULER_SIZE + 8 } : undefined}>
        <button type="button" aria-label={t('canvas.zoomOut')} className={ZOOM_BUTTON} onClick={() => { zoomTo(view.zoom / ZOOM_STEP); }}>
          −
        </button>
        {scale ? (
          // With a real scale (6.2a), the zoom's label is the scale bar: a round length and a bar that long on screen.
          <button type="button" data-scale-bar={barLabel} aria-label={t('canvas.zoomResetScale', { length: barLabel })} className={cx(ZOOM_BUTTON, 'min-w-14 gap-1.5 font-mono normal-case')} onClick={() => { zoomTo(1); }}>
            <span aria-hidden="true" className="block h-1.5 border-x-[1.5px] border-b-[1.5px] border-text" style={{ width: bar * view.zoom }} />
            {barLabel}
          </button>
        ) : (
          <button type="button" aria-label={t('canvas.zoomReset', { percent })} className={cx(ZOOM_BUTTON, 'min-w-14 font-mono')} onClick={() => { zoomTo(1); }}>
            {percent}%
          </button>
        )}
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
      {quickItem &&
        SIDES.map((side) => {
          // Just outside the side, along its (turned) normal; the rotate handle sits further out than these.
          const middle = toScreen(view, size, sideMidpoint(quickItem, side));
          const normal = sideNormal(quickItem, side);
          return (
            <button
              key={side}
              type="button"
              tabIndex={-1}
              data-quick-side={side}
              aria-label={QUICK_LABEL[side]()}
              className="absolute z-10 flex items-center justify-center border border-text bg-surface font-mono text-[10px] leading-none text-text hover:bg-surface-raised"
              style={{ left: middle.x + normal.x * QUICK_OFFSET - QUICK_SIZE / 2, top: middle.y + normal.y * QUICK_OFFSET - QUICK_SIZE / 2, width: QUICK_SIZE, height: QUICK_SIZE }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                frame.current?.focus({ preventScroll: true });
                frame.current?.setPointerCapture(event.pointerId);
                gesture.current = { kind: 'connect', id: null, fixed: { item: quickItem.id, side }, moving: 'to', screen: local(event), moved: false, quick: quickItem.id, quickSide: side };
              }}
            >
              +
            </button>
          );
        })}
      {editingItem && renderEditor && (
        <div
          data-canvas-editor=""
          style={{
            position: 'absolute',
            left: (editingItem.x - view.cx) * view.zoom + size.width / 2,
            top: (editingItem.y - view.cy) * view.zoom + size.height / 2,
            width: editingItem.width * view.zoom,
            height: editingItem.height * view.zoom,
            transform: `rotate(${String(editingItem.rotation)}deg)`,
            transformOrigin: 'center',
          }}
        >
          {renderEditor(editingItem, view.zoom)}
        </div>
      )}
      {menu && (
        <CanvasMenu
          at={menu.at}
          hasSelection={selection.length > 0}
          items={selection.filter((id) => items.some((item) => item.id === id)).length}
          hasSection={selection.some((id) => shown.some((item) => item.id === id && item.section))}
          canvasHeight={size.height}
          canPaste={canPaste}
          mac={isMac()}
          onCommand={runCommand}
          onSelectContents={selectContents}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';

// Controls clear of an overlay scroll bar (6.27o, Kevin Nov 19). Where the system's bars lie over the content (a Mac's
// default, headless Chromium), a button at a scroller's right edge sits under the bar, and a click there goes to the bar:
// hard to hit for a person too. So a scroller that overflows takes a lane on its bar's side, the room a classic bar
// takes for itself (`padding-inline-end` up and down, `padding-bottom` sideways, 16 px: theme.css). Classic bars
// (Windows, a Mac set to always show them) already have their own room, and nothing changes there.
//
// Whether bars overlay is measured, never read from the system's name: a hidden box with `overflow: scroll` whose bar
// takes no width. The answer is `data-scrollbars="overlay"` on <html>, measured at start and again on focus and resize
// (macOS can switch styles while the app runs: a mouse plugged in, the "Show scroll bars" setting). No timer.

/** The root's attribute and its one value. */
export const SCROLLBARS_ATTRIBUTE = 'data-scrollbars';

/**
 * Bars take no room of their own when a box with `overflow: scroll` is as wide inside as outside. A box with no width
 * (no layout, as in jsdom) says nothing, so it isn't taken for overlay.
 */
export function barsOverlay(offsetWidth: number, clientWidth: number): boolean {
  return offsetWidth > 0 && offsetWidth - clientWidth <= 0;
}

function measureBars(): boolean {
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;top:-1000px;left:-1000px;width:100px;height:100px;overflow:scroll;visibility:hidden;';
  document.body.append(probe);
  const overlay = barsOverlay(probe.offsetWidth, probe.clientWidth);
  probe.remove();
  return overlay;
}

type RootAttributes = Pick<Element, 'getAttribute' | 'setAttribute' | 'removeAttribute'>;

/**
 * Puts a reading on the root, only when it differs from what is there: a write of the same value would still wake every
 * scroller's hook through the root's observer, on each event of a window drag. Returns whether it wrote.
 */
export function writeReading(root: RootAttributes, overlay: boolean): boolean {
  const now = root.getAttribute(SCROLLBARS_ATTRIBUTE) === 'overlay';
  if (now === overlay) return false;
  if (overlay) root.setAttribute(SCROLLBARS_ATTRIBUTE, 'overlay');
  else root.removeAttribute(SCROLLBARS_ATTRIBUTE);
  return true;
}

/** Measures now and on every focus and resize of the window; returns the stop. Started once, by the app's root. */
export function startScrollbarProbe(): () => void {
  const apply = () => {
    writeReading(document.documentElement, measureBars());
  };
  apply();
  window.addEventListener('focus', apply);
  window.addEventListener('resize', apply);
  return () => {
    window.removeEventListener('focus', apply);
    window.removeEventListener('resize', apply);
  };
}

// The root's attribute, as a store: one observer for every scroller, so the hooks follow a switch of style at once.
const listeners = new Set<() => void>();
let rootWatch: MutationObserver | null = null;

function subscribeOverlay(onChange: () => void): () => void {
  listeners.add(onChange);
  if (rootWatch === null && typeof MutationObserver !== 'undefined') {
    rootWatch = new MutationObserver(() => {
      for (const listener of listeners) listener();
    });
    rootWatch.observe(document.documentElement, { attributes: true, attributeFilter: [SCROLLBARS_ATTRIBUTE] });
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      rootWatch?.disconnect();
      rootWatch = null;
    }
  };
}

function readOverlay(): boolean {
  return document.documentElement.getAttribute(SCROLLBARS_ATTRIBUTE) === 'overlay';
}

/** One axis's lane: on or off, and the box it was last taken off at, or is held on at. */
export interface AxisLane {
  on: boolean;
  /** Held on until the scroller's box is no longer this one (the stay-on rule). */
  heldAt: string | null;
  /** The box the lane was taken off at by the measure before this one; null after any other measure. */
  droppedAt: string | null;
}

export interface LaneState {
  x: AxisLane;
  y: AxisLane;
}

export interface LaneMeasure {
  overlay: boolean;
  /** Whether the content overflows sideways, and up and down: without any lane once the box has settled, so the lane's
   *  own room never keeps it on past a resize (#222 round 6b: a lane that made the content wrap kept itself on where
   *  the content fitted without it); with the lane on while the box is changing or only the content changed (6c). */
  overflowX: boolean;
  overflowY: boolean;
  /** The scroller's own box, its outer width and height: "320x480". */
  box: string;
}

const OFF: AxisLane = { on: false, heldAt: null, droppedAt: null };
export const NO_LANE: LaneState = { x: OFF, y: OFF };

/**
 * Once the scroller's box has settled, the overflow is measured without the lane, so the lane's own room never keeps it
 * on past a change of size (`watchLane` says when it reads with the lane on). Content can still answer the
 * lane (a tile that shows a line only where it fits): if the content overflows again on the measure right after the
 * lane was taken off, while the scroller's own box is the same, the lane goes back on and stays until that box changes,
 * so it never flickers on and off.
 */
function nextAxis(prev: AxisLane, overflow: boolean, box: string): AxisLane {
  if (prev.heldAt === box) return { on: true, heldAt: box, droppedAt: null };
  if (overflow) return { on: true, heldAt: prev.droppedAt === box ? box : null, droppedAt: null };
  // The drop is remembered for the very next measure only: an overflow then is the lane's own flicker; any later one is
  // the content's, and is let go again as soon as the content fits.
  return { on: false, heldAt: null, droppedAt: prev.on ? box : null };
}

/** The rule: a lane on each axis the scroller overflows, only while bars overlay. Pure, so it is tested alone. */
export function nextLane(prev: LaneState, measure: LaneMeasure): LaneState {
  if (!measure.overlay) return NO_LANE;
  return { x: nextAxis(prev.x, measure.overflowX, measure.box), y: nextAxis(prev.y, measure.overflowY, measure.box) };
}

/** The scroller's attribute for a state: "y", "x", "both", or none. */
export function laneAttribute(state: LaneState): 'x' | 'y' | 'both' | null {
  if (state.x.on && state.y.on) return 'both';
  if (state.y.on) return 'y';
  if (state.x.on) return 'x';
  return null;
}

const SCROLLS = new Set(['auto', 'scroll']);

/** The boxes to watch: the scroller's children, through any without a box of their own (display: contents). */
function contentBoxes(element: Element, boxes: Element[], lists: Element[], depth = 0): void {
  for (const child of element.children) {
    if (depth < 4 && getComputedStyle(child).display === 'contents') {
      lists.push(child);
      contentBoxes(child, boxes, lists, depth + 1);
    } else {
      boxes.push(child);
    }
  }
}

/** Whether the content overflows each way, as the scroller is now. */
function overflowNow(element: HTMLElement): { x: boolean; y: boolean } {
  return { x: element.scrollWidth > element.clientWidth, y: element.scrollHeight > element.clientHeight };
}

/**
 * Whether the content overflows each way with no lane, the lane on as `lane`. It is taken off for the reading and put
 * back in the same task: the page lays out to answer, but never draws in between, and every size is the same again
 * before the resize observers look, so they report nothing. Without the lane everything inside is laid out 16 px wider
 * (or taller), and the browser pulls back every scroll position the wider layout can't reach: the scroller's own, and
 * any scrolled area inside it (the Shot list's table scrolled to its right end, a text field at its end; #222 round
 * 6c). Each of those that was away from the start is put back as it was, and only where it moved: `scrolled` holds the
 * ones seen scrolling, so nothing walks the content.
 */
function overflowWithoutLane(element: HTMLElement, lane: string, scrolled: Set<Element>): { x: boolean; y: boolean } {
  const kept: { target: Element; top: number; left: number }[] = [];
  for (const target of [element, ...scrolled]) {
    if (target !== element && !target.isConnected) {
      scrolled.delete(target);
      continue;
    }
    const top = target.scrollTop;
    const left = target.scrollLeft;
    if (top === 0 && left === 0) {
      // Back at the start: nothing a reading can pull back, so it is let go until it scrolls again.
      if (target !== element) scrolled.delete(target);
      continue;
    }
    kept.push({ target, top, left });
  }
  element.removeAttribute('data-scroll-lane');
  const bare = overflowNow(element);
  element.setAttribute('data-scroll-lane', lane);
  for (const { target, top, left } of kept) {
    if (target.scrollTop !== top) target.scrollTop = top;
    if (target.scrollLeft !== left) target.scrollLeft = left;
  }
  return bare;
}

/**
 * Watches one scroller and keeps its `data-scroll-lane` up to date; returns the stop. Exported for its test.
 *
 * Nothing is read from the page until the next frame, the first watch included (it reads the children's computed
 * style): never inside the effects that mount the scroller. WebKit, made to work out the style of a modal dialog's
 * content there, then drops the focus() a window gives its first field when the dialog is closed and shown again in
 * the same task, as React's Strict Mode does with every effect (#222: the Save preset window's Name field was left
 * unfocused on the Mac, and in Playwright's WebKit on Windows; deferring this one read alone brought the focus back).
 *
 * With the lane on, the content is read without it only once the scroller's own box has changed size and held that
 * size for a frame: the box a resize observer saw after one frame's layout is still the box in the next frame (#222
 * round 6c). A reading without the lane lays the whole scroller out twice more, so a splitter drag or the Dock's grow
 * transition, which change the box from one frame to the next, take one at their end, not one a frame; a single change
 * of size is read in the frame after it, as before. A change of the content alone (a frame
 * added, a row opened, a person's scroll that loads more) is read with the lane on, as before round 6b: still
 * overflowing keeps it, fitting drops it. The lane's own room can only hold it on at the box it was taken at, and the
 * next change of that box lets it go.
 */
export function watchLane(element: HTMLElement): () => void {
  let state = NO_LANE;
  let frame = 0;
  let watching = false;
  // The box at the last measure; and, once the box has changed, the last box it was seen at, until a measure finds it
  // still there (held from one frame's layout to the next frame, or from one measure to the next).
  let lastBox: string | null = null;
  let pending: string | null = null;
  const boxOf = () => {
    const rect = element.getBoundingClientRect();
    return `${String(Math.round(rect.width))}x${String(Math.round(rect.height))}`;
  };
  // Areas inside seen scrolling, the only ones a reading without the lane puts back. Scroll events don't bubble, but
  // a listener in the capture phase sees every one on its way down to its target.
  const scrolled = new Set<Element>();
  const onScroll = (event: Event) => {
    const target = event.target as Element | null;
    if (target !== null && target !== element && 'scrollTop' in target) scrolled.add(target);
  };
  element.addEventListener('scroll', onScroll, { capture: true, passive: true });
  const measure = () => {
    frame = 0;
    if (!watching) {
      watching = true;
      watch();
    }
    const style = getComputedStyle(element);
    const box = boxOf();
    const on = element.getAttribute('data-scroll-lane');
    let over: { x: boolean; y: boolean };
    if (on === null) {
      // No lane: what is read is the content without it.
      over = overflowNow(element);
      pending = null;
    } else if (pending !== null && box === pending) {
      // The new size has held: read once without the lane.
      over = overflowWithoutLane(element, on, scrolled);
      pending = null;
    } else {
      // Still changing size (a drag, a transition), or only the content changed: read with the lane on.
      if (pending !== null || (lastBox !== null && box !== lastBox)) pending = box;
      over = overflowNow(element);
    }
    lastBox = box;
    state = nextLane(state, {
      overlay: true,
      overflowX: SCROLLS.has(style.overflowX) && over.x,
      overflowY: SCROLLS.has(style.overflowY) && over.y,
      box,
    });
    const lane = laneAttribute(state);
    if (lane === null) element.removeAttribute('data-scroll-lane');
    else if (element.getAttribute('data-scroll-lane') !== lane) element.setAttribute('data-scroll-lane', lane);
    // Still changing size with the lane on: look again next frame, to read without it once the size holds.
    if (pending !== null && lane !== null) schedule();
  };
  // Measured in the next frame, never inside the observer's own callback: a lane written there would resize what it
  // watches in the same pass, which the browser reports as an error.
  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(measure);
  };
  const resize = new ResizeObserver((entries: ResizeObserverEntry[]) => {
    // The scroller's own box, as this frame's layout left it (read where layout is already done). Watching again after
    // a change of children reports the box once more, unchanged: that is no resize.
    if (entries.some((entry) => entry.target === element)) {
      const seen = boxOf();
      if (pending !== null || seen !== lastBox) pending = seen;
    }
    schedule();
  });
  const children = new MutationObserver(() => {
    watch();
    schedule();
  });
  const watch = () => {
    resize.disconnect();
    children.disconnect();
    resize.observe(element);
    children.observe(element, { childList: true });
    const boxes: Element[] = [];
    const lists: Element[] = [];
    contentBoxes(element, boxes, lists);
    for (const box of boxes) resize.observe(box);
    for (const list of lists) children.observe(list, { childList: true });
  };
  schedule();
  return () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    children.disconnect();
    element.removeEventListener('scroll', onScroll, { capture: true });
    scrolled.clear();
    element.removeAttribute('data-scroll-lane');
  };
}

/**
 * Keeps a scroller's controls clear of an overlay scroll bar: `data-scroll-lane` on it while it overflows and bars
 * overlay, which theme.css turns into the lane. One line in every scroller that can really scroll, text areas aside.
 * The element may come and go with the component's renders (a menu opening): it is looked at after each one.
 */
export function useScrollLane(ref: RefObject<HTMLElement | null>): void {
  const overlay = useSyncExternalStore(subscribeOverlay, readOverlay, () => false);
  const live = useRef<{ element: HTMLElement; stop: () => void } | null>(null);
  useEffect(() => {
    const element = overlay && typeof ResizeObserver !== 'undefined' ? ref.current : null;
    if (live.current?.element === element) return;
    live.current?.stop();
    live.current = element === null ? null : { element, stop: watchLane(element) };
  });
  useEffect(
    () => () => {
      live.current?.stop();
      live.current = null;
    },
    [],
  );
}

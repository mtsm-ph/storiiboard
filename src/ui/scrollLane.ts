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

/** A padding as a number of px; nothing (a page with no layout) reads as none. */
function px(value: string | undefined): number {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) ? n : 0;
}

/**
 * Whether the content overflows each way, as the scroller is now, its lane `lane`. The sideways lane's bottom padding
 * never changes how wide the content is, so it is taken away by arithmetic, never by a new layout (#222 round 6d): up and
 * down, the content overflows without it when it reaches past the box less the room that lane adds, `extraBottom`
 * (the lane's padding less the scroller's own). The same arithmetic holds where the scroller's height follows its
 * content (the Shot list's table): there the box is as high as the content, lane included, and never overflows.
 *
 * It assumes a border-box scroller (the app's base style) whose own bottom padding doesn't change while its sideways
 * lane is on: that padding is read only while there is no lane. `scrollHeight` counts the bottom padding in Chromium
 * and in WebKit alike, for block, flex (row and column) and grid scrollers (probed in round 6e: a 100 px box with a
 * 150 px child and 16 px of bottom padding reads 166 in each).
 */
function overflowNow(element: HTMLElement, lane: string | null = null, extraBottom = 0): { x: boolean; y: boolean } {
  const bottom = lane === 'x' || lane === 'both' ? extraBottom : 0;
  return { x: element.scrollWidth > element.clientWidth, y: element.scrollHeight - bottom > element.clientHeight };
}

/** A scroll position kept across a reading. */
interface Kept {
  target: Element;
  top: number;
  left: number;
}

function keep(target: Element, kept: Kept[]): boolean {
  const top = target.scrollTop;
  const left = target.scrollLeft;
  if (top === 0 && left === 0) return false;
  kept.push({ target, top, left });
  return true;
}

/**
 * Whether the content overflows each way with no lane, the lane on as `lane` ('y' or 'both'). Only the lane up and down
 * is taken off for the reading, since only its room changes how the content lays out: 'both' reads as 'x', its bottom
 * padding taken away by arithmetic (`overflowNow`), so a scroller whose height follows its content keeps its height. It
 * is put back in the same task: the page lays out to answer, but never draws in between, and every size is the same
 * again before the resize observers look, so they report nothing. Without the lane everything inside is laid out 16 px
 * wider, and the browser pulls back every scroll position the wider layout can't reach: the scroller's own, and any
 * scrolled area inside it (the Shot list's table scrolled to its right end, a text field at its end; #222 round 6c). The
 * scroller's own box can change too (a box as wide as its content), and with it the reach of a scroller around it, so
 * each scrolling ancestor is kept as well (a walk up the parents, round 6d). Each of those that was away from the start
 * is put back as it was, and only where it moved: `scrolled` holds the areas inside seen scrolling, so nothing walks the
 * content.
 */
function overflowWithoutLane(element: HTMLElement, lane: string, scrolled: Set<Element>, extraBottom: number): { x: boolean; y: boolean } {
  const kept: Kept[] = [];
  keep(element, kept);
  for (const target of scrolled) {
    // Back at the start: nothing a reading can pull back, so it is let go until it scrolls again.
    if (!keep(target, kept)) scrolled.delete(target);
  }
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) keep(parent, kept);
  const bare = lane === 'both' ? 'x' : null;
  if (bare === null) element.removeAttribute('data-scroll-lane');
  else element.setAttribute('data-scroll-lane', bare);
  const over = overflowNow(element, bare, extraBottom);
  element.setAttribute('data-scroll-lane', lane);
  for (const { target, top, left } of kept) {
    if (target.scrollTop !== top) target.scrollTop = top;
    if (target.scrollLeft !== left) target.scrollLeft = left;
  }
  return over;
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
 *
 * Content that shrinks is the one change of content alone that can leave the lane on where it fits without it (the
 * storyboard's grid, whose lane can take a whole column away), so a change of content that makes the scroller's
 * content shorter or narrower, the lane up and down on, is read once without the lane when its size has held for a
 * frame (#222 round 6d); growing content costs nothing more. A sideways lane alone is never taken off to read: its
 * bottom padding never changes how wide the content is, and up and down its room is taken away by arithmetic
 * (`overflowNow`), so it is read as it is on every measure, and nothing moves. That matters where a lane host sits
 * inside another (the Shot list's table in the board): taking that lane off would make the table, whose height follows
 * its content, 16 px shorter for a moment, and the board around it would pull its own scroll position back.
 *
 * A change of the scroller's own children (the Shot list switched to the Grid: the board's body gets new content) is
 * read as a shrink is, once without the lane when the size holds, even where the new content is taller (round 6e): the
 * grid with the lane would otherwise keep a column fewer than it needs. One case is left: frames moved between scenes
 * so that the content fits without the lane while no watched box changes size and no child comes or goes; it heals at
 * the next change of the scroller's box. And while the lane up and down is held on at this box (the Layers tile's keys
 * line), no reading can change the answer, so none is taken for a shrink there.
 */
export function watchLane(element: HTMLElement): () => void {
  let state = NO_LANE;
  let frame = 0;
  let watching = false;
  // The box at the last measure; and, once the box has changed, the last box it was seen at, until a measure finds it
  // still there (held from one frame's layout to the next frame, or from one measure to the next).
  let lastBox: string | null = null;
  let pending: string | null = null;
  // The content's size at the last measure, the lane as it was left then (none after a measure that changed the lane:
  // its own room isn't the content's change); and, once a change of content alone has made it smaller, the size it was
  // seen at, until a measure finds it still there.
  let lastSize: { width: number; height: number } | null = null;
  let shrunk: string | null = null;
  // Whether the scroller's children changed since the last measure: read as a shrink is (round 6e).
  let swapped = false;
  // The scroller's own bottom padding, read while it has no lane: the sideways lane's room is the lane's padding less it.
  let ownBottom = 0;
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
    // Areas that left the page are let go here, not only at a reading: a tile that never resizes still measures.
    for (const target of scrolled) if (!target.isConnected) scrolled.delete(target);
    const style = getComputedStyle(element);
    const box = boxOf();
    const on = element.getAttribute('data-scroll-lane');
    const extraBottom = on === 'x' || on === 'both' ? px(style.paddingBottom) - ownBottom : 0;
    const width = element.scrollWidth;
    const height = element.scrollHeight;
    const size = `${String(width)}x${String(height)}`;
    const childrenChanged = swapped;
    swapped = false;
    // The lane up and down alone, held on at this box: a reading without it would hold it on all the same.
    const held = on === 'y' && state.y.heldAt === box;
    let over: { x: boolean; y: boolean };
    if (on === null || on === 'x') {
      // No lane, or the sideways one alone: what is read is the content without it, nothing taken off.
      if (on === null) ownBottom = px(style.paddingBottom);
      over = overflowNow(element, on, extraBottom);
      pending = null;
      shrunk = null;
    } else if ((pending !== null && box === pending) || (pending === null && !held && shrunk === size && box === lastBox)) {
      // The new size, or the content's smaller size, has held: read once without the lane.
      over = overflowWithoutLane(element, on, scrolled, extraBottom);
      pending = null;
      shrunk = null;
    } else {
      // Still changing size (a drag, a transition), or only the content changed: read with the lane on.
      if (pending !== null || (lastBox !== null && box !== lastBox)) pending = box;
      else if (held) shrunk = null;
      else if (shrunk !== null || childrenChanged || (lastSize !== null && (width < lastSize.width || height < lastSize.height))) {
        shrunk = size;
      }
      over = overflowNow(element, on, extraBottom);
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
    else if (on !== lane) element.setAttribute('data-scroll-lane', lane);
    lastSize = lane === on ? { width, height } : null;
    // Still changing size, or the content just got smaller, with the lane on: look again next frame, to read without it
    // once the size holds.
    if ((pending !== null || shrunk !== null) && lane !== null) schedule();
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
    swapped = true;
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

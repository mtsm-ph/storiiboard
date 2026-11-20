import { useEffect, useState, type RefObject } from 'react';

// The Layers tile's keys line (Kevin, Nov 20, #222 choice 1): it shows only when the tile has room for it whole, so it
// is never cut off and never the reason the tile's body scrolls (and, where bars overlay, takes a lane that narrows the
// rows). What decides it never includes the line itself: the rows' height and the line's height as a hidden copy
// measures it, at the tile's present width, so showing or hiding it can't change the answer (no loop, no flicker).

export interface KeysLineMeasure {
  /** From the top of the body's content to the bottom of the tile's own content without the line, padding included. */
  base: number;
  /** The space the tile puts between the list and the line. */
  gap: number;
  /** The line's height at the tile's present width. */
  line: number;
  /** The body's height inside (its `clientHeight`). */
  room: number;
}

/** The fit rule: the line shows only when the rows, the gap and the whole line fit the body without scrolling. */
export function keysLineFits({ base, gap, line, room }: KeysLineMeasure): boolean {
  if (!(room > 0) || !(line > 0)) return false;
  return base + gap + line <= room;
}

export interface KeysLineParts {
  /** The tile's own content box (its section). */
  tile: RefObject<HTMLElement | null>;
  /** The last thing above the line (the list): where the content without the line ends. */
  last: RefObject<HTMLElement | null>;
  /** The line's hidden copy, out of the flow, at the tile's width. */
  copy: RefObject<HTMLElement | null>;
}

/**
 * Whether the keys line fits, followed as the tile is resized, maximized, moved, its rows change or the language does.
 * Measured in the next frame, never inside the observer's callback: showing the line there would resize what is
 * watched in the same pass, which the browser reports as an error.
 */
export function useKeysLineFits({ tile, last, copy }: KeysLineParts): boolean {
  const [fits, setFits] = useState(false);
  useEffect(() => {
    const section = tile.current;
    const list = last.current;
    const line = copy.current;
    const body = section?.closest('[data-scroll-root]');
    if (!section || !list || !line || !(body instanceof HTMLElement) || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = body.getBoundingClientRect().top + body.clientTop - body.scrollTop;
      const style = getComputedStyle(section);
      setFits(
        keysLineFits({
          base: list.getBoundingClientRect().bottom - top + parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth),
          gap: parseFloat(style.rowGap) || 0,
          line: line.getBoundingClientRect().height,
          room: body.clientHeight,
        }),
      );
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    // The body's box (and its lane), what sits above the line (the buttons, the list: rows, language, width) and the
    // copy (the line's words and width) decide. The line's own resize when it shows wakes this once more, to the same
    // answer: what it measures leaves the line out.
    const resize = new ResizeObserver(schedule);
    resize.observe(body);
    resize.observe(line);
    for (const child of section.children) resize.observe(child);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
    };
  }, [tile, last, copy]);
  return fits;
}

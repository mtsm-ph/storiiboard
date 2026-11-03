import { useRef, useState, type PointerEvent } from 'react';
import { cx } from '../../../ui/cx';
import { snap, SNAP_PX } from './geometry';
import { holdTextSelection, releaseTextSelection } from './textSelection';

interface SplitterProps {
  /** row: the splitter is a vertical line between tiles side by side. */
  direction: 'row' | 'column';
  /** The two neighbours' shares of their split, for the separator's value. */
  before: number;
  after: number;
  label: string;
  /** A new share for the tile before the line, out of before + after. `done` ends the drag. */
  onResize: (share: number, done: boolean) => void;
  onEvenOut: () => void;
  /** Shows the magnet's dashed guide while it holds the line, or hides it with null. */
  onGuide: (position: number | null) => void;
}

/** Other splitters' lines running the same way, in screen px, for the magnet. */
function otherLines(self: HTMLElement, direction: SplitterProps['direction']): number[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-splitter="${direction}"]`)]
    .filter((el) => el !== self)
    .map((el) => {
      const box = el.getBoundingClientRect();
      return direction === 'row' ? box.left + box.width / 2 : box.top + box.height / 2;
    });
}

export function Splitter({ direction, before, after, label, onResize, onEvenOut, onGuide }: SplitterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<[number, number] | null>(null);
  const row = direction === 'row';

  // The pair's span on screen, from the start of the tile before the line to the end of the one after it.
  const measure = () => {
    const el = ref.current;
    const a = el?.previousElementSibling?.getBoundingClientRect();
    const b = el?.nextElementSibling?.getBoundingClientRect();
    if (!el || !a || !b) return null;
    return row
      ? { start: a.left, end: b.right, gap: el.getBoundingClientRect().width }
      : { start: a.top, end: b.bottom, gap: el.getBoundingClientRect().height };
  };

  const shareAt = (position: number, span: { start: number; end: number; gap: number }) => {
    const usable = span.end - span.start - span.gap;
    const tileBefore = position - span.start - span.gap / 2;
    setLive([Math.round(tileBefore), Math.round(usable - tileBefore)]);
    return ((before + after) * tileBefore) / usable;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    const span = measure();
    if (!el || !span || event.button !== 0) return;
    // No preventDefault here: in Chromium it also cancels the mouse events a double-click (even out) is made of.
    // Text selection is switched off for the drag instead.
    holdTextSelection();
    el.setPointerCapture(event.pointerId);
    const lines = otherLines(el, direction);
    const move = (e: globalThis.PointerEvent, done: boolean) => {
      const raw = row ? e.clientX : e.clientY;
      // ⌘ (Ctrl on Windows) places the line freely; otherwise it snaps to lines within 8px.
      const free = e.metaKey || e.ctrlKey;
      const { position, snappedTo } = free ? { position: raw, snappedTo: null } : snap(raw, lines);
      onGuide(done ? null : snappedTo);
      onResize(shareAt(position, span), done);
    };
    const onMove = (e: globalThis.PointerEvent) => {
      move(e, false);
    };
    const onUp = (e: globalThis.PointerEvent) => {
      move(e, true);
      setLive(null);
      releaseTextSelection();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  const percent = Math.round((before / (before + after)) * 100);

  return (
    // A focusable separator with a value is ARIA's splitter widget; jsx-a11y counts every separator as static.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={ref}
      role="separator"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the splitter widget is focusable (see above)
      tabIndex={0}
      aria-label={label}
      aria-orientation={row ? 'vertical' : 'horizontal'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      data-splitter={direction}
      onPointerDown={onPointerDown}
      onDoubleClick={onEvenOut}
      onKeyDown={(event) => {
        const span = measure();
        if (!span) return;
        const back = row ? 'ArrowLeft' : 'ArrowUp';
        const forward = row ? 'ArrowRight' : 'ArrowDown';
        if (event.key !== back && event.key !== forward) return;
        event.preventDefault();
        // One step is the magnet's 8px; Shift takes bigger steps.
        const step = ((before + after) * SNAP_PX * (event.shiftKey ? 5 : 1)) / (span.end - span.start - span.gap);
        onResize(before + (event.key === forward ? step : -step), true);
      }}
      className={cx(
        'relative shrink-0 touch-none focus-visible:outline-offset-0',
        row ? 'w-gap cursor-col-resize' : 'h-gap cursor-row-resize',
      )}
    >
      {live && (
        // Live sizes in mono while dragging (DESIGN.md, Splitter).
        <span
          aria-hidden="true"
          className={cx(
            'pointer-events-none absolute z-20 flex gap-3 font-mono text-[10px] whitespace-nowrap',
            row ? 'top-2 left-1/2 -translate-x-1/2' : 'top-1/2 left-2 -translate-y-1/2',
          )}
        >
          <span className="bg-ink px-1 text-ink-inverse">{live[0]} px</span>
          <span className="bg-ink px-1 text-ink-inverse">{live[1]} px</span>
        </span>
      )}
    </div>
  );
}

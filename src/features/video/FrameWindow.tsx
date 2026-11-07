import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clampCrop, cropWindow, DEFAULT_CROP, isDefaultCrop, MAX_ZOOM, moveWindow, zoomCrop, type Crop } from '../../core/media/crop';
import { t } from '../../core/i18n';
import { Button } from '../../ui/Button';

// Framing a frame's clip over the Player (2.6): the window is the part of the take the frame shows, in the project's
// aspect ratio, drawn over the whole picture with the rest dimmed. Drag it, or with it focused use the arrow keys
// (Shift for bigger steps), + and − to zoom and 0 to centre it again; or the zoom slider and Centre below. As with a
// frame's picture (CropEditor), a change saves once, when it's let go, so ⌘Z takes back one move. It sets the clip's
// crop, which still capture (2.7) and clip capture (2.8) use; the frame's picture keeps its own.

const STEP = 0.02;
const BIG_STEP = 0.1;
const ZOOM_STEP = 1.1;

const same = (a: Crop, b: Crop) => a.x === b.x && a.y === b.y && a.zoom === b.zoom;

export interface FrameWindowProps {
  crop: Crop;
  /** The take's shape, upright with square pixels (displayAspect). */
  imageAspect: number;
  /** The project's frame. */
  frameAspect: number;
  /** Saves the clip's crop; settles once the edit has landed, true if it did (false: refused, or nothing to save). */
  onCommit: (crop: Crop) => Promise<boolean>;
  /** The frame and video the framing is of: a change drops a draft, so it never lands on another frame. */
  frameKey: string;
}

/**
 * A draft of the framing, shared by the window over the picture and the controls under it. A move let go is kept as
 * pending until its edit lands, so the window doesn't jump back meanwhile, and a quick next step builds on it rather
 * than on the crop saved before.
 */
export function useFraming({ crop, imageAspect, frameAspect, onCommit, frameKey }: FrameWindowProps) {
  const [draft, setDraftState] = useState<Crop | null>(null);
  // The latest draft for the handlers, which can run before React has drawn the last move (a fast drag's pointerup);
  // kept with the frame it's of, so a draft of another frame is never saved onto this one.
  const latest = useRef<{ key: string; crop: Crop } | null>(null);
  // Where a slider gesture began: zooming from there, not from the last (clamped) step, keeps the window's place
  // when it's zoomed out and back in one drag.
  const gesture = useRef<{ key: string; crop: Crop } | null>(null);
  const [pending, setPending] = useState<Crop | null>(null);
  const [said, setSaid] = useState('');
  // Another frame or video, or the picture gone: nothing carried over. Each reset starts a generation of its own, so
  // a move held when the picture went can't count again when the same frame comes back.
  const [keyFor, setKeyFor] = useState({ frameKey, generation: 0 });
  if (keyFor.frameKey !== frameKey) {
    setKeyFor((now) => ({ frameKey, generation: now.generation + 1 }));
    setDraftState(null);
    setPending(null);
  }
  const heldKey = `${String(keyFor.generation)}|${frameKey}`;
  // As drawn: the stored crop may be outside what this frame allows (another aspect ratio since); drawing clamps it.
  const saved = clampCrop(crop, imageAspect, frameAspect);
  const shown = draft ?? pending ?? saved;
  const mine = (held: { key: string; crop: Crop } | null) => (held?.key === heldKey ? held.crop : null);
  const setDraft = (next: Crop | null) => {
    latest.current = next ? { key: heldKey, crop: next } : null;
    setDraftState(next);
  };
  const commit = (given?: Crop | null) => {
    const next = given === undefined ? mine(latest.current) : given;
    setDraft(null);
    gesture.current = null;
    // Nothing moved on screen: no edit, so the stored choice stays as the person left it.
    if (!next || same(next, pending ?? saved)) return;
    setPending(next);
    onCommit(next)
      .then((landed) => {
        // Said once it's saved, not on every step: where the window's centre is, and the zoom.
        if (landed) setSaid(t('player.framed', { zoom: Math.round(next.zoom * 100), x: Math.round(next.x * 100), y: Math.round(next.y * 100) }));
      })
      .catch(() => undefined)
      .finally(() => {
        setPending((now) => (now === next ? null : now));
      });
  };
  /** Back to what's saved, unsaved (a gesture the system took over). */
  const revert = () => {
    setDraft(null);
  };
  /** Where the next step starts from: the move under way, else the last one let go, else what's saved. */
  const base = () => mine(latest.current) ?? pending ?? saved;
  /** Where a slider gesture began (the first step of it sets it). */
  const gestureStart = () => {
    const held = mine(gesture.current);
    if (held) return held;
    const from = base();
    gesture.current = { key: heldKey, crop: from };
    return from;
  };
  return { shown, draft, setDraft, commit, revert, base, gestureStart, said };
}

export type Framing = ReturnType<typeof useFraming>;

/** The window over the picture, and the dimmed take around it. Fills its parent, which is the picture's own box. */
export function FrameWindow({ framing, imageAspect, frameAspect, hintId }: { framing: Framing; imageAspect: number; frameAspect: number; hintId: string }) {
  const { shown, draft, setDraft, commit, revert, base } = framing;
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; from: Crop } | null>(null);
  const box = cropWindow(shown, imageAspect, frameAspect);
  const move = (from: Crop, dx: number, dy: number) => moveWindow(from, dx, dy, imageAspect, frameAspect);
  const zoom = (from: Crop, to: number) => zoomCrop(from, to, imageAspect, frameAspect);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, from: base() };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    const rect = area.current?.getBoundingClientRect();
    if (!start || !rect || rect.width === 0) return;
    setDraft(move(start.from, (event.clientX - start.x) / rect.width, (event.clientY - start.y) / rect.height));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    commit();
  };
  // Taken over by the system (a touch turned into a scroll): put back, not saved.
  const onPointerCancel = () => {
    drag.current = null;
    revert();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // ⌘ or Ctrl with + − 0 zooms the window of the app, not the frame's; ⌘ or Alt with an arrow is the system's.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const step = event.shiftKey ? BIG_STEP : STEP;
    const from = base();
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const by = moves[event.key];
    let next: Crop | null = null;
    if (by) next = move(from, by[0], by[1]);
    else if (event.key === '+' || event.key === '=') next = zoom(from, from.zoom * ZOOM_STEP);
    else if (event.key === '-' || event.key === '_') next = zoom(from, from.zoom / ZOOM_STEP);
    else if (event.key === '0') next = DEFAULT_CROP;
    if (!next) return;
    // These keys are the window's; the Player's own (comma, period, I, O, Space) still reach the Player.
    event.preventDefault();
    event.stopPropagation();
    setDraft(next);
  };

  const dim = 'pointer-events-none absolute bg-ink-fixed/60';
  return (
    <div ref={area} className="absolute inset-0" data-frame-window-area="">
      {/* The take outside the frame, dimmed: above, below, left and right of the window. */}
      <div aria-hidden="true" className={`${dim} inset-x-0 top-0`} style={{ height: `${String(box.top)}%` }} />
      <div aria-hidden="true" className={`${dim} inset-x-0 bottom-0`} style={{ height: `${String(100 - box.top - box.height)}%` }} />
      <div aria-hidden="true" className={dim} style={{ top: `${String(box.top)}%`, height: `${String(box.height)}%`, left: 0, width: `${String(box.left)}%` }} />
      <div
        aria-hidden="true"
        className={dim}
        style={{ top: `${String(box.top)}%`, height: `${String(box.height)}%`, right: 0, width: `${String(100 - box.left - box.width)}%` }}
      />
      {/* An application region, so a screen reader in browse mode hands it the arrow keys that move the window; as a
          button it would keep them for reading. Its edge is paper on ink, so it shows on any footage. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        role="application"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        aria-label={t('player.frameWindow', { zoom: Math.round(shown.zoom * 100) })}
        aria-describedby={hintId}
        data-frame-window=""
        // Its ink outline stays on its edge when focused (the app's focus rule would push it 2px out).
        className="group/window absolute cursor-grab touch-none border-[1.5px] border-paper-fixed outline outline-1 outline-ink-fixed focus-visible:outline-offset-0 active:cursor-grabbing"
        style={{ left: `${String(box.left)}%`, top: `${String(box.top)}%`, width: `${String(box.width)}%`, height: `${String(box.height)}%` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
        // Saved when the moving key is let go, not Shift let go first while an arrow still repeats.
        onKeyUp={(event) => {
          if (draft && !['Shift', 'Meta', 'Control', 'Alt'].includes(event.key)) commit();
        }}
        // A key held down as focus leaves still saves where it got to.
        onBlur={() => {
          if (draft) commit();
        }}
      >
        {/* The focus ring: inside the edge, so the picture's box never clips it, and two-tone (paper with ink round
            it), since what's under it is the footage itself, bright or dark. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[3px] hidden border-2 border-paper-fixed outline outline-2 outline-ink-fixed group-focus-visible/window:block"
        />
      </div>
    </div>
  );
}

/** The zoom slider and Centre, under the Player, with the live line that says each framing once it's saved. */
export function FramingControls({ framing, imageAspect, frameAspect }: { framing: Framing; imageAspect: number; frameAspect: number }) {
  const { shown, setDraft, commit, gestureStart, said } = framing;
  const zoomId = useId();
  const percent = Math.round(shown.zoom * 100);
  return (
    <div className="flex shrink-0 items-center gap-3" data-framing-controls="">
      <label htmlFor={zoomId} className="sb-label">
        {t('player.framing')}
      </label>
      <input
        id={zoomId}
        type="range"
        min={100}
        max={MAX_ZOOM * 100}
        step={5}
        value={percent}
        onChange={(event) => {
          setDraft(zoomCrop(gestureStart(), Number(event.currentTarget.value) / 100, imageAspect, frameAspect));
        }}
        // Saved when let go, as the inspector's controls are.
        onPointerUp={() => {
          commit();
        }}
        // Saved when the moving key is let go, not Shift let go first while an arrow still repeats.
        onKeyUp={(event) => {
          if (!['Shift', 'Meta', 'Control', 'Alt'].includes(event.key)) commit();
        }}
        onBlur={() => {
          commit();
        }}
        className="sb-range min-w-0 flex-1"
      />
      <span className="w-[4ch] text-right font-mono text-[12px]">{percent}%</span>
      <Button
        disabled={isDefaultCrop(shown)}
        onClick={() => {
          commit(DEFAULT_CROP);
        }}
      >
        {t('player.centreFraming')}
      </Button>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </div>
  );
}

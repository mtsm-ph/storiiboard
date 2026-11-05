import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { DEFAULT_CROP, isDefaultCrop, MAX_ZOOM, panCrop, zoomCrop, type Crop } from '../../core/media/crop';
import { Button } from '../../ui/Button';
import { FrameImage, type FramePictureView } from './FrameImage';
import { t } from '../../core/i18n';

// Framing a frame's picture (1.11): drag it, or with the frame focused use the arrow keys (Shift for bigger steps),
// + and − to zoom and 0 to centre it again. The picture always covers the frame. Like the inspector's other
// controls, a change saves once, when it's let go (pointer up, key up, slider released), so ⌘Z takes back one move.

const STEP = 0.02;
const BIG_STEP = 0.1;
const ZOOM_STEP = 1.1;

const same = (a: Crop, b: Crop) => a.x === b.x && a.y === b.y && a.zoom === b.zoom;

interface CropEditorProps {
  picture: FramePictureView;
  frameAspect: number;
  onCommit: (crop: Crop) => void;
}

export function CropEditor({ picture, frameAspect, onCommit }: CropEditorProps) {
  // The framing while it's being changed; null shows the saved one.
  const [draft, setDraft] = useState<Crop | null>(null);
  const shown = draft ?? picture.crop;
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; from: Crop } | null>(null);
  const hintId = useId();
  const zoomId = useId();

  const [said, setSaid] = useState('');
  const commit = (next: Crop | null) => {
    setDraft(null);
    if (!next || same(next, picture.crop)) return;
    onCommit(next);
    // Said once it's saved, not on every step: where the picture's centre now is, and the zoom.
    setSaid(
      t('crop.said', { zoom: Math.round(next.zoom * 100), x: Math.round(next.x * 100), y: Math.round(next.y * 100) }),
    );
  };
  const pan = (from: Crop, dx: number, dy: number) => panCrop(from, dx, dy, picture.aspect, frameAspect);
  const zoom = (to: number) => zoomCrop(shown, to, picture.aspect, frameAspect);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, from: shown };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    const rect = frame.current?.getBoundingClientRect();
    if (!start || !rect || rect.width === 0) return;
    setDraft(pan(start.from, (event.clientX - start.x) / rect.width, (event.clientY - start.y) / rect.height));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    commit(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    let next: Crop | null = null;
    if (move) next = pan(shown, move[0], move[1]);
    else if (event.key === '+' || event.key === '=') next = zoom(shown.zoom * ZOOM_STEP);
    else if (event.key === '-' || event.key === '_') next = zoom(shown.zoom / ZOOM_STEP);
    else if (event.key === '0') next = DEFAULT_CROP;
    if (!next) return;
    // Escape still goes back to the board; these keys stay here.
    event.preventDefault();
    event.stopPropagation();
    setDraft(next);
  };

  const percent = Math.round(shown.zoom * 100);
  return (
    <div className="flex flex-col gap-2">
      {/* An application region, so a screen reader in browse mode (NVDA, JAWS) hands it the arrow keys that move the
          picture; as a button it would keep them for reading. jsx-a11y counts application as non-interactive. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={frame}
        role="application"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        aria-label={t('crop.label', { zoom: percent })}
        aria-describedby={hintId}
        data-crop-editor=""
        className="relative w-full cursor-grab touch-none overflow-hidden border border-text active:cursor-grabbing"
        style={{ aspectRatio: String(frameAspect) }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onKeyUp={() => {
          if (draft) commit(draft);
        }}
        // A key held down as focus leaves still saves where it got to.
        onBlur={() => {
          if (draft) commit(draft);
        }}
      >
        {/* The 640px thumbnail: the well is a few hundred pixels wide, and full-size pictures read here would stay in
            memory until the project closes. */}
        <FrameImage picture={{ ...picture, crop: shown }} frameAspect={frameAspect} eager />
      </div>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
      <p id={hintId} className="text-[12px] text-text-muted">
        {t('cropEditor.dragToMoveThePicture')}
      </p>
      <div className="flex items-center gap-3">
        <label htmlFor={zoomId} className="sb-label">
          {t('cropEditor.zoom')}
        </label>
        <input
          id={zoomId}
          type="range"
          min={100}
          max={MAX_ZOOM * 100}
          step={5}
          value={percent}
          onChange={(event) => {
            setDraft(zoom(Number(event.currentTarget.value) / 100));
          }}
          // Saved when let go, as the inspector's other controls are.
          onPointerUp={() => {
            commit(draft);
          }}
          onKeyUp={() => {
            commit(draft);
          }}
          onBlur={() => {
            commit(draft);
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
          {t('cropEditor.centre')}
        </Button>
      </div>
    </div>
  );
}

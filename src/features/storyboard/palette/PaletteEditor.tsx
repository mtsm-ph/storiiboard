import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { isMac } from '../../../app/shell/undoShortcuts';
import { t } from '../../../core/i18n';
import { DEFAULT_PALETTE_SIZE, MAX_PALETTE, movedColor, normalHex, removedColor, toggledLock, withSize, type Palette } from '../../../core/model/palette';
import { Button, IconButton } from '../../../ui/Button';
import { Select, TextField } from '../../../ui/fields';
import { LockGlyph } from '../../../ui/glyphs';
import { Menu, MenuGroup, MenuItem } from '../../../ui/Menu';
import { useGenerating } from './actions';
import { stopEyedropper, type AddOutcome } from './Eyedropper';

// A scene's palette in the inspector (polish PP): its colours as swatches, the one picked shown by its hex. Click a
// swatch to copy its hex. One Tab stop for the swatches, a toolbar: the arrows pick, ⌘ (Ctrl) with an arrow moves the
// colour, L locks it, Delete takes it out; the buttons below do the same for the mouse. Generate fills the palette from
// the frames' pictures, again around locked colours. Every change is an edit.

interface PaletteEditorProps {
  sceneId: string;
  /** "SC 04", for the toolbar's name. */
  scene: string;
  palette: Palette | null;
  /** A frame in the scene has a picture to read. */
  canGenerate: boolean;
  onGenerate: () => Promise<unknown>;
  /** Resolves once the edit has landed (or was refused), so focus can follow the colour. */
  onEdit: (edit: (palette: Palette) => Palette | null) => Promise<unknown>;
  onCopy: (hex: string) => void;
  /** The eyedropper is on for this scene. */
  picking: boolean;
  /** Turns the eyedropper on for this scene, or off. */
  onPick: () => void;
  /** Adds a colour typed as hex: the eyedropper's keyboard way. Resolves to what happened. */
  onAddHex: (hex: string) => Promise<AddOutcome>;
  /** The moodboards linked to this scene (5.6b), which the palette can be made from. */
  boards: readonly { id: string; name: string }[];
  onFromBoard: (boardId: string) => Promise<unknown>;
  /** Opens Export for the palette's swatches (5.6b). */
  onExport: () => void;
}

const SHORTCUTS = 'Enter ArrowLeft ArrowRight Home End L Delete Backspace Control+ArrowLeft Control+ArrowRight Meta+ArrowLeft Meta+ArrowRight';

export function PaletteEditor({ sceneId, scene, palette, canGenerate, onGenerate, onEdit, onCopy, picking, onPick, onAddHex, boards, onFromBoard, onExport }: PaletteEditorProps) {
  const [typed, setTyped] = useState('');
  const [typedProblem, setTypedProblem] = useState<string | null>(null);
  const problemId = useId();
  const addTyped = () => {
    const hex = normalHex(typed);
    if (!hex) {
      setTypedProblem(t('palette.hexProblem'));
      return;
    }
    setTypedProblem(null);
    // Cleared, and focus on the new swatch, only once it's in: a full palette or a refused write keeps what was typed.
    void onAddHex(hex).then((outcome) => {
      if (outcome !== 'added') return;
      setTyped('');
      focusAfter(Promise.resolve(), hex);
    });
  };
  // The eyedropper is this scene's: it stops when the inspector shows another scene or closes, so it never picks for a
  // scene that isn't on screen.
  const pickingNow = useRef(picking);
  useEffect(() => {
    pickingNow.current = picking;
  }, [picking]);
  useEffect(
    () => () => {
      if (pickingNow.current) stopEyedropper();
    },
    [],
  );
  const colors = palette?.colors ?? [];
  // The picked colour by its hex, which stays with it when it moves; a palette lists each colour once.
  const [pickedHex, setPickedHex] = useState<string | null>(null);
  // Any run for this scene, Generate or from a board, from anywhere.
  const busy = useGenerating(sceneId);
  const bar = useRef<HTMLDivElement>(null);
  const generateButton = useRef<HTMLButtonElement>(null);
  const found = colors.findIndex((c) => c.hex === pickedHex);
  const at = found === -1 ? 0 : found;
  const current = colors[at];

  /**
   * Focus once the edit has landed and the swatches are on screen: the colour `hex`, or else the swatch now at
   * `index` (the one that took a deleted colour's place), or Generate when none is left.
   */
  const focusAfter = (done: Promise<unknown>, hex: string | null, index = 0) => {
    void done.then(() => {
      requestAnimationFrame(() => {
        const all = [...(bar.current?.querySelectorAll<HTMLElement>('[data-swatch]') ?? [])];
        const swatch = all.find((s) => s.dataset.swatch === hex) ?? all[Math.min(index, all.length - 1)];
        (swatch ?? generateButton.current)?.focus();
      });
    });
  };
  const pick = (index: number) => {
    const target = colors[Math.max(0, Math.min(colors.length - 1, index))];
    if (!target) return;
    setPickedHex(target.hex);
    bar.current?.querySelector<HTMLElement>(`[data-swatch="${CSS.escape(target.hex)}"]`)?.focus();
  };
  // Each edit names the colour by its hex, so it lands on that colour however many presses are still on their way.
  const move = (step: number) => {
    if (!current) return;
    const { hex } = current;
    focusAfter(
      onEdit((p) => movedColor(p, hex, step)),
      hex,
    );
  };
  const remove = () => {
    if (!current) return;
    const { hex } = current;
    // The next press acts on the colour that will take this one's place.
    setPickedHex((colors[at + 1] ?? colors[at - 1])?.hex ?? null);
    focusAfter(
      onEdit((p) => removedColor(p, hex)),
      null,
      at,
    );
  };
  const lock = () => {
    if (!current) return;
    const { hex } = current;
    void onEdit((p) => toggledLock(p, hex));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const command = isMac() ? event.metaKey : event.ctrlKey;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const step = event.key === 'ArrowLeft' ? -1 : 1;
      if (command) move(step);
      else pick(at + step);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      pick(event.key === 'Home' ? 0 : colors.length - 1);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      if (!event.repeat) remove();
    } else if ((event.code === 'KeyL' || event.key.toLowerCase() === 'l') && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Where it sits too, for layouts without Latin letters, as the app's other shortcuts are read.
      event.preventDefault();
      lock();
    }
  };

  const generate = () => {
    // aria-disabled while it runs, not disabled, so the button keeps focus for a keyboard user.
    if (busy || !canGenerate) return;
    void onGenerate();
  };

  return (
    <div className="flex flex-col gap-2">
      {colors.length > 0 ? (
        <>
          <div ref={bar} role="toolbar" aria-label={t('palette.list', { scene })} className="flex flex-wrap gap-1">
            {colors.map((color, index) => (
              // Keyed by the colour, so moving or deleting one never remounts the others (and their focus).
              <div key={color.hex} className="flex flex-col items-center gap-0.5">
                <button
                  type="button"
                  data-swatch={color.hex}
                  aria-label={t(color.locked ? 'palette.swatchLocked' : 'palette.swatch', { n: index + 1, of: colors.length, hex: color.hex })}
                  aria-current={index === at ? 'true' : undefined}
                  aria-keyshortcuts={SHORTCUTS}
                  title={t('palette.copyHint', { hex: color.hex })}
                  tabIndex={index === at ? 0 : -1}
                  onFocus={() => {
                    setPickedHex(color.hex);
                  }}
                  onClick={() => {
                    setPickedHex(color.hex);
                    onCopy(color.hex);
                  }}
                  onKeyDown={onKeyDown}
                  // The colour is the person's data, not a design token: it's the swatch.
                  style={{ backgroundColor: color.hex }}
                  className={`size-6 border border-text ${index === at ? 'outline-[1.5px] outline-offset-1 outline-text' : ''}`}
                />
                {/* Locked shows under the swatch, in the text colour: never drawn on the colour itself. */}
                <span aria-hidden="true" className="flex h-3 items-center">
                  {color.locked && <LockGlyph />}
                </span>
              </div>
            ))}
          </div>
          {current && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-auto font-mono text-[12px] font-bold">{current.hex}</span>
              <Button variant="ghost" onClick={() => { onCopy(current.hex); }}>
                {t('palette.copy')}
              </Button>
              <Button variant="ghost" aria-pressed={current.locked} onClick={lock}>
                {t('palette.lock')}
              </Button>
              <IconButton size="sm" label={t('palette.moveLeft')} disabled={at === 0} onClick={() => { move(-1); }}>
                <span aria-hidden="true">←</span>
              </IconButton>
              <IconButton size="sm" label={t('palette.moveRight')} disabled={at === colors.length - 1} onClick={() => { move(1); }}>
                <span aria-hidden="true">→</span>
              </IconButton>
              <Button variant="ghost" onClick={remove}>
                {t('palette.delete')}
              </Button>
            </div>
          )}
        </>
      ) : (
        <p className="text-[12px] text-text-muted">{canGenerate ? t('palette.none') : t('palette.noPicturesYet')}</p>
      )}
      {/* Add a colour: from a frame's picture with the eyedropper, or typed. */}
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <TextField
          label={t('palette.addHex')}
          mono
          value={typed}
          placeholder={t('palette.hexExample')}
          maxLength={7}
          aria-invalid={typedProblem !== null || undefined}
          {...(typedProblem ? { 'aria-describedby': problemId } : {})}
          onChange={(event) => {
            setTyped(event.currentTarget.value);
            setTypedProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addTyped();
          }}
        />
        <Button aria-pressed={picking} onClick={onPick}>
          {t('palette.pick')}
        </Button>
      </div>
      {typedProblem && (
        <p id={problemId} role="alert" className="sb-label inline-block self-start bg-warning px-[7px] py-1 text-paper-fixed">
          {typedProblem}
        </p>
      )}
      {/* Always there, its words swapped, so a screen reader announces them when picking starts. */}
      <p role="status" className="text-[12px] empty:hidden">
        {picking ? t('palette.picking') : ''}
      </p>
      <div className="grid grid-cols-[96px_1fr] items-end gap-3">
        <Select
          label={t('palette.colours')}
          mono
          disabled={busy}
          value={String(palette?.size ?? DEFAULT_PALETTE_SIZE)}
          onChange={(event) => {
            const size = Number(event.currentTarget.value);
            void onEdit((p) => withSize(p, size));
          }}
        >
          {Array.from({ length: MAX_PALETTE }, (_, i) => (
            <option key={i} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </Select>
        <Button ref={generateButton} disabled={!canGenerate} aria-disabled={busy || undefined} onClick={generate}>
          {busy ? t('palette.generating') : colors.length > 0 ? t('palette.regenerate') : t('palette.generate')}
        </Button>
      </div>
      {(boards.length > 0 || colors.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {boards.length > 0 && (
            <Menu label={t('palette.fromBoard')} buttonClassName="sb-label h-7 border border-text px-2.5 hover:bg-surface-raised focus-visible:-outline-offset-4" panelClassName="w-52">
              {(close) => (
                <MenuGroup>
                  {boards.map((board) => (
                    <MenuItem
                      key={board.id}
                      aria-disabled={busy || undefined}
                      onClick={() => {
                        close();
                        if (!busy) void onFromBoard(board.id);
                      }}
                    >
                      <span data-user-text="">{board.name}</span>
                      {busy ? ` ${t('palette.generating')}` : ''}
                    </MenuItem>
                  ))}
                </MenuGroup>
              )}
            </Menu>
          )}
          {colors.length > 0 && <Button onClick={onExport}>{t('palette.exportSwatches')}</Button>}
        </div>
      )}
    </div>
  );
}

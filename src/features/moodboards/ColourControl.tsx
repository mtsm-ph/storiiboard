import { useEffect, useId, useRef, useState } from 'react';
import { t } from '../../core/i18n';
import { cx } from '../../ui/cx';
import { luminance, parseHex as rgbOf } from '../../ui/theme/generator/color';
import { BOARD_PAPER, parseHex, STICKY_INK, SWATCHES } from './items';

/** A tick on a swatch in whichever of ink and paper reads better on it. */
const tickOn = (hex: string): string => (luminance(rgbOf(hex)) > 0.18 ? STICKY_INK : BOARD_PAPER);

// A colour for a shape, a text box or a sticky note (5.1a): a button showing it that opens a panel of swatches, a hex
// field and the system colour picker (<input type="color">, no colour library). Stickies get their six colours only. A
// change is one call; the picker's own choice is taken when it is committed, not at every step of the drag.

interface ColourControlProps {
  label: string;
  /** The colour as stored; null shows `unset`. */
  value: string | null;
  /** What shows when nothing is stored: the board's default colour for it. */
  unset: string;
  swatches?: readonly string[];
  /** A swatch's name for a screen reader, where it has one (the sticky colours); its hex otherwise. */
  nameOf?: (hex: string) => string;
  /** The selected items differ: no colour is picked, and the button says so. */
  mixed?: boolean;
  /** Whether the hex field and the system picker are offered (not for stickies). */
  custom?: boolean;
  onChange: (hex: string) => void;
}

export function ColourControl({ label, value, unset, swatches = SWATCHES, nameOf, mixed = false, custom = true, onChange }: ColourControlProps) {
  const [open, setOpen] = useState(false);
  // Where the panel opens: beside its button, in window coordinates, since the strip scrolls sideways and would clip it.
  const [anchor, setAnchor] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });
  // What is being typed in the hex field, until it is taken or left; null shows the stored colour.
  const [typed, setTyped] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  // The system picker's own value while it is open; its native change commits it.
  const [picked, setPicked] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const panel = useId();
  const hexId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    // The panel is placed in window coordinates beside its button, so anything that moves the button closes it.
    const close = () => {
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  // The native change event, which a colour input sends when a colour is chosen; React's onChange fires on every step.
  useEffect(() => {
    const element = picker.current;
    if (!element) return;
    const onPicked = () => {
      const hex = parseHex(element.value);
      setPicked(null);
      if (hex) onChange(hex);
    };
    element.addEventListener('change', onPicked);
    return () => {
      element.removeEventListener('change', onPicked);
    };
  }, [open, onChange]);

  const commitHex = () => {
    if (typed === null) return;
    const hex = typed.trim() === '' ? null : parseHex(typed);
    if (typed.trim() === '') {
      setTyped(null);
      setInvalid(false);
      return;
    }
    setInvalid(hex === null);
    if (hex) {
      setTyped(null);
      onChange(hex);
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape closes the panel; the buttons inside are the controls
    <div
      ref={root}
      className="relative flex flex-col gap-[5px]"
      onBlur={(event) => {
        // Tab past the last control (focus moved to something outside) closes the panel.
        if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <span className="sb-label">{label}</span>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        aria-label={t('moodboard.colourOf', { what: label, colour: mixed ? t('moodboard.mixed') : (value ?? t('moodboard.colourUnset')) })}
        onClick={() => {
          const box = trigger.current?.getBoundingClientRect();
          if (box) {
            const left = Math.max(4, Math.min(box.left, window.innerWidth - 232));
            // Above the button when the panel would run off the bottom of the window.
            const room = window.innerHeight - box.bottom - 4;
            setAnchor(room < (custom ? 200 : 110) && box.top > room ? { left, bottom: window.innerHeight - box.top + 4 } : { left, top: box.bottom + 4 });
          }
          setOpen((on) => !on);
        }}
        className="flex h-8 items-center gap-2 border border-text bg-surface-raised px-2 text-[13px] text-text focus-visible:-outline-offset-4"
      >
        <span aria-hidden="true" className="size-4 border border-text" style={{ background: mixed ? 'transparent' : (value ?? unset) }} />
        <span className="font-mono text-[12px]">{mixed ? t('moodboard.mixed') : (value ?? '—')}</span>
      </button>
      {open && (
        <div id={panel} role="group" aria-label={label} style={{ position: 'fixed', ...anchor }} className="z-30 flex w-56 flex-col gap-2 border border-text bg-surface p-2">
          <div className="grid grid-cols-6 gap-2 p-1">
            {swatches.map((hex) => (
              <button
                key={hex}
                type="button"
                aria-label={nameOf ? nameOf(hex) : hex}
                aria-pressed={!mixed && value === hex}
                onClick={() => {
                  onChange(hex);
                  // A swatch is the whole choice for stickies; for the rest the hex field may follow.
                  if (!custom) {
                    setOpen(false);
                    trigger.current?.focus();
                  }
                }}
                // The chosen swatch has an ink frame and a tick: a second cue besides the frame.
                className={cx('flex size-7 items-center justify-center border border-text text-[13px] focus-visible:outline-offset-2', !mixed && value === hex && 'outline-2 outline-offset-2 outline-text')}
                style={{ background: hex, color: tickOn(hex) }}
              >
                {!mixed && value === hex ? '✓' : ''}
              </button>
            ))}
          </div>
          {custom && (
            <div className="flex items-end gap-2">
              <label htmlFor={hexId} className="flex flex-1 flex-col gap-[5px]">
                <span className="sb-label">{t('moodboard.hex')}</span>
                <input
                  id={hexId}
                  value={typed ?? value ?? ''}
                  maxLength={7}
                  aria-invalid={invalid}
                  spellCheck={false}
                  onChange={(event) => {
                    setTyped(event.target.value);
                    setInvalid(false);
                  }}
                  onBlur={commitHex}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitHex();
                    }
                  }}
                  className="h-8 w-full border border-text bg-surface-raised px-2 font-mono text-[13px] text-text"
                />
              </label>
              <input ref={picker} type="color" aria-label={t('moodboard.systemPicker')} value={picked ?? value ?? STICKY_INK} onChange={(event) => { setPicked(event.target.value); }} className="h-8 w-10 border border-text bg-surface-raised p-0.5" />
            </div>
          )}
          {invalid && (
            <p role="alert" className="text-[12px] text-text">
              {t('moodboard.hexInvalid')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

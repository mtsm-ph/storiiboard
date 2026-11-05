import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { cx } from './cx';
import { PencilGlyph } from './glyphs';
import { t } from '../core/i18n';

// A title edited in place (Nov 5): a scene's name, a frame's title. A pencil beside it shows on hover and on keyboard
// focus; a click (or F2 on what it names) turns the text into a field. Enter saves, Escape puts it back as it was, and
// leaving the field saves too, as every typed field in the app does. The save is one edit, so one undo takes it back.
// The pencil is a button of its own, never inside another: frame cards and scene rows are buttons themselves.

/** How a title field was left: Enter and Escape keep the keys where the edit began; a click or Tab goes on. */
export type TitleDone = 'enter' | 'escape' | 'away';

export interface TitleFieldProps {
  value: string;
  /** The field's name: "title of 1B", "name of SC 04". */
  label: string;
  /**
   * With the text to save (trimmed), or null when Escape put it back, and how it was left: only after Enter or Escape
   * does focus go back to where the edit began; after a click or Tab it stays where the person sent it.
   */
  onDone: (text: string | null, how: TitleDone) => void;
  maxLength?: number;
  className?: string;
}

/** The field alone, focused and selected as it appears; for callers that draw their own pencil. */
export function TitleField({ value, label, onDone, maxLength = 120, className }: TitleFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  // Set once done, so the blur that follows Enter or Escape doesn't finish it a second time.
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (text: string | null, how: TitleDone) => {
    if (done.current) return;
    done.current = true;
    onDone(text, how);
  };
  return (
    <input
      ref={input}
      data-title-field=""
      defaultValue={value}
      aria-label={label}
      maxLength={maxLength}
      // In the capture phase, so Enter and Escape are the field's before any panel's own keys (the inspector's Escape
      // goes back to the board, and would otherwise blur the field and save what was half typed).
      onKeyDownCapture={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          finish(event.currentTarget.value.trim(), 'enter');
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(null, 'escape');
        }
      }}
      onBlur={(event) => {
        // Switching to another app (to copy a line from the script, say) leaves the field open, not saved.
        if (!document.hasFocus()) return;
        finish(event.currentTarget.value.trim(), 'away');
      }}
      // Clicks stay in the field rather than selecting what's under it.
      onClick={(event) => {
        event.stopPropagation();
      }}
      className={cx('min-w-0 border border-text bg-surface-raised px-1.5 py-0.5 text-[13px] text-text', className)}
    />
  );
}

/** The pencil: shown on hover of `group/title`, on its own focus, or always with `reveal`. */
export function PencilButton({
  label,
  onClick,
  tabbable = true,
  reveal = false,
  buttonRef,
  className,
}: {
  label: string;
  onClick: () => void;
  tabbable?: boolean;
  reveal?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  className?: string;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={t('title.edit', { label })}
      title={t('title.edit', { label })}
      tabIndex={tabbable ? 0 : -1}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cx(
        'flex size-6 shrink-0 items-center justify-center text-text hover:bg-surface-raised',
        // Hidden until wanted, but never out of reach: hover, its own focus, or the caller's reveal.
        reveal ? 'opacity-100' : 'opacity-0 group-hover/title:opacity-100 focus-visible:opacity-100',
        className,
      )}
    >
      <PencilGlyph />
    </button>
  );
}

export interface EditableTitleProps {
  /** The title as stored; empty for none. */
  value: string;
  /** What reads in its place: the title, "Untitled", a scene's whole heading. */
  shown: ReactNode;
  label: string;
  onSave: (text: string) => void;
  reveal?: boolean;
  maxLength?: number;
  className?: string;
  inputClassName?: string;
}

/** Text with its pencil, becoming a field in place: a board's scene heading, the inspector's header. */
export function EditableTitle({ value, shown, label, onSave, reveal = false, maxLength, className, inputClassName }: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const pencil = useRef<HTMLButtonElement>(null);
  if (editing) {
    return (
      <TitleField
        value={value}
        label={label}
        {...(maxLength !== undefined ? { maxLength } : {})}
        {...(inputClassName !== undefined ? { className: inputClassName } : {})}
        onDone={(text, how) => {
          setEditing(false);
          if (text !== null && text !== value) onSave(text);
          // Back to the pencil after Enter or Escape, so the keys carry on from where the edit started.
          if (how !== 'away') {
            requestAnimationFrame(() => {
              pencil.current?.focus();
            });
          }
        }}
      />
    );
  }
  return (
    <span className={cx('group/title inline-flex min-w-0 items-center gap-1.5', className)}>
      <span className="min-w-0 truncate">{shown}</span>
      <PencilButton
        label={label}
        reveal={reveal}
        buttonRef={pencil}
        onClick={() => {
          setEditing(true);
        }}
      />
    </span>
  );
}

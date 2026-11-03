import { useEffect, useRef, type HTMLAttributes, type KeyboardEvent } from 'react';
import { cx } from '../../ui/cx';

// A note among a scene's frames (1.12): what a board says between panels, "Rain starts" or "Cut to black". It's a
// board item like a frame, so the arrows, Delete, ⌘ with an arrow and "/" work on it. Enter (or a double click)
// edits the text in place; leaving saves it once, and Escape leaves without saving, as the inspector's fields do.

interface NoteCardProps {
  id: string;
  text: string;
  editing: boolean;
  /** The board item's own attributes and keys, from StoryboardView. */
  itemProps: HTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>;
  onEdit: () => void;
  onSave: (text: string) => void;
  onCancel: () => void;
  className?: string | undefined;
}

export function NoteCard({ id, text, editing, itemProps, onEdit, onSave, onCancel, className }: NoteCardProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  // Set by Escape, so the blur that follows as the field goes away doesn't save what was typed.
  const cancelled = useRef(false);
  useEffect(() => {
    if (!editing) return;
    cancelled.current = false;
    const element = field.current;
    element?.focus();
    element?.setSelectionRange(element.value.length, element.value.length);
  }, [editing]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // The inspector's Escape goes back to the board; here it only leaves the note.
      event.stopPropagation();
      cancelled.current = true;
      onCancel();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };

  return (
    <div className={cx('relative flex min-h-[96px] flex-col border border-dashed border-text bg-surface', className)}>
      {editing ? (
        <>
          <label htmlFor={`note-${id}`} className="sb-label px-2 pt-1.5">
            Note
          </label>
          <textarea
            ref={field}
            id={`note-${id}`}
            defaultValue={text}
            rows={4}
            onBlur={(event) => {
              if (!cancelled.current) onSave(event.currentTarget.value);
            }}
            onKeyDown={onKeyDown}
            className="min-h-0 w-full flex-1 resize-none bg-surface-raised px-2 py-1.5 text-[13px] text-text"
          />
        </>
      ) : (
        <button
          type="button"
          {...itemProps}
          onDoubleClick={onEdit}
          className="flex w-full flex-1 flex-col items-start gap-1 px-2 py-1.5 text-left"
        >
          <span className="sb-label">Note</span>
          <span className={cx('text-[13px] whitespace-pre-wrap', text === '' && 'text-text-muted')}>
            {text === '' ? 'Empty note. Enter to write.' : text}
          </span>
        </button>
      )}
    </div>
  );
}

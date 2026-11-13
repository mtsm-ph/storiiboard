import { useLayoutEffect, useRef } from 'react';
import { t } from '../../core/i18n';
import { cssFamily, fontsStore } from './fonts';
import { BOARD_INK, LINE_HEIGHT, STICKY_COLOURS, STICKY_INK, STICKY_PADDING, type ItemFields } from './items';

// Typing into a text box or sticky note in place (5.1a): a textarea over the item, in the item's font, size and
// alignment, scaled by the zoom, so what is typed is what is drawn. Escape or a click outside (the textarea losing
// focus) ends it with one call: nothing is written per keystroke. Enter is a new line.

interface TextEditorProps {
  fields: ItemFields;
  text: string;
  zoom: number;
  onEnd: (text: string) => void;
  /** What a screen reader hears for the field, where it isn't a text box or a sticky note (a connector's label). */
  ariaLabel?: string;
  /** One line only, as a section's name is: Enter ends the edit, and nothing wraps. */
  singleLine?: boolean;
}

export function TextEditor({ fields, text, zoom, onEnd, ariaLabel, singleLine = false }: TextEditorProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const ended = useRef(false);
  const sticky = fields.kind === 'sticky';

  // Focus with the caret at the end, and a text box tall enough for what is in it.
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    element.setSelectionRange(element.value.length, element.value.length);
    fit(element, sticky || singleLine);
  }, [sticky, singleLine]);

  const end = (element: HTMLTextAreaElement, refocus: boolean) => {
    if (ended.current) return;
    ended.current = true;
    const frame = element.closest<HTMLElement>('[data-canvas]');
    onEnd(element.value);
    // Back to the canvas, so the keys carry on from where they were (V, R, arrows).
    if (refocus) frame?.focus({ preventScroll: true });
  };

  return (
    <textarea
      ref={field}
      aria-label={ariaLabel ?? (sticky ? t('moodboard.editSticky') : t('moodboard.editText'))}
      defaultValue={text}
      spellCheck={false}
      onInput={(event) => {
        fit(event.currentTarget, sticky || singleLine);
      }}
      onKeyDown={(event) => {
        // Escape or Enter while an input method is composing belongs to the composition.
        // keyCode 229 is what some browsers send for a key during composition, without isComposing.
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape' || (singleLine && event.key === 'Enter')) {
          event.preventDefault();
          event.stopPropagation();
          end(event.currentTarget, true);
        }
      }}
      onBlur={(event) => {
        // Switching to another app blurs the field too; coming back finds it as it was.
        if (!document.hasFocus()) return;
        end(event.currentTarget, false);
      }}
      className="m-0 block w-full resize-none overflow-hidden border-0 bg-transparent p-0 select-text"
      style={{
        height: '100%',
        boxSizing: 'border-box',
        fontFamily: cssFamily(fields.fontFamily, fontsStore.getState(), { weight: fields.fontWeight, italic: fields.fontItalic }),
        outline: `1px solid ${BOARD_INK}`,
        outlineOffset: -1,
        fontSize: fields.fontSize * zoom,
        fontWeight: fields.fontWeight,
        fontStyle: fields.fontItalic ? 'italic' : 'normal',
        lineHeight: LINE_HEIGHT,
        textAlign: fields.align,
        padding: sticky ? STICKY_PADDING * zoom : singleLine ? `${String(2.4 * zoom)}px ${String(4 * zoom)}px` : 0,
        color: sticky ? STICKY_INK : (fields.color ?? BOARD_INK),
        background: sticky ? (fields.color ?? STICKY_COLOURS[0]) : 'transparent',
        whiteSpace: singleLine ? 'pre' : 'pre-wrap',
        overflowWrap: 'break-word',
      }}
    />
  );
}

/** A text box grows with what is typed; a sticky note keeps its square. */
function fit(element: HTMLTextAreaElement, sticky: boolean) {
  if (sticky) return;
  element.style.height = '0px';
  element.style.height = `${String(Math.max(element.scrollHeight, 1))}px`;
}

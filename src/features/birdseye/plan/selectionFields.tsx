import { useEffect, useRef } from 'react';
import { showInfo } from '../../../app/notice';
import { t } from '../../../core/i18n';
import { hasGroupingComma, parseLength, type PlanUnit } from '../../../core/model/length';
import { TextField } from '../../../ui/fields';

// The Selection tile's typed fields (6.2a), shared by every kind of item it shows (6.4's cameras among them).

/** The value every one of them has, or null when they differ. */
export function shared<T>(values: readonly T[]): T | null {
  const [first] = values;
  return first !== undefined && values.every((v) => v === first) ? first : null;
}

interface TypedFieldProps {
  label: string;
  /** What the field shows: '' for nothing set, or for several that differ. */
  text: string;
  /** Several selected with different values. */
  mixed?: boolean;
  /** Technical values (lengths, degrees) are mono; a name isn't. */
  mono?: boolean;
  /**
   * Reads what was typed: true when it was taken (and written), false to snap back saying `refused` when given, or the
   * words to say as it snaps back (a length that doesn't fit).
   */
  onCommit: (typed: string) => boolean | string;
  refused?: string;
}

/**
 * A field written when it's left or Enter is pressed, one edit each. The caller keys it by the item and the field,
 * never by its value: Enter keeps the focus in it, and what the records say (an undo, the tidy form of what was typed)
 * shows in it as it changes.
 */
export function TypedField({ label, text, mixed = false, mono = true, onCommit, refused }: TypedFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (input.current) input.current.value = text;
  }, [text]);
  const commit = (field: HTMLInputElement) => {
    if (field.value.trim() === text) return;
    const taken = onCommit(field.value);
    // Taken: the field shows the value as the plan has it ("3.50 m" for "3.5"), even when it's the one already stored,
    // which changes nothing the field would hear of. A new value comes back through `text` once it's written.
    field.value = text;
    if (taken === true) return;
    const words = typeof taken === 'string' ? taken : refused;
    if (words !== undefined) showInfo(words);
  };
  return (
    <TextField
      ref={input}
      label={label}
      mono={mono}
      autoComplete="off"
      defaultValue={text}
      placeholder={mixed ? t('plan.field.mixed') : undefined}
      onBlur={(event) => {
        commit(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit(event.currentTarget);
      }}
    />
  );
}

/** "90°": a rotation in whole hundredths, as a technical value. */
export const degreesText = (degrees: number): string => t('plan.degrees', { value: String(Math.round(degrees * 100) / 100) });

/** A length field's commit: what's typed read in any form; `empty` is what an emptied field means, if it may be. */
export const lengthCommit =
  <P,>(unit: PlanUnit, write: (patch: P) => boolean | string, apply: (m: number) => P, opts: { signed?: boolean; empty?: P } = {}) =>
  (typed: string): boolean | string => {
    if (typed.trim() === '' && opts.empty) return write(opts.empty);
    if (hasGroupingComma(typed)) return t('plan.groupingComma');
    const m = parseLength(typed, unit, opts.signed ?? false);
    if (m === null || (!opts.signed && m <= 0)) return false;
    return write(apply(m));
  };


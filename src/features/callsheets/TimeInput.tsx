import { useEffect, useRef } from 'react';
import { isClockTime } from '../../core/model/shootDay';

/**
 * A time on the call sheet, edited in place (4.2): one edit when it's left. `shown` is the time the sheet prints (a
 * call may be worked out from its department or the day); `stored` is what is saved for this field, '' while it is
 * worked out. Clearing a field takes the stored time off; a time typed, even one equal to what was shown, is stored.
 * A clear that has nothing to take off changes nothing, and the shown time comes back; so does a half-typed time where
 * the engine reports it as bad input (Chromium). WebKit may read a half-typed field as empty, which takes a stored time
 * off, as the Shoot days tile's times do. The input is never remounted, so Tab keeps focus.
 *
 * Only a field the person has typed in commits. One they merely pass through, or are in when another edit lands (a
 * department's call moving a member's, an undo), follows `shown` and commits nothing: committing what it showed before
 * would store a stale time as their own call, or bring back a time just undone.
 */
export function TimeInput({ label, caption, shown, stored = shown, onCommit }: { label: string; caption: string; shown: string; stored?: string; onCommit: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const typed = useRef(false);
  useEffect(() => {
    const element = input.current;
    if (element && !typed.current) element.value = shown;
  }, [shown, stored]);
  return (
    <label className="flex items-center gap-1">
      <span aria-hidden="true" className="sb-label">
        {caption}
      </span>
      <input
        ref={input}
        type="time"
        aria-label={label}
        defaultValue={shown}
        className="h-7 w-[96px] border border-text bg-surface-raised px-1.5 font-mono text-[13px] text-text"
        onFocus={() => {
          typed.current = false;
        }}
        // onInput, not onChange: React leaves out a change that ends on the value the field had, and typing the time
        // already shown is how a person makes a worked-out call their own.
        onInput={() => {
          typed.current = true;
        }}
        onBlur={(event) => {
          const next = event.currentTarget.value;
          const wasTyped = typed.current;
          typed.current = false;
          if (!wasTyped || event.currentTarget.validity.badInput || (next !== '' && !isClockTime(next)) || next === stored) {
            event.currentTarget.value = shown;
            return;
          }
          onCommit(next);
        }}
      />
    </label>
  );
}

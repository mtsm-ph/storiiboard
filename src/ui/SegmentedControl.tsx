import { useId } from 'react';
import { cx } from './cx';
import { roveFocus } from './roving';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** md: 30px cells, label above. sm: 18px cells, label beside, for the status bar. */
  size?: 'md' | 'sm';
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'md',
}: SegmentedControlProps<T>) {
  const labelId = useId();
  return (
    <div className={cx('flex', size === 'md' ? 'flex-col gap-[5px]' : 'items-center gap-2')}>
      <span id={labelId} className={cx('sb-label', size === 'sm' && 'text-text-muted')}>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="grid border border-text"
        style={{ gridTemplateColumns: `repeat(${String(options.length)}, minmax(0, 1fr))` }}
      >
        {options.map((option, i) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                onChange(option.value);
              }}
              onKeyDown={(event) => {
                const next = roveFocus(event, i, options.length, '[role="radio"]');
                const nextOption = next === null ? undefined : options[next];
                if (nextOption) onChange(nextOption.value);
              }}
              className={cx(
                'sb-label focus-visible:-outline-offset-4',
                size === 'md' ? 'h-[30px] px-3' : 'h-[18px] px-2',
                i > 0 && 'border-l border-text',
                // Selection is an ink fill, never orange. Focus always lands on the selected cell, so its ring
                // flips to ink-inverse: an ink ring on an ink fill would be invisible.
                selected ? 'bg-text text-text-inverse focus-visible:outline-text-inverse' : 'text-text',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

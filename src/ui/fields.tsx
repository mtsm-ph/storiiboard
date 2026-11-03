import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cx } from './cx';
import { ChevronGlyph } from './glyphs';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string;
  /** Technical values (shot 4B, 35mm, T2.0, 06:30) are always mono. */
  mono?: boolean;
}

export function TextField({ label, mono = false, type = 'text', ...rest }: TextFieldProps) {
  return (
    <label className="flex flex-col gap-[5px]">
      <span className="sb-label">{label}</span>
      <input
        type={type}
        className={cx(
          // ink/70 keeps placeholders at AA on the oatmeal well in both themes; the kit's muted would not.
          'h-8 w-full border border-text bg-surface-raised px-2.5 text-[13px] text-text placeholder:text-text/70',
          mono && 'font-mono',
        )}
        {...rest}
      />
    </label>
  );
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  label: string;
  mono?: boolean;
  children: ReactNode;
}

/** A native select, so the keyboard, screen readers and the OS picker all behave as people expect. */
export function Select({ label, mono = false, children, ...rest }: SelectProps) {
  return (
    <label className="flex flex-col gap-[5px]">
      <span className="sb-label">{label}</span>
      <span className="relative flex">
        <select
          className={cx(
            'h-8 w-full appearance-none border border-text bg-bg pr-7 pl-2 text-[13px] text-text',
            mono && 'font-mono',
          )}
          {...rest}
        >
          {children}
        </select>
        <ChevronGlyph className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2" />
      </span>
    </label>
  );
}

interface SliderProps<T extends number | string> {
  label: string;
  /** The marks on the scale, in order; the slider moves between them. */
  stops: readonly T[];
  value: T;
  onChange: (value: T) => void;
  /** How the current value reads, such as "T2.0". */
  format?: (value: T) => string;
}

/**
 * A native range input under a drawn tick scale. The input stays on top (transparent), so dragging, arrow keys
 * and screen readers all work natively; the drawn thumb follows it.
 */
export function Slider<T extends number | string>({
  label,
  stops,
  value,
  onChange,
  format = String,
}: SliderProps<T>) {
  const id = useId();
  const index = Math.max(0, stops.indexOf(value));
  const last = Math.max(1, stops.length - 1);
  const percent = (index / last) * 100;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between">
        <label htmlFor={id} className="sb-label">
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-xs font-bold">
          {format(value)}
        </output>
      </div>
      <div className="relative h-[22px]">
        <input
          id={id}
          type="range"
          min={0}
          max={stops.length - 1}
          step={1}
          value={index}
          aria-valuetext={format(value)}
          onChange={(event) => {
            const next = stops[Number(event.target.value)];
            if (next !== undefined) onChange(next);
          }}
          className="peer absolute inset-0 z-10 m-0 w-full cursor-pointer opacity-0"
        />
        <div aria-hidden="true" className="absolute inset-x-0 top-[10px] border-t border-text" />
        <div aria-hidden="true" className="absolute inset-x-0 top-1 flex h-1.5 justify-between">
          {stops.map((stop) => (
            <span key={String(stop)} className="w-[1.5px] bg-text" />
          ))}
        </div>
        <div
          aria-hidden="true"
          className="absolute top-[3px] -ml-1.5 h-4 w-3 border border-text bg-bg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-text"
          style={{ left: `${String(percent)}%` }}
        />
      </div>
      <div aria-hidden="true" className="flex justify-between font-mono text-[10px] text-text-muted">
        {stops.map((stop) => (
          <span key={String(stop)}>{String(stop)}</span>
        ))}
      </div>
    </div>
  );
}

interface BarGaugeProps {
  label: string;
  value: number;
  max?: number;
}

/** The kit's "Scene coverage ..... 67%" gauge: a ruled bar with an ink fill. */
export function BarGauge({ label, value, max = 100 }: BarGaugeProps) {
  const labelId = useId();
  const clamped = Math.min(Math.max(value, 0), max);
  const percent = Math.round((clamped / max) * 100);
  return (
    <div className="flex flex-col gap-[5px]">
      <span id={labelId} className="sb-label">
        {label} <span aria-hidden="true">.....</span> {percent}%
      </span>
      <div
        role="meter"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={clamped}
        aria-valuetext={`${String(percent)}%`}
        className="flex h-4 border border-text"
      >
        <div className="bg-text" style={{ width: `${String(percent)}%` }} />
      </div>
    </div>
  );
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** On shows an ink fill, like every selection in the app; orange stays reserved. */
export function Toggle({ label, checked, onChange, disabled = false }: ToggleProps) {
  const labelId = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <span id={labelId} className="text-[13px] font-semibold">
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => {
          onChange(!checked);
        }}
        className={cx(
          'flex h-5 w-10 shrink-0 items-center border border-text p-0 disabled:border-dashed disabled:opacity-60',
          checked ? 'justify-end bg-text' : 'justify-start',
        )}
      >
        <span aria-hidden="true" className={cx('size-3.5', checked ? 'mr-[1.5px] bg-text-inverse' : 'ml-[1.5px] bg-text')} />
      </button>
    </div>
  );
}

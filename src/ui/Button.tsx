import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'warning';

const VARIANT: Record<ButtonVariant, string> = {
  // Orange is reserved for primary actions; text on it is always ink. Dark mode edges it in orange rather than
  // paper, as the kit's dark boards do.
  primary: 'border border-ink bg-accent text-on-accent dark:enabled:border-accent',
  secondary: 'border border-ink text-ink',
  ghost: 'text-ink underline underline-offset-3',
  // Truffle text falls below AA on the dark panel (2.1:1), so dark mode keeps the outline with paper text.
  warning: 'border border-warning text-warning dark:text-ink',
};

// Disabled controls are exempt from AA contrast, which is what lets the kit's oatmeal-and-muted style stand.
const DISABLED =
  'disabled:border disabled:border-dashed disabled:border-muted disabled:bg-oatmeal disabled:text-muted disabled:no-underline';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Mono for technical commands such as "[ IN" and "OUT ]". */
  mono?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  mono = false,
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex h-[34px] shrink-0 items-center gap-2',
        mono ? 'font-mono text-xs font-bold' : 'text-[13px] font-semibold',
        VARIANT[variant],
        // One padding class only: cx joins without merging, so two would be settled by CSS order, not intent.
        variant === 'ghost' ? 'px-1.5' : mono ? 'px-2.5' : 'px-3.5',
        DISABLED,
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Icon buttons have no visible text, so the label is required: it names the button and shows as its tooltip. */
  label: string;
  /** md: 34px bordered control. sm: 22px, borderless, for tile title bars. */
  size?: 'md' | 'sm';
  children: ReactNode;
}

export function IconButton({ label, size = 'md', className, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center text-ink',
        // The 22px title-bar buttons sit against the tile's clipped top edge, so their ring is drawn inside.
        size === 'md' ? 'size-[34px] border border-ink' : 'size-[22px] focus-visible:-outline-offset-2',
        DISABLED,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

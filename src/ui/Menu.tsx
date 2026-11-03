import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';

// A button that opens a panel of commands: the Layout menu, the project menu and the project switcher. It's a
// disclosure (aria-expanded on the button), not an ARIA menu, so Tab moves through the commands as through any
// buttons. Escape or a press outside closes it, and focus goes back to the button.

interface MenuProps {
  /** The button's content. Its text is the button's name. */
  label: ReactNode;
  /** Which edge of the button the panel lines up with; right for menus at the window's right edge. */
  align?: 'left' | 'right';
  buttonClassName?: string;
  panelClassName?: string;
  /** The commands. `close` shuts the panel and returns focus to the button; call it from event handlers. */
  children: (close: () => void) => ReactNode;
}

export function Menu({ label, align = 'left', buttonClassName, panelClassName, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  // By id rather than a ref: close is handed to the commands while they render.
  const focusTrigger = () => document.getElementById(triggerId)?.focus();

  useEffect(() => {
    if (!open) return;
    // Focus the first command that works; failing that the first still to come, which reads out its phase.
    const panel = rootRef.current?.querySelector<HTMLElement>(`#${CSS.escape(panelId)}`);
    (
      panel?.querySelector<HTMLElement>('button:not(:disabled):not([aria-disabled="true"])') ??
      panel?.querySelector<HTMLElement>('button:not(:disabled)') ??
      panel
    )?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      focusTrigger();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
    // focusTrigger only reads triggerId, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, panelId]);

  const close = () => {
    setOpen(false);
    focusTrigger();
  };

  return (
    <div ref={rootRef} className="relative flex h-full">
      <button
        id={triggerId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className={buttonClassName}
      >
        {label}
      </button>
      {open && (
        <div
          id={panelId}
          tabIndex={-1}
          className={cx(
            // Never past the status bar: a long list (Open tile) scrolls rather than covering its controls.
            'absolute top-full z-50 max-h-[calc(100dvh_-_var(--sb-topbar)_-_var(--sb-statusbar)_-_8px)] w-64 overflow-y-auto',
            'border border-border-top bg-surface focus-visible:outline-offset-0',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

export const menuItemClass =
  // Muted text never sits on oatmeal (DESIGN.md), so only commands that work light up on hover.
  'sb-label flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left enabled:hover:bg-surface-raised disabled:text-text-muted';

/**
 * A command whose phase hasn't come. It stays focusable (aria-disabled rather than disabled), so keyboard and
 * screen-reader users find it and hear when it arrives.
 */
export function ComingItem({ label, phase }: { label: string; phase: string }) {
  return (
    <button type="button" aria-disabled="true" className={cx(menuItemClass, 'cursor-default text-text-muted enabled:hover:bg-transparent')}>
      {label}
      <span className="ml-auto">{phase}</span>
    </button>
  );
}

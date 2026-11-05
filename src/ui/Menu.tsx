import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
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
      // Escape in a window of the app's (Export, opened from the menu with ⌘E) is that window's.
      if (event.key !== 'Escape' || (event.target instanceof Element && event.target.closest('dialog[open]'))) return;
      event.stopPropagation();
      setOpen(false);
      focusTrigger();
    };
    // Focus gone elsewhere (a shortcut the menu shows opened History, or a window) closes it, leaving focus there.
    const onFocusIn = (event: FocusEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('focusin', onFocusIn);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('focusin', onFocusIn);
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

/** A keyboard shortcut as a menu shows it: the Mac's symbols there, Ctrl+ elsewhere, and the aria-keyshortcuts value. */
export interface Shortcut {
  label: string;
  aria: string;
}

/** ⌘⇧S on a Mac, Ctrl+Shift+S elsewhere. `key` as printed on the keycap. */
export function commandShortcut(key: string, { shift = false, mac }: { shift?: boolean; mac: boolean }): Shortcut {
  return mac
    ? { label: `⌘${shift ? '⇧' : ''}${key}`, aria: `Meta+${shift ? 'Shift+' : ''}${key}` }
    : { label: `Ctrl+${shift ? 'Shift+' : ''}${key}`, aria: `Control+${shift ? 'Shift+' : ''}${key}` };
}

/**
 * A labelled group of commands (polish A): most-used groups first, at most four to a menu, and anything that undoes or
 * deletes in a group of its own at the bottom. A 1.5px rule above each group but the first is the separator.
 */
export function MenuGroup({ label, children }: { label?: string; children: ReactNode }) {
  const labelId = useId();
  // Only a labelled group is a group to assistive tech: a bare "grouping" says nothing. The last item's own rule gives
  // way to the next group's 1.5px one.
  return (
    <div
      {...(label ? { role: 'group', 'aria-labelledby': labelId } : {})}
      className="border-t-[1.5px] border-text first:border-t-0 [&>button:last-child]:border-b-0"
    >
      {label && (
        <p id={labelId} className="sb-label px-3 pt-2.5 pb-1 text-text-muted">
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

interface MenuItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** Shown at the right, in mono, and given to assistive tech as aria-keyshortcuts. */
  shortcut?: Shortcut | undefined;
  /** A key shown at the right that isn't this item's own (` acts on the tile holding focus): seen, not announced. */
  hint?: string;
}

/** One command. A command that opens a window of the app's own ends its name with "…", as the kit's menus do. */
export function MenuItem({ shortcut, hint, children, className, ...rest }: MenuItemProps) {
  const keysId = useId();
  // The shortcut is read as the item's description, which screen readers announce more often than aria-keyshortcuts.
  return (
    <button
      type="button"
      className={cx(menuItemClass, className)}
      {...(shortcut ? { 'aria-keyshortcuts': shortcut.aria, 'aria-describedby': keysId } : {})}
      {...rest}
    >
      <span className="min-w-0 truncate">{children}</span>
      {shortcut && (
        // Mono like every technical value, at the label's size, not uppercased: a shortcut reads as it's typed.
        // Hidden from the name, so the item is called what it does; aria-describedby still reads it as the description.
        <kbd id={keysId} aria-hidden="true" className="ml-auto shrink-0 pl-3 font-mono text-[10px] tracking-normal normal-case">
          {shortcut.label}
        </kbd>
      )}
      {hint !== undefined && (
        <kbd aria-hidden="true" className="ml-auto shrink-0 pl-3 font-mono text-[12px] font-bold">
          {hint}
        </kbd>
      )}
    </button>
  );
}

import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { t } from '../core/i18n';
import { IconButton } from './Button';
import { cx } from './cx';
import { CloseGlyph } from './glyphs';

// A window inside the app (polish B): Settings, Watermark Settings, Export, a confirm. Never a window of the system's
// own: it moves with the app, stays behind other programs when they come forward, and goes with the app's theme.
// Built on <dialog> opened modal, so everything behind it is inert: Tab and Shift+Tab stay inside, Escape closes, and
// focus goes back to what had it before. It draws like a tile: a 1.5px ink rule, a 26px title bar, no radius or shadow.

interface InAppWindowProps {
  title: string;
  /** Escape, the close button, or the window being closed by the system: the caller decides what closing means. */
  onClose: () => void;
  /** The widest it gets; it never passes the app window, less a 16px margin each side. */
  width?: number;
  /** A fixed height, for a window whose content changes size (Settings' tabs); otherwise it fits its content. */
  height?: number;
  /** Marks a window whose work is the project's own edits, so ⌘Z goes through to them (src/app/shell/workspaces.ts). */
  projectUndo?: boolean;
  className?: string;
  children: ReactNode;
}

export function InAppWindow({ title, onClose, width = 520, height, projectUndo = false, className, children }: InAppWindowProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const latest = useRef(onClose);
  useLayoutEffect(() => {
    latest.current = onClose;
  });
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // Focus returns to what had it, the button that opened the window, say, wherever the engine would put it.
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Chromium (so WebView2) closes a modal dialog on a second Escape without a cancel event the page can stop, so a
    // page can't trap people in one. The close event comes either way: without it the caller would still think the
    // window open, and couldn't open it again.
    const closed = () => {
      // The event comes a moment after the close. Open again by then (Strict Mode runs this effect twice, closing
      // the dialog in between), it's a close that no longer stands.
      if (!element.open) latest.current();
    };
    element.addEventListener('close', closed);
    if (!element.open) {
      element.showModal();
      // Focus starts on the window's first control, its work, not on its close button; in a question that's Cancel.
      element
        .querySelector<HTMLElement>('[data-window-body] :is(button, input, select, textarea, [tabindex]):not(:disabled):not([tabindex="-1"])')
        ?.focus();
    }
    return () => {
      // Going because the caller said so: no close event back to it, which may have opened another window by then.
      element.removeEventListener('close', closed);
      if (element.open) element.close();
      if (before?.isConnected) {
        requestAnimationFrame(() => {
          before.focus();
        });
      }
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      {...(projectUndo ? { 'data-project-undo': '' } : {})}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      style={{ width, ...(height === undefined ? {} : { height }) }}
      className={cx(
        'm-auto max-h-[calc(100dvh-48px)] max-w-[calc(100vw-32px)] flex-col border-[1.5px] border-text bg-surface p-0 text-text backdrop:bg-text/40 open:flex',
        className,
      )}
    >
      <div className="flex h-titlebar shrink-0 items-center gap-2 border-b border-text pr-1 pl-3">
        <h2 id={titleId} className="sb-label min-w-0 flex-1 truncate font-bold">
          {title}
        </h2>
        <IconButton size="sm" label={t('window.close', { title })} onClick={onClose}>
          <CloseGlyph />
        </IconButton>
      </div>
      <div data-window-body="" className="flex min-h-0 flex-1 flex-col overflow-auto">
        {children}
      </div>
    </dialog>
  );
}

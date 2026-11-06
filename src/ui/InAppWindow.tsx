import { createContext, useContext, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { t } from '../core/i18n';
import { IconButton } from './Button';
import { cx } from './cx';
import { CloseGlyph } from './glyphs';

// A window inside the app (polish B): Settings, Watermark Settings, Export, a question. Never a window of the system's
// own: it moves with the app, stays behind other programs when they come forward, and goes with the app's theme.
// Built on <dialog> opened modal, so everything behind it is inert: Tab and Shift+Tab stay inside, Escape closes, and
// focus goes back to what had it before. It draws like a tile: a 1.5px ink rule, a 26px title bar, no radius or shadow.

/** The windows open now, the top one last: a notice shows in the top one, where it can be reached and heard. */
const windowStack = createStore<{ ids: string[] }>()(() => ({ ids: [] }));
const WindowContext = createContext<string | null>(null);

/** How many of the app's windows are open. */
export function useOpenWindowCount(): number {
  return useStore(windowStack, (s) => s.ids.length);
}

/** Inside a window: whether it's the top one. Outside every window: null. */
export function useIsTopWindow(): boolean | null {
  const id = useContext(WindowContext);
  const top = useStore(windowStack, (s) => s.ids.at(-1));
  return id === null ? null : id === top;
}

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
  /** A question the app asks: an alertdialog, described by its text, read as it opens. */
  describedBy?: string;
  /** The close button's name, when "Close <title>" would sound like the action itself ("Close Empty Trash?"). */
  closeLabel?: string;
  className?: string;
  children: ReactNode;
}

export function InAppWindow({ title, onClose, width = 520, height, projectUndo = false, describedBy, closeLabel, className, children }: InAppWindowProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const windowId = useId();
  const latest = useRef(onClose);
  useLayoutEffect(() => {
    latest.current = onClose;
  });
  /**
   * Closing as the person asked: a field still being typed in is left first, so what was typed is committed as when
   * focus leaves it anywhere else (a Title or a Keep field saves on blur), never dropped with the window.
   */
  const close = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && dialog.current?.contains(active)) active.blur();
    latest.current();
  };
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
    windowStack.setState((s) => ({ ids: [...s.ids.filter((id) => id !== windowId), windowId] }));
    if (!element.open) {
      element.showModal();
      // Focus starts on the window's first control, its work: not its close button, nor a notice still showing from
      // before (data-notice), which Tab reaches next. In a question that's Cancel.
      element
        .querySelector<HTMLElement>(
          '[data-window-body] :is(button, input, select, textarea, [tabindex]):not(:disabled):not([tabindex="-1"]):not([data-notice] *)',
        )
        ?.focus();
    }
    return () => {
      // Going because the caller said so: no close event back to it, which may have opened another window by then.
      element.removeEventListener('close', closed);
      windowStack.setState((s) => ({ ids: s.ids.filter((id) => id !== windowId) }));
      if (element.open) element.close();
      // What had focus may have gone while the window was open (a project switched underneath): then the workspace
      // takes it rather than the page. Gone only after (a deleted row), the screen behind places focus itself.
      const goneAlready = !before?.isConnected;
      requestAnimationFrame(() => {
        const target = before?.isConnected ? before : goneAlready ? document.getElementById('workspace-panel') : null;
        // Under another window still open (a question over Settings), only what's inside that window can take it.
        const open = [...document.querySelectorAll('dialog[open]')].at(-1);
        if (!target || (open && !open.contains(target))) return;
        target.focus();
      });
    };
  }, [windowId]);
  return (
    <WindowContext value={windowId}>
      <dialog
        ref={dialog}
        role={describedBy ? 'alertdialog' : undefined}
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        {...(projectUndo ? { 'data-project-undo': '' } : {})}
        onCancel={(event) => {
          // A window opened from inside this one (Licences, from Settings → Storage) sends its Escape up React's tree
          // too: that's its own to close, and this one stays.
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          close();
        }}
        style={{ width, ...(height === undefined ? {} : { height }) }}
        className={cx(
          // The app behind dims in both themes: an ink wash, never the theme's text colour, which is paper in dark.
          'm-auto max-h-[calc(100dvh-48px)] max-w-[calc(100vw-32px)] flex-col border-[1.5px] border-text bg-surface p-0 text-text backdrop:bg-ink-fixed/50 open:flex',
          className,
        )}
      >
        <div className="flex h-titlebar shrink-0 items-center gap-2 border-b border-text pr-1 pl-3">
          <h2 id={titleId} className="sb-label min-w-0 flex-1 truncate font-bold">
            {title}
          </h2>
          <IconButton size="sm" label={closeLabel ?? t('window.close', { title })} onClick={close}>
            <CloseGlyph />
          </IconButton>
        </div>
        <div data-window-body="" className="flex min-h-0 flex-1 flex-col overflow-auto">
          {children}
        </div>
      </dialog>
    </WindowContext>
  );
}

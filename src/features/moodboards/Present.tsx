import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useProject } from '../../app/projectStore';
import { t } from '../../core/i18n';
import { PageStage } from '../../ui/canvas/PageStage';
import type { CanvasItem, CanvasLink } from '../../ui/canvas/types';
import { BOARD_COLOURS, PRESENT_BLACK, PRESENT_WHITE } from './items';
import { presentPages } from './pages';

// Present (5.5, decision 3): an in-app presentation over the whole window. One page at a time, scaled to fit on black, drawn by
// the canvas's renderer read-only: live cards live, pictures at full size, nothing outside the pages. → / Space / Page Down
// go on, ← / Page Up back, Home and End to the ends, F asks the webview for full screen through the Fullscreen API where there is
// one (and does nothing where there isn't), Escape leaves. The page number and count sit in a corner and fade; the live
// region says "Page 3 of 8, The look" as the page changes.

/** The corner's page count fades this long after the last key or pointer move. */
const FADE_MS = 2500;

interface PresentProps {
  boardId: string;
  deckName: string;
  /** The board's items as the canvas draws them (field cards and live cards included) and its connectors. */
  items: readonly CanvasItem[];
  links: readonly CanvasLink[];
  /** The page it begins on: the selected page's id, else the first. */
  startId: string | null;
  onClose: () => void;
}

export function Present({ boardId, deckName, items, links, startId, onClose }: PresentProps) {
  const records = useProject((s) => s.records);
  const pages = useMemo(() => presentPages(records, boardId), [records, boardId]);
  const [index, setIndex] = useState(() => Math.max(0, pages.findIndex((page) => page.id === startId)));
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [awake, setAwake] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const last = pages.length - 1;
  const at = Math.max(0, Math.min(index, Math.max(0, last)));
  const page = pages[at];

  // Latest values for the key handler, which is set up once.
  const state = useRef({ at, last, onClose });
  useEffect(() => {
    state.current = { at, last, onClose };
  });
  // A deck with no page left (deleted from elsewhere) has nothing to present.
  useEffect(() => {
    if (pages.length === 0) onClose();
  }, [pages.length, onClose]);
  // The live region mounts empty and says the page after the first frame, so it is read as news, not as part of the dialog.
  const [said, setSaid] = useState('');

  useEffect(() => {
    root.current?.focus();
    const resize = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', resize);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      setAwake(true);
      clearTimeout(timer);
      timer = setTimeout(() => {
        setAwake(false);
      }, FADE_MS);
    };
    wake();
    const go = (to: number) => {
      setIndex(Math.min(state.current.last, Math.max(0, to)));
    };
    const onKey = (event: KeyboardEvent) => {
      wake();
      // Nothing reaches the app behind the presentation: ⌘Z, Alt+1 to 6, ⌘, and the rest stop here (the overlay is a div, so the
      // app's own modal-dialog guards don't see it). Combinations are also kept from their defaults, so none does anything.
      event.stopImmediatePropagation();
      if (event.metaKey || event.ctrlKey || event.altKey) {
        if (/^(z|y|v|x|c|,|[0-9])$/i.test(event.key) || /^Digit[0-9]$/.test(event.code)) event.preventDefault();
        return;
      }
      const { at: now, last: end } = state.current;
      const handled = (run: () => void) => {
        event.preventDefault();
        event.stopPropagation();
        run();
      };
      switch (event.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          handled(() => {
            go(now + 1);
          });
          break;
        case 'ArrowLeft':
        case 'PageUp':
          handled(() => {
            go(now - 1);
          });
          break;
        case 'Home':
          handled(() => {
            go(0);
          });
          break;
        case 'End':
          handled(() => {
            go(end);
          });
          break;
        case 'Escape':
          handled(() => {
            state.current.onClose();
          });
          break;
        case 'f':
        case 'F':
          // Full screen where the webview offers it; nowhere else does anything happen.
          handled(() => {
            if (document.fullscreenEnabled && !document.fullscreenElement) void root.current?.requestFullscreen().catch(() => undefined);
            else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
          });
          break;
        case 'Tab':
          // The only thing to reach is the close button; focus stays inside the presentation.
          handled(() => {
            const close = root.current?.querySelector<HTMLElement>('[data-present-close]');
            if (document.activeElement === close) root.current?.focus();
            else close?.focus();
          });
          break;
      }
    };
    // Space on a button also clicks it when let go: kept from doing anything here.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ') event.preventDefault();
    };
    // Clipboard events stop here too: a picture pasted now must not land on the frame selected behind the presentation.
    const stopClipboard = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const name of ['paste', 'cut', 'copy']) window.addEventListener(name, stopClipboard, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointermove', wake);
    return () => {
      window.removeEventListener('resize', resize);
      for (const name of ['paste', 'cut', 'copy']) window.removeEventListener(name, stopClipboard, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointermove', wake);
      clearTimeout(timer);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  const shown = page ? new Set(page.items) : new Set<string>();
  const pageItem = page ? items.find((item) => item.id === page.id) : undefined;
  const inside = page ? items.filter((item) => shown.has(item.id)) : [];
  const onPage = page ? links.filter((link) => page.connectors.includes(link.id)) : [];
  const spoken = page
    ? page.name === ''
      ? t('deck.present.page', { number: page.number, count: pages.length })
      : t('deck.present.pageNamed', { number: page.number, count: pages.length, name: page.name })
    : '';

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setSaid(spoken);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [spoken]);

  return createPortal(
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- a click goes on to the next page; the keys are handled on the window
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={t('deck.present.label', { name: deckName })}
      tabIndex={-1}
      data-present=""
      data-present-page={String(at + 1)}
      data-present-count={String(pages.length)}
      data-present-items={JSON.stringify(page?.items ?? [])}
      style={{ background: PRESENT_BLACK, color: PRESENT_WHITE }}
      className="fixed inset-0 z-[100] flex items-center justify-center outline-none"
      onClick={() => {
        setIndex(Math.min(last, at + 1));
      }}
    >
      <p role="status" className="sr-only">
        {said}
      </p>
      {page && pageItem && <PageStage page={pageItem} items={inside} links={onPage} size={size} colours={BOARD_COLOURS} />}
      <p
        aria-hidden="true"
        data-present-corner=""
        className={`pointer-events-none absolute right-4 bottom-3 font-mono text-[12px] motion-safe:transition-opacity ${awake ? 'opacity-100' : 'opacity-0'}`}
      >
        {page ? `${String(page.number)} / ${String(pages.length)}` : ''}
      </p>
      <button
        type="button"
        data-present-close=""
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        style={{ background: PRESENT_BLACK, color: PRESENT_WHITE, borderColor: PRESENT_WHITE, outlineColor: PRESENT_WHITE }}
        className={`sb-label absolute top-3 right-4 h-7 border px-2.5 motion-safe:transition-opacity focus-visible:opacity-100 focus-visible:outline-2 ${awake ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        {t('deck.present.exit')}
      </button>
    </div>,
    document.body,
  );
}

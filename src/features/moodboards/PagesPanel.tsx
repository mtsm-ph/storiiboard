import { useId, useRef, useState } from 'react';
import { projectStore, useProject } from '../../app/projectStore';
import { t } from '../../core/i18n';
import { cx } from '../../ui/cx';
import { Select } from '../../ui/fields';
import { useRowDrag, type RowDragList } from '../../ui/useRowDrag';
import { addPage, deletePage, duplicatePage, movePage } from './deckActions';
import { isPageFormat, isPaper, PAGE_FORMAT_LABEL, PAGE_FORMATS, type PageFormat, type PageOrientation } from './pageFormats';
import { deckPageFormat, pagesOf, type PageInfo } from './pages';
import { moodboardStore, useMoodboard } from './moodboardStore';

// A deck's Pages panel (5.5): a column at the left of the deck's board view, collapsible, listing the pages in order with their
// number and name. Click a page to centre the view on it; drag a row by its handle, or use Move up and Move down (the
// keyboard's way), to reorder; Add page (in the deck's format, or another), Duplicate page and Delete page. Every one is an
// op group of its own. The drag is pointer events (src/ui/useRowDrag.ts), never HTML5 drag and drop, which Tauri's file
// drop turns off inside the Windows app (6.15, docs/DESKTOP_GAPS.md B1); a mouse, a pen or a finger drags alike.

/** A deck's page rows: the deck is the group, its list the box a drop lands in. */
const PAGE_ROWS: RowDragList = {
  rows: (boardId) => [...document.querySelectorAll<HTMLElement>(`[data-pages-list="${CSS.escape(boardId)}"] [data-page-row]`)],
  idOf: (row) => row.dataset.pageRow,
  area: (boardId) => document.querySelector<HTMLElement>(`[data-pages-list="${CSS.escape(boardId)}"]`),
  // The list runs past the box that shows it in a long deck: a drop lands only on what shows, and its edges scroll it.
  scroller: (boardId) => document.querySelector<HTMLElement>(`[data-pages-scroll="${CSS.escape(boardId)}"]`),
  touch: true,
  capture: true,
};

const ACTION = 'sb-label h-6 border border-text px-1.5 hover:bg-surface-raised focus-visible:-outline-offset-4 aria-disabled:border-dashed aria-disabled:text-text-muted aria-disabled:hover:bg-transparent';

export function PagesPanel({ boardId, onCentre }: { boardId: string; onCentre: (page: PageInfo) => void }) {
  const records = useProject((s) => s.records);
  const selection = useMoodboard((s) => s.selections[boardId]);
  const [open, setOpen] = useState(true);
  const [format, setFormat] = useState<PageFormat | ''>('');
  const [turn, setTurn] = useState<PageOrientation | ''>('');
  const root = useRef<HTMLElement>(null);
  const listId = useId();
  const pages = pagesOf(records, boardId);
  const deck = deckPageFormat(records[boardId]);
  const chosen: PageFormat = format === '' ? deck.format : format;
  // Paper turns the way chosen, else the way the deck's own does; the others have no turn.
  const orientation: PageOrientation = !isPaper(chosen) ? 'portrait' : turn !== '' ? turn : chosen === deck.format ? deck.orientation : 'portrait';

  const select = (page: PageInfo) => {
    moodboardStore.getState().select(boardId, [page.id]);
    onCentre(page);
  };
  const nameOf = (page: PageInfo) => (page.fields.name.trim() === '' ? t('deck.pageNumber', { number: page.number }) : t('deck.pageNumberNamed', { number: page.number, name: page.fields.name.trim() }));
  const moveTo = (page: PageInfo, to: number) => {
    void movePage(boardId, page.id, to).then((written) => {
      if (written) moodboardStore.getState().announce(t('deck.pageMoved', { number: to + 1 }));
    });
  };
  const { drag, handleProps } = useRowDrag(PAGE_ROWS, (id, to) => {
    // Read now, not from the render the drag began in: the pages may have changed under it.
    const now = pagesOf(projectStore.getState().records, boardId);
    const page = now.find((p) => p.id === id);
    // Dropped where it started: nothing to write.
    if (page && now.indexOf(page) !== to) moveTo(page, to);
  });

  return (
    <aside ref={root} aria-label={t('deck.pages')} data-pages-panel="" className={cx('flex shrink-0 flex-col border-r border-border', open ? 'w-60' : 'w-9')}>
      <div className="flex items-center justify-between gap-1 border-b border-border p-1">
        {open && <h2 className="sb-label pl-1 text-text-muted">{t('deck.pages')}</h2>}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={open ? t('deck.collapsePages') : t('deck.expandPages')}
          data-pages-toggle=""
          onClick={() => {
            setOpen((now) => !now);
          }}
          className="sb-label h-6 border border-text px-1.5 hover:bg-surface-raised focus-visible:-outline-offset-4"
        >
          {open ? '‹' : '›'}
        </button>
      </div>
      <div id={listId} data-pages-scroll={boardId} className={cx('min-h-0 flex-1 flex-col overflow-y-auto', open ? 'flex' : 'hidden')}>
        {pages.length === 0 && <p className="p-3 text-[12px] text-text-muted">{t('deck.noPages')}</p>}
        <ol data-pages-list={boardId}>
          {pages.map((page, i) => {
            const picked = selection?.includes(page.id) === true;
            const name = nameOf(page);
            return (
              <li key={page.id} data-page-row={page.id} className={cx('border-b border-border p-1.5', picked && 'bg-surface-raised', drag?.id === page.id && 'border-dashed')}>
                <div className="flex items-stretch gap-1">
                  {/* The pointer's way to reorder; Move up and Move down below are the keyboard's, so the handle is no stop of its own. */}
                  <span
                    aria-hidden="true"
                    data-page-handle={page.id}
                    title={t('deck.dragHandle')}
                    {...handleProps(page.id, boardId)}
                    className="flex w-4 shrink-0 cursor-grab touch-none items-center justify-center font-mono text-[12px] text-text-muted select-none"
                  >
                    {t('deck.dragMark')}
                  </span>
                  <button
                    type="button"
                    data-page-select={page.id}
                    aria-current={picked ? 'true' : undefined}
                    onClick={() => {
                      select(page);
                    }}
                    className={cx('flex min-w-0 flex-1 items-center gap-2 px-1 py-1 text-left text-[13px] hover:bg-surface-raised focus-visible:-outline-offset-4', picked && 'font-bold')}
                  >
                    <span className="font-mono text-[12px]">{page.number}</span>
                    <span data-user-text="" className="truncate">
                      {page.fields.name.trim() === '' ? t('deck.unnamedPage') : page.fields.name.trim()}
                    </span>
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label={name}>
                  <button
                    type="button"
                    aria-disabled={i === 0}
                    aria-label={t('deck.moveUp', { page: name })}
                    onClick={() => {
                      if (i > 0) moveTo(page, i - 1);
                    }}
                    className={ACTION}
                  >
                    {t('deck.up')}
                  </button>
                  <button
                    type="button"
                    aria-disabled={i === pages.length - 1}
                    aria-label={t('deck.moveDown', { page: name })}
                    onClick={() => {
                      if (i < pages.length - 1) moveTo(page, i + 1);
                    }}
                    className={ACTION}
                  >
                    {t('deck.down')}
                  </button>
                  <button
                    type="button"
                    aria-label={t('deck.duplicatePage', { page: name })}
                    onClick={() => {
                      void duplicatePage(boardId, page.id);
                    }}
                    className={ACTION}
                  >
                    {t('deck.duplicate')}
                  </button>
                  <button
                    type="button"
                    aria-label={t('deck.deletePage', { page: name })}
                    onClick={() => {
                      void deletePage(boardId, page.id).then((written) => {
                        if (!written) return;
                        moodboardStore.getState().announce(t('deck.pageDeleted', { page: name }));
                        // Focus goes to the next row's button (now at this place), else Add page: the row it was on is gone.
                        requestAnimationFrame(() => {
                          const next = root.current?.querySelectorAll<HTMLElement>('[data-page-select]')[i];
                          (next ?? root.current?.querySelector<HTMLElement>('[data-add-page]'))?.focus();
                        });
                      });
                    }}
                    className={ACTION}
                  >
                    {t('deck.delete')}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      {drag && (
        // Where the dragged page will land: an ink bar between rows.
        <div aria-hidden="true" data-page-drop-bar="" data-page-drop-to={drag.to} className="pointer-events-none fixed z-40 h-[3.5px] bg-text" style={{ left: drag.bar.left, top: drag.bar.top, width: drag.bar.width }} />
      )}
      <div className={cx('flex-col gap-2 border-t border-border p-2', open ? 'flex' : 'hidden')}>
        <Select
          label={t('deck.pageFormat')}
          value={chosen}
          onChange={(event) => {
            if (isPageFormat(event.target.value)) setFormat(event.target.value);
          }}
        >
          {PAGE_FORMATS.map((id) => (
            <option key={id} value={id}>
              {PAGE_FORMAT_LABEL[id]}
            </option>
          ))}
        </Select>
        {isPaper(chosen) && (
          <Select
            label={t('deck.orientation')}
            value={orientation}
            onChange={(event) => {
              setTurn(event.target.value === 'landscape' ? 'landscape' : 'portrait');
            }}
          >
            <option value="portrait">{t('deck.orientation.portrait')}</option>
            <option value="landscape">{t('deck.orientation.landscape')}</option>
          </Select>
        )}
        <button
          type="button"
          data-add-page=""
          onClick={() => {
            // Paper turns the way the deck's own does; the others have no turn.
            void addPage(boardId, chosen, orientation).then((id) => {
              const made = id ? pagesOf(projectStore.getState().records, boardId).find((p) => p.id === id) : undefined;
              if (made) onCentre(made);
            });
          }}
          className="sb-label h-7 border border-text px-2.5 hover:bg-surface-raised focus-visible:-outline-offset-4"
        >
          {t('deck.addPage')}
        </button>
      </div>
    </aside>
  );
}

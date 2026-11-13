import { cx } from '../../../ui/cx';
import { onNavKeyDown } from './navKeys';
import { t } from '../../../core/i18n';

export interface BoardEntry {
  id: string;
  title: string;
  /** A deck (5.5) is marked as one. */
  deck?: boolean;
}

interface BoardListProps {
  boards: readonly BoardEntry[];
  openBoardId: string | null;
  /** False with no project open: there's nowhere to add a board. */
  canAdd: boolean;
  onSelect: (id: string) => void;
  /** "+ Add Board" opens the picker. */
  onAdd: () => void;
  /** Delete on a board's row moves it, with its items, to the Trash. */
  onDelete: (id: string) => void;
}

/** The Moodboard's boards inline in the sidebar, as the Storyboard lists its scenes, then "+ Add Board". */
export function BoardList({ boards, openBoardId, canAdd, onSelect, onAdd, onDelete }: BoardListProps) {
  return (
    <ul aria-label={t('boardList.boards')} className="pb-1">
      {boards.map((board) => {
        const current = board.id === openBoardId;
        return (
          <li key={board.id}>
            <button
              type="button"
              data-nav-item=""
              data-sidebar-board={board.id}
              aria-keyshortcuts="Delete Backspace"
              onKeyDown={(event) => {
                if (event.key === 'Delete' || event.key === 'Backspace') {
                  event.preventDefault();
                  // A held key would go on down the list, a whole board at a time.
                  if (!event.repeat) onDelete(board.id);
                  return;
                }
                onNavKeyDown(event);
              }}
              aria-current={current ? 'true' : undefined}
              tabIndex={-1}
              onClick={() => {
                onSelect(board.id);
              }}
              className="flex h-7 w-full items-center gap-2 px-4 text-left text-[12px] hover:bg-surface-raised focus-visible:-outline-offset-4"
            >
              {/* The open board's marker is orange; its bold name is the second cue. */}
              <span aria-hidden="true" className={cx('size-1.5 shrink-0', current ? 'bg-accent' : 'border border-text')} />
              <span data-user-text="" className={cx('truncate', current && 'font-bold')}>
                {board.title}
              </span>
              {board.deck === true && <span className="sb-label ml-auto font-normal">{t('deck.tag')}</span>}
            </button>
          </li>
        );
      })}
      <li>
        <button
          type="button"
          data-nav-item=""
          onKeyDown={onNavKeyDown}
          tabIndex={-1}
          disabled={!canAdd}
          onClick={onAdd}
          className="sb-label flex h-7 w-full items-center pl-[30px] text-left enabled:hover:bg-surface-raised disabled:text-text-muted focus-visible:-outline-offset-4"
        >
          {t('boardList.addBoard')}
        </button>
      </li>
    </ul>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useProject } from '../../app/projectStore';
import { t } from '../../core/i18n';
import { boardsOf, boardTitle } from '../moodboards/boards';
import { addToBoard } from '../moodboards/liveActions';
import type { CardTarget } from '../moodboards/liveAdd';

// The context menu on a frame or a scene's heading (5.4): "Add to board…" asks which board, then puts a live card for it
// there and opens the board with the card selected. It opens at the pointer, or at the frame from the keyboard (the menu
// key, Shift+F10); Escape or a click outside closes it and focus returns to where it came from.

export interface BoardMenuAsk {
  target: CardTarget;
  from: HTMLElement;
  at: { x: number; y: number };
}

export function AddToBoardMenu({ ask, onClose }: { ask: BoardMenuAsk; onClose: () => void }) {
  const records = useProject((s) => s.records);
  const projectId = useProject((s) => s.project?.projectId ?? null);
  const [choosing, setChoosing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const boards = projectId ? boardsOf(records, projectId) : [];

  // Focus goes to the first command as it opens, and again when the boards list replaces the menu.
  useEffect(() => {
    // With no boards there is no button: focus stays in the panel, on its message.
    (panel.current?.querySelector<HTMLElement>('button') ?? panel.current?.querySelector<HTMLElement>('[data-menu-message]'))?.focus();
  }, [choosing]);

  useEffect(() => {
    const close = (restore: boolean) => {
      onClose();
      if (restore) ask.from.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close(true);
    };
    // Focus moved to something outside the panel: it is done. (Moving between its own commands, or to nothing as one command
    // replaces another, keeps it open.)
    const onFocusOut = (event: FocusEvent) => {
      const to = event.relatedTarget;
      if (to instanceof Node && !panel.current?.contains(to)) close(false);
    };
    const node = panel.current;
    node?.addEventListener('focusout', onFocusOut);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      node?.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [ask.from, onClose]);

  const item = 'sb-label flex h-8 w-full items-center px-2.5 text-left text-text hover:bg-surface-raised focus-visible:-outline-offset-4';
  return (
    <div
      ref={panel}
      role="group"
      aria-label={t('board.addToBoard')}
      data-add-to-board-menu=""
      className="fixed z-40 flex max-h-[min(320px,calc(100vh-16px))] min-w-48 flex-col overflow-y-auto border border-text bg-surface"
      style={{ left: Math.max(8, Math.min(ask.at.x, window.innerWidth - 220)), top: Math.max(8, Math.min(ask.at.y, window.innerHeight - 8 - Math.min(320, 40 + boards.length * 32))) }}
    >
      {!choosing ? (
        <button
          type="button"
          data-add-to-board=""
          className={item}
          onClick={() => {
            setChoosing(true);
          }}
        >
          {t('board.addToBoard')}
        </button>
      ) : boards.length === 0 ? (
        <p tabIndex={-1} data-menu-message="" className="p-2.5 text-[13px]">
          {t('board.addToBoardNone')}
        </p>
      ) : (
        boards.map((board) => (
          <button
            key={board.id}
            type="button"
            data-add-to-board-pick={board.id}
            className={item}
            onClick={() => {
              onClose();
              void addToBoard(board.id, [ask.target]);
            }}
          >
            <span data-user-text="" className="truncate normal-case">
              {boardTitle(board)}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

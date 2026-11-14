import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { showInfo } from '../../app/notice';
import { projectStore, useProject } from '../../app/projectStore';
import { t } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import { frameSetup, joinSetup, leaveSetup, newSetupFromFrames, sceneSetups, setupLabel } from '../../core/model/setup';
import { sceneFields, sceneLabel, shotFields } from '../../core/model/storyboard';
import type { Change } from '../../core/ops/ops';
import { rovingIndex } from '../../ui/roving';
import { boardsOf, boardTitle } from '../moodboards/boards';
import { addToBoard } from '../moodboards/liveActions';
import type { CardTarget } from '../moodboards/liveAdd';

// The context menu on a frame or a scene's heading (5.4): "Add to board…" asks which board, then puts a live card for it
// there and opens the board with the card selected. It opens at the pointer, or at the frame from the keyboard (the menu
// key, Shift+F10); Escape or a click outside closes it and focus returns to where it came from. On a frame it has the
// setup commands too (6.0): New setup from selection, Add to setup (the scene's setups) and Take out of setup. The
// board selects one frame at a time, so the selection is the frame the menu is on. Up and Down move between its
// commands and Tab leaves it, as in any menu.

type View = 'root' | 'boards' | 'setups';

/** A setup command as one edit, and what it did said once it has landed: "4A is in Setup 2 now." */
function setupEdit(shotId: string, build: (now: Readonly<Record<string, SbdRecord>>) => Change[]) {
  void projectStore
    .getState()
    .applyWith((now) => ({ changes: build(now) }))
    .then((written) => {
      if (!written) return;
      const records = projectStore.getState().records;
      const shot = records[shotId];
      if (!shot) return;
      const frame = shotFields(shot.props).number;
      const setup = frameSetup(records, shot);
      showInfo(setup ? t('setups.frameIn', { frame, setup: setupLabel(setup) }) : t('setups.frameOut', { frame }), { step: true });
    });
}

export interface BoardMenuAsk {
  target: CardTarget;
  from: HTMLElement;
  at: { x: number; y: number };
}

export function AddToBoardMenu({ ask, onClose }: { ask: BoardMenuAsk; onClose: () => void }) {
  const records = useProject((s) => s.records);
  const projectId = useProject((s) => s.project?.projectId ?? null);
  const [view, setView] = useState<View>('root');
  const panel = useRef<HTMLDivElement>(null);
  const boards = projectId ? boardsOf(records, projectId) : [];
  // The frame the menu is on, while it's live, with its scene's setups and the one it's in.
  const shot = ask.target.kind === 'shot_card' ? records[ask.target.shotId] : undefined;
  const frame = shot?.type === 'shot' && shot.trashedAt === null && shot.parentId ? shot : null;
  const setups = frame?.parentId ? sceneSetups(records, frame.parentId) : [];
  const inSetup = frame ? frameSetup(records, frame) : null;
  const scene = frame?.parentId ? records[frame.parentId] : undefined;
  const sceneName = scene ? sceneLabel(sceneFields(scene.props).number) : '';

  // Back from the setups' list, focus returns to Add to setup rather than to the first command.
  const backFromSetups = useRef(false);

  // Focus goes to the first command as it opens, and again when a list replaces the menu.
  useEffect(() => {
    const back = backFromSetups.current ? panel.current?.querySelector<HTMLElement>('[data-add-to-setup]') : null;
    backFromSetups.current = false;
    // With no boards there is no button: focus stays in the panel, on its message.
    (back ?? panel.current?.querySelector<HTMLElement>('button') ?? panel.current?.querySelector<HTMLElement>('[data-menu-message]'))?.focus();
  }, [view]);

  // Up, Down, Home and End move between the commands; each is out of the Tab order, so Tab leaves the menu and closes it.
  // Right on Add to setup opens its list, as a submenu opens; Left in the list goes back to it.
  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight' && view === 'root' && document.activeElement?.hasAttribute('data-add-to-setup')) {
      event.preventDefault();
      setView('setups');
      return;
    }
    if (event.key === 'ArrowLeft' && view === 'setups') {
      event.preventDefault();
      backFromSetups.current = true;
      setView('root');
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') return;
    const buttons = [...(panel.current?.querySelectorAll<HTMLElement>('button') ?? [])];
    const at = buttons.findIndex((button) => button === document.activeElement);
    const next = rovingIndex(event.key, Math.max(0, at), buttons.length);
    if (next === null || buttons.length === 0) return;
    event.preventDefault();
    buttons[next]?.focus();
  };

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
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the arrow keys move between the menu's own buttons, each of which is a button
    <div
      ref={panel}
      role="group"
      aria-label={frame ? t('board.frameMenu', { frame: shotFields(frame.props).number }) : t('board.addToBoard')}
      data-add-to-board-menu=""
      onKeyDown={onMenuKeyDown}
      className="fixed z-40 flex max-h-[min(320px,calc(100vh-16px))] min-w-48 flex-col overflow-y-auto border border-text bg-surface"
      style={{ left: Math.max(8, Math.min(ask.at.x, window.innerWidth - 220)), top: Math.max(8, Math.min(ask.at.y, window.innerHeight - 8 - Math.min(320, 40 + Math.max(frame ? 3 : 0, boards.length, setups.length) * 32))) }}
    >
      {view === 'root' ? (
        <>
          <button
            type="button"
            tabIndex={-1}
            data-add-to-board=""
            className={item}
            onClick={() => {
              setView('boards');
            }}
          >
            {t('board.addToBoard')}
          </button>
          {frame && (
            <>
              <button
                type="button"
                tabIndex={-1}
                data-new-setup=""
                className={item}
                onClick={() => {
                  onClose();
                  ask.from.focus();
                  setupEdit(frame.id, (now) => newSetupFromFrames(now, [frame.id]));
                }}
              >
                {t('board.newSetupFromSelection')}
              </button>
              <button
                type="button"
                tabIndex={-1}
                data-add-to-setup=""
                className={item}
                onClick={() => {
                  setView('setups');
                }}
              >
                {t('board.addToSetup')}
                <span aria-hidden="true" className="ml-auto pl-3">
                  {t('board.submenuMark')}
                </span>
              </button>
              {inSetup && (
                <button
                  type="button"
                  tabIndex={-1}
                  data-take-out-of-setup=""
                  className={item}
                  onClick={() => {
                    onClose();
                    ask.from.focus();
                    setupEdit(frame.id, (now) => leaveSetup(now, [frame.id]));
                  }}
                >
                  {t('board.takeOutOfSetup')}
                </button>
              )}
            </>
          )}
        </>
      ) : view === 'setups' ? (
        setups.length === 0 ? (
          <p tabIndex={-1} data-menu-message="" className="p-2.5 text-[13px]">
            {t('board.noSetups', { scene: sceneName })}
          </p>
        ) : (
          setups.map((setup) => (
            <button
              key={setup.record.id}
              type="button"
              tabIndex={-1}
              data-add-to-setup-pick={setup.record.id}
              aria-current={setup.record.id === inSetup?.record.id || undefined}
              className={item}
              onClick={() => {
                onClose();
                ask.from.focus();
                if (frame) setupEdit(frame.id, (now) => joinSetup(now, [frame.id], setup.record.id));
              }}
            >
              <span data-user-text="" className="truncate normal-case">
                {setupLabel(setup)}
              </span>
            </button>
          ))
        )
      ) : boards.length === 0 ? (
        <p tabIndex={-1} data-menu-message="" className="p-2.5 text-[13px]">
          {t('board.addToBoardNone')}
        </p>
      ) : (
        boards.map((board) => (
          <button
            key={board.id}
            type="button"
            tabIndex={-1}
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

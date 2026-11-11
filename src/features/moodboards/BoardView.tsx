import { useMemo } from 'react';
import { useProject } from '../../app/projectStore';
import { t } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import { Canvas } from '../../ui/canvas/Canvas';
import { ToolStrip } from '../../ui/canvas/ToolStrip';
import type { CanvasCommand } from '../../ui/canvas/types';
import { EditableTitle } from '../../ui/EditableTitle';
import { boardFields, boardTitle } from './boards';
import {
  changeGeometry,
  copySelection,
  cutSelection,
  deleteSelection,
  drawRect,
  duplicateSelection,
  nudge,
  pasteClipboard,
  renameBoardTo,
  reorder,
} from './boardActions';
import { canvasItems } from './items';
import { moodboardStore, useMoodboard, viewportOf } from './moodboardStore';

// One open board: the tool strip (a way back to the picker, the board's name, the tools) and the canvas core with the
// board's items. Everything the canvas reports becomes an edit in boardActions.ts; selection, tool and view stay in the
// session (moodboardStore), never in the project.

export function BoardView({ board }: { board: SbdRecord }) {
  const records = useProject((s) => s.records);
  const stored = useMoodboard((s) => s.selections[board.id]);
  const viewports = useMoodboard((s) => s.viewports);
  const tool = useMoodboard((s) => s.tool);
  const clipboard = useMoodboard((s) => s.clipboard);
  const items = useMemo(() => canvasItems(records, board.id), [records, board.id]);
  // An undo that removed an item takes it out of the selection.
  const selection = useMemo(() => (stored ?? []).filter((id) => items.some((item) => item.id === id)), [stored, items]);
  const title = boardTitle(board);
  const free = boardFields(board.props).name !== null;

  const run = (command: CanvasCommand) => {
    switch (command.kind) {
      case 'copy':
        copySelection(board.id);
        break;
      case 'cut':
        void cutSelection(board.id);
        break;
      case 'paste':
        void pasteClipboard(board.id, command.at);
        break;
      case 'duplicate':
        void duplicateSelection(board.id);
        break;
      case 'delete':
        void deleteSelection(board.id);
        break;
      default:
        void reorder(board.id, command.kind);
    }
  };

  return (
    <div className="flex h-full min-h-80 flex-col">
      <ToolStrip tool={tool} onTool={moodboardStore.getState().setTool}>
        <button
          type="button"
          data-boards-back=""
          onClick={() => {
            moodboardStore.getState().openBoard(null);
          }}
          className="sb-label h-7 border border-text px-2.5 hover:bg-surface-raised focus-visible:-outline-offset-4"
        >
          {t('moodboard.allBoards')}
        </button>
        {free ? (
          <EditableTitle
            value={title}
            shown={<span data-board-title="" className="text-[13px] font-bold">{title}</span>}
            label={t('moodboard.nameOf', { name: title })}
            maxLength={80}
            reveal
            onSave={(name) => {
              void renameBoardTo(board.id, name);
            }}
          />
        ) : (
          <span data-board-title="" className="text-[13px] font-bold">
            {title}
          </span>
        )}
      </ToolStrip>
      <div className="min-h-0 flex-1">
        <Canvas
          label={t('moodboard.canvasLabel', { name: title })}
          items={items}
          selection={selection}
          onSelectionChange={(ids) => {
            moodboardStore.getState().select(board.id, ids);
          }}
          tool={tool}
          onToolChange={moodboardStore.getState().setTool}
          viewport={viewportOf(viewports, board.id)}
          onViewportChange={(view) => {
            moodboardStore.getState().setViewport(board.id, view);
          }}
          onGeometry={(changes) => changeGeometry(changes)}
          onNudge={(ids, dx, dy) => nudge(ids, dx, dy)}
          onCreate={(geometry) => drawRect(board.id, geometry)}
          onCommand={run}
          canPaste={clipboard.length > 0}
        />
      </div>
    </div>
  );
}

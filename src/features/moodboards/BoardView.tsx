import { useEffect, useMemo } from 'react';
import { showInfo } from '../../app/notice';
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
  changeStyle,
  duplicateSelection,
  editItem,
  finishEditing,
  nudge,
  placeItem,
  pasteClipboard,
  renameBoardTo,
  reorder,
} from './boardActions';
import { withDrawing } from './drawing';
import { ensureFont, loadSystemFonts, newlyMissing, unreadableFamilies, unreported, useFonts } from './fonts';
import { BOARD_COLOURS, canvasItems, isTextKind, itemFields, itemsOf, KIND_LABEL, propsFor, type ItemFields } from './items';
import { PropertiesStrip } from './PropertiesStrip';
import { TextEditor } from './TextEditor';
import { moodboardStore, useMoodboard, viewportOf } from './moodboardStore';

// One open board: the tool strip (a way back to the picker, the board's name, the tools) and the canvas core with the
// board's items. Everything the canvas reports becomes an edit in boardActions.ts; selection, tool and view stay in the
// session (moodboardStore), never in the project.

/** Which fonts have been named as missing, per board, this session: each is said once. */
const REPORTED = new Set<string>();

export function BoardView({ board }: { board: SbdRecord }) {
  const records = useProject((s) => s.records);
  const stored = useMoodboard((s) => s.selections[board.id]);
  const viewports = useMoodboard((s) => s.viewports);
  const tool = useMoodboard((s) => s.tool);
  const clipboard = useMoodboard((s) => s.clipboard);
  const editing = useMoodboard((s) => s.editing);
  const fontsVersion = useFonts((s) => s.version);
  const fontsStatus = useFonts((s) => s.status);
  const systemFonts = useFonts((s) => s.system);
  const brokenFonts = useFonts((s) => s.broken);
  const mine = editing?.boardId === board.id ? editing : null;
  const placed = useMemo(() => canvasItems(records, board.id), [records, board.id]);
  // A new text box or sticky note being typed into is not in the project yet: it is shown beside the real items.
  const draftFields = useMemo(() => (mine?.draft ? itemFields(propsFor(mine.draft)) : null), [mine]);
  const items = useMemo(() => {
    if (!mine?.draft || !draftFields) return placed;
    const { x, y, width, height, rotation } = mine.draft;
    return [...placed, { id: mine.id, x, y, width, height, rotation, label: KIND_LABEL[mine.draft.kind](), editable: true }];
  }, [placed, mine, draftFields]);
  const fieldsOf = (id: string): ItemFields | null => (mine?.draft && id === mine.id ? draftFields : itemFields(records[id]?.props ?? {}));
  const drawn = useMemo(
    () => withDrawing(items, (id) => (mine?.draft && id === mine.id ? draftFields : itemFields(records[id]?.props ?? {})), mine?.id ?? null, fontsVersion),
    // fontsStatus and systemFonts decide which family a text is drawn in, so they redraw it too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, records, mine, draftFields, fontsVersion, fontsStatus, systemFonts, brokenFonts],
  );
  // An undo that removed an item takes it out of the selection.
  const selection = useMemo(() => (stored ?? []).filter((id) => items.some((item) => item.id === id)), [stored, items]);
  const selectedFields = selection.flatMap((id) => {
    const fields = itemFields(records[id]?.props ?? {});
    return fields ? [fields] : [];
  });

  // What the items are, as plain data on the canvas's wrapper: the canvas is pixels, so the end-to-end tests read the
  // board's kinds, colours and words from here.
  const data = useMemo(
    () => JSON.stringify(itemsOf(records, board.id).flatMap((r) => { const f = itemFields(r.props); return f ? [{ id: r.id, ...f }] : []; })),
    [records, board.id],
  );

  // The computer's fonts are listed once the first board opens, and the faces this board uses are loaded.
  useEffect(() => {
    void loadSystemFonts();
  }, []);
  const used = useMemo(() => {
    const seen = new Map<string, ItemFields>();
    for (const item of items) {
      const fields = fieldsOf(item.id);
      if (fields && isTextKind(fields.kind)) seen.set([fields.fontFamily, String(fields.fontWeight), String(fields.fontItalic)].join('|'), fields);
    }
    return [...seen.values()];
    // fieldsOf reads records and the draft, which items follow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, records, draftFields]);
  useEffect(() => {
    if (fontsStatus !== 'ready') return;
    for (const fields of used) void ensureFont(fields.fontFamily, fields.fontWeight, fields.fontItalic);
    // A font this computer lacks is said once on the board; the text is drawn in Inter Tight meanwhile.
    for (const name of newlyMissing(board.id, used.map((f) => f.fontFamily), { status: fontsStatus, system: systemFonts, broken: brokenFonts }, REPORTED)) {
      showInfo(t('moodboard.fontMissing', { name }));
    }
    // One that is on the computer but can't be read has its own words.
    const view = { status: fontsStatus, system: systemFonts, broken: brokenFonts };
    for (const name of unreported(board.id, unreadableFamilies(used, view).map((n) => `unreadable:${n}`), REPORTED)) {
      showInfo(t('moodboard.fontUnreadable', { name: name.slice('unreadable:'.length) }));
    }
  }, [used, fontsStatus, systemFonts, brokenFonts, board.id]);
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
      {/* A band of one height above the canvas, empty when nothing is selected: the canvas never changes size under a gesture, and nothing on it is covered. */}
      <PropertiesStrip
        fields={selectedFields}
        selectionKey={selection.join('|')}
        onChange={(patch) => {
          void changeStyle(board.id, patch);
        }}
      />
      <div className="min-h-0 flex-1" data-board-data={data}>
        <Canvas
          label={t('moodboard.canvasLabel', { name: title })}
          items={drawn}
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
          onCreate={(geometry, placing) => placeItem(board.id, geometry, placing)}
          onEdit={(id) => {
            editItem(board.id, id);
          }}
          editing={mine?.id ?? null}
          renderEditor={(item, zoom) => {
            const fields = fieldsOf(item.id);
            return fields ? <TextEditor key={item.id} fields={fields} text={fields.text} zoom={zoom} onEnd={(text) => void finishEditing(text)} /> : null;
          }}
          onCommand={run}
          canPaste={clipboard.length > 0}
          fixedColours={BOARD_COLOURS}
        />
      </div>
    </div>
  );
}

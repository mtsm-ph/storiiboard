import { useEffect, useMemo, useRef } from 'react';
import { showInfo } from '../../app/notice';
import { fromFile, choosePictures, onWindowDrop } from '../../app/pictures';
import { useProject } from '../../app/projectStore';
import { isTauriApp } from '../../app/fileAccess';
import { openTile } from '../../app/shell/docking/layout';
import { layoutsOf, layoutStore } from '../../app/shell/docking/layoutStore';
import { useWorkspaceId } from '../../app/shell/workspaceContext';
import { videoDriver } from '../../app/video';
import { t } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import { Canvas } from '../../ui/canvas/Canvas';
import { ToolStrip } from '../../ui/canvas/ToolStrip';
import type { CanvasCommand, Point } from '../../ui/canvas/types';
import { toWorld } from '../../ui/canvas/viewport';
import { EditableTitle } from '../../ui/EditableTitle';
import { useMissingVideos } from '../video/videoStatus';
import { boardFields, boardTitle } from './boards';
import {
  addBoardFiles,
  addBoardPictures,
  openCard,
  pasteFromSystem,
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
import { cardInfo, originalOf } from './cards';
import { markSystemClipboard } from './clipboardMarker';
import { CardProperties } from './CardProperties';
import { withDrawing } from './drawing';
import { LinkDialog } from './LinkDialog';
import { useDrawnLevels } from './PictureNode';
import { ensureFont, loadSystemFonts, newlyMissing, unreadableFamilies, unreported, useFonts } from './fonts';
import { BOARD_COLOURS, canvasItems, isMediaKind, isTextKind, itemFields, itemsOf, KIND_LABEL, propsFor, type ItemFields } from './items';
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
  const linkAsk = useMoodboard((s) => s.linkAsk);
  const workspaceId = useWorkspaceId();
  const missingVideos = useMissingVideos();
  const levels = useDrawnLevels();
  const wrapper = useRef<HTMLDivElement>(null);
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
    () =>
      withDrawing(
        items,
        (id) => (mine?.draft && id === mine.id ? draftFields : itemFields(records[id]?.props ?? {})),
        (id) => {
          const fields = itemFields(records[id]?.props ?? {});
          return fields ? cardInfo(records, id, fields, missingVideos) : null;
        },
        mine?.id ?? null,
        fontsVersion,
      ),
    // fontsStatus and systemFonts decide which family a text is drawn in, so they redraw it too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, records, mine, draftFields, fontsVersion, fontsStatus, systemFonts, brokenFonts, missingVideos],
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
  // Video and link cards are set in JetBrains Mono: loaded once a board has one, and drawn again when it is.
  const hasCards = useMemo(() => itemsOf(records, board.id).some((r) => r.props.kind === 'video' || r.props.kind === 'link'), [records, board.id]);
  useEffect(() => {
    // The faces the cards are set in: mono regular for the length, mono bold for the file name, Inter Tight bold for a link.
    if (hasCards) for (const [family, weight] of [['JetBrains Mono', 400], ['JetBrains Mono', 700], ['Inter Tight', 700]] as const) void ensureFont(family, weight, false);
  }, [hasCards]);

  // Files dropped on the canvas. In the browser build the page's own drag events carry them; in the desktop app Tauri
  // catches the drop and Rust reports the point (src/app/pictures.ts). Either way they land from the drop point.
  const worldAt = (client: { x: number; y: number }): Point | null => {
    const frame = wrapper.current?.querySelector<HTMLElement>('[data-canvas]');
    if (!frame) return null;
    const box = frame.getBoundingClientRect();
    const view = viewportOf(moodboardStore.getState().viewports, board.id);
    return toWorld(view, { width: Math.max(80, Math.round(frame.clientWidth)), height: Math.max(80, Math.round(frame.clientHeight)) }, { x: client.x - box.left, y: client.y - box.top });
  };
  useEffect(() => {
    if (!isTauriApp) return;
    let live = true;
    let stop: (() => void) | null = null;
    void onWindowDrop((files, at) => {
      const over = document.elementFromPoint(at.x, at.y);
      if (over && wrapper.current?.contains(over)) void addBoardPictures(board.id, files, worldAt(at));
    }).then((unlisten) => {
      if (live) stop = unlisten;
      else unlisten();
    });
    return () => {
      live = false;
      stop?.();
    };
    // worldAt reads the refs and the store as they are when a drop lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.id]);
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

  const showPlayer = () => {
    const { layouts, change } = layoutStore.getState();
    change(workspaceId, openTile(layoutsOf(layouts, workspaceId).current, 'player'));
  };
  // One picture, video card or link selected: what the strip adds for it.
  const only = selection.length === 1 ? selection[0] : undefined;
  const onlyFields = only ? itemFields(records[only]?.props ?? {}) : null;
  const strip =
    only && onlyFields && isMediaKind(onlyFields.kind) ? (
      <CardProperties id={only} fields={onlyFields} card={cardInfo(records, only, onlyFields, missingVideos)} original={originalOf(records, only)} />
    ) : null;

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
        <button
          type="button"
          data-board-picture=""
          onClick={() => {
            void choosePictures(true).then((files) => addBoardPictures(board.id, files, null));
          }}
          className="sb-label h-7 border border-text px-2.5 hover:bg-surface-raised focus-visible:-outline-offset-4"
        >
          {t('moodboard.picture')}
        </button>
        <button
          type="button"
          data-board-video=""
          onClick={() => {
            void videoDriver.choose(true).then((videos) => addBoardFiles(board.id, videos.map((file) => ({ kind: 'video' as const, file })), null));
          }}
          className="sb-label h-7 border border-text px-2.5 hover:bg-surface-raised focus-visible:-outline-offset-4"
        >
          {t('moodboard.chooseVideo')}
        </button>
      </ToolStrip>
      {/* A band of one height above the canvas, empty when nothing is selected: the canvas never changes size under a gesture, and nothing on it is covered. */}
      <PropertiesStrip
        fields={selectedFields}
        selectionKey={selection.join('|')}
        onChange={(patch) => {
          void changeStyle(board.id, patch);
        }}
      >
        {strip}
      </PropertiesStrip>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- takes files dropped on the board; the canvas inside is the control */}
      <div
        ref={wrapper}
        className="min-h-0 flex-1"
        data-board-data={data}
        data-picture-levels={JSON.stringify(levels)}
        // Marks the canvas as the board's own for pictures dropped or pasted, so the storyboard's listeners leave them.
        data-moodboard-canvas=""
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          void addBoardPictures(board.id, [...event.dataTransfer.files].map(fromFile), worldAt({ x: event.clientX, y: event.clientY }));
        }}
      >
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
          onOpen={(id) => {
            void openCard(board.id, id, showPlayer);
          }}
          onPasteData={(data, at) => pasteFromSystem(board.id, data, at)}
          onSystemCopy={markSystemClipboard}
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
      {linkAsk?.boardId === board.id && (
        <LinkDialog
          ask={linkAsk}
          onClose={() => {
            moodboardStore.getState().askLink(null);
          }}
        />
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { showInfo } from '../../app/notice';
import { fromFile, choosePictures, onWindowDrop } from '../../app/pictures';
import { projectStore, useProject } from '../../app/projectStore';
import { isMac } from '../../app/shell/undoShortcuts';
import { isTauriApp } from '../../app/fileAccess';
import { openTile } from '../../app/shell/docking/layout';
import { layoutsOf, layoutStore } from '../../app/shell/docking/layoutStore';
import { useWorkspaceId } from '../../app/shell/workspaceContext';
import { videoDriver } from '../../app/video';
import { t } from '../../core/i18n';
import type { SbdRecord } from '../../core/model/record';
import { Canvas } from '../../ui/canvas/Canvas';
import { LABEL_FONT_SIZE } from '../../ui/canvas/LinkShapes';
import { ToolStrip } from '../../ui/canvas/ToolStrip';
import type { CanvasCommand, Point } from '../../ui/canvas/types';
import { fitBounds, toWorld } from '../../ui/canvas/viewport';
import { EditableTitle } from '../../ui/EditableTitle';
import { useMissingVideos } from '../video/videoStatus';
import { boardFields, boardTitle, linkedLine } from './boards';
import { AddFromStoryboard } from './AddFromStoryboard';
import { BoardLinksDialog } from './BoardLinksDialog';
import { BoardPaletteButton } from './BoardPaletteButton';
import { LiveProperties } from './LiveProperties';
import { addFieldCard, openFieldCard } from './deckActions';
import { fieldValue, type FieldValue } from './deckFields';
import { DECK_FIELDS, DECK_FIELD_LABEL } from './pageFormats';
import { isDeck, pageRect, pagesOf, type PageInfo } from './pages';
import { PagesPanel } from './PagesPanel';
import { Present } from './Present';
import { isPresentKey } from './presentKey';
import { Menu, MenuGroup, MenuItem } from '../../ui/Menu';
import { openLiveCard } from './liveActions';
import { isLiveKind, liveCardData, liveLabel, projectIdOf, type LiveCardData } from './liveCards';
import { openExportDialog } from '../export/exportStore';

import {
  addBoardFiles,
  addBoardPictures,
  arrangeSelection,
  openCard,
  pasteFromSystem,
  changeGeometry,
  connect,
  copySelection,
  cutSelection,
  deleteSelection,
  changeStyle,
  duplicateSelection,
  editItem,
  finishEditing,
  nudge,
  placeItem,
  quickCreate,
  pasteClipboard,
  renameBoardTo,
  reorder,
  sectionAroundSelection,
} from './boardActions';
import { cardInfo, originalOf } from './cards';
import { markSystemClipboard } from './clipboardMarker';
import { CardProperties } from './CardProperties';
import { canvasLinks, connectorsOf } from './connectors';
import { connectorFields } from './connectorFields';
import { ConnectorProperties } from './ConnectorProperties';
import { withDrawing } from './drawing';
import { LinkDialog } from './LinkDialog';
import { useDrawnLevels } from './PictureNode';
import { ensureFont, loadSystemFonts, newlyMissing, unreadableFamilies, unreported, useFonts } from './fonts';
import { BOARD_COLOURS, BOARD_INK, canvasItems, isMediaKind, pageNumbers, isTextKind, itemFields, itemsOf, KIND_LABEL, propsFor, SECTION_NAME_SIZE, type ItemFields } from './items';
import { PropertiesStrip } from './PropertiesStrip';
import { TextEditor } from './TextEditor';
import { moodboardStore, useMoodboard, viewportOf } from './moodboardStore';
import { useLocale } from '../../ui/useLocale';

// One open board: the tool strip (a way back to the picker, the board's name, the tools) and the canvas core with the
// board's items. Everything the canvas reports becomes an edit in boardActions.ts; selection, tool and view stay in the
// session (moodboardStore), never in the project.

/** Which fonts have been named as missing, per board, this session: each is said once. */
const REPORTED = new Set<string>();

export function BoardView({ board }: { board: SbdRecord }) {
  const locale = useLocale();
  const records = useProject((s) => s.records);
  const stored = useMoodboard((s) => s.selections[board.id]);
  const viewports = useMoodboard((s) => s.viewports);
  const tool = useMoodboard((s) => s.tool);
  const clipboard = useMoodboard((s) => s.clipboard);
  const clipConnectors = useMoodboard((s) => s.clipConnectors);
  const editing = useMoodboard((s) => s.editing);
  const linkAsk = useMoodboard((s) => s.linkAsk);
  const announcement = useMoodboard((s) => s.announcement);
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
  const links = useMemo(() => canvasLinks(records, board.id), [records, board.id]);
  // A new text box or sticky note being typed into is not in the project yet: it is shown beside the real items.
  const draftFields = useMemo(() => (mine?.draft ? itemFields(propsFor(mine.draft)) : null), [mine]);
  const items = useMemo(() => {
    if (!mine?.draft || !draftFields) return placed;
    const { x, y, width, height, rotation } = mine.draft;
    return [...placed, { id: mine.id, x, y, width, height, rotation, label: KIND_LABEL[mine.draft.kind](), editable: true }];
  }, [placed, mine, draftFields]);
  // What each live card shows, read from the project as it is now (5.4): nothing is stored on the card but which record it names.
  const liveCards = useMemo(() => {
    const out = new Map<string, LiveCardData>();
    for (const record of itemsOf(records, board.id)) {
      const fields = itemFields(record.props);
      if (fields && isLiveKind(fields.kind)) out.set(record.id, liveCardData(records, projectIdOf(records, record.id), { kind: fields.kind, shotId: fields.shotId, sceneId: fields.sceneId }, locale));
    }
    return out;
  }, [records, board.id, locale]);
  const liveOf = (id: string): LiveCardData | null => liveCards.get(id) ?? null;
  const deck = isDeck(board);
  // What each field card shows, read from the project as it is now (5.5), and each page's number in the deck's order.
  const fieldValues = useMemo(() => {
    const out = new Map<string, FieldValue>();
    for (const record of itemsOf(records, board.id)) {
      const fields = itemFields(record.props);
      if (fields?.kind === 'field_card' && fields.field !== '') out.set(record.id, fieldValue(records, projectIdOf(records, record.id), fields.field, locale));
    }
    return out;
  }, [records, board.id, locale]);
  const numbers = useMemo(() => pageNumbers(itemsOf(records, board.id).flatMap((r) => { const f = itemFields(r.props); return f ? [{ id: r.id, kind: f.kind }] : []; })), [records, board.id]);
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
        (id) => liveOf(id),
        mine?.id ?? null,
        fontsVersion,
        { pageNumbers: numbers, fieldOf: (id) => fieldValues.get(id) ?? null },
      ),
    // fontsStatus and systemFonts decide which family a text is drawn in, so they redraw it too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, records, liveCards, fieldValues, numbers, mine, draftFields, fontsVersion, fontsStatus, systemFonts, brokenFonts, missingVideos, locale],
  );
  // An undo that removed an item takes it out of the selection.
  const selection = useMemo(() => (stored ?? []).filter((id) => items.some((item) => item.id === id) || links.some((link) => link.id === id)), [stored, items, links]);
  const selectedFields = selection.flatMap((id) => {
    const fields = itemFields(records[id]?.props ?? {});
    return fields ? [fields] : [];
  });

  // The selected connectors, for the strip.
  const selectedConnectors = selection.flatMap((id) => {
    const fields = records[id] ? connectorFields(records[id].props) : null;
    return fields ? [fields] : [];
  });

  // What the items are, as plain data on the canvas's wrapper: the canvas is pixels, so the end-to-end tests read the
  // board's kinds, colours and words from here.
  const data = useMemo(
    () => JSON.stringify(itemsOf(records, board.id).flatMap((r) => { const f = itemFields(r.props); return f ? [{ id: r.id, ...f }] : []; })),
    [records, board.id],
  );

  // What the live cards show, as plain data too (5.4): the strokes are left out.
  const liveData = useMemo(
    () =>
      JSON.stringify(
        [...liveCards].map(([id, data]) => {
          const { kind, ...rest } = data;
          const plain: Record<string, unknown> = { id, kind, ...rest, label: liveLabel(data) };
          delete plain.strokes;
          // The company's name only: its address, phone and email are private and never needed here.
          if (data.kind === 'brand_card') plain.company = data.company ? { name: data.company.name } : null;
          return plain;
        }),
      ),
    [liveCards],
  );

  // What the field cards show (5.5), as plain data too. Cast and crew are names and roles only, as the cards are.
  const fieldData = useMemo(() => JSON.stringify([...fieldValues].map(([id, value]) => ({ id, field: value.field, text: value.text }))), [fieldValues]);

  // The connectors' props as plain data, for the end-to-end tests.
  const connectorData = useMemo(
    () => JSON.stringify(connectorsOf(records, board.id).flatMap((r) => { const f = connectorFields(r.props); return f ? [{ id: r.id, ...f }] : []; })),
    [records, board.id],
  );

  // The computer's fonts are listed once the first board opens, and the faces this board uses are loaded.
  useEffect(() => {
    void loadSystemFonts();
  }, []);
  // Video and link cards are set in JetBrains Mono: loaded once a board has one, and drawn again when it is.
  const hasCards = useMemo(() => itemsOf(records, board.id).some((r) => r.props.kind === 'video' || r.props.kind === 'link' || (typeof r.props.kind === 'string' && isLiveKind(r.props.kind))), [records, board.id]);
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
    const seen = new Map<string, { fontFamily: string; fontWeight: number; fontItalic: boolean }>();
    for (const item of items) {
      const fields = fieldsOf(item.id);
      if (fields && (isTextKind(fields.kind) || fields.kind === 'field_card')) seen.set([fields.fontFamily, String(fields.fontWeight), String(fields.fontItalic)].join('|'), fields);
    }
    // The brand kit's fonts are set in their own faces (5.4), so they are loaded, and named when this computer lacks one.
    for (const data of liveCards.values()) {
      if (data.kind === 'brand_card') for (const family of data.fonts) seen.set([family, '400', 'false'].join('|'), { fontFamily: family, fontWeight: 400, fontItalic: false });
    }
    return [...seen.values()];
    // fieldsOf reads records and the draft, which items follow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, records, draftFields, liveCards]);
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
  const linked = linkedLine(records, board);
  const [picking, setPicking] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const presentButton = useRef<HTMLButtonElement>(null);
  const pageCount = useMemo(() => pagesOf(records, board.id).length, [records, board.id]);
  const [linking, setLinking] = useState(false);
  const free = boardFields(board.props).name !== null;

  const showTrash = () => {
    const { layouts, change } = layoutStore.getState();
    change(workspaceId, openTile(layoutsOf(layouts, workspaceId).current, 'trash'));
  };
  const showPlayer = () => {
    const { layouts, change } = layoutStore.getState();
    change(workspaceId, openTile(layoutsOf(layouts, workspaceId).current, 'player'));
  };
  // One picture, video card or link selected: what the strip adds for it.
  const only = selection.length === 1 ? selection[0] : undefined;
  const onlyFields = only ? itemFields(records[only]?.props ?? {}) : null;
  const onlyLive = only ? liveOf(only) : null;
  const strip =
    only && onlyFields && isMediaKind(onlyFields.kind) ? (
      <CardProperties id={only} fields={onlyFields} card={cardInfo(records, only, onlyFields, missingVideos)} original={originalOf(records, only)} />
    ) : only && onlyFields && onlyLive ? (
      <LiveProperties boardId={board.id} id={only} data={onlyLive} showTrash={showTrash} />
    ) : selectedConnectors.length > 0 ? (
      <ConnectorProperties boardId={board.id} fields={selectedConnectors} selectionKey={selection.join('|')} />
    ) : null;

  // Present (5.5): ⌘⌥P (Ctrl+Alt+P elsewhere) on a deck with a page. By the key's place, since ⌥P types another letter on a Mac.
  useEffect(() => {
    if (!deck) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isPresentKey(event, isMac())) return;
      event.preventDefault();
      if (pagesOf(projectStore.getState().records, board.id).length > 0) setPresenting(true);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [deck, board.id]);

  /** Centres the view on a page, whole in the canvas (the Pages panel's click). */
  const centreOnPage = (page: PageInfo) => {
    const frame = wrapper.current?.querySelector<HTMLElement>('[data-canvas]');
    const size = { width: Math.max(80, Math.round(frame?.clientWidth ?? 800)), height: Math.max(80, Math.round(frame?.clientHeight ?? 600)) };
    moodboardStore.getState().setViewport(board.id, fitBounds(pageRect(page.fields), size));
  };

  // A deck opens fitted to its first page, unless the person has looked around in it already (L10).
  useEffect(() => {
    if (!deck || moodboardStore.getState().viewports[board.id]) return;
    const frame = requestAnimationFrame(() => {
      const first = pagesOf(projectStore.getState().records, board.id)[0];
      if (first && !moodboardStore.getState().viewports[board.id]) centreOnPage(first);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
    // centreOnPage reads the refs and the store as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, board.id]);

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
      case 'align':
      case 'distribute':
      case 'tidy':
        void arrangeSelection(board.id, command);
        break;
      case 'sectionAround':
        void sectionAroundSelection(board.id);
        break;
      default:
        void reorder(board.id, command.kind);
    }
  };

  return (
    <div className="flex h-full min-h-80 flex-col">
      <ToolStrip
        tool={tool}
        pages={deck}
        // The Page tool belongs to a deck's board (5.5): its key does nothing on a moodboard.
        onTool={(next) => {
          if (next !== 'page' || deck) moodboardStore.getState().setTool(next);
        }}
      >
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
        <button
          type="button"
          data-board-add-live=""
          onClick={() => {
            setPicking(true);
          }}
          className="sb-label h-7 border border-text px-2.5 hover:bg-surface-raised focus-visible:-outline-offset-4"
        >
          {t('moodboard.live.addFromStoryboard')}
        </button>
        {deck && (
          <>
            <button
              ref={presentButton}
              type="button"
              data-present-button=""
              disabled={pageCount === 0}
              aria-keyshortcuts={isMac() ? 'Meta+Alt+P' : 'Control+Alt+P'}
              title={pageCount === 0 ? t('deck.present.noPages') : undefined}
              onClick={() => {
                setPresenting(true);
              }}
              className="sb-label h-7 border border-text bg-accent px-2.5 text-accent-contrast disabled:border-dashed disabled:border-text-muted disabled:bg-surface-raised disabled:text-text-muted focus-visible:-outline-offset-4"
            >
              {t('deck.present')}
            </button>
            {/* Export (5.6a): the app's export dialog with this deck's two formats, a PDF and a PNG for each page. */}
            <button
              type="button"
              data-deck-export=""
              onClick={() => {
                openExportDialog('export', board.id);
              }}
              className="sb-label h-7 border border-text px-2.5 hover:bg-surface-raised focus-visible:-outline-offset-4"
            >
              {t('deck.export')}
            </button>
            {pageCount === 0 && <span className="text-[12px] text-text-muted">{t('deck.present.noPages')}</span>}
            <div className="flex h-7">
            <Menu label={t('deck.addField')} buttonClassName="sb-label h-7 border border-text px-2.5 hover:bg-surface-raised focus-visible:-outline-offset-4" panelClassName="w-44">
              {(close) => (
                <MenuGroup>
                  {DECK_FIELDS.map((id) => (
                    <MenuItem
                      key={id}
                      onClick={() => {
                        close();
                        void addFieldCard(board.id, id);
                      }}
                    >
                      {DECK_FIELD_LABEL[id]}
                    </MenuItem>
                  ))}
                </MenuGroup>
              )}
            </Menu>
            </div>
          </>
        )}
        {/* The scenes, characters and locations this board is about (5.4): read the other way in the places that list a scene's boards. */}
        <span data-board-links="" className="flex min-w-0 items-center gap-2 text-[12px]">
          {linked !== '' && (
            <span data-user-text="" className="truncate">
              {t('moodboard.links.linkedTo', { names: linked })}
            </span>
          )}
          <button
            type="button"
            data-board-links-edit=""
            onClick={() => {
              setLinking(true);
            }}
            className="sb-label h-7 border border-text px-2.5 hover:bg-surface-raised focus-visible:-outline-offset-4"
          >
            {linked === '' ? t('moodboard.links.add') : t('moodboard.links.edit')}
          </button>
          {!deck && <BoardPaletteButton boardId={board.id} />}
        </span>
      </ToolStrip>
      {/* A band of one height above the canvas, empty when nothing is selected: the canvas never changes size under a gesture, and nothing on it is covered. */}
      <PropertiesStrip
        fields={selectedFields}
        selectionKey={selection.join('|')}
        onChange={(patch) => {
          void changeStyle(board.id, patch);
        }}
        onArrange={run}
      >
        {strip}
      </PropertiesStrip>
      <div className="flex min-h-0 flex-1">
      {deck && <PagesPanel boardId={board.id} onCentre={centreOnPage} />}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- takes files dropped on the board; the canvas inside is the control */}
      <div
        ref={wrapper}
        className="min-h-0 min-w-0 flex-1"
        data-board-data={data}
      data-board-connectors={connectorData}
        data-board-live={liveData}
        data-board-fields={fieldData}
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
          links={links}
          onConnect={(drop) => connect(board.id, drop)}
          onQuickCreate={(id, side) => {
            void quickCreate(board.id, id, side);
          }}
          onEdit={(id) => {
            editItem(board.id, id);
          }}
          onOpen={(id) => {
            if (fieldValues.has(id) || itemFields(records[id]?.props ?? {})?.kind === 'field_card') openFieldCard(records, id);
            else if (liveCards.has(id)) openLiveCard(board.id, id, showTrash);
            else void openCard(board.id, id, showPlayer);
          }}
          onPasteData={(data, at) => pasteFromSystem(board.id, data, at)}
          onSystemCopy={markSystemClipboard}
          editing={mine?.id ?? null}
          renderEditor={(item, zoom) => {
            const fields = fieldsOf(item.id);
            // A section's name: one line in Inter Tight bold, on its tab.
            if (fields?.kind === 'section' || fields?.kind === 'page') {
              const named = itemFields(propsFor({ kind: 'text', x: 0, y: 0, width: item.width, height: item.height, rotation: 0, fontSize: SECTION_NAME_SIZE, fontWeight: 700, color: BOARD_INK }));
              return named ? <TextEditor key={item.id} fields={named} text={fields.name} zoom={zoom} singleLine ariaLabel={fields.kind === 'page' ? t('deck.editPageName') : t('moodboard.section.editName')} onEnd={(text) => void finishEditing(text)} /> : null;
            }
            if (fields) return <TextEditor key={item.id} fields={fields} text={fields.text} zoom={zoom} onEnd={(text) => void finishEditing(text)} />;
            // A connector's label: centred, small, in ink as it is drawn, over its paper patch.
            const connector = records[item.id] ? connectorFields(records[item.id]?.props ?? {}) : null;
            const labelAs = connector
              ? itemFields(propsFor({ kind: 'text', x: 0, y: 0, width: item.width, height: item.height, rotation: 0, fontSize: LABEL_FONT_SIZE, align: 'center' }))
              : null;
            return connector && labelAs ? <TextEditor key={item.id} fields={labelAs} text={connector.label} zoom={zoom} ariaLabel={t('moodboard.connector.editLabel')} onEnd={(text) => void finishEditing(text)} /> : null;
          }}
          onCommand={run}
          canPaste={clipboard.length > 0 || clipConnectors.length > 0}
          announcement={announcement}
          fixedColours={BOARD_COLOURS}
        />
      </div>
      </div>
      {presenting && (
        <Present
          boardId={board.id}
          deckName={title}
          items={drawn}
          links={links}
          startId={selection.find((id) => itemFields(records[id]?.props ?? {})?.kind === 'page') ?? null}
          onClose={() => {
            setPresenting(false);
            // Focus goes back to the button that opened it.
            requestAnimationFrame(() => presentButton.current?.focus());
          }}
        />
      )}
      {picking && <AddFromStoryboard boardId={board.id} onClose={() => { setPicking(false); }} />}
      {linking && <BoardLinksDialog boardId={board.id} onClose={() => { setLinking(false); }} />}
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

import { Fragment, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { cx } from '../../../ui/cx';
import { Tile } from '../../../ui/Tile';
import { TILE_CONTENT } from '../tileContent';
import { ScrollMemory, ScrollMemoryScope } from './ScrollMemory';
import { inModalDialog, isTextEntry, TILES, WORKSPACE_PANEL_ID, type Workspace } from '../workspaces';
import { edgePreviewBox, previewBox, windowEdgeAt, zoneAt, type Box } from './geometry';
import {
  dockedAt,
  dockToEdge,
  dropTile,
  findStack,
  removeTile,
  resizeSplit,
  evenOut,
  selectTab,
  stacks,
  tilesIn,
  toggleMaximize,
  type DropZone,
  type Layout,
  type LayoutNode,
  type Stack,
  type WindowEdge,
} from './layout';
import { layoutStore, useLayouts } from './layoutStore';
import { holdTextSelection, releaseTextSelection } from './textSelection';

// Docking on pointer events, with no library and no HTML5 drag and drop: on Windows, Tauri's own file drop has to
// stay on for Phase 2 (footage dragged into frames), and HTML5 drag and drop would need it off (decided Nov 2).

function zoneLabel(zone: DropZone): string {
  return t(`dock.zone.${zone}`);
}

function edgeLabel(edge: WindowEdge): string {
  return t(`dock.edge.${edge}`);
}

/** A drop zone that is also a window edge: top, right or bottom. */
function asEdge(zone: DropZone): WindowEdge | null {
  return zone === 'top' || zone === 'right' || zone === 'bottom' ? zone : null;
}

/** A keyboard move's last stop after every tile: the window's own edges (polish 4). Never a node id, which has none of '#'. */
const WINDOW_TARGET = '#window';

/**
 * The tile last used in each workspace, by focus or a press anywhere on it (a canvas takes no focus, and a Mac's
 * webview doesn't focus a clicked button): the Layout menu's Maximize tile acts on it, as ` does on the tile holding
 * focus (focus is on the menu by then).
 */
const lastUsed = new Map<string, string>();

/** The stack Maximize tile would fill in a workspace: the one last used there, if it's still in the layout. */
export function lastUsedStack(workspaceId: string, layout: Layout): Stack | null {
  const id = lastUsed.get(workspaceId);
  return (id !== undefined ? findStack(layout, id) : undefined) ?? null;
}

/** Pointer travel before a press on a title bar becomes a drag, so a click on it stays a click. */
const DRAG_THRESHOLD_PX = 4;

/** Where a drag would land: an edge or the centre of a tile, or a whole side of the window. */
type Target = { stackId: string; zone: DropZone; box: Box } | { edge: WindowEdge; box: Box };

interface Drag {
  tile: string;
  title: string;
  x: number;
  y: number;
  started: boolean;
  target: Target | null;
}

interface KeyMove {
  tile: string;
  title: string;
  /** Stacks the tile can go to, in reading order. */
  targets: string[];
  index: number;
  /** The zone of the tile picked, kept while the window is picked, so Shift+Tab back finds it as it was. */
  zone: DropZone;
  /** The window's edge, picked with the arrows while the window is the target. */
  edge: WindowEdge;
  box: Box | null;
}

const title = (tile: string) => TILES[tile]?.title ?? tile;

function stackBox(stackId: string): Box | null {
  const el = document.querySelector(`[data-stack-id="${CSS.escape(stackId)}"]`);
  if (!el) return null;
  const { left, top, width, height } = el.getBoundingClientRect();
  return { left, top, width, height };
}

function boxOf(el: Element | null): Box | null {
  if (!el) return null;
  const { left, top, width, height } = el.getBoundingClientRect();
  return { left, top, width, height };
}

/** The space the tiles fill: a window-edge dock spans it. Absent while a tile is maximized. */
const rootBox = () => boxOf(document.querySelector('[data-dock-root]'));

/**
 * The tile under the pointer, ignoring the drag ghost and preview drawn over everything. Past the tiles (the gap around
 * them, the top bar, the status bar, the window's right edge), the window's side instead: the tile would span all of
 * it. `edges` is false for a workspace's only tile, which has nothing to dock beside.
 */
function targetAt(x: number, y: number, edges: boolean, tile: string, layout: Layout): Target | null {
  const root = rootBox();
  const edge = edges && root ? windowEdgeAt(root, x, y) : null;
  // Already along that edge, the drop would change nothing: no band promises otherwise.
  if (edge && root) return dockedAt(layout, tile) === edge ? null : { edge, box: edgePreviewBox(root, edge) };
  const el = document.elementsFromPoint(x, y).find((node) => node instanceof HTMLElement && node.dataset.stackId);
  const stackId = el instanceof HTMLElement ? el.dataset.stackId : undefined;
  if (!stackId) return null;
  const box = stackBox(stackId);
  return box ? { stackId, zone: zoneAt(box, x, y), box } : null;
}

export function Dock({ workspace }: { workspace: Workspace }) {
  const stored = useLayouts((s) => s.layouts[workspace.id].current);
  // A splitter drag previews here and lands in the store (and the undo history) once, when it ends.
  const [draft, setDraft] = useState<Layout | null>(null);
  const layout = draft ?? stored;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [keyMove, setKeyMove] = useState<KeyMove | null>(null);
  const [guide, setGuide] = useState<{ direction: 'row' | 'column'; position: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // Window listeners read the latest layout through this, not the one from when they were added.
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  const commit = (next: Layout) => {
    setDraft(null);
    layoutStore.getState().change(workspace.id, next);
  };
  // Numbers follow the design's order for the workspace, then the order tiles were opened in.
  const present = tilesIn(layout);
  const order = [...workspace.order.filter((t) => present.includes(t)), ...present.filter((t) => !workspace.order.includes(t))];

  // Which tile was last used here, for the Layout menu's Maximize tile (focus is on the menu by the time it's picked).
  useEffect(() => {
    const onUse = (event: Event) => {
      const stackId = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-stack-id]')?.dataset.stackId : undefined;
      if (stackId) lastUsed.set(workspace.id, stackId);
    };
    window.addEventListener('focusin', onUse);
    window.addEventListener('pointerdown', onUse, true);
    return () => {
      window.removeEventListener('focusin', onUse);
      window.removeEventListener('pointerdown', onUse, true);
    };
  }, [workspace.id]);

  // ` maximizes the tile holding focus, or restores; the rest fold into chips along the bottom.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '`' || event.metaKey || event.ctrlKey || event.altKey || isTextEntry(event.target) || inModalDialog(event.target)) return;
      const current = layoutRef.current;
      const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-stack-id]');
      const stackId = focused?.dataset.stackId ?? current.maximized;
      if (!stackId) return;
      event.preventDefault();
      layoutStore.getState().change(workspace.id, toggleMaximize(current, stackId));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [workspace.id]);

  // Moving a tile from the keyboard: Tab picks the tile to drop on, arrows an edge, Space the centre.
  useEffect(() => {
    if (!keyMove) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A window of the app's opened meanwhile (⌘,) keeps its own keys: the move waits behind it.
      if (inModalDialog(event.target)) return;
      const move = keyMove;
      let next: KeyMove | null = move;
      if (event.key === 'Escape') next = null;
      else if (event.key === 'Tab') {
        const step = event.shiftKey ? -1 : 1;
        const index = (move.index + step + move.targets.length) % move.targets.length;
        next = { ...move, index };
      } else if (event.key.startsWith('Arrow')) {
        const zone = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom' } as const)[
          event.key as 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
        ];
        if (move.targets[move.index] === WINDOW_TARGET) {
          // The window's top, right and bottom; never its left, the sidebar's.
          const edge = asEdge(zone);
          event.preventDefault();
          event.stopPropagation();
          if (!edge) {
            setAnnouncement(t('dock.leftIsSidebar'));
            return;
          }
          setKeyMove({ ...move, edge });
          setAnnouncement(t('dock.edgeOfWindow', { edge: edgeLabel(edge) }));
          return;
        }
        next = { ...move, zone };
      } else if (event.key === ' ') {
        if (move.targets[move.index] === WINDOW_TARGET) {
          event.preventDefault();
          event.stopPropagation();
          setAnnouncement(t('dock.noWindowCentre'));
          return;
        }
        next = { ...move, zone: 'center' };
      }
      else if (event.key === 'Enter') {
        const target = move.targets[move.index];
        event.preventDefault();
        setKeyMove(null);
        if (target) {
          const next = target === WINDOW_TARGET ? dockToEdge(layoutRef.current, move.tile, move.edge) : dropTile(layoutRef.current, move.tile, target, move.zone);
          // A tile already along that edge stays as it is, and says so rather than claiming a move.
          const stayed = next === layoutRef.current;
          layoutStore.getState().change(workspace.id, next);
          setAnnouncement(stayed ? t('dock.stayed', { title: move.title }) : t('dock.moved', { title: move.title }));
          // Focus follows the tile to where it landed.
          requestAnimationFrame(() => {
            document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(t('tile.move', { title: move.title }))}"]`)?.focus();
          });
        }
        return;
      } else return;
      event.preventDefault();
      event.stopPropagation();
      if (!next) {
        setKeyMove(null);
        setAnnouncement(t('dock.moveCancelled'));
        return;
      }
      const target = next.targets[next.index];
      if (target === WINDOW_TARGET) {
        // Its box is worked out as it's drawn, so it follows the next redraw after a change of layout (the sidebar folding).
        setKeyMove({ ...next, box: null });
        setAnnouncement(t('dock.edgeOfWindow', { edge: edgeLabel(next.edge) }));
        return;
      }
      setKeyMove({ ...next, box: target ? stackBox(target) : null });
      if (target) {
        const onto = findStack(layoutRef.current, target);
        setAnnouncement(t('dock.zoneOf', { zone: zoneLabel(next.zone), title: title(onto?.active ?? '') }));
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [keyMove, workspace.id]);

  const startKeyMove = (stack: Stack) => {
    // Every other tile, then the window's edges, which take any tile but a workspace's only one.
    const targets = [
      ...stacks(layout.root)
        .filter((s) => s.id !== stack.id || s.tiles.length > 1)
        .map((s) => s.id),
      ...(tilesIn(layout).length > 1 && !layout.maximized ? [WINDOW_TARGET] : []),
    ];
    const first = targets[0];
    if (!first) {
      setAnnouncement(t('dock.noOtherTile'));
      return;
    }
    const tileTitle = title(stack.active);
    setKeyMove({ tile: stack.active, title: tileTitle, targets, index: 0, zone: 'right', edge: 'right', box: stackBox(first) });
    setAnnouncement(t('dock.moving', { title: tileTitle }));
  };

  const startDrag = (stack: Stack, event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const tile = stack.active;
    const origin = { x: event.clientX, y: event.clientY };
    holdTextSelection();
    let current: Drag = { tile, title: title(tile), x: origin.x, y: origin.y, started: false, target: null };
    const edges = tilesIn(layout).length > 1;

    const onMove = (e: globalThis.PointerEvent) => {
      const started = current.started || Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > DRAG_THRESHOLD_PX;
      current = { ...current, x: e.clientX, y: e.clientY, started, target: started ? targetAt(e.clientX, e.clientY, edges, tile, layoutRef.current) : null };
      if (started) setDrag(current);
    };
    const finish = (drop: boolean) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onEscape, true);
      releaseTextSelection();
      setDrag(null);
      const target = current.target;
      if (drop && current.started && target) {
        const next = 'edge' in target ? dockToEdge(layoutRef.current, tile, target.edge) : dropTile(layoutRef.current, tile, target.stackId, target.zone);
        layoutStore.getState().change(workspace.id, next);
      }
    };
    const onUp = () => {
      finish(true);
    };
    const onCancel = () => {
      finish(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      finish(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onEscape, true);
  };

  const renderStack = (stack: Stack, style?: CSSProperties) => {
    const active = stack.active;
    const info = TILES[active];
    const Content = TILE_CONTENT[active];
    return (
      <Tile
        key={stack.id}
        stackId={stack.id}
        index={order.indexOf(active) + 1}
        title={info?.title ?? active}
        {...(stack.tiles.length > 1
          ? {
              tabs: stack.tiles.map((id) => ({ id, label: title(id) })),
              activeTab: active,
              onTabChange: (id: string) => {
                commit(selectTab(layout, stack.id, id));
              },
            }
          : {})}
        maximized={layout.maximized === stack.id}
        onToggleMaximize={() => {
          commit(toggleMaximize(layout, stack.id));
        }}
        {...(order.length > 1
          ? {
              onClose: () => {
                commit(removeTile(layout, active));
                setAnnouncement(t('dock.closed', { title: title(active) }));
              },
            }
          : {})}
        drag={{
          onPointerDown: (event) => {
            startDrag(stack, event);
          },
          onGripKeyDown: (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            startKeyMove(stack);
          },
          moving: keyMove?.tile === active,
        }}
        className="h-full"
        style={style}
      >
        {Content ? (
          // Keeps the tile's scroll position when the layout redraws it (a dock along the top or bottom).
          <ScrollMemory key={active} tile={active}>
            <Content />
          </ScrollMemory>
        ) : (
          <p className="sb-label p-3 text-text-muted">{info?.note}</p>
        )}
      </Tile>
    );
  };

  const renderNode = (node: LayoutNode): ReactNode => {
    if (node.kind === 'stack') return renderStack(node);
    const row = node.direction === 'row';
    return (
      <div className={cx('flex h-full min-h-0 w-full min-w-0', row ? 'flex-row' : 'flex-col')}>
        {node.children.map((child, i) => (
          <Fragment key={child.id}>
            {i > 0 && (
              <Splitter
                direction={node.direction}
                before={node.sizes[i - 1] ?? 0}
                after={node.sizes[i] ?? 0}
                label={t('dock.resize', { first: title(stacks(node.children[i - 1] ?? child)[0]?.active ?? ''), second: title(stacks(child)[0]?.active ?? '') })}
                onResize={(share, done) => {
                  const next = resizeSplit(stored, node.id, i - 1, share);
                  if (done) commit(next);
                  else setDraft(next);
                }}
                onEvenOut={() => {
                  commit(evenOut(stored, node.id, i - 1));
                }}
                onGuide={(position) => {
                  setGuide(position === null ? null : { direction: node.direction, position });
                }}
              />
            )}
            <div
              className={cx(
                'min-h-0 min-w-0',
                // Reflow eases over 180ms (DESIGN.md), but never while a splitter is following the pointer.
                !draft && 'motion-safe:transition-[flex-grow] motion-safe:duration-[180ms] motion-safe:ease-out',
              )}
              style={{ flex: `${String(node.sizes[i] ?? 1)} 1 0px` }}
            >
              {renderNode(child)}
            </div>
          </Fragment>
        ))}
      </div>
    );
  };

  const maximized = layout.maximized ? findStack(layout, layout.maximized) : undefined;
  const dragTarget = drag?.target ?? null;
  const keyEdge = keyMove?.targets[keyMove.index] === WINDOW_TARGET ? keyMove.edge : null;
  const keyRoot = keyEdge ? rootBox() : null;
  // A window edge's box is already the side it would take; a tile's is cut to the half its zone would take.
  const preview = dragTarget
    ? 'edge' in dragTarget
      ? dragTarget.box
      : previewBox(dragTarget.box, dragTarget.zone)
    : keyEdge
      ? keyRoot && edgePreviewBox(keyRoot, keyEdge)
      : keyMove?.box
        ? previewBox(keyMove.box, keyMove.zone)
        : null;
  const previewLabel = dragTarget
    ? 'edge' in dragTarget
      ? edgeLabel(dragTarget.edge)
      : zoneLabel(dragTarget.zone)
    : keyEdge
      ? edgeLabel(keyEdge)
      : keyMove
        ? zoneLabel(keyMove.zone)
        : null;

  return (
    // Scroll positions kept while this workspace's layout redraws its tiles (P4's low); a new workspace starts clean.
    <ScrollMemoryScope>
    <WorkspaceContext value={workspace.id}>
    <div
      id={WORKSPACE_PANEL_ID}
      // Focus can land on the workspace itself, after Alt+number with the sidebar hidden (polish 2).
      tabIndex={-1}
      role="region"
      aria-label={t('dock.workspace', { name: workspace.label })}
      className="flex min-h-0 flex-1 flex-col p-gap focus-visible:outline-offset-[-2px]"
    >
      {maximized ? (
        <>
          <div className="min-h-0 flex-1">{renderStack(maximized)}</div>
          {/* The other tiles wait as chips; restoring brings back every size and position as it was. */}
          <ul aria-label={t('dock.foldedTiles')} className="mt-gap flex shrink-0 gap-gap">
            {order
              .filter((tile) => !maximized.tiles.includes(tile))
              .map((tile) => (
                <li key={tile}>
                  <button
                    type="button"
                    onClick={() => {
                      commit(toggleMaximize(layout, maximized.id));
                    }}
                    className="sb-label border border-border bg-surface px-2.5 py-1.5"
                  >
                    {String(order.indexOf(tile) + 1).padStart(2, '0')} {title(tile)}
                  </button>
                </li>
              ))}
          </ul>
        </>
      ) : (
        <div data-dock-root="" className="min-h-0 flex-1">
          {renderNode(layout.root)}
        </div>
      )}

      {preview && previewLabel !== null && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-40 flex items-center justify-center border-2 border-accent bg-accent/10"
          style={preview}
        >
          {/* The label is the second cue: the orange outline alone never carries meaning (DESIGN.md). */}
          <span className="sb-label bg-text px-1.5 py-1 text-text-inverse">{previewLabel}</span>
        </div>
      )}
      {drag?.started && (
        // The lifted tile: a dashed ghost with a hard ink offset, which is a second box, never a shadow.
        <div aria-hidden="true" className="pointer-events-none fixed z-50" style={{ left: drag.x + 12, top: drag.y + 12 }}>
          <div className="absolute top-1 left-1 h-titlebar w-48 bg-text" />
          <div className="sb-label relative flex h-titlebar w-48 items-center border-[1.5px] border-dashed border-text bg-surface px-2 font-bold">
            {drag.title}
          </div>
        </div>
      )}
      {guide && (
        <div
          aria-hidden="true"
          className={cx(
            'pointer-events-none fixed z-30 border-dashed border-text',
            guide.direction === 'row' ? 'top-0 bottom-0 w-0 border-l-[1.5px]' : 'right-0 left-0 h-0 border-t-[1.5px]',
          )}
          style={guide.direction === 'row' ? { left: guide.position } : { top: guide.position }}
        />
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
    </WorkspaceContext>
    </ScrollMemoryScope>
  );
}

import { Splitter } from './Splitter';
import { WorkspaceContext } from '../workspaceContext';
import { t } from '../../../core/i18n';

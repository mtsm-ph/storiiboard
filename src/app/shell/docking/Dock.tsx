import { Fragment, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { cx } from '../../../ui/cx';
import { Tile } from '../../../ui/Tile';
import { changeLayout } from '../../undo';
import { isTextEntry, TILES, WORKSPACE_PANEL_ID, workspaceTabId, type Workspace } from '../workspaces';
import { previewBox, zoneAt, type Box } from './geometry';
import {
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
} from './layout';
import { useLayouts } from './layoutStore';

// Docking on pointer events, with no library and no HTML5 drag and drop: on Windows, Tauri's own file drop has to
// stay on for Phase 2 (footage dragged into frames), and HTML5 drag and drop would need it off (decided Nov 2).

const ZONE_LABEL: Record<DropZone, string> = {
  left: 'Split left',
  right: 'Split right',
  top: 'Split top',
  bottom: 'Split bottom',
  center: 'Add as tab',
};

/** Pointer travel before a press on a title bar becomes a drag, so a click on it stays a click. */
const DRAG_THRESHOLD_PX = 4;

interface Target {
  stackId: string;
  zone: DropZone;
  box: Box;
}

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
  zone: DropZone;
  box: Box | null;
}

const title = (tile: string) => TILES[tile]?.title ?? tile;

function stackBox(stackId: string): Box | null {
  const el = document.querySelector(`[data-stack-id="${CSS.escape(stackId)}"]`);
  if (!el) return null;
  const { left, top, width, height } = el.getBoundingClientRect();
  return { left, top, width, height };
}

/** The tile under the pointer, ignoring the drag ghost and preview drawn over everything. */
function targetAt(x: number, y: number): Target | null {
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
    changeLayout(workspace.id, next);
  };
  // Numbers follow the design's order for the workspace, then the order tiles were opened in.
  const present = tilesIn(layout);
  const order = [...workspace.order.filter((t) => present.includes(t)), ...present.filter((t) => !workspace.order.includes(t))];

  // ` maximizes the tile holding focus, or restores; the rest fold into chips along the bottom.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '`' || event.metaKey || event.ctrlKey || event.altKey || isTextEntry(event.target)) return;
      const current = layoutRef.current;
      const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-stack-id]');
      const stackId = focused?.dataset.stackId ?? current.maximized;
      if (!stackId) return;
      event.preventDefault();
      changeLayout(workspace.id, toggleMaximize(current, stackId));
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
        next = { ...move, zone };
      } else if (event.key === ' ') next = { ...move, zone: 'center' };
      else if (event.key === 'Enter') {
        const target = move.targets[move.index];
        event.preventDefault();
        setKeyMove(null);
        if (target) {
          changeLayout(workspace.id, dropTile(layoutRef.current, move.tile, target, move.zone));
          setAnnouncement(`${move.title} moved.`);
          // Focus follows the tile to where it landed.
          requestAnimationFrame(() => {
            document.querySelector<HTMLElement>(`[aria-label="Move ${CSS.escape(move.title)}"]`)?.focus();
          });
        }
        return;
      } else return;
      event.preventDefault();
      event.stopPropagation();
      if (!next) {
        setKeyMove(null);
        setAnnouncement('Move cancelled.');
        return;
      }
      const target = next.targets[next.index];
      setKeyMove({ ...next, box: target ? stackBox(target) : null });
      if (target) {
        const onto = findStack(layoutRef.current, target);
        setAnnouncement(`${ZONE_LABEL[next.zone]} of ${title(onto?.active ?? '')}.`);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [keyMove, workspace.id]);

  const startKeyMove = (stack: Stack) => {
    const targets = stacks(layout.root)
      .filter((s) => s.id !== stack.id || s.tiles.length > 1)
      .map((s) => s.id);
    const first = targets[0];
    if (!first) {
      setAnnouncement('There is no other tile to move it next to.');
      return;
    }
    const tileTitle = title(stack.active);
    setKeyMove({ tile: stack.active, title: tileTitle, targets, index: 0, zone: 'right', box: stackBox(first) });
    setAnnouncement(
      `Moving ${tileTitle}. Tab picks a tile, arrow keys an edge, Space adds it as a tab. Enter drops, Escape cancels.`,
    );
  };

  const startDrag = (stack: Stack, event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const tile = stack.active;
    const origin = { x: event.clientX, y: event.clientY };
    let current: Drag = { tile, title: title(tile), x: origin.x, y: origin.y, started: false, target: null };

    const onMove = (e: globalThis.PointerEvent) => {
      const started = current.started || Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > DRAG_THRESHOLD_PX;
      current = { ...current, x: e.clientX, y: e.clientY, started, target: started ? targetAt(e.clientX, e.clientY) : null };
      if (started) setDrag(current);
    };
    const finish = (drop: boolean) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onEscape, true);
      setDrag(null);
      if (drop && current.started && current.target) {
        changeLayout(workspace.id, dropTile(layoutRef.current, tile, current.target.stackId, current.target.zone));
      }
    };
    const onUp = () => {
      finish(true);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      finish(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onEscape, true);
  };

  const renderStack = (stack: Stack, style?: CSSProperties) => {
    const active = stack.active;
    const info = TILES[active];
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
                setAnnouncement(`${title(active)} closed.`);
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
        <p className="sb-label p-3 text-muted">{info?.note}</p>
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
                label={`Resize ${title(stacks(node.children[i - 1] ?? child)[0]?.active ?? '')} and ${title(stacks(child)[0]?.active ?? '')}`}
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
  const preview = drag?.target ? previewBox(drag.target.box, drag.target.zone) : keyMove?.box ? previewBox(keyMove.box, keyMove.zone) : null;
  const previewZone = drag?.target?.zone ?? keyMove?.zone;

  return (
    <div
      id={WORKSPACE_PANEL_ID}
      role="tabpanel"
      aria-labelledby={workspaceTabId(workspace.id)}
      className="flex min-h-0 flex-1 flex-col p-gap"
    >
      {maximized ? (
        <>
          <div className="min-h-0 flex-1">{renderStack(maximized)}</div>
          {/* The other tiles wait as chips; restoring brings back every size and position as it was. */}
          <ul aria-label="Folded tiles" className="mt-gap flex shrink-0 gap-gap">
            {order
              .filter((tile) => !maximized.tiles.includes(tile))
              .map((tile) => (
                <li key={tile}>
                  <button
                    type="button"
                    onClick={() => {
                      commit(toggleMaximize(layout, maximized.id));
                    }}
                    className="sb-label border border-rule bg-panel px-2.5 py-1.5"
                  >
                    {String(order.indexOf(tile) + 1).padStart(2, '0')} {title(tile)}
                  </button>
                </li>
              ))}
          </ul>
        </>
      ) : (
        <div className="min-h-0 flex-1">{renderNode(layout.root)}</div>
      )}

      {preview && previewZone && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-40 flex items-center justify-center border-2 border-accent bg-accent/10"
          style={preview}
        >
          {/* The label is the second cue: the orange outline alone never carries meaning (DESIGN.md). */}
          <span className="sb-label bg-ink px-1.5 py-1 text-ink-inverse">{ZONE_LABEL[previewZone]}</span>
        </div>
      )}
      {drag?.started && (
        // The lifted tile: a dashed ghost with a hard ink offset, which is a second box, never a shadow.
        <div aria-hidden="true" className="pointer-events-none fixed z-50" style={{ left: drag.x + 12, top: drag.y + 12 }}>
          <div className="absolute top-1 left-1 h-titlebar w-48 bg-ink" />
          <div className="sb-label relative flex h-titlebar w-48 items-center border-[1.5px] border-dashed border-ink bg-panel px-2 font-bold">
            {drag.title}
          </div>
        </div>
      )}
      {guide && (
        <div
          aria-hidden="true"
          className={cx(
            'pointer-events-none fixed z-30 border-dashed border-ink',
            guide.direction === 'row' ? 'top-0 bottom-0 w-0 border-l-[1.5px]' : 'right-0 left-0 h-0 border-t-[1.5px]',
          )}
          style={guide.direction === 'row' ? { left: guide.position } : { top: guide.position }}
        />
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

import { Splitter } from './Splitter';

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { showInfo } from '../../../app/notice';
import { usePlanUnit } from '../../../app/planUnits';
import { useProject } from '../../../app/projectStore';
import { t } from '../../../core/i18n';
import type { GridSnap } from '../../../ui/canvas/scale';
import type { Tool } from '../../../ui/canvas/types';
import { TextField } from '../../../ui/fields';
import { iconHome } from '../../../core/model/planRooms';
import { croppedIconUrl } from './iconDraw';
import { TOOL_ICONS } from './iconSizes';
import { dropAt, groupName, libraryGroups, libraryState, type DropView, type LibraryEntry, type LibraryState } from './library';
import { placeIcon, type PlanView } from './planActions';
import { viewKey, type IconRefusal } from './planItems';
import { planScale } from './planScale';
import { planStore, planViewportOf } from './planStore';
import { useLiveView } from './PlanTile';

// The Library tile (6.3), in the Setup workspace: the kit's plan icons by department, each placed on the plan shown at
// its real size by a drag (pointer events, a ghost at real size under the pointer, snapped to the grid as a moved item
// is; never HTML drag and drop, which the Windows app turns off) or from the keyboard (Enter puts it in the middle of
// the view, selected, and the plan takes the focus so the arrows nudge it). Escape during a drag drops nothing. Wall,
// door and window pick 6.2's tools; what comes later in this phase shows greyed out and says so.

/** How far the pointer moves before a press on an icon is a drag, screen pixels. */
const DRAG_FROM = 4;

/** The plan canvas the Library places onto, when its tile is open. */
const planCanvas = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-plan-tile] [data-canvas]');

/** The view the plan canvas shows, as it reports it; without a canvas, the view kept for the plan shown. */
function dropView(view: PlanView, canvas: HTMLElement | null): DropView {
  if (canvas) {
    const n = (name: string) => Number(canvas.getAttribute(name));
    // As the canvas measures itself.
    return { cx: n('data-cx'), cy: n('data-cy'), zoom: n('data-zoom') || 1, width: Math.max(80, Math.round(canvas.clientWidth)), height: Math.max(80, Math.round(canvas.clientHeight)) };
  }
  const kept = planViewportOf(planStore.getState().viewports, viewKey(view.sceneId, view.setupId));
  return { ...kept, width: 0, height: 0 };
}

const snapOf = (event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean }): GridSnap => (event.metaKey || event.ctrlKey ? 'off' : event.altKey ? 'fine' : 'magnet');

/** Why an icon can't be placed, in words, as a notice. */
function sayRefusal(why: IconRefusal, label: string): void {
  if (why === 'coming') showInfo(t('library.comingNotice', { what: label }));
  else if (why === 'noRoom') showInfo(t('library.needsRoom'));
  else if (why === 'noSetup') showInfo(t('library.needsSetup', { what: label }));
  else if (why === 'noScene') showInfo(t('library.pick'));
}

/** The plan takes the focus after a placement or a tool picked, so the arrows nudge and the tool's keys work. */
const focusPlan = () => {
  planCanvas()?.focus();
};

interface Ghost {
  url: string;
  /** Screen pixels, the window's. */
  x: number;
  y: number;
  width: number;
  height: number;
  over: boolean;
}

function stateWords(state: LibraryState): string | null {
  if (state.kind === 'noView') return t('library.pick');
  if (state.kind === 'noRoom') return t('library.noRoom', { scene: state.scene });
  if (state.kind === 'noSetup') return t('library.noSetup');
  return null;
}

export function LibraryTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const live = useLiveView(records);
  const [filter, setFilter] = useState('');
  const stateId = useId();
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('plan.noProject')}</p>;
  const view = live?.view ?? null;
  const state = libraryState(records, view);
  const words = stateWords(state);
  const groups = libraryGroups(filter);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3" data-library-tile="" data-library-state={state.kind}>
      <TextField
        label={t('library.filter')}
        type="search"
        autoComplete="off"
        value={filter}
        onChange={(event) => {
          setFilter(event.target.value);
        }}
      />
      <p id={stateId} className="text-[12px] text-text-muted" data-library-says="">
        {words ?? t('library.hint')}
      </p>
      {groups.length === 0 && <p className="text-[13px]">{t('library.none')}</p>}
      {groups.map(({ group, entries }) => (
        <LibraryGroupView key={group} group={group} entries={entries} view={view} state={state} stateId={stateId} />
      ))}
    </div>
  );
}

function LibraryGroupView({ group, entries, view, state, stateId }: { group: LibraryEntry['icon']['group']; entries: readonly LibraryEntry[]; view: PlanView | null; state: LibraryState; stateId: string }) {
  const headingId = useId();
  const noteId = useId();
  const coming = entries.filter((e) => e.use === 'coming').length;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5" data-library-group={group}>
      <h3 id={headingId} className="sb-label">
        {groupName(group)}
      </h3>
      {coming > 0 && (
        <p id={noteId} className="text-[11px] text-text-muted">
          {coming === entries.length ? t('library.coming') : t('library.comingSome')}
        </p>
      )}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(68px,1fr))] gap-1.5">
        {entries.map((entry) => (
          <li key={entry.icon.id} className="flex">
            <IconButton entry={entry} view={view} state={state} describedBy={entry.use === 'coming' ? noteId : stateId} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Whether an entry can be placed now, from what the tile knows: refused ones show greyed out and say why when pressed. */
function refusalNow(entry: LibraryEntry, view: PlanView | null, state: LibraryState): IconRefusal | null {
  if (entry.use !== 'place') return entry.use === 'coming' ? 'coming' : null;
  if (state.kind === 'noView' || !view) return 'noScene';
  if (state.kind === 'noRoom') return 'noRoom';
  if (state.kind === 'noSetup' && iconHome(entry.icon.id) === 'setup') return 'noSetup';
  return null;
}

function IconButton({ entry, view, state, describedBy }: { entry: LibraryEntry; view: PlanView | null; state: LibraryState; describedBy: string }) {
  const unit = usePlanUnit();
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const drag = useRef<{ pointer: number; start: { x: number; y: number }; moving: boolean; dropped: boolean } | null>(null);
  const refused = refusalNow(entry, view, state);
  const muted = refused !== null;
  const tool = TOOL_ICONS[entry.icon.id] as Tool | undefined;

  // Escape during a drag drops nothing.
  useEffect(() => {
    if (!ghost) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      drag.current = null;
      setGhost(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [ghost]);

  const place = async (centre: { x: number; y: number }) => {
    if (!view) return;
    const why = await placeIcon(view, entry.icon.id, centre);
    if (why !== null) sayRefusal(why, entry.label);
    else focusPlan();
  };

  /** Enter, Space or a click without a drag: a tool picked, or the icon in the middle of the view. */
  const activate = () => {
    if (tool) {
      planStore.getState().setTool(tool);
      focusPlan();
      return;
    }
    if (refused !== null || !view) {
      sayRefusal(refused ?? 'noScene', entry.label);
      return;
    }
    const at = dropView(view, planCanvas());
    const spot = dropAt(entry.icon.id, { x: at.width / 2, y: at.height / 2 }, at, planScale(unit).grid, 'magnet');
    if (spot) void place(spot.centre);
  };

  /** The ghost and where it lands, for the pointer at a window point. */
  const follow = (event: { clientX: number; clientY: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): Ghost & { centre: { x: number; y: number } | null } => {
    const url = croppedIconUrl(entry.icon);
    const canvas = planCanvas();
    const box = canvas?.getBoundingClientRect();
    const inside = box !== undefined && event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (canvas && box && inside && view) {
      const spot = dropAt(entry.icon.id, { x: event.clientX - box.left, y: event.clientY - box.top }, dropView(view, canvas), planScale(unit).grid, snapOf(event));
      if (spot) return { url, x: box.left + spot.screen.x, y: box.top + spot.screen.y, width: spot.screen.width, height: spot.screen.height, over: true, centre: spot.centre };
    }
    return { url, x: event.clientX - 16, y: event.clientY - 16, width: 32, height: 32, over: false, centre: null };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || muted || tool) return;
    drag.current = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, moving: false, dropped: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const now = drag.current;
    if (now?.pointer !== event.pointerId) return;
    if (!now.moving && Math.hypot(event.clientX - now.start.x, event.clientY - now.start.y) < DRAG_FROM) return;
    now.moving = true;
    const at = follow(event);
    setGhost({ url: at.url, x: at.x, y: at.y, width: at.width, height: at.height, over: at.over });
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const now = drag.current;
    if (now?.pointer !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setGhost(null);
    if (!now.moving) {
      drag.current = null;
      return;
    }
    // The click that follows a drag places nothing more; one that never comes leaves nothing behind.
    now.dropped = true;
    setTimeout(() => {
      if (drag.current === now) drag.current = null;
    }, 0);
    const { centre } = follow(event);
    if (centre) void place(centre);
  };
  const onPointerCancel = () => {
    drag.current = null;
    setGhost(null);
  };

  return (
    <>
      <button
        type="button"
        data-library-icon={entry.icon.id}
        data-library-use={entry.use}
        aria-disabled={muted ? true : undefined}
        aria-describedby={muted ? describedBy : undefined}
        title={entry.label}
        className="flex min-w-0 flex-1 touch-none flex-col items-center gap-1 border border-text px-1 py-1.5 text-center text-[11px] leading-tight select-none hover:bg-surface-raised focus-visible:-outline-offset-4"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={() => {
          const now = drag.current;
          drag.current = null;
          if (now?.dropped) return;
          activate();
        }}
      >
        {/* The kit's SVG as it is, never recoloured: on paper in both themes, so its ink always reads (decision 13). */}
        <span className="flex h-9 w-9 items-center justify-center bg-paper-fixed">
          <img src={croppedIconUrl(entry.icon)} alt="" width={28} height={28} draggable={false} className={muted ? 'opacity-40' : undefined} style={{ objectFit: 'contain' }} />
        </span>
        {/* A long word (Spanish "Estacionamiento") breaks rather than spilling out of its button. */}
        <span className={muted ? 'max-w-full text-text-muted [overflow-wrap:anywhere]' : 'max-w-full [overflow-wrap:anywhere]'}>{entry.label}</span>
      </button>
      {ghost &&
        createPortal(
          <img
            src={ghost.url}
            alt=""
            aria-hidden="true"
            data-library-ghost={entry.icon.id}
            data-library-ghost-over={ghost.over ? 'plan' : 'none'}
            draggable={false}
            style={{ position: 'fixed', left: ghost.x, top: ghost.y, width: ghost.width, height: ghost.height, pointerEvents: 'none', opacity: ghost.over ? 0.8 : 0.5, zIndex: 1000 }}
          />,
          document.body,
        )}
    </>
  );
}


import { useMemo, useState, type ReactNode } from 'react';
import { usePlanUnit } from '../../../app/planUnits';
import { projectStore, useProject } from '../../../app/projectStore';
import { t, tn } from '../../../core/i18n';
import { isOpening, OPENING_WIDTH, planFields, roomTitle, sceneRoom, wallEnds, type OpeningKind } from '../../../core/model/plan';
import { alsoInRoom, roomChoices, setupCopySources, setupHasItems } from '../../../core/model/planRooms';
import { openingFrame } from '../../../core/model/openings';
import type { SbdRecord } from '../../../core/model/record';
import { sceneSetups } from '../../../core/model/setup';
import { sceneFields, sceneLabel } from '../../../core/model/storyboard';
import { Button } from '../../../ui/Button';
import { Canvas } from '../../../ui/canvas/Canvas';
import { INK, PAPER_COLOURS } from '../../../ui/canvas/paperColours';
import { ToolStrip } from '../../../ui/canvas/ToolStrip';
import type { CanvasCommand, CanvasItem, Point } from '../../../ui/canvas/types';
import { TextField } from '../../../ui/fields';
import { InAppWindow } from '../../../ui/InAppWindow';
import { Menu, MenuGroup, MenuItem } from '../../../ui/Menu';
import { Trans } from '../../../ui/Trans';
import { useLocale } from '../../../ui/useLocale';
import {
  changePlanGeometry,
  copyPlanSelection,
  copySetup,
  cutPlanSelection,
  deletePlanSelection,
  deleteRoom,
  drawWalls,
  duplicatePlanSelection,
  flipDoors,
  newRoom,
  nudgePlan,
  pastePlan,
  placeOpening,
  renameRoom,
  reorderPlan,
  separateCopy,
  chooseRoom,
  type PlanView,
} from './planActions';
import { openingDistances, openingItem, openingSpot, openingSpotInWall, planConstrain, planItemsBuilder, shownItemsKeeper, viewKey } from './planItems';
import { DOOR_TOOL, PLAN_TOOLS, PLAN_ZOOM, planScale, toMetres, WALL_TOOL, WINDOW_TOOL } from './planScale';
import { planStore, planViewportOf, usePlan } from './planStore';
import { openingKey, useShownPlan } from './shownPlan';

// The Plan tile (6.2a, 6.2b), in the Setup workspace: the setup picked in the Setups tile (or a scene picked by its
// heading) as a top-down plan in real units, on paper in light and dark (decision 13). A scene's room is started new or
// chosen from the rooms already drawn (a room is shared, decision 2); the room's menu renames it, swaps it, copies it
// for this scene alone or deletes it. Walls are drawn point to point, and doors and windows put into them. Everything
// the canvas reports becomes an edit in planActions.ts.

type Records = Readonly<Record<string, SbdRecord>>;

/** The view the Setup workspace shows, while its scene (and setup) are live. */
export function useLiveView(records: Records): { view: PlanView; scene: SbdRecord; setup: SbdRecord | null; number: number | null } | null {
  const { sceneId, setupId } = useShownPlan();
  if (sceneId === null) return null;
  const scene = records[sceneId];
  if (scene?.type !== 'scene' || scene.trashedAt !== null) return null;
  const setups = sceneSetups(records, sceneId);
  const setup = setupId === null ? undefined : setups.find((s) => s.record.id === setupId);
  return { view: { sceneId, setupId: setup ? setup.record.id : null }, scene, setup: setup?.record ?? null, number: setup?.number ?? null };
}

/**
 * Starting a scene's room (6.2b): "New room", or one of the rooms already drawn, those at the scene's location first,
 * each with its location and how many scenes use it. Choosing one is one edit.
 */
function RoomChooser({ sceneId, onChosen }: { sceneId: string; onChosen?: () => void }) {
  const records = useProject((s) => s.records);
  const choices = roomChoices(records, sceneId);
  return (
    <div className="flex flex-col gap-3" data-room-chooser="">
      <div>
        <Button
          variant="primary"
          data-new-room=""
          onClick={() => {
            void newRoom(sceneId).then(() => onChosen?.());
          }}
        >
          {t('plan.newRoom')}
        </Button>
      </div>
      {choices.length > 0 && (
        <section aria-labelledby={`rooms-${sceneId}`} className="flex flex-col gap-2">
          <h3 id={`rooms-${sceneId}`} className="sb-label">
            {t('plan.chooseRoom')}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {choices.map((choice) => (
              <li key={choice.id}>
                <button
                  type="button"
                  data-room-choice={choice.id}
                  className="flex w-full flex-col items-start border border-text px-2.5 py-1.5 text-left text-[13px] hover:underline"
                  onClick={() => {
                    void chooseRoom(sceneId, choice.id).then(() => onChosen?.());
                  }}
                >
                  <span className="font-bold" data-user-text="">
                    {choice.name}
                  </span>
                  <span>
                    {choice.location !== '' && (
                      <>
                        <span data-user-text="">{choice.location}</span>
                        {' · '}
                      </>
                    )}
                    {tn('selection.roomScenes', choice.scenes)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function PlanTile() {
  const project = useProject((s) => s.project);
  const records = useProject((s) => s.records);
  const live = useLiveView(records);
  if (!project) return <p className="sb-label p-3 text-text-muted">{t('plan.noProject')}</p>;
  if (!live) return <p className="p-3 text-[13px] text-text-muted">{t('plan.pick')}</p>;
  const scene = sceneLabel(sceneFields(live.scene.props).number);
  const room = sceneRoom(records, live.scene.id);
  const name = live.setup && typeof live.setup.props.name === 'string' ? live.setup.props.name.trim() : '';
  const header = (
    <h2 data-plan-header="" className="min-w-0 truncate text-[13px] font-bold">
      <span className="font-mono">{scene}</span>
      {live.number !== null && (
        <>
          {' · '}
          <Trans k="setup.label" parts={{ number: <span className="font-mono">{live.number}</span> }} />
        </>
      )}
      {name !== '' && (
        <>
          {' · '}
          <span data-user-text="">{name}</span>
        </>
      )}
    </h2>
  );
  if (!room) {
    return (
      <div className="flex flex-col gap-3 overflow-y-auto p-3" data-plan-tile="">
        {header}
        <p className="text-[13px]">{t('plan.noRoom', { scene })}</p>
        <RoomChooser sceneId={live.scene.id} />
      </div>
    );
  }
  // A canvas per view and per opening of a project: nothing it holds (a run of walls being drawn above all) carries into
  // another view, nor into another project that shares the ids (a version, a backup). A run in progress when the view
  // changes ends as Escape ends it, written into the room it was drawn in; when the project changes, it writes nothing.
  return <PlanCanvas key={`${openingKey(project)}:${viewKey(live.view.sceneId, live.view.setupId)}`} view={live.view} header={header} room={room} />;
}

const MENU_BUTTON = 'sb-label flex h-7 items-center gap-1.5 border border-text px-2.5 hover:bg-surface-raised focus-visible:-outline-offset-4';

/** The room's menu (6.2b): Rename, Use another room…, Make a separate copy (shared rooms), Delete room (unshared ones). */
function RoomMenu({ sceneId, room, shared }: { sceneId: string; room: SbdRecord; shared: boolean }) {
  const [open, setOpen] = useState<'rename' | 'choose' | null>(null);
  const name = roomTitle(planFields(room.props));
  return (
    <>
      <Menu label={<span data-user-text="">{t('plan.roomMenu', { name })}</span>} buttonClassName={MENU_BUTTON}>
        {(close) => (
          <MenuGroup>
            <MenuItem
              onClick={() => {
                close();
                setOpen('rename');
              }}
            >
              {t('plan.renameRoom')}
            </MenuItem>
            <MenuItem
              onClick={() => {
                close();
                setOpen('choose');
              }}
            >
              {t('plan.useAnotherRoom')}
            </MenuItem>
            {shared ? (
              <MenuItem
                onClick={() => {
                  close();
                  void separateCopy(sceneId);
                }}
              >
                {t('plan.separateCopy')}
              </MenuItem>
            ) : (
              <MenuItem
                onClick={() => {
                  close();
                  void deleteRoom(sceneId);
                }}
              >
                {t('plan.deleteRoom')}
              </MenuItem>
            )}
          </MenuGroup>
        )}
      </Menu>
      {open === 'rename' && (
        <RenameRoomWindow
          name={name}
          onClose={() => {
            setOpen(null);
          }}
          onRename={(next) => {
            void renameRoom(room.id, next);
            setOpen(null);
          }}
        />
      )}
      {open === 'choose' && (
        <InAppWindow
          title={t('plan.useAnotherRoomTitle')}
          onClose={() => {
            setOpen(null);
          }}
          width={420}
        >
          <div className="flex flex-col gap-3 p-3">
            <p className="text-[13px]">{t('plan.useAnotherRoomNote')}</p>
            <RoomChooser
              sceneId={sceneId}
              onChosen={() => {
                setOpen(null);
              }}
            />
          </div>
        </InAppWindow>
      )}
    </>
  );
}

function RenameRoomWindow({ name, onClose, onRename }: { name: string; onClose: () => void; onRename: (name: string) => void }) {
  const [typed, setTyped] = useState(name);
  return (
    <InAppWindow title={t('plan.renameRoomTitle')} onClose={onClose} width={360}>
      <form
        className="flex flex-col gap-3 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (typed.trim() !== '') onRename(typed.trim());
        }}
      >
        <TextField
          label={t('selection.roomName')}
          value={typed}
          autoComplete="off"
          onChange={(event) => {
            setTyped(event.target.value);
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('plan.cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={typed.trim() === ''}>
            {t('plan.rename')}
          </Button>
        </div>
      </form>
    </InAppWindow>
  );
}

/** "Start from another setup" (6.2b), offered quietly while a setup has nothing of its own and another has. */
function SetupCopyOffer({ view }: { view: PlanView }) {
  const records = useProject((s) => s.records);
  if (view.setupId === null || setupHasItems(records, view.setupId)) return null;
  const sources = setupCopySources(records, view.sceneId, view.setupId);
  if (sources.length === 0) return null;
  return (
    <Menu label={t('plan.startFromSetup')} buttonClassName="sb-label flex h-7 items-center px-1 text-text-muted underline-offset-2 hover:underline">
      {(close) => (
        <MenuGroup label={t('plan.startFromSetupLabel')}>
          {sources.map((source) => (
            <MenuItem
              key={source.record.id}
              data-copy-setup={source.record.id}
              onClick={() => {
                close();
                void copySetup(view, source.record.id);
              }}
            >
              {source.fields.name === '' ? t('setup.label', { number: String(source.number) }) : t('plan.setupNamed', { number: String(source.number), name: source.fields.name })}
            </MenuItem>
          ))}
        </MenuGroup>
      )}
    </Menu>
  );
}

const openingKindOf = (tool: string): OpeningKind | null => (tool === DOOR_TOOL ? 'door' : tool === WINDOW_TOOL ? 'window' : null);

function PlanCanvas({ view, header, room }: { view: PlanView; header: ReactNode; room: SbdRecord }) {
  const records = useProject((s) => s.records);
  const unit = usePlanUnit();
  const locale = useLocale();
  // The project this canvas was opened in (it is keyed by it): a run it hands back is written there or nowhere.
  const [madeIn] = useState(() => projectStore.getState().project);
  const key = viewKey(view.sceneId, view.setupId);
  const stored = usePlan((s) => s.selections[key]);
  const viewports = usePlan((s) => s.viewports);
  const tool = usePlan((s) => s.tool);
  const clipboard = usePlan((s) => s.clipboard);
  // Read once per change of the records, and kept as they were while the plan's own records are (an edit elsewhere in
  // the project rebuilds nothing, and the canvas keeps what it drew for each wall).
  const [keepShown] = useState(shownItemsKeeper);
  const [build] = useState(planItemsBuilder);
  const shown = useMemo(() => keepShown(records, view.sceneId, view.setupId), [keepShown, records, view.sceneId, view.setupId]);
  const built = useMemo(() => build(shown, unit, INK, locale), [build, shown, unit, locale]);
  const scale = useMemo(() => planScale(unit), [unit]);
  const constrain = useMemo(() => planConstrain(shown, unit), [shown, unit]);
  // Where the pointer is while the Door or Window tool is picked: the opening previews where a click would put it.
  const [hover, setHover] = useState<Point | null>(null);
  const kind = openingKindOf(tool);
  const spot = useMemo(() => (kind && hover ? openingSpot(shown, hover, kind, toMetres(scale.grid.step)) : null), [kind, hover, shown, scale]);
  const preview = useMemo((): CanvasItem | null => {
    if (!kind || !spot) return null;
    return openingItem('preview', { kind, wallId: spot.wallId, along: spot.along, width: OPENING_WIDTH[kind], hinge: 'start', swing: 'left', heightM: null, name: '' }, spot.wall, unit, true);
  }, [kind, spot, unit]);
  const items = useMemo(() => (preview ? [...built, preview] : built), [built, preview]);
  // An undo that removed an item takes it out of the selection.
  const selection = useMemo(() => (stored ?? []).filter((id) => built.some((item) => item.id === id)), [stored, built]);
  const also = alsoInRoom(records, view.sceneId);
  // What the plan holds, in metres, as plain data for the end-to-end tests (the canvas is pixels).
  const data = useMemo(() => {
    const walls = new Map(shown.flatMap((item) => (isOpening(item.fields) ? [] : [[item.record.id, item.fields] as const])));
    return JSON.stringify(
      shown.map(({ record, fields, level }) => {
        if (!isOpening(fields)) {
          const [start, end] = wallEnds(fields);
          return { id: record.id, level, ...fields, start, end };
        }
        const wall = walls.get(fields.wallId);
        return { id: record.id, level, ...fields, ...(wall ? { ...openingDistances(wall, fields), centre: openingFrame(wall, fields).centre } : {}) };
      }),
    );
  }, [shown]);
  const run = (command: CanvasCommand) => {
    switch (command.kind) {
      case 'copy':
        copyPlanSelection(view);
        break;
      case 'cut':
        void cutPlanSelection(view);
        break;
      case 'paste':
        void pastePlan(view, command.at);
        break;
      case 'duplicate':
        void duplicatePlanSelection(view);
        break;
      case 'delete':
        void deletePlanSelection(view);
        break;
      case 'forward':
      case 'backward':
      case 'front':
      case 'back':
        void reorderPlan(view, command.kind);
        break;
      default:
        // Align, distribute, tidy and sections are a board's (5.3), not a plan's.
        break;
    }
  };
  return (
    <div className="flex h-full min-h-80 flex-col" data-plan-tile="">
      <ToolStrip tool={tool} onTool={planStore.getState().setTool} tools={PLAN_TOOLS}>
        {header}
        <RoomMenu sceneId={view.sceneId} room={room} shared={also.length > 0} />
        {also.length > 0 && (
          <p className="text-[12px] text-text-muted" data-room-shared={also.join(' ')}>
            {t('plan.alsoIn', { scenes: also.join(', ') })}
          </p>
        )}
        <SetupCopyOffer view={view} />
      </ToolStrip>
      <div className="min-h-0 min-w-0 flex-1" data-plan-data={data} data-plan-unit={unit} data-plan-preview={spot ? JSON.stringify({ wallId: spot.wallId, along: spot.along }) : undefined}>
        <Canvas
          label={t('plan.canvasLabel', { name: roomTitle(planFields(room.props)) })}
          items={items}
          selection={selection}
          onSelectionChange={(ids) => {
            planStore.getState().select(key, ids);
          }}
          tool={tool}
          onToolChange={planStore.getState().setTool}
          viewport={planViewportOf(viewports, key)}
          onViewportChange={(next) => {
            planStore.getState().setViewport(key, next);
          }}
          onGeometry={(changes) => changePlanGeometry(changes, view)}
          onNudge={(ids, dx, dy) => nudgePlan(ids, dx, dy)}
          onCreate={(geometry, used, by) => {
            const placing = openingKindOf(used);
            if (!placing) return undefined;
            // From the keyboard, into the one wall selected; by the pointer, into the wall under it, or nowhere.
            const walls = selection.filter((id) => shown.some((item) => item.record.id === id && item.fields.kind === 'wall'));
            const at = by === 'key' ? (walls.length === 1 && walls[0] ? openingSpotInWall(shown, walls[0], placing) : null) : openingSpot(shown, { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 }, placing, toMetres(scale.grid.step));
            setHover(null);
            return at ? placeOpening(view, at, placing) : undefined;
          }}
          onPath={(points, used) => (used === WALL_TOOL ? drawWalls(view, points, madeIn) : undefined)}
          onCommand={run}
          canPaste={clipboard.length > 0}
          fixedColours={PAPER_COLOURS}
          tools={PLAN_TOOLS}
          scale={scale}
          zoomLimits={PLAN_ZOOM}
          constrainMove={constrain}
          onHover={(at) => {
            setHover((was) => (openingKindOf(planStore.getState().tool) && at ? at : was === null ? was : null));
          }}
          onKey={(event) => {
            if (event.key.toLowerCase() !== 'f' || event.altKey || event.metaKey || event.ctrlKey) return false;
            const doors = selection.filter((id) => shown.some((item) => item.record.id === id && item.fields.kind === 'door'));
            if (doors.length === 0) return false;
            if (!event.repeat) void flipDoors(doors, event.shiftKey ? 'hinge' : 'swing');
            return true;
          }}
        />
      </div>
    </div>
  );
}

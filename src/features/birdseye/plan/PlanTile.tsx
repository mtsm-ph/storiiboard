import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { showInfo } from '../../../app/notice';
import { usePlanUnit } from '../../../app/planUnits';
import { projectStore, useProject } from '../../../app/projectStore';
import { pluralKey, t, tn } from '../../../core/i18n';
import { CAMERA_ICON, isCamera, isGrip, isIcon, isLight, isNorth, isSun, isWallFields, LIGHT_ICON, MIN_PLAN_SIZE, OPENING_WIDTH, planFields, planItemLayer, roomTitle, sceneRoom, wallEnds, type OpeningKind } from '../../../core/model/plan';
import { alsoInRoom, roomChoices, setupCopySources, setupHasItems } from '../../../core/model/planRooms';
import { openingFrame } from '../../../core/model/openings';
import { beamDirection } from '../../../core/model/planLight';
import { sunReading, sunZonePoint } from '../../../core/model/planSun';
import { useSunZonesAt, type ZonePoint } from '../../../app/timeZone';
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
  deleteUnusedRoom,
  drawWalls,
  duplicatePlanSelection,
  flipDoors,
  newRoom,
  nudgePlan,
  pastePlan,
  placeIcon,
  placeOpening,
  renameRoom,
  turnCameras,
  reorderPlan,
  separateCopy,
  chooseRoom,
  type PlanView,
} from './planActions';
import { cameraLooks } from './cameraLooks';
import { lightLooks } from './lightLooks';
import { sunLooks, sunNumbers } from './sunLooks';
import { iconLabel } from './iconWords';
import { heightLines, iconCentre, iconRefusal, openingDistances, openingItem, openingSpot, openingSpotInWall, planConstrain, planItemsBuilder, shownItemsKeeper, turnsByKey, viewKey, wallAtPoint } from './planItems';
import { CAMERA_TOOL, DOOR_TOOL, LIGHT_TOOL, PLAN_TOOLS, PLAN_ZOOM, planScale, toCanvas, toMetres, WALL_TOOL, WINDOW_TOOL } from './planScale';
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

// What takes the focus once the element it was on goes away (6.2b review): the chooser after Delete room, the canvas
// after a room is chosen or started from the chooser that stood in its place. Kept a moment only, so a step that
// wrote nothing never moves the focus later.
let focusNext: { what: 'chooser' | 'canvas'; until: number } | null = null;
const focusSoon = (what: 'chooser' | 'canvas') => {
  focusNext = { what, until: Date.now() + 2000 };
};
const takeFocus = (what: 'chooser' | 'canvas'): boolean => {
  const due = focusNext !== null && focusNext.what === what && Date.now() <= focusNext.until;
  if (due) focusNext = null;
  return due;
};

/** "Also in SC 02, SC 07 and 9 more" (6.2b review): one line, the scene numbers in mono, every one of them in its title. */
export function AlsoIn({ scenes }: { scenes: readonly string[] }) {
  if (scenes.length === 0) return null;
  const listed = scenes.length > 3 ? scenes.slice(0, 2) : scenes;
  const more = scenes.length - listed.length;
  const names = <span className="font-mono">{listed.join(', ')}</span>;
  return (
    <p className="max-w-full min-w-0 truncate text-[12px] text-text-muted" data-room-shared={scenes.join(' ')} title={t('plan.alsoIn', { scenes: scenes.join(', ') })}>
      {more > 0 ? <Trans k={pluralKey('plan.alsoInMore', more)} parts={{ scenes: names, count: <span className="font-mono">{more}</span> }} /> : <Trans k="plan.alsoIn" parts={{ scenes: names }} />}
    </p>
  );
}

/**
 * Starting a scene's room (6.2b): "New room", or one of the rooms already drawn, those at the scene's location first,
 * each with its location and how many scenes use it. Choosing one is one edit. A room no scene uses can be deleted here.
 * In place of the canvas (no `onChosen`), the canvas takes the focus once a room is chosen or started.
 */
function RoomChooser({ sceneId, onChosen }: { sceneId: string; onChosen?: () => void }) {
  const records = useProject((s) => s.records);
  const choices = roomChoices(records, sceneId);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (takeFocus('chooser')) root.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);
  const chosen = () => {
    if (!onChosen) focusSoon('canvas');
  };
  return (
    <div className="flex flex-col gap-3" data-room-chooser="" ref={root}>
      <div>
        <Button
          variant="primary"
          data-new-room=""
          onClick={() => {
            chosen();
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
              <li key={choice.id} className="flex gap-1.5">
                <button
                  type="button"
                  data-room-choice={choice.id}
                  aria-label={[choice.name, choice.location, tn('selection.roomScenes', choice.scenes)].filter((part) => part !== '').join(' · ')}
                  className="flex min-w-0 flex-1 flex-col items-start border border-text px-2.5 py-1.5 text-left text-[13px] hover:underline"
                  onClick={() => {
                    chosen();
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
                {choice.scenes === 0 && (
                  <Button
                    variant="secondary"
                    data-delete-room={choice.id}
                    aria-label={t('plan.deleteUnusedRoomLabel', { name: choice.name })}
                    onClick={() => {
                      // The focus goes to the chooser's first button: this one goes with its row.
                      root.current?.querySelector<HTMLElement>('button')?.focus();
                      void deleteUnusedRoom(choice.id);
                    }}
                  >
                    {t('plan.deleteUnusedRoom')}
                  </Button>
                )}
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
    <h2 data-plan-header="" className="max-w-full min-w-0 truncate text-[13px] font-bold">
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
          <>
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
              {shared && (
                <MenuItem
                  onClick={() => {
                    close();
                    void separateCopy(sceneId);
                  }}
                >
                  {t('plan.separateCopy')}
                </MenuItem>
              )}
            </MenuGroup>
            {!shared && (
              <MenuGroup>
                <MenuItem
                  onClick={() => {
                    close();
                    // The canvas and this menu go; the chooser that takes their place takes the focus.
                    focusSoon('chooser');
                    void deleteRoom(sceneId);
                  }}
                >
                  {t('plan.deleteRoom')}
                </MenuItem>
              </MenuGroup>
            )}
          </>
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

const TURN_CODES: Readonly<Record<string, 1 | -1>> = { BracketRight: 1, Period: 1, BracketLeft: -1, Comma: -1 };
const TURN_KEYS: Readonly<Record<string, 1 | -1>> = { ']': 1, '.': 1, '[': -1, ',': -1 };
/** What Shift makes of the comma, period and bracket keys (US and Dvorak), read only with Shift down. */
const SHIFTED_TURN_KEYS: Readonly<Record<string, 1 | -1>> = { '>': 1, '<': -1, '}': 1, '{': -1 };
/**
 * What a key types where its unshifted character zooms (+ on German and Spanish BracketRight, * with Shift): that key is
 * the canvas's zoom key, so it never turns, shifted or not (6.5 second review).
 */
const ZOOM_KEY_CHARACTERS: ReadonlySet<string> = new Set(['+', '*']);

/**
 * Which way a turn key turns a camera, light or frame (6.4, 6.5): 1 clockwise (] or period), -1 the other way ([ or
 * comma), 0 for any other key. The physical key (`code`) decides first, so Shift on it (< or : on QWERTY; "." on
 * AZERTY's ; key) turns the same way; but never where that key types a letter (Dvorak's v and w sit there, and are the
 * Select and Wall tools), nor where it is the zoom key. A key with another code turns by what it types (`key`), as
 * Dvorak's own . and , do, and with Shift by their shifted forms (< > { }), so Shift turns 1° there too; never the
 * German < key (IntlBackslash), where < is no comma's shift.
 */
export function turnFor(event: { code: string; key: string; shiftKey?: boolean }): -1 | 0 | 1 {
  const byCode = Object.hasOwn(TURN_CODES, event.code) ? TURN_CODES[event.code] : undefined;
  if (byCode !== undefined) return /^\p{L}$/u.test(event.key) || ZOOM_KEY_CHARACTERS.has(event.key) ? 0 : byCode;
  const byKey = Object.hasOwn(TURN_KEYS, event.key) ? TURN_KEYS[event.key] : undefined;
  if (byKey !== undefined) return byKey;
  if (event.shiftKey === true && event.code !== 'IntlBackslash' && Object.hasOwn(SHIFTED_TURN_KEYS, event.key)) return SHIFTED_TURN_KEYS[event.key] ?? 0;
  return 0;
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
  // Each camera's cone and labels (6.4), read live from its frames, its body and the project: a lens changed on the
  // board changes them with no edit to the plan. A camera's item is made again only when its own look changed. Its lines
  // are words, and t() reads the language set now, so a change of language reads them again: `locale` is a dependency
  // the function doesn't name.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the language, read through t()
  const looks = useMemo(() => cameraLooks(records, shown, unit, stored ?? []), [records, shown, unit, stored, locale]);
  // Each light's beam and labels (6.5), read live as a camera's are: its watts may be its gear item's.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the language, read through t()
  const lights = useMemo(() => lightLooks(records, shown, unit, stored ?? []), [records, shown, unit, stored, locale]);
  // Each sun path's day (6.6), read live from the setup's frames, their day, their location's place and zone and the
  // room's north. A location with a place and no zone of its own has its zone looked up by Rust on the desktop; while that
  // answer is on its way the path shows its icon alone. The browser build has no lookup and never takes this computer's
  // zone in its place (6.6 review): there, such a location reads "No time zone".
  const zonePoints = useMemo(
    () => shown.flatMap((item): ZonePoint[] => (isSun(item.fields) ? [sunZonePoint(records, item.record.id)].filter((p): p is ZonePoint => p !== null) : [])),
    [records, shown],
  );
  const zones = useSunZonesAt(zonePoints);
  const zonesKey = JSON.stringify([...zones]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the language, read through t(); the zones by value
  const suns = useMemo(() => sunLooks(records, shown, zones, stored ?? []), [records, shown, zonesKey, stored, locale]);
  const built = useMemo(() => build(shown, unit, INK, locale, looks, lights, suns), [build, shown, unit, locale, looks, lights, suns]);
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
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (takeFocus('canvas')) holder.current?.querySelector<HTMLElement>('[data-canvas]')?.focus();
  }, []);
  // What the plan holds, in metres, as plain data for the end-to-end tests (the canvas is pixels).
  const data = useMemo(() => {
    const walls = new Map(shown.flatMap((item) => (isWallFields(item.fields) ? [[item.record.id, item.fields] as const] : [])));
    return JSON.stringify(
      shown.map(({ record, fields, level }) => {
        // An icon (6.3): its box, its middle and its layer, worked out from its group.
        if (isIcon(fields)) return { id: record.id, level, layer: planItemLayer(record.props), ...fields, centre: iconCentre(fields), labels: heightLines(fields, unit) };
        // A camera (6.4): an icon's, with what its cone and labels show.
        if (isCamera(fields)) {
          const look = looks.get(record.id);
          return { id: record.id, level, layer: planItemLayer(record.props), ...fields, centre: iconCentre(fields), cone: look?.degrees ?? null, labels: look?.lines ?? [] };
        }
        // A light (6.5): an icon's, with its beam and labels; a flag or diffusion frame: an icon's, with its labels.
        if (isLight(fields)) {
          const look = lights.get(record.id);
          return { id: record.id, level, layer: planItemLayer(record.props), ...fields, centre: iconCentre(fields), beam: look?.degrees ?? null, pointing: beamDirection(fields), labels: look?.lines ?? [] };
        }
        if (isGrip(fields)) return { id: record.id, level, layer: planItemLayer(record.props), ...fields, centre: iconCentre(fields), labels: heightLines(fields, unit) };
        // The room's north (6.6): an icon's, its rotation the room's north.
        if (isNorth(fields)) return { id: record.id, level, layer: planItemLayer(record.props), ...fields, centre: iconCentre(fields) };
        // A sun path (6.6): what it says (its label, or what it lacks) and, drawn, the sun's bearing and true height at its time.
        if (isSun(fields)) {
          const look = suns.get(record.id);
          const numbers = sunNumbers(sunReading(records, record.id, zones), fields.time);
          const sun = numbers ? { bearing: numbers.at.bearing, altitude: numbers.at.altitude, up: numbers.at.up, hours: numbers.path.hours.map((h) => h.hour) } : null;
          const says = look?.kind === 'missing' ? look.lines.join(' · ') : (look?.label ?? '');
          return { id: record.id, level, layer: planItemLayer(record.props), ...fields, centre: iconCentre(fields), drawn: look?.kind === 'drawn', says, sun };
        }
        if (isWallFields(fields)) {
          const [start, end] = wallEnds(fields);
          return { id: record.id, level, ...fields, start, end, labels: heightLines(fields, unit, false) };
        }
        const wall = walls.get(fields.wallId);
        return { id: record.id, level, ...fields, labels: heightLines(fields, unit, false), ...(wall ? { ...openingDistances(wall, fields), centre: openingFrame(wall, fields).centre } : {}) };
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the zones by value
  }, [shown, looks, lights, suns, unit, records, zonesKey]);
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
      {/* The heading, the room's menu and the notes on one row, the tools on their own below it, each wrapping in a narrow
          tile (6.6 review). Sharing one wrapping row, the menu's wrapper (h-full, sized for the top bar) took the row's
          whole height, and the tools wrapped past the strip's foot, under the canvas, out of sight. Each menu sits in a
          box of its own height here, so nothing in the row can stretch it. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1" data-plan-heading="">
        {header}
        <div className="flex h-7">
          <RoomMenu sceneId={view.sceneId} room={room} shared={also.length > 0} />
        </div>
        <AlsoIn scenes={also} />
        <div className="flex h-7 empty:hidden">
          <SetupCopyOffer view={view} />
        </div>
      </div>
      <div data-plan-tools="">
        <ToolStrip tool={tool} onTool={planStore.getState().setTool} tools={PLAN_TOOLS} />
      </div>
      <div ref={holder} className="min-h-0 min-w-0 flex-1" data-plan-data={data} data-plan-unit={unit} data-plan-preview={spot ? JSON.stringify({ wallId: spot.wallId, along: spot.along }) : undefined}>
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
          onNudge={(ids, dx, dy) => nudgePlan(ids, dx, dy, view)}
          onCreate={(geometry, used, by) => {
            if (used === CAMERA_TOOL || used === LIGHT_TOOL) {
              // A camera (6.4) or a fresnel (6.5) where the click was, or in the middle of the view from the keyboard: the setup's own.
              const icon = used === CAMERA_TOOL ? CAMERA_ICON : LIGHT_ICON;
              const why = iconRefusal(records, view, icon);
              if (why !== null) {
                showInfo(why === 'noSetup' ? t('library.needsSetup', { what: iconLabel(icon) }) : t('library.needsRoom'));
                return false;
              }
              const centre = { x: toMetres(geometry.x + geometry.width / 2), y: toMetres(geometry.y + geometry.height / 2) };
              return placeIcon(view, icon, centre, madeIn);
            }
            const placing = openingKindOf(used);
            if (!placing) return undefined;
            // From the keyboard, into the one wall selected; by the pointer, into the wall under it. Nowhere to go: the tool
            // stays, and the notice says why (false keeps the canvas's tool).
            const walls = selection.filter((id) => shown.some((item) => item.record.id === id && item.fields.kind === 'wall'));
            if (by === 'key' && (walls.length !== 1 || !walls[0])) {
              showInfo(t('plan.selectOneWall'));
              return false;
            }
            const point = { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
            const at = by === 'key' && walls[0] ? openingSpotInWall(shown, walls[0], placing) : openingSpot(shown, point, placing, toMetres(scale.grid.step));
            if (!at) {
              // Over a wall with no room left in it: it doesn't fit (6.2b review); over none: point at one.
              showInfo(t(by === 'key' || wallAtPoint(shown, point) ? 'selection.openingRefused' : 'plan.pointAtWall'));
              return false;
            }
            setHover(null);
            return placeOpening(view, at, placing);
          }}
          onPath={(points, used) => (used === WALL_TOOL ? drawWalls(view, points, madeIn) : undefined)}
          onCommand={run}
          canPaste={clipboard.length > 0}
          fixedColours={PAPER_COLOURS}
          tools={PLAN_TOOLS}
          scale={scale}
          zoomLimits={PLAN_ZOOM}
          // The plan's own least size, a centimetre (6.5 review): a board's 8 units would be 8 cm here, deeper than a flag.
          minSize={toCanvas(MIN_PLAN_SIZE)}
          constrainMove={constrain}
          onHover={(at) => {
            setHover((was) => (openingKindOf(planStore.getState().tool) && at ? at : was === null ? was : null));
          }}
          onKey={(event) => {
            // [ and ] turn the selected cameras and lights 5° (Shift: 1°) the other way and clockwise (6.4, 6.5); with a modifier they
            // stay the canvas's order keys. Where [ needs AltGr (Spanish, German), comma and period do the same: free on
            // the plan (they step frames only in the Player), and on those layouts with no modifier at all.
            const turn = turnFor(event);
            if (turn !== 0 && !event.altKey && !event.metaKey && !event.ctrlKey) {
              const cameras = selection.filter((id) => shown.some((item) => item.record.id === id && turnsByKey(item.fields)));
              if (cameras.length === 0) return false;
              const step = event.shiftKey ? 1 : 5;
              void turnCameras(cameras, turn * step);
              return true;
            }
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

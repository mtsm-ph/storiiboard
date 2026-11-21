import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isTauriApp } from '../../../app/fileAccess';
import { showInfo } from '../../../app/notice';
import { choosePictures, fromFile, isChangeFile, onWindowDrop, type PictureFile } from '../../../app/pictures';
import { setPlanUnitsChoice, usePlanUnit } from '../../../app/planUnits';
import { projectStore, useProject } from '../../../app/projectStore';
import { pluralKey, t, tn } from '../../../core/i18n';
import { itemLayer, viewBlocking } from '../../../core/model/planBlocking';
import { formatLength, hasGroupingComma, parseLength } from '../../../core/model/length';
import {
  CAMERA_ICON,
  isCamera,
  isGrip,
  isIcon,
  isLight,
  isMark,
  isMeasure,
  isNorth,
  isSun,
  isUnderlay,
  isWallFields,
  LIGHT_ICON,
  MIN_PLAN_SIZE,
  OPENING_WIDTH,
  planFields,
  planItemLayer,
  roomTitle,
  sceneRoom,
  SUN_ICON,
  wallEnds,
  type OpeningKind,
  type PlanLayer,
  type Point as PlanPoint,
  type ShownItem,
} from '../../../core/model/plan';
import { LAYER_ORDER, layeredItemsKeeper, layerNote, layerOfItem, type LayerLook, type PlanLayerStates } from '../../../core/model/planLayers';
import { alsoInRoom, roomChoices, setupCopySources, setupHasItems } from '../../../core/model/planRooms';
import { openingFrame } from '../../../core/model/openings';
import { beamDirection } from '../../../core/model/planLight';
import { sunReadingOf, sunZonePointOf, type SunZonePoint } from '../../../core/model/sunSources';
import { useSunZonesAt, type ZonePoint } from '../../../app/timeZone';
import type { SbdRecord } from '../../../core/model/record';
import { sceneSetups } from '../../../core/model/setup';
import { sceneFields, sceneLabel } from '../../../core/model/storyboard';
import { Button } from '../../../ui/Button';
import { useScrollLane } from '../../../ui/scrollLane';
import { Canvas, type CanvasProps } from '../../../ui/canvas/Canvas';
import { middleBeside, toWorld } from '../../../ui/canvas/viewport';
import { canvasPalette } from '../../../ui/canvas/canvasPalette';
import { setCanvasView, useCanvasView } from '../../../app/canvasView';
import { setTrackpadMode, useTrackpadMode } from '../../../app/trackpadMode';
import { RULER_SIZE } from '../../../ui/canvas/Rulers';
import { hostStripTools } from '../../../ui/canvas/stripTools';
import { ToolStrip } from '../../../ui/canvas/ToolStrip';
import type { CanvasCommand, CanvasItem, Point } from '../../../ui/canvas/types';
import { useDrawnLevels } from '../../moodboards/PictureNode';
import { TextField } from '../../../ui/fields';
import { InAppWindow } from '../../../ui/InAppWindow';
import { Menu, MenuGroup, MenuItem } from '../../../ui/Menu';
import { Trans } from '../../../ui/Trans';
import { useLocale } from '../../../ui/useLocale';
import {
  addUnderlay,
  changePlanGeometry,
  copyPlanSelection,
  copySetup,
  cutPlanSelection,
  deletePlanSelection,
  deleteRoom,
  deleteUnusedRoom,
  drawMeasures,
  drawWalls,
  duplicatePlanSelection,
  flipDoors,
  markPlanClipboard,
  newRoom,
  nextPosition,
  nudgePlan,
  placeMark,
  pastePlan,
  planClipHere,
  placeIcon,
  placeOpening,
  renameRoom,
  turnCameras,
  reorderPlan,
  separateCopy,
  setUnderlayScale,
  chooseRoom,
  type PlanView,
} from './planActions';
import { cameraLooks } from './cameraLooks';
import { lightLooks } from './lightLooks';
import { liveSights } from './liveSights';
import { sightsKeeper, sightSummary, type Sights } from './planSights';
import { sunLooks, sunNumbers } from './sunLooks';
import { PlanCompass } from './PlanCompass';
import { iconLabel } from './iconWords';
import { heightLines, iconCentre, iconRefusal, measureLines, openingDistances, openingItem, openingSpot, openingSpotInWall, planConstrain, planItemsBuilder, shownItemsKeeper, turnsByKey, viewKey, wallAtPoint } from './planItems';
import { CAMERA_TOOL, DOOR_TOOL, LIGHT_TOOL, MARK_TOOL, MEASURE_TOOL, PLAN_CANVAS_TOOLS, PLAN_TOOLS, PLAN_ZOOM, planScale, SCALE_TOOL, toCanvas, toMetres, WALL_TOOL, WINDOW_TOOL } from './planScale';
import { roomUnderlays, scaleTarget, underlayAt, underlayHintName, underlayPictures, unscaledIn } from './underlayEdits';
import { blockingLooks } from './markLooks';
import { choosePlanTool, showAllLayers, soloLayer, startUnderlayScale, useLayersSaid, usePlanLayerStates, useSoloLayer } from './layersStore';
import { pasteIsPicture } from './planClipboard';
import { openPlanExport } from '../../export/exportStore';
import type { PlanTarget } from '../../export/planExport';
import { groupName } from './library';
import { PLAN_STRIP_INSET, planStore, planViewportOf, usePlan } from './planStore';
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
  const noRoom = useRef<HTMLDivElement>(null);
  useScrollLane(noRoom);
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
      <div ref={noRoom} className="flex flex-col gap-3 overflow-y-auto p-3" data-plan-tile="">
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

/**
 * Export… (6.10): the shown setup's plan as a PDF or a PNG, or its scene's plans as one PDF, each opening the Export
 * window for it with that format picked, where the paper, the underlay and the grid are chosen.
 */
function PlanExportMenu({ view }: { view: PlanView }) {
  // Every entry is for what the tile shows (6.10 review): the setup, or the scene when it shows none. Each format works
  // out its own plans from it, so switching formats in the window prints what that format names.
  const target: PlanTarget = view.setupId === null ? { kind: 'scene', sceneId: view.sceneId } : { kind: 'setup', sceneId: view.sceneId, setupId: view.setupId };
  const choices = [
    { id: 'plan-setup-pdf', words: t('plan.export.setupPdf') },
    { id: 'plan-setup-png', words: t('plan.export.setupPng') },
    { id: 'plan-scene-pdf', words: t('plan.export.scenePdf') },
  ];
  return (
    <Menu label={t('plan.export.menu')} buttonClassName={MENU_BUTTON}>
      {(close) => (
        <MenuGroup>
          {choices.map((choice) => (
            <MenuItem
              key={choice.id}
              data-plan-export={choice.id}
              onClick={() => {
                close();
                openPlanExport(target, choice.id);
              }}
            >
              {choice.words}
            </MenuItem>
          ))}
        </MenuGroup>
      )}
    </Menu>
  );
}

/**
 * The room's menu (6.2b): Rename, Use another room…, Make a separate copy (shared rooms), Delete room (unshared ones);
 * Add underlay… and, with an underlay in the room, Set scale… (6.9).
 */
function RoomMenu({
  sceneId,
  room,
  shared,
  hasUnderlay,
  onAddUnderlay,
  onSetScale,
}: {
  sceneId: string;
  room: SbdRecord;
  shared: boolean;
  hasUnderlay: boolean;
  onAddUnderlay: () => void;
  onSetScale: () => void;
}) {
  const [open, setOpen] = useState<'rename' | 'choose' | null>(null);
  const name = roomTitle(planFields(room.props));
  return (
    <>
      {/* A long room name is cut short in a narrow tile (6.6 second review); the whole name stays its tooltip and its
          accessible name (the text is all there, only clipped). */}
      <Menu
        label={
          <span data-user-text="" className="min-w-0 truncate">
            {t('plan.roomMenu', { name })}
          </span>
        }
        buttonClassName={`${MENU_BUTTON} min-w-0 max-w-full`}
        buttonTitle={t('plan.roomMenu', { name })}
        className="min-w-0 max-w-full"
      >
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
              <MenuItem
                data-add-underlay=""
                onClick={() => {
                  close();
                  onAddUnderlay();
                }}
              >
                {t('plan.underlay.add')}
              </MenuItem>
              {hasUnderlay && (
                <MenuItem
                  data-set-scale=""
                  onClick={() => {
                    close();
                    onSetScale();
                  }}
                >
                  {t('plan.underlay.setScale')}
                </MenuItem>
              )}
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

/**
 * The layer keys on the plan (6.8): 1 to 7 solo the layers in the Layers tile's order (call-sheet order), 0 shows all.
 * By the physical key, so AZERTY's unshifted digit row works too; never with a modifier or Shift (Shift+0, 1 and 2 are
 * the canvas's zoom keys). A numpad key only while it types its digit (6.8 review, L2): with NumLock off the same keys
 * are End, Home, Clear and Insert, and solo nothing.
 */
export function layerKeyFor(event: { code: string; key?: string; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }): PlanLayer | 'all' | null {
  if (event.shiftKey === true || event.altKey === true || event.metaKey === true || event.ctrlKey === true) return null;
  const found = /^(Digit|Numpad)([0-9])$/.exec(event.code);
  const digit = found?.[2];
  if (digit === undefined) return null;
  if (found?.[1] === 'Numpad' && event.key !== digit) return null;
  return digit === SHOW_ALL_KEY ? 'all' : (LAYER_ORDER[Number(digit) - 1] ?? null);
}

/** The key that shows every layer on the plan (6.8), read by `layerKeyFor` and said in Show all's title. */
export const SHOW_ALL_KEY = '0';

/**
 * The key that solos a layer on the plan: its place in the order `layerKeyFor` reads, so the Layers tile's titles can
 * never say a key the plan doesn't handle.
 */
export function layerKeyOf(layer: PlanLayer): string {
  return String(LAYER_ORDER.indexOf(layer) + 1);
}

/** The two points Set scale's clicks left (6.9, metres), for its question, with the underlay and the project they were made in. */
interface ScaleAsk {
  underlayId: string;
  a: PlanPoint;
  b: PlanPoint;
}

/**
 * Set scale's question (6.9): the real distance between the two points, in any form src/core/model/length.ts reads
 * ("4m", "12' 6\""). One that can't be read, or isn't above 0, is refused in words and nothing is written.
 */
function ScaleWindow({ ask, onClose, onScale }: { ask: ScaleAsk; onClose: () => void; onScale: (metres: number) => void }) {
  const unit = usePlanUnit();
  const [typed, setTyped] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const clicked = formatLength(Math.hypot(ask.b.x - ask.a.x, ask.b.y - ask.a.y), unit);
  return (
    <InAppWindow title={t('plan.underlay.scaleTitle')} onClose={onClose} width={380}>
      <form
        noValidate
        data-scale-window=""
        className="flex flex-col gap-3 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (hasGroupingComma(typed)) {
            setRefused(t('plan.groupingComma'));
            return;
          }
          const metres = parseLength(typed, unit);
          if (metres === null || !(metres > 0)) {
            setRefused(t('plan.underlay.scaleRefused'));
            return;
          }
          onScale(metres);
        }}
      >
        <p className="text-[13px]">
          <Trans k="plan.underlay.scaleNote" parts={{ now: <span className="font-mono">{clicked}</span> }} />
        </p>
        <TextField
          label={t('plan.underlay.scaleDistance')}
          mono
          data-scale-distance=""
          value={typed}
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the window exists to ask for this
          autoFocus
          aria-invalid={refused !== null || undefined}
          onChange={(event) => {
            setTyped(event.currentTarget.value);
            setRefused(null);
          }}
        />
        {refused !== null && (
          <p role="alert" className="text-[12px]" data-scale-refused="">
            {refused}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('plan.cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={typed.trim() === ''}>
            {t('plan.underlay.scaleApply')}
          </Button>
        </div>
      </form>
    </InAppWindow>
  );
}

/** A cone's or a beam's shape as drawn (6.18), for the end-to-end tests: its summary (planSights.ts), never its corners. */
const sightData = (sights: Sights, id: string) => sightSummary(sights.get(id));

/** How an item's layer draws it, as plain data for the end-to-end tests: dimmed, locked, or neither (left out). */
const layerData = (look: LayerLook | undefined) => ({ ...(look?.dim ? { dim: true } : {}), ...(look?.locked ? { locked: true } : {}) });

/**
 * "2 layers hidden · 1 locked" (6.8) and Show all, while any layer is hidden or locked, so a missing item isn't a mystery.
 * During a solo (L2) "Camera solo" and End solo instead: the solo's locks are its own, not a count to clear.
 */
function LayersNote({ states }: { states: PlanLayerStates }) {
  const solo = useSoloLayer();
  const { hidden, locked } = layerNote(states);
  if (solo !== null) {
    return (
      <p className="flex min-w-0 items-center gap-1.5 text-[12px]" data-layers-note="" data-layers-solo={solo}>
        <span className="truncate">{t('layers.note.solo', { layer: groupName(solo) })}</span>
        <button
          type="button"
          data-layers-end-solo=""
          className="sb-label h-7 shrink-0 px-1 underline underline-offset-2 hover:no-underline focus-visible:-outline-offset-4"
          onClick={() => {
            soloLayer(solo, 'plan');
          }}
        >
          {t('layers.endSolo')}
        </button>
      </p>
    );
  }
  if (hidden === 0 && locked === 0) return null;
  const parts = [hidden > 0 ? tn('layers.note.hidden', hidden) : null, locked > 0 ? tn('layers.note.locked', locked) : null].filter((p): p is string => p !== null);
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-[12px]" data-layers-note="">
      <span className="truncate">{parts.join(' · ')}</span>
      <button
        type="button"
        data-layers-show-all=""
        className="sb-label h-7 shrink-0 px-1 underline underline-offset-2 hover:no-underline focus-visible:-outline-offset-4"
        onClick={() => {
          showAllLayers('plan');
        }}
      >
        {t('layers.showAll')}
      </button>
    </p>
  );
}

/**
 * The plan's canvas with its view (6.11): the one part of the tile that reads the view, so a pan or a zoom (a new view
 * every frame) draws the canvas again and leaves the tile around it (its heading, menus, tools and notes) as it was.
 */
function PlanViewCanvas({ planKey, ...props }: Omit<CanvasProps, 'viewport'> & { planKey: string }) {
  const viewport = usePlan((s) => planViewportOf(s.viewports, planKey));
  return <Canvas {...props} viewport={viewport} />;
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
  const tool = usePlan((s) => s.tool);
  const clipboard = usePlan((s) => s.clipboard);
  // The opening the clipboard was copied in: only there does the menu offer Paste (6.9 review, L1).
  const clipFrom = usePlan((s) => s.clipFrom);
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
    () => shown.flatMap((item): ZonePoint[] => (isSun(item.fields) ? [sunZonePointOf(records, item.record.id)].filter((p): p is SunZonePoint => p !== null) : [])),
    [records, shown],
  );
  const zones = useSunZonesAt(zonePoints);
  const zonesKey = JSON.stringify([...zones]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the language, read through t(); the zones by value
  const suns = useMemo(() => sunLooks(records, shown, zones, stored ?? []), [records, shown, zonesKey, stored, locale]);
  // Each mark's drawing, number and label and each owner's path (6.7), read live: a renamed character, a position moved
  // or a lens changed on the board changes them with no edit to the plan.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the language, read through t()
  const blocking = useMemo(() => blockingLooks(records, view, shown, unit, stored ?? []), [records, view.sceneId, view.setupId, shown, unit, stored, locale]);
  // The layers (6.8): a hidden layer's items are left out (a door or window with its wall), a dimmed one's drawn at the
  // core's dim, a locked one's drawn and never picked. This computer's state, never the project's.
  // Kept as it was while the shown items, the states and the marks' layers are (L12): an edit elsewhere builds nothing.
  const layerStates = usePlanLayerStates();
  const [keepLayered] = useState(layeredItemsKeeper);
  const layered = useMemo(() => keepLayered(records, shown, layerStates), [keepLayered, records, shown, layerStates]);
  // What the last layer key (or the header's Show all) did, read out by the canvas's spoken line (L3).
  const layersSaid = useLayersSaid('plan');
  const visible = layered.visible;
  // Each underlay's picture (6.9), read from its `media` record: one missing is drawn "gone", as a board's is.
  const pictures = useMemo(() => underlayPictures(records, visible), [records, visible]);
  // Walls stop cones and beams (6.18): each drawn one's cut shape, by the room's walls and openings on every layer (a
  // hidden layer is a focus view, never a wall flown out), worked out again only for what an edit touched.
  const [keepSights] = useState(sightsKeeper);
  const sights = useMemo(() => keepSights(shown, visible, looks, lights, blocking.marks), [keepSights, shown, visible, looks, lights, blocking.marks]);
  // Paper or Dark (6.5.1): this computer's view of every plan, never the project's. The palette is a fixed object per view,
  // so the canvas keeps what it drew until the view changes, then draws everything again; a wall's ink is its builder's,
  // so a wall is made again with the new ink and hands the canvas a new `draw`.
  const canvasView = useCanvasView('plan');
  const trackpad = useTrackpadMode();
  const palette = canvasPalette(canvasView);
  const built = useMemo(
    () => build(visible, unit, palette.ink, locale, looks, lights, suns, blocking, layered.looks, pictures, sights),
    [build, visible, unit, palette.ink, locale, looks, lights, suns, blocking, layered.looks, pictures, sights],
  );
  // Which size each underlay's picture is drawn at now, for the end-to-end tests (as a board's are).
  const levels = useDrawnLevels();
  const pictureLevels = useMemo(() => JSON.stringify(Object.fromEntries(visible.flatMap((item) => (isUnderlay(item.fields) && levels[item.record.id] ? [[item.record.id, levels[item.record.id]]] : [])))), [visible, levels]);
  // Read once per change of the records or the room (6.9 review, L10), never on a hover's render.
  const underlays = useMemo(() => roomUnderlays(records, room.id), [records, room.id]);
  const hasUnderlay = underlays.length > 0;
  const unscaled = useMemo(() => unscaledIn(records, room.id), [records, room.id]);
  // Set scale's question (6.9), once its two clicks are in.
  const [scaleAsk, setScaleAsk] = useState<ScaleAsk | null>(null);
  const scalingNow = tool === SCALE_TOOL;
  const scaling = usePlan((s) => s.scaling);
  // The underlay Set scale's first click landed on (6.9 review, L2), so the hint names it until the second.
  const scaleFirst = usePlan((s) => s.scaleFirst);
  /** What the hint calls an underlay among several, numbered when another has its name (L5). */
  const nameOf = (id: string): string => underlayHintName(records, underlays, id);
  /**
   * Set scale (6.9): two clicks on the selected underlay, else the room's frontmost, or whichever is topmost under the
   * first click (L2); its row drawn first when hidden (L4); the plan takes the focus for them.
   */
  const startScale = () => {
    const target = scaleTarget(projectStore.getState().records, room.id, planStore.getState().selections[key] ?? []);
    if (target === null) {
      showInfo(t('plan.underlay.none'));
      return;
    }
    startUnderlayScale(target);
    holder.current?.querySelector<HTMLElement>('[data-canvas]')?.focus();
  };
  /** Pictures added under the room (6.9): their middle at `centre` (metres), else the middle of the view. */
  const addPictures = (files: readonly PictureFile[], centre: PlanPoint | null) => {
    if (files.length === 0) return;
    // The middle of what is seen beside the tools' strip (6.5.2 round 2).
    const middle = middleBeside(planViewportOf(planStore.getState().viewports, key), PLAN_STRIP_INSET);
    void addUnderlay(view, files, centre ?? { x: toMetres(middle.x), y: toMetres(middle.y) }, madeIn);
  };
  /** Where a drop at a page point lands on the plan, metres; null off the canvas. */
  const dropAt = (client: { x: number; y: number }): PlanPoint | null => {
    const frame = holder.current?.querySelector<HTMLElement>('[data-canvas]');
    if (!frame) return null;
    const box = frame.getBoundingClientRect();
    const at = toWorld(planViewportOf(planStore.getState().viewports, key), { width: Math.max(80, Math.round(frame.clientWidth)), height: Math.max(80, Math.round(frame.clientHeight)) }, { x: client.x - box.left, y: client.y - box.top });
    return { x: toMetres(at.x), y: toMetres(at.y) };
  };
  // In the desktop app Tauri catches a file drop before the page sees it and Rust reports the point (src/app/pictures.ts).
  useEffect(() => {
    if (!isTauriApp) return;
    let live = true;
    let stop: (() => void) | null = null;
    void onWindowDrop((files, at) => {
      const over = document.elementFromPoint(at.x, at.y);
      if (over && holder.current?.contains(over)) addPictures(files, dropAt(at));
    }).then((unlisten) => {
      if (live) stop = unlisten;
      else unlisten();
    });
    return () => {
      live = false;
      stop?.();
    };
    // The canvas is keyed per view and per opening of a project, so what these read never changes under it; the view and
    // the refs are read as they are when a drop lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const scale = useMemo(() => planScale(unit), [unit]);
  // Sets Plan units alone, so Settings' Measurement system may then read Mixed; the weather keeps its own units.
  const scaleUnits = useMemo(() => ({ value: unit, onChange: setPlanUnitsChoice }), [unit]);
  const constrain = useMemo(() => planConstrain(visible, unit), [visible, unit]);
  // The cut live while a camera, a light, a wall or an opening is dragged or turned (6.18 review, decision 5): the canvas
  // asks on every step with the live boxes, and the walls and openings are where the drop will write them.
  const live = useMemo(() => liveSights({ records, view, blocking: shown, items: visible, built, looks, lights, marks: blocking }), [records, view, shown, visible, built, looks, lights, blocking]);
  // What the canvas drew anew, for the end-to-end tests (data-plan-live: each shape's summary, by id), written once it is
  // drawn; in development builds only, so a release writes nothing on a drag (6.18 second review).
  const liveDrawn = (made: ReadonlyMap<string, CanvasItem> | null) => {
    if (!import.meta.env.DEV) return;
    const element = holder.current;
    if (!element) return;
    const summaries = live.summaries(made);
    const text = summaries === null ? null : JSON.stringify(summaries);
    if (text === null) element.removeAttribute('data-plan-live');
    else if (element.getAttribute('data-plan-live') !== text) element.setAttribute('data-plan-live', text);
  };
  // Where the pointer is while the Door or Window tool is picked: the opening previews where a click would put it.
  const [hover, setHover] = useState<Point | null>(null);
  const kind = openingKindOf(tool);
  const spot = useMemo(() => (kind && hover ? openingSpot(visible, hover, kind, toMetres(scale.grid.step)) : null), [kind, hover, visible, scale]);
  const preview = useMemo((): CanvasItem | null => {
    if (!kind || !spot) return null;
    return openingItem('preview', { kind, wallId: spot.wallId, along: spot.along, width: OPENING_WIDTH[kind], hinge: 'start', swing: 'left', heightM: null, name: '' }, spot.wall, unit, true);
  }, [kind, spot, unit]);
  const items = useMemo(() => (preview ? [...built, preview] : built), [built, preview]);
  // An undo that removed an item takes it out of the selection, and so does its layer hidden or locked (6.8).
  const selection = useMemo(() => (stored ?? []).filter((id) => built.some((item) => item.id === id && item.locked !== true)), [stored, built]);
  const also = useMemo(() => alsoInRoom(records, view.sceneId), [records, view.sceneId]);
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (takeFocus('canvas')) holder.current?.querySelector<HTMLElement>('[data-canvas]')?.focus();
  }, []);
  // What the plan holds, in metres, as plain data for the end-to-end tests (the canvas is pixels).
  // Only what is drawn (6.8: a hidden layer's items are left out), each with how its layer draws it.
  // In development builds only (6.26 round 2), as data-plan-live is: nothing in the app reads it, and it is a string of
  // every item made again on every edit, which an installed app has no use for.
  const data = useMemo(() => {
    if (!import.meta.env.DEV) return undefined;
    const walls = new Map(visible.flatMap((item) => (isWallFields(item.fields) ? [[item.record.id, item.fields] as const] : [])));
    const itemData = ({ record, fields, level }: ShownItem): Record<string, unknown> => {
      // An icon (6.3): its box, its middle and its layer, worked out from its group.
      if (isIcon(fields)) return { id: record.id, level, layer: planItemLayer(record.props), ...fields, centre: iconCentre(fields), labels: heightLines(fields, unit) };
      // A camera (6.4): an icon's, with what its cone and labels show.
      if (isCamera(fields)) {
        const look = looks.get(record.id);
        // Its move (6.7): its positions' middles in order, from itself, and the move's length.
        const path = blocking.paths.get(record.id);
        const move = blocking.moves.get(record.id);
        return {
          id: record.id,
          level,
          layer: planItemLayer(record.props),
          ...fields,
          centre: iconCentre(fields),
          cone: look?.degrees ?? null,
          sight: sightData(sights, record.id),
          labels: look?.lines ?? [],
          ...(path ? { path: path.points.map((p) => ({ x: toMetres(p.x), y: toMetres(p.y) })) } : {}),
          ...(move !== undefined ? { moveM: Math.round(move * 10000) / 10000 } : {}),
        };
      }
      // A mark (6.7): an icon's, with who it is, its number and its labels; an owner's first position carries the path.
      if (isMark(fields)) {
        const look = blocking.marks.get(record.id);
        const of = viewBlocking(records, view.sceneId, view.setupId).numbers.get(record.id);
        const path = blocking.paths.get(record.id);
        return {
          id: record.id,
          level,
          // On the camera layer only while its camera link reads (6.7 review: markLayer).
          layer: itemLayer(records, record),
          ...fields,
          centre: iconCentre(fields),
          owner: of?.owner ?? null,
          number: of?.number ?? null,
          count: of?.count ?? null,
          drawnAs: look?.icon ?? null,
          ghost: look?.ghost ?? false,
          cone: look?.cone ?? null,
          sight: sightData(sights, record.id),
          labels: look?.lines ?? [],
          ...(path ? { path: path.points.map((p) => ({ x: toMetres(p.x), y: toMetres(p.y) })) } : {}),
        };
      }
      // A light (6.5): an icon's, with its beam and labels; a flag or diffusion frame: an icon's, with its labels.
      if (isLight(fields)) {
        const look = lights.get(record.id);
        return { id: record.id, level, layer: planItemLayer(record.props), ...fields, centre: iconCentre(fields), beam: look?.degrees ?? null, pointing: beamDirection(fields), sight: sightData(sights, record.id), labels: look?.lines ?? [] };
      }
      if (isGrip(fields)) return { id: record.id, level, layer: planItemLayer(record.props), ...fields, centre: iconCentre(fields), labels: heightLines(fields, unit) };
      // The room's north (6.6): an icon's, its rotation the room's north.
      if (isNorth(fields)) return { id: record.id, level, layer: planItemLayer(record.props), ...fields, centre: iconCentre(fields) };
      // A sun path (6.6): what it says (its label, or what it lacks) and, drawn, the sun's bearing and true height at its time.
      if (isSun(fields)) {
        const look = suns.get(record.id);
        const reading = sunReadingOf(records, record.id, zones);
        const numbers = sunNumbers(reading, fields.time);
        const sun = numbers ? { bearing: numbers.at.bearing, altitude: numbers.at.altitude, up: numbers.at.up, hours: numbers.path.hours.map((h) => h.hour) } : null;
        const says = look?.kind === 'missing' ? look.lines.join(' · ') : (look?.label ?? '');
        // Where its place and date come from (6.5.5): the setup's location and shoot day, or its own.
        const from = { place: reading?.place?.source ?? null, date: reading?.date?.source ?? null };
        // The light reference photo's mark on the path (6.27), "Photo 16:42", only while it is drawn.
        const photo = look?.kind === 'drawn' && look.photo ? { photo: look.photo.label } : {};
        return { id: record.id, level, layer: planItemLayer(record.props), ...fields, centre: iconCentre(fields), drawn: look?.kind === 'drawn', says, sun, from, ...photo };
      }
      if (isWallFields(fields)) {
        const [start, end] = wallEnds(fields);
        return { id: record.id, level, layer: layerOfItem(records, record), ...fields, start, end, labels: heightLines(fields, unit, false) };
      }
      // An underlay (6.9): its box, its picture's address (null drawn "gone") and whether its scale is set.
      if (isUnderlay(fields)) return { id: record.id, level, layer: layerOfItem(records, record), ...fields, centre: iconCentre(fields), sha: fields.mediaId === null ? null : (pictures.get(fields.mediaId) ?? null) };
      // A measure (6.9): its ends, as a wall's, and its label.
      if (isMeasure(fields)) {
        const [start, end] = wallEnds(fields);
        return { id: record.id, level, layer: layerOfItem(records, record), ...fields, start, end, labels: measureLines(fields, unit) };
      }
      const wall = walls.get(fields.wallId);
      return { id: record.id, level, layer: layerOfItem(records, record), ...fields, labels: heightLines(fields, unit, false), ...(wall ? { ...openingDistances(wall, fields), centre: openingFrame(wall, fields).centre } : {}) };
    };
    return JSON.stringify(visible.map((item) => ({ ...itemData(item), ...layerData(layered.looks.get(item.record.id)) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the zones by value
  }, [visible, layered.looks, looks, lights, suns, blocking, unit, records, zonesKey, pictures, sights]);
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
      {/* The heading, the room's menu and the notes on one row, wrapping in a narrow tile (6.6 review); the tools are the
          strip on the canvas's corner (6.5.2). Each menu sits in a box of its own height here (h-full, sized for the top
          bar, would take the row's whole height), so nothing in the row can stretch it. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-2 py-1" data-plan-heading="">
        {header}
        <div className="flex h-7 min-w-0 max-w-full">
          <RoomMenu
            sceneId={view.sceneId}
            room={room}
            shared={also.length > 0}
            hasUnderlay={hasUnderlay}
            onAddUnderlay={() => {
              void choosePictures(false).then((files) => {
                addPictures(files, null);
              });
            }}
            onSetScale={startScale}
          />
        </div>
        <div className="flex h-7">
          <PlanExportMenu view={view} />
        </div>
        <AlsoIn scenes={also} />
        <div className="flex h-7 empty:hidden">
          <SetupCopyOffer view={view} />
        </div>
        <LayersNote states={layerStates} />
        {/* A quiet note while an underlay is still to be set to scale (6.9); while its two clicks are under way, what to do. */}
        {scalingNow ? (
          <p className="text-[12px]" data-scale-hint="">
            {/* With several underlays, which one the clicks scale (L2): the one started for, until the first click picks. */}
            {underlays.length > 1
              ? scaleFirst !== null && scaleFirst !== ''
                ? t('plan.underlay.scaleHintOn', { name: nameOf(scaleFirst) })
                : t('plan.underlay.scaleHintMany', { name: nameOf(scaling ?? underlays.at(-1)?.id ?? '') })
              : t('plan.underlay.scaleHint')}
          </p>
        ) : (
          unscaled && (
            <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-text-muted" data-underlay-unscaled="">
              <span className="truncate">{t('plan.underlay.unscaled')}</span>
              <button type="button" data-underlay-scale-now="" className="sb-label h-7 shrink-0 px-1 text-text underline underline-offset-2 hover:no-underline focus-visible:-outline-offset-4" onClick={startScale}>
                {t('plan.underlay.setScale')}
              </button>
            </p>
          )
        )}
      </div>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- takes pictures dropped on the plan as underlays (6.9); the canvas inside is the control */}
      <div
        ref={holder}
        className="relative min-h-0 min-w-0 flex-1"
        data-plan-data={data}
        data-plan-unit={unit}
        data-plan-preview={spot ? JSON.stringify({ wallId: spot.wallId, along: spot.along }) : undefined}
        data-picture-levels={pictureLevels}
        // Marks the plan as taking its own drops and pastes, so the storyboard's listeners leave them (useBoardDrops.ts).
        data-plan-drops=""
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          // A change file (7.1) is never a picture. Dropped here in the browser build it is left out here; brought in only
          // by the storyboard's document listener when a Storyboard tile is open. The desktop app brings it in from the
          // window's own drop.
          const pictures = [...event.dataTransfer.files].filter((file) => !isChangeFile(file.name));
          if (pictures.length === 0) return;
          addPictures(pictures.map(fromFile), dropAt({ x: event.clientX, y: event.clientY }));
        }}
      >
        {/* The tools on the canvas's corner (6.5.2), before it so their tab stops come first. */}
        <ToolStrip tools={hostStripTools(PLAN_TOOLS, tool, choosePlanTool)} offset={RULER_SIZE} />
        <PlanViewCanvas
          planKey={key}
          // Fits, the keyboard's placements and the first view (planViewportOf) beside the strip, never under it.
          insetLeft={PLAN_STRIP_INSET}
          insetMiddle
          label={t('plan.canvasLabel', { name: roomTitle(planFields(room.props)) })}
          items={items}
          selection={selection}
          onSelectionChange={(ids) => {
            // The layer words leave the spoken line with it (layersStore.ts, L3).
            planStore.getState().select(key, ids);
          }}
          announcement={layersSaid}
          tool={tool}
          onToolChange={choosePlanTool}
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
            if (used === MARK_TOOL) {
              // A plain mark (6.7) where the click was, or in the middle of the view from the keyboard: the scene's blocking.
              const centre = { x: toMetres(geometry.x + geometry.width / 2), y: toMetres(geometry.y + geometry.height / 2) };
              return placeMark(view, centre, madeIn).then((why) => {
                if (why === 'noRoom') showInfo(t('library.needsRoom'));
              });
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
            const at = by === 'key' && walls[0] ? openingSpotInWall(visible, walls[0], placing) : openingSpot(visible, point, placing, toMetres(scale.grid.step));
            if (!at) {
              // Over a wall with no room left in it: it doesn't fit (6.2b review); over none: point at one.
              showInfo(t(by === 'key' || wallAtPoint(visible, point) ? 'selection.openingRefused' : 'plan.pointAtWall'));
              return false;
            }
            setHover(null);
            return placeOpening(view, at, placing);
          }}
          onPath={(points, used) => {
            if (used === WALL_TOOL) return drawWalls(view, points, madeIn);
            if (used === MEASURE_TOOL) return drawMeasures(view, points, madeIn);
            if (used !== SCALE_TOOL) return undefined;
            // Set scale's two clicks (6.9): the underlay read now, before the canvas goes back to Select (which ends the
            // scaling); the question opens on the next tick, once the click that ended the run is over, and only while
            // the project they were made in is the one open.
            const preferred = planStore.getState().scaling;
            const [a, b] = points;
            if (!a || !b) return undefined;
            const first = { x: toMetres(a.x), y: toMetres(a.y) };
            const now = projectStore.getState().records;
            // Only for an underlay of the room shown (L1): one started in another view is never rescaled unseen.
            if (preferred === null || !roomUnderlays(now, room.id).some((r) => r.id === preferred)) {
              showInfo(t('plan.underlay.scaleOtherRoom'));
              return undefined;
            }
            // The topmost underlay under the first click, the one started for first (L2); none under it: said, and the
            // tool kept for two more clicks (picked again once the canvas has gone back to Select).
            const underlayId = underlayAt(now, room.id, first, preferred);
            if (underlayId === null) {
              showInfo(t('plan.underlay.clickOnPicture'));
              setTimeout(() => {
                if (projectStore.getState().project === madeIn && planStore.getState().tool === 'select') planStore.getState().startScale(preferred);
              }, 0);
              return undefined;
            }
            setTimeout(() => {
              if (projectStore.getState().project !== madeIn) return;
              setScaleAsk({ underlayId, a: first, b: { x: toMetres(b.x), y: toMetres(b.y) } });
            }, 0);
            return undefined;
          }}
          onPasteData={(transfer) => {
            // A picture pasted onto the plan is an underlay (6.9), unless the clipboard is the plan's own copy, told by the
            // mark its Copy and Cut put there (6.9 review, M2: planClipboard.ts), not by focus history: then the plan's
            // own items paste, as they always have.
            // Items copied in another opening paste nothing here (L1), so they never keep a picture from being an underlay.
            if (!pasteIsPicture(transfer, planClipHere())) return false;
            addPictures([...transfer.files].map(fromFile), null);
            return true;
          }}
          onSystemCopy={markPlanClipboard}
          onPathDraft={(run) => {
            // Set scale's first point among several underlays (L2), read from the run itself (6.9 review, L4): the one it
            // lands on is named in the hint until the second, and Backspace taking the point off takes the name off too. A
            // pan, the minimap or the zoom buttons add no point, so they never name one. The underlay scaled is worked out
            // again from the points the run hands back. '' is a first point on none, so the hint never names a wrong one.
            const first = run?.tool === SCALE_TOOL ? run.points[0] : undefined;
            const picked = first ? (underlayAt(projectStore.getState().records, room.id, { x: toMetres(first.x), y: toMetres(first.y) }, planStore.getState().scaling) ?? '') : null;
            if (planStore.getState().scaleFirst !== picked) planStore.getState().setScaleFirst(picked);
          }}
          onCommand={run}
          canPaste={clipboard.length > 0 && clipFrom === openingKey(madeIn)}
          fixedColours={palette}
          view={{
            value: canvasView,
            onChange: (next) => {
              setCanvasView('plan', next);
            },
          }}
          trackpad={{ value: trackpad, onChange: setTrackpadMode }}
          tools={PLAN_CANVAS_TOOLS}
          scale={scale}
          // m | ft by the scale bar (Kevin, Nov 18): this computer's Plan units, at once, as a view; never the forecast's.
          scaleUnits={scaleUnits}
          zoomLimits={PLAN_ZOOM}
          // The plan's own least size, a centimetre (6.5 review): a board's 8 units would be 8 cm here, deeper than a flag.
          minSize={toCanvas(MIN_PLAN_SIZE)}
          constrainMove={constrain}
          liveItems={live.items}
          onLiveDrawn={liveDrawn}
          onHover={(at) => {
            setHover((was) => (openingKindOf(planStore.getState().tool) && at ? at : was === null ? was : null));
          }}
          onKey={(event) => {
            // 1 to 7 solo a layer, 0 shows all (6.8): the person's own view, never an edit.
            const layerKey = layerKeyFor(event);
            if (layerKey !== null) {
              if (!event.repeat) {
                if (layerKey === 'all') showAllLayers('plan');
                else soloLayer(layerKey, 'plan');
              }
              return true;
            }
            // [ and ] turn the selected cameras and lights 5° (Shift: 1°) the other way and clockwise (6.4, 6.5); with a modifier they
            // stay the canvas's order keys. Where [ needs AltGr (Spanish, German), comma and period do the same: free on
            // the plan (they step frames only in the Player), and on those layouts with no modifier at all.
            const turn = turnFor(event);
            if (turn !== 0 && !event.altKey && !event.metaKey && !event.ctrlKey) {
              const cameras = selection.filter((id) => shown.some((item) => item.record.id === id && turnsByKey(item.fields, records, item.record)));
              if (cameras.length === 0) return false;
              const step = event.shiftKey ? 1 : 5;
              void turnCameras(cameras, turn * step);
              return true;
            }
            // Shift+M (6.7): the next position of the one mark or camera selected, selected in its turn.
            if (event.key.toLowerCase() === 'm' && event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
              const [only] = selection;
              if (selection.length !== 1 || only === undefined) {
                showInfo(t('plan.mark.selectFirst'));
                return true;
              }
              if (!event.repeat) void nextPosition(view, only, madeIn);
              return true;
            }
            if (event.key.toLowerCase() !== 'f' || event.altKey || event.metaKey || event.ctrlKey) return false;
            const doors = selection.filter((id) => shown.some((item) => item.record.id === id && item.fields.kind === 'door'));
            if (doors.length === 0) return false;
            if (!event.repeat) void flipDoors(doors, event.shiftKey ? 'hinge' : 'swing');
            return true;
          }}
        />
        {/* North and the sun at the top-right corner (6.5.5), app chrome as the strip is; after the canvas, so the strip's
            tab stops and the canvas's keep their order. While a drawing tool is in use, clicks go through it to the plan. */}
        <PlanCompass
          records={records}
          view={view}
          zones={zones}
          passThrough={tool !== 'select' && tool !== 'hand'}
          onAddSun={() => {
            // The middle of what is seen beside the tools' strip, as the Library's Enter places it.
            const middle = middleBeside(planViewportOf(planStore.getState().viewports, key), PLAN_STRIP_INSET);
            void placeIcon(view, SUN_ICON, { x: toMetres(middle.x), y: toMetres(middle.y) }, madeIn).then((why) => {
              if (why === 'noSetup') showInfo(t('library.needsSetup', { what: iconLabel(SUN_ICON) }));
              else if (why === 'noRoom') showInfo(t('library.needsRoom'));
            });
          }}
        />
      </div>
      {scaleAsk && (
        <ScaleWindow
          ask={scaleAsk}
          onClose={() => {
            setScaleAsk(null);
            holder.current?.querySelector<HTMLElement>('[data-canvas]')?.focus();
          }}
          onScale={(metres) => {
            const asked = scaleAsk;
            setScaleAsk(null);
            holder.current?.querySelector<HTMLElement>('[data-canvas]')?.focus();
            void setUnderlayScale(asked.underlayId, asked.a, asked.b, metres, madeIn).then((done) => {
              if (done) showInfo(t('plan.underlay.scaled', { distance: formatLength(metres, unit) }));
              else if (projectStore.getState().project === madeIn) showInfo(t('plan.underlay.scaleNotSet'));
            });
          }}
        />
      )}
    </div>
  );
}

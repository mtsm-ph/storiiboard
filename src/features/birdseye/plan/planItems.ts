import { createElement, Fragment, type ReactNode } from 'react';
import { Group, Line, Rect } from 'react-konva';
import { getLocale, t } from '../../../core/i18n';
import { formatLength, type PlanUnit } from '../../../core/model/length';
import { mediaFields } from '../../../core/media/store';
import { centreOfBox, fitAlong, fitsAt, onStep, openingFrame, projectOnWall, swingSign, wallAxes, wallNeeds, wallUnder, type OpeningFrame } from '../../../core/model/openings';
import {
  boxFields,
  isCamera,
  isGrip,
  isIcon,
  isLight,
  isMark,
  isMeasure,
  isNorth,
  isOpening,
  isSun,
  isUnderlay,
  keptInWall,
  lastKeyUnder,
  markFields,
  MEASURE_THICKNESS,
  measureFields,
  MIN_PLAN_SIZE,
  normalDegrees,
  OPENING_WIDTH,
  openingFields,
  openingsInView,
  openingsOf,
  planFields,
  planItemFields,
  plansShown,
  sceneRoomId,
  shownFields,
  shownItems,
  shownPlanIds,
  wallBetween,
  wallEnds,
  wallProps,
  wallsAlong,
  CAMERA_ICON,
  DEFAULT_SUN_TIME,
  CAST_MARK_ICON,
  LIGHT_ICON,
  MARK_ICON,
  NORTH_ICON,
  SUN_ICON,
  type BoxFields,
  type CameraFields,
  type GripFields,
  type Hinge,
  type IconFields,
  type LightFields,
  type MarkFields,
  type MeasureFields,
  type NorthFields,
  type OpeningFields,
  type OpeningKind,
  type PlanGeometry,
  type PlanItemFields,
  type PlanViewOf,
  type ShownFields,
  type ShownItem,
  type SunFields,
  type Swing,
  type UnderlayFields,
} from '../../../core/model/plan';
import type { LayerLook } from '../../../core/model/planLayers';
import { cameraMarks, markLayer, ownerMarks, repointCamera, soundOrders, type MarkOwner } from '../../../core/model/planBlocking';
import { CONE_LENGTH_M, isCameraIcon, isTrackIcon, withoutFrameLinks } from '../../../core/model/planCamera';
import { BEAM_LENGTH_M, beamFacing, frameSizeBox, FRAME_SIZES, gripKindOf, isLightIcon, liesFlat } from '../../../core/model/planLight';
import { iconHome, underlayPictureCopy } from '../../../core/model/planRooms';
import { roomNorthItem } from '../../../core/model/planSun';
import type { Props, SbdRecord } from '../../../core/model/record';
import { sceneSetups, setupLabel } from '../../../core/model/setup';
import { sceneFields, sceneLabel } from '../../../core/model/storyboard';
import type { Change } from '../../../core/ops/ops';
import { keyBetween } from '../../../core/ops/order';
import { pasted } from '../../../ui/canvas/placement';
import type { GridSnap } from '../../../ui/canvas/scale';
import type { CanvasColours, CanvasItem, Geometry, GeometryChange, Point, ReorderMode } from '../../../ui/canvas/types';
import { DIM_OPACITY } from '../../../ui/canvas/ItemNodes';
import { PictureNode } from '../../moodboards/PictureNode';
import { reordered, sortKeysFor } from '../../../ui/canvas/zOrder';
import { besideBeyond, cameraBeyond, labelsBeyond, type CameraLook } from './cameraDraw';
import { heightLabel } from './cameraLooks';
import { IconShape, NameBelow, NoteShape, UnknownIconShape, ZoneShape } from './iconDraw';
import { lightBeyond, StandingFrameShape, type LightLook } from './lightDraw';
import { joinBeyond, pathBeyond, type PathLook } from './markDraw';
import type { BlockingLooks, MarkLook } from './markLooks';
import { sunBeyond, sunFitExtent, type SunLook } from './sunDraw';
import { FREE_RESIZE, iconSize, iconUse } from './iconSizes';
import { frameLabel, iconLabel, planIconOf } from './iconWords';
import { PLAN_ZOOM, planScale, toCanvas, toMetres } from './planScale';
import { wallOutline, type WallLine } from './wallShape';

// A plan's items for the canvas core and back (6.2a, 6.2b): records in metres become CanvasItems in canvas units
// (1 cm), and what a gesture or a field changed becomes updates in metres again. Pure, so each edit is tested without a
// browser. The items of every level a view shows are drawn together (the room's first); an edit reaches each item in
// its own plan. A door or window has no place of its own: it is drawn from its wall, and a drag slides it along a wall.

type Records = Readonly<Record<string, SbdRecord>>;

/** A plan view's key: the setup it shows, or the scene with no setup picked. */
export const viewKey = (sceneId: string, setupId: string | null): string => (setupId ? `setup:${setupId}` : `scene:${sceneId}`);

/** A live wall, with its fields. */
function liveItem(records: Records, id: string): { record: SbdRecord; fields: PlanItemFields } | null {
  const record = records[id];
  if (record?.type !== 'plan_item' || record.trashedAt !== null) return null;
  const fields = planItemFields(record.props);
  return fields ? { record, fields } : null;
}

/** A live door or window, with its fields and its live wall's. */
function liveOpening(records: Records, id: string): { record: SbdRecord; fields: OpeningFields; wall: { record: SbdRecord; fields: PlanItemFields } } | null {
  const record = records[id];
  if (record?.type !== 'plan_item' || record.trashedAt !== null) return null;
  const fields = openingFields(record.props);
  const wall = fields ? liveItem(records, fields.wallId) : null;
  // Read inside its wall, as the plan shows it (a wall shortened in another scene's view may have left it past an end).
  return fields && wall ? { record, fields: keptInWall(fields, wall.fields.width), wall } : null;
}

/** A live library icon (6.3) or camera (6.4), with its fields: both are a box that moves, turns and resizes freely. */
function liveIcon(records: Records, id: string): { record: SbdRecord; fields: BoxFields } | null {
  const record = records[id];
  if (record?.type !== 'plan_item' || record.trashedAt !== null) return null;
  const fields = boxFields(record.props);
  return fields ? { record, fields } : null;
}

/** A live measure (6.9), with its fields: a line stored as a wall's box is. */
function liveMeasure(records: Records, id: string): { record: SbdRecord; fields: MeasureFields } | null {
  const record = records[id];
  if (record?.type !== 'plan_item' || record.trashedAt !== null) return null;
  const fields = measureFields(record.props);
  return fields ? { record, fields } : null;
}

/** A live item with a box of its own: a wall, an icon, a camera, a measure… (a door or window takes its place from its wall). */
const liveBoxed = (records: Records, id: string): { record: SbdRecord; fields: PlanItemFields | BoxFields | MeasureFields } | null =>
  liveItem(records, id) ?? liveIcon(records, id) ?? liveMeasure(records, id);

const toCanvasGeometry = (g: PlanGeometry): Geometry => ({ x: toCanvas(g.x), y: toCanvas(g.y), width: toCanvas(g.width), height: toCanvas(g.height), rotation: g.rotation });

/** A wall as a line with ends, canvas units. */
const lineOf = (id: string, fields: PlanItemFields): WallLine => {
  const [start, end] = wallEnds(fields);
  return { id, start: { x: toCanvas(start.x), y: toCanvas(start.y) }, end: { x: toCanvas(end.x), y: toCanvas(end.y) }, thickness: toCanvas(fields.height) };
};

/** What a wall is called aloud: "Wall, 3.50 m". */
export const wallLabel = (fields: PlanItemFields, unit: PlanUnit): string =>
  fields.name === '' ? t('plan.announce.wall', { length: formatLength(fields.width, unit) }) : t('plan.announce.wallNamed', { name: fields.name, length: formatLength(fields.width, unit) });

/** What a door or window is called aloud: "Door, 0.90 m". */
export const openingLabel = (fields: OpeningFields, unit: PlanUnit): string => {
  const width = formatLength(fields.width, unit);
  if (fields.name !== '') return t(fields.kind === 'door' ? 'plan.announce.doorNamed' : 'plan.announce.windowNamed', { name: fields.name, width });
  return t(fields.kind === 'door' ? 'plan.announce.door' : 'plan.announce.window', { width });
};

/** What an icon is called aloud: "Sofa, 2.00 m by 0.90 m", or "Hero couch, sofa, 2.00 m by 0.90 m". */
export const iconAnnounce = (fields: IconFields, unit: PlanUnit): string => {
  const sizes = { width: formatLength(fields.width, unit), depth: formatLength(fields.height, unit) };
  const what = iconLabel(fields.icon);
  return fields.name === '' ? t('plan.announce.icon', { what, ...sizes }) : t('plan.announce.iconNamed', { name: fields.name, what, ...sizes });
};

/**
 * A library icon for the canvas (6.3): its box at its real size, drawn as the kit's vectors; a zone and a note resize freely,
 * every other icon keeps its proportions (corner handles). An icon id this version doesn't have is an outline with "?".
 */
export function iconItem(id: string, fields: IconFields, unit: PlanUnit): CanvasItem {
  const icon = planIconOf(fields.icon);
  const g = toCanvasGeometry(fields);
  // A set height (decision 11) is a label by the item, upright, its name with it (a zone and a note keep theirs inside).
  const inside = icon?.id === 'production/zone' || icon?.id === 'production/note';
  const lines = heightLines(fields, unit, !inside);
  const draw = (context: { zoom: number; colours: CanvasColours }): ReactNode => {
    const common = { width: g.width, height: g.height, zoom: context.zoom, name: lines.length > 0 && !inside ? '' : fields.name, colours: context.colours };
    if (!icon) return createElement(UnknownIconShape, common);
    if (icon.id === 'production/zone') return createElement(ZoneShape, { icon, ...common });
    if (icon.id === 'production/note') return createElement(NoteShape, { icon, ...common });
    // Its box is the thing's real footprint (6.17): a symbol draws in its own proportions inside an outline of it.
    return createElement(IconShape, { icon, ...common, footprint: true });
  };
  return {
    id,
    ...g,
    label: iconAnnounce(fields, unit),
    ...(icon && !FREE_RESIZE.has(icon.id) ? { keepRatio: true } : {}),
    draw,
    ...(lines.length > 0 ? { beyond: labelsBeyond(g, lines, PLAN_ZOOM.min) } : {}),
    sameInAndOut: true,
  };
}

/**
 * An item's labels for its set height (6.5, decision 11): none while it has no height; else its name (when `withName`
 * and it has one), then the height in the unit shown, said as a camera's height is (heightLabel).
 */
export function heightLines(fields: { heightM: number | null; name: string }, unit: PlanUnit, withName = true): string[] {
  if (fields.heightM === null) return [];
  const height = heightLabel({ from: 'camera', metres: fields.heightM }, unit) ?? '';
  return [...(withName && fields.name !== '' ? [fields.name] : []), height];
}

/** What a light is called aloud: "Fresnel · 650 W, 0.40 m by 0.40 m". */
export const lightAnnounce = (fields: LightFields, unit: PlanUnit, look: LightLook | null): string => {
  const sizes = { width: formatLength(fields.width, unit), depth: formatLength(fields.height, unit) };
  return t('plan.announce.icon', { what: [iconLabel(fields.icon), ...(look?.lines ?? [])].join(' · '), ...sizes });
};

/**
 * A light for the canvas (6.5): its icon at its real size, keeping its proportions, and past its box its beam (or its
 * soft circle) and its labels (lightDraw.tsx), which the canvas keeps drawn while the box is off screen.
 */
export function lightItem(id: string, fields: LightFields, unit: PlanUnit, look: LightLook | null): CanvasItem {
  const icon = planIconOf(fields.icon) ?? planIconOf(LIGHT_ICON);
  const g = toCanvasGeometry(fields);
  const draw = (context: { zoom: number; colours: CanvasColours }): ReactNode => {
    // Its name is drawn with its labels, upright, past its box.
    const common = { width: g.width, height: g.height, zoom: context.zoom, name: '', colours: context.colours };
    return icon ? createElement(IconShape, { icon, ...common }) : createElement(UnknownIconShape, common);
  };
  // Its beam leaves the side its icon's drawing shines from (BEAM_FACING), turned with the light.
  const beyond = look ? { beyond: lightBeyond(g, look, toCanvas(BEAM_LENGTH_M), PLAN_ZOOM.min, beamFacing(fields.icon)) } : {};
  return { id, ...g, label: lightAnnounce(fields, unit, look), keepRatio: true, draw, ...beyond, sameInAndOut: true };
}

/** What a flag or diffusion frame is called aloud: by its kind and size, never the icon it was placed as ("Diffusion · 8×8, 2.44 m by 0.05 m"). */
export const gripAnnounce = (fields: GripFields, unit: PlanUnit): string => {
  const sizes = { width: formatLength(fields.width, unit), depth: formatLength(fields.height, unit) };
  const what = frameLabel(fields, unit);
  return fields.name === '' ? t('plan.announce.icon', { what, ...sizes }) : t('plan.announce.iconNamed', { name: fields.name, what, ...sizes });
};

/** How thick, in screen pixels, a standing frame is picked by at least (6.5 review): its 5 cm bar is 1 px at 20%. */
const FRAME_PICK_PIXELS = 8;

/**
 * A flag or diffusion frame for the canvas (6.5): a standing one a line its width long (StandingFrameShape), resized
 * freely, since its depth stays 5 cm whatever its width, and picked at least FRAME_PICK_PIXELS thick; the overhead
 * lying flat as its icon, its proportions kept.
 */
export function gripItem(id: string, fields: GripFields, unit: PlanUnit): CanvasItem {
  const icon = planIconOf(fields.icon);
  const g = toCanvasGeometry(fields);
  const flat = liesFlat(fields.icon);
  const lines = heightLines(fields, unit);
  const draw = (context: { zoom: number; colours: CanvasColours }): ReactNode => {
    const common = { width: g.width, height: g.height, zoom: context.zoom, name: lines.length > 0 ? '' : fields.name, colours: context.colours };
    if (!flat) {
      const bar = createElement(StandingFrameShape, { key: 'bar', width: g.width, height: g.height, zoom: context.zoom, dashed: fields.kind === 'diffusion', colours: context.colours });
      return createElement(Fragment, null, bar, createElement(NameBelow, { key: 'name', ...common }));
    }
    return icon ? createElement(IconShape, { icon, ...common }) : createElement(UnknownIconShape, common);
  };
  return {
    id,
    ...g,
    label: gripAnnounce(fields, unit),
    ...(flat ? { keepRatio: true } : { pickThickness: FRAME_PICK_PIXELS }),
    draw,
    ...(lines.length > 0 ? { beyond: labelsBeyond(g, lines, PLAN_ZOOM.min) } : {}),
    sameInAndOut: true,
  };
}

/** No blocking worked out (a caller that draws no marks' looks): none, and no paths. */
const NO_BLOCKING: BlockingLooks = { marks: new Map(), paths: new Map(), moves: new Map() };
const NO_LAYERS: ReadonlyMap<string, LayerLook> = new Map();

/** A camera with no look worked out yet: no cone, no label. */
const NO_LOOK: CameraLook = { degrees: null, lines: [], selected: false };

/** What a camera is called aloud: "Camera A · 50 mm · 51.1°, 0.40 m by 0.40 m". */
export const cameraAnnounce = (fields: CameraFields, unit: PlanUnit, look: CameraLook): string => {
  const sizes = { width: formatLength(fields.width, unit), depth: formatLength(fields.height, unit) };
  const what = [iconLabel(fields.icon), ...look.lines].join(' · ');
  return t('plan.announce.icon', { what, ...sizes });
};

/**
 * A camera for the canvas (6.4): its icon at its real size, keeping its proportions, and past its box its field of view
 * and its labels (cameraDraw.tsx), which the canvas keeps drawn while the box is off screen.
 */
export function cameraItem(id: string, fields: CameraFields, unit: PlanUnit, look: CameraLook, path: PathLook | null = null): CanvasItem {
  const icon = planIconOf(fields.icon) ?? planIconOf(CAMERA_ICON);
  const g = toCanvasGeometry(fields);
  const draw = (context: { zoom: number; colours: CanvasColours }): ReactNode => {
    // Its name is drawn with its labels, upright, past its box; its icon as every icon is (iconDraw.tsx).
    const common = { width: g.width, height: g.height, zoom: context.zoom, name: '', colours: context.colours };
    return icon ? createElement(IconShape, { icon, ...common }) : createElement(UnknownIconShape, common);
  };
  // A camera that moves (6.7) carries its move's path, from it through each later position; Fit all takes them all in.
  const beyond = joinBeyond(cameraBeyond(g, look, toCanvas(CONE_LENGTH_M), PLAN_ZOOM.min), path ? pathBeyond(g, path, PLAN_ZOOM.min) : undefined);
  // A track, a slider or a jib's arm (6.7) stretches along its length: its proportions aren't kept.
  return {
    id,
    ...g,
    label: cameraAnnounce(fields, unit, look),
    ...(isTrackIcon(fields.icon) ? {} : { keepRatio: true }),
    draw,
    ...(beyond ? { beyond } : {}),
    ...(path ? { fitExtent: path.fit } : {}),
    sameInAndOut: true,
  };
}

/**
 * A mark for the canvas (6.7): the kit's drawing for what it is, at its box (a character's first position, a later one,
 * a plain tape mark; a camera's later position the camera's own icon, dimmed as the core dims a layer, its label at full
 * ink so it stays legible), its upright label past its box, a camera's later position's cone as thin edges, and on an
 * owner's first position the path through every position, which the canvas keeps drawn while the box is off screen.
 */
export function markItem(id: string, fields: MarkFields, unit: PlanUnit, look: MarkLook | null, path: PathLook | null = null): CanvasItem {
  const icon = planIconOf(look?.icon ?? MARK_ICON) ?? planIconOf(MARK_ICON);
  const g = toCanvasGeometry(fields);
  const lines = look?.lines ?? (fields.name !== '' ? [fields.name] : []);
  const ghost = look?.ghost === true;
  const draw = (context: { zoom: number; colours: CanvasColours }): ReactNode => {
    const common = { width: g.width, height: g.height, zoom: context.zoom, name: '', colours: context.colours };
    // A character's mark says its own letter and number in place of the kit's "A1" (look.texts).
    const shape = icon ? createElement(IconShape, { icon, ...common, texts: look?.texts }) : createElement(UnknownIconShape, common);
    return ghost ? createElement(Group, { opacity: DIM_OPACITY, listening: false }, shape) : shape;
  };
  const cone = look?.cone ?? null;
  const own =
    ghost && cone !== null
      ? cameraBeyond(g, { degrees: cone, lines, selected: look.selected, edgesOnly: true }, toCanvas(CONE_LENGTH_M), PLAN_ZOOM.min)
      : lines.length > 0
        ? labelsBeyond(g, lines, PLAN_ZOOM.min)
        : undefined;
  const beyond = joinBeyond(own, path ? pathBeyond(g, path, PLAN_ZOOM.min) : undefined);
  const what = look?.say ?? iconLabel(MARK_ICON);
  const label = t('plan.announce.icon', { what, width: formatLength(fields.width, unit), depth: formatLength(fields.height, unit) });
  return { id, ...g, label, keepRatio: true, draw, ...(beyond ? { beyond } : {}), ...(path ? { fitExtent: path.fit } : {}), sameInAndOut: true };
}

/** What the room's north is called aloud: "North, 35°". */
export const northAnnounce = (fields: NorthFields): string => t('plan.announce.north', { degrees: t('plan.degrees', { value: String(Math.round(fields.rotation * 100) / 100) }) });

/**
 * The room's north for the canvas (6.6): the kit's north arrow at its real size, turned with the item, whose rotation IS
 * the room's north; its proportions kept. A set height or a name is a label by it, as an icon's.
 */
export function northItem(id: string, fields: NorthFields, unit: PlanUnit): CanvasItem {
  const icon = planIconOf(fields.icon) ?? planIconOf(NORTH_ICON);
  const g = toCanvasGeometry(fields);
  const lines = heightLines(fields, unit);
  const draw = (context: { zoom: number; colours: CanvasColours }): ReactNode => {
    const common = { width: g.width, height: g.height, zoom: context.zoom, name: lines.length > 0 ? '' : fields.name, colours: context.colours };
    return icon ? createElement(IconShape, { icon, ...common }) : createElement(UnknownIconShape, common);
  };
  return { id, ...g, label: northAnnounce(fields), keepRatio: true, draw, ...(lines.length > 0 ? { beyond: labelsBeyond(g, lines, PLAN_ZOOM.min) } : {}), sameInAndOut: true };
}

/** What a sun path is called aloud: "Sun path, 14:30 · 212° · 38° high", or what it lacks. */
export const sunAnnounce = (look: SunLook | null): string => {
  const what = iconLabel(SUN_ICON);
  if (!look) return what;
  return t('plan.announce.sun', { what, says: look.kind === 'missing' ? look.lines.join(' · ') : look.label });
};

/**
 * A sun path for the canvas (6.6): its icon at its real size, never turned by the handles (its drawing is the compass's),
 * its proportions kept, and past its box the sun's day round its middle (sunDraw.tsx), or a label saying what it lacks.
 */
export function sunItem(id: string, fields: SunFields, look: SunLook | null): CanvasItem {
  const icon = planIconOf(fields.icon) ?? planIconOf(SUN_ICON);
  // Never turned (6.6 review): one imported with a turn of its own is drawn upright, as nothing could turn it back.
  const g = { ...toCanvasGeometry(fields), rotation: 0 };
  const draw = (context: { zoom: number; colours: CanvasColours }): ReactNode => {
    const common = { width: g.width, height: g.height, zoom: context.zoom, name: '', colours: context.colours };
    return icon ? createElement(IconShape, { icon, ...common }) : createElement(UnknownIconShape, common);
  };
  // Fit all takes in its whole circle (sunFitExtent), never the far wider reach kept for culling.
  const fit = look ? sunFitExtent(g, look) : null;
  return { id, ...g, label: sunAnnounce(look), keepRatio: true, noTurn: true, draw, ...(look ? { beyond: sunBeyond(g, look, PLAN_ZOOM.min) } : {}), ...(fit ? { fitExtent: fit } : {}), sameInAndOut: true };
}

/** What an underlay is called aloud: "Underlay, 10.00 m by 7.50 m", and whether its scale is set. */
export const underlayAnnounce = (fields: UnderlayFields, unit: PlanUnit): string =>
  t(fields.scaled ? 'plan.announce.underlay' : 'plan.announce.underlayUnscaled', { width: formatLength(fields.width, unit), depth: formatLength(fields.height, unit) });

/**
 * An underlay for the canvas (6.9): its picture stretched to its box, stored and drawn as a board's pictures are (the
 * thumbnail until it is drawn large, then the stored picture; "gone" said where the file no longer holds it), its
 * proportions kept. `sha` is its picture's address, null when its `media` record is missing. Dimmed and locked by its
 * row of the layers, as any layer's items are.
 */
export function underlayItem(id: string, fields: UnderlayFields, unit: PlanUnit, sha: string | null): CanvasItem {
  const g = toCanvasGeometry(fields);
  return {
    id,
    ...g,
    label: underlayAnnounce(fields, unit),
    keepRatio: true,
    // Nothing snaps to the picture's frame or middle lines (6.9 review, L5): what is traced over it snaps to the walls.
    noSnap: true,
    // On paper (6.10) its stored picture, whatever size it prints at (the PDF reads the original's file itself), under an id
    // of its own, so the screen's report of what size it draws the underlay at is left as it is.
    draw: (context) => createElement(PictureNode, { id: context.print ? `print:${id}` : id, sha256: sha, width: g.width, height: g.height, zoom: context.print ? PRINT_PICTURE_ZOOM : context.zoom, inView: context.inView, colours: context.colours }),
  };
}

/** The zoom an underlay's picture is asked for at on paper: far enough in that its stored picture is drawn. */
const PRINT_PICTURE_ZOOM = 1000;

/** How long a measure's end ticks reach either side of its line, screen pixels. */
const MEASURE_TICK_PIXELS = 6;

/** What a measure is called aloud: "Measure, 3.50 m". */
export const measureAnnounce = (fields: MeasureFields, unit: PlanUnit): string =>
  fields.name === '' ? t('plan.announce.measure', { length: formatLength(fields.width, unit) }) : t('plan.announce.measureNamed', { name: fields.name, length: formatLength(fields.width, unit) });

/** A measure's label: its name when it has one, then its length in the unit shown. */
export const measureLines = (fields: MeasureFields, unit: PlanUnit): string[] => [...(fields.name !== '' ? [fields.name] : []), formatLength(fields.width, unit)];

/**
 * A measure for the canvas (6.9): a thin ink line along its box's middle with a tick across each end, its length (in the
 * unit shown) an upright mono label beside its middle, as a wall's height label is (BesideLabels), never themed. Picked
 * at least FRAME_PICK_PIXELS thick, as a standing frame is: its 1 cm box is a hairline zoomed out. Its ends are its snap
 * points, as a wall's are.
 */
export function measureItem(id: string, fields: MeasureFields, unit: PlanUnit): CanvasItem {
  const g = toCanvasGeometry(fields);
  const [start, end] = wallEnds(fields);
  const lines = measureLines(fields, unit);
  const draw = (context: { zoom: number; colours: CanvasColours }): ReactNode => {
    const mid = g.height / 2;
    const tick = MEASURE_TICK_PIXELS / context.zoom;
    const ink = { stroke: context.colours.ink, strokeWidth: 1, strokeScaleEnabled: false, listening: false } as const;
    return createElement(
      Fragment,
      null,
      createElement(Line, { key: 'line', points: [0, mid, g.width, mid], ...ink }),
      createElement(Line, { key: 'start', points: [0, mid - tick, 0, mid + tick], ...ink }),
      createElement(Line, { key: 'end', points: [g.width, mid - tick, g.width, mid + tick], ...ink }),
    );
  };
  return {
    id,
    ...g,
    label: measureAnnounce(fields, unit),
    snapPoints: [
      { x: toCanvas(start.x), y: toCanvas(start.y) },
      { x: toCanvas(end.x), y: toCanvas(end.y) },
    ],
    pickThickness: FRAME_PICK_PIXELS,
    draw,
    // Above the line, the side away from its box's normal, so a measure drawn along a wall's face and the wall's own height
    // label (on the wall's normal side) sit apart.
    beyond: besideBeyond(g, { lines, side: -1, edge: g.height / 2 }, PLAN_ZOOM.min),
    sameInAndOut: true,
  };
}

/** The walls whose ends meet each wall's (within a cell of a millimetre's join), found through a grid of their ends, not pair by pair. */
function joinedTo(lines: readonly WallLine[]): Map<string, WallLine[]> {
  // Cells of 1 canvas unit (1 cm), far wider than the 1 mm join: two ends that join are in the same or a neighbouring cell.
  const cell = (p: Point) => [Math.floor(p.x), Math.floor(p.y)] as const;
  const ends = new Map<string, WallLine[]>();
  for (const line of lines) {
    for (const p of [line.start, line.end]) {
      const [cx, cy] = cell(p);
      const key = `${String(cx)},${String(cy)}`;
      const here = ends.get(key);
      if (here) here.push(line);
      else ends.set(key, [line]);
    }
  }
  const joined = new Map<string, WallLine[]>();
  for (const line of lines) {
    const near = new Set<WallLine>();
    for (const p of [line.start, line.end]) {
      const [cx, cy] = cell(p);
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (const other of ends.get(`${String(cx + dx)},${String(cy + dy)}`) ?? []) if (other !== line) near.add(other);
    }
    joined.set(line.id, [...near]);
  }
  return joined;
}

const ARC_STEPS = 24;

/**
 * A door or window as a plan draws it, in its own box (canvas units): a gap in the wall (paper over the wall's ink,
 * since a board's content is never themed) with its jambs; a door's leaf standing open and the quarter circle it
 * swings through; a window's thin double line.
 */
function drawOpening(o: OpeningFields, frame: OpeningFrame, colours: CanvasColours): ReactNode {
  const w = toCanvas(o.width);
  const t = toCanvas(frame.thickness);
  const lo = toCanvas(frame.lo);
  const X = (a: number) => a + w / 2;
  const Y = (b: number) => b - lo;
  const ink = { stroke: colours.ink, strokeScaleEnabled: false, listening: false } as const;
  const parts: ReactNode[] = [
    createElement(Rect, { key: 'gap', x: 0, y: Y(-t / 2) - 0.5, width: w, height: t + 1, fill: colours.paper, listening: false }),
    createElement(Line, { key: 'jamb-a', points: [X(-w / 2), Y(-t / 2), X(-w / 2), Y(t / 2)], strokeWidth: 1.5, ...ink }),
    createElement(Line, { key: 'jamb-b', points: [X(w / 2), Y(-t / 2), X(w / 2), Y(t / 2)], strokeWidth: 1.5, ...ink }),
  ];
  const side = swingSign(o);
  if (side !== 0) {
    const hinge = o.hinge === 'start' ? -w / 2 : w / 2;
    const toLatch = hinge < 0 ? 1 : -1;
    const face = (side * t) / 2;
    const arc: number[] = [];
    for (let i = 0; i <= ARC_STEPS; i += 1) {
      const turn = (i / ARC_STEPS) * (Math.PI / 2);
      arc.push(X(hinge + toLatch * w * Math.cos(turn)), Y(face + side * w * Math.sin(turn)));
    }
    parts.push(
      createElement(Line, { key: 'leaf', points: [X(hinge), Y(face), X(hinge), Y(face + side * w)], strokeWidth: 1.5, ...ink }),
      createElement(Line, { key: 'arc', points: arc, strokeWidth: 1, ...ink }),
    );
  } else {
    for (const b of [-t / 6, t / 6]) parts.push(createElement(Line, { key: `pane${String(b)}`, points: [X(-w / 2), Y(b), X(w / 2), Y(b)], strokeWidth: 1, ...ink }));
  }
  return createElement(Fragment, null, ...parts);
}

/** A door or window for the canvas, from its wall: moved only, never resized or turned by the handles. */
export function openingItem(id: string, fields: OpeningFields, wall: PlanItemFields, unit: PlanUnit, preview = false): CanvasItem {
  const frame = openingFrame(wall, fields);
  const g = toCanvasGeometry(frame.box);
  // A set height (decision 11, 6.5 reviews): a label beside it, upright, on the side away from its wall's height label
  // (which sits on the wall's normal side), past its own box, so a door's swing never runs through it.
  const lines = heightLines(fields, unit, false);
  return {
    id,
    ...g,
    ...(lines.length > 0 ? { beyond: besideBeyond(g, { lines, side: -1, edge: g.height / 2 }, PLAN_ZOOM.min) } : {}),
    label: openingLabel(fields, unit),
    // It snaps along its wall (planConstrain), never by its box.
    snapPoints: [],
    moveOnly: true,
    ...(preview ? { locked: true, dim: true } : {}),
    draw: (context) => drawOpening(fields, frame, context.colours),
    sameInAndOut: true,
  };
}

/**
 * What a built item depended on: the same record, unit, ink and language (its label is in words), and the same walls at
 * its ends (or its wall), give the same item.
 */
interface Built {
  record: SbdRecord;
  unit: PlanUnit;
  ink: string;
  locale: string;
  neighbours: readonly SbdRecord[];
  /** A camera's look (6.4), as a string: what its cone and labels were drawn from, read from other records. */
  look?: string;
  item: CanvasItem;
}

const isWall = (item: ShownItem): item is ShownItem & { fields: PlanItemFields } => item.fields.kind === 'wall';
const isOpeningItem = (item: ShownItem): item is ShownItem & { fields: OpeningFields } => isOpening(item.fields);
const isIconItem = (item: ShownItem): item is ShownItem & { fields: IconFields } => isIcon(item.fields);
const isCameraItem = (item: ShownItem): item is ShownItem & { fields: CameraFields } => isCamera(item.fields);
const isLightItem = (item: ShownItem): item is ShownItem & { fields: LightFields } => isLight(item.fields);
const isGripItem = (item: ShownItem): item is ShownItem & { fields: GripFields } => isGrip(item.fields);
const isNorthItem = (item: ShownItem): item is ShownItem & { fields: NorthFields } => isNorth(item.fields);
const isSunItem = (item: ShownItem): item is ShownItem & { fields: SunFields } => isSun(item.fields);
const isMarkItem = (item: ShownItem): item is ShownItem & { fields: MarkFields } => isMark(item.fields);
const isUnderlayItem = (item: ShownItem): item is ShownItem & { fields: UnderlayFields } => isUnderlay(item.fields);
const isMeasureItem = (item: ShownItem): item is ShownItem & { fields: MeasureFields } => isMeasure(item.fields);

/**
 * A view's items for the canvas, kept between calls (6.2a): a wall's item is made again only when its record, the unit,
 * the ink or the walls joined at its ends changed (their mitres shape its corners), a door's or window's only when it
 * or its wall changed, so an edit elsewhere in the project rebuilds nothing and the canvas keeps what it drew; when
 * nothing changed, the same list comes back. Doors and windows come after the walls, so they are drawn over them.
 */
export function planItemsBuilder(): (
  shown: readonly ShownItem[],
  unit: PlanUnit,
  ink: string,
  locale?: string,
  looks?: ReadonlyMap<string, CameraLook>,
  lights?: ReadonlyMap<string, LightLook>,
  suns?: ReadonlyMap<string, SunLook>,
  blocking?: BlockingLooks,
  layers?: ReadonlyMap<string, LayerLook>,
  pictures?: ReadonlyMap<string, string | null>,
) => readonly CanvasItem[] {
  let built = new Map<string, Built>();
  let layered = new Map<string, { from: CanvasItem; look: string; item: CanvasItem }>();
  let last: readonly CanvasItem[] = [];
  return (shown, unit, ink, locale = getLocale(), looks = new Map(), lights = new Map(), suns = new Map(), blocking = NO_BLOCKING, layers = NO_LAYERS, pictures = new Map()) => {
    const walls = shown.filter(isWall);
    const lines = walls.map((item) => lineOf(item.record.id, item.fields));
    const records = new Map(walls.map((item) => [item.record.id, item.record]));
    const joined = joinedTo(lines);
    const next = new Map<string, Built>();
    const kept = (item: ShownItem, neighbours: readonly SbdRecord[], look?: string): CanvasItem | null => {
      const was = built.get(item.record.id);
      if (
        was &&
        was.record === item.record &&
        was.unit === unit &&
        was.ink === ink &&
        was.locale === locale &&
        was.look === look &&
        was.neighbours.length === neighbours.length &&
        was.neighbours.every((r, k) => r === neighbours[k])
      ) {
        next.set(item.record.id, was);
        return was.item;
      }
      return null;
    };
    const openingsOn = new Map<string, (ShownItem & { fields: OpeningFields })[]>();
    for (const item of shown.filter(isOpeningItem)) openingsOn.set(item.fields.wallId, [...(openingsOn.get(item.fields.wallId) ?? []), item]);
    const wallItems = walls.map((item, i): CanvasItem => {
      const line = lines[i] as WallLine;
      const near = joined.get(line.id) ?? [];
      const heights = heightLines(item.fields, unit, false);
      // A wall with a height label is made again when a door or window on it changes too: the label sits past its swing.
      const openings = heights.length > 0 ? (openingsOn.get(item.record.id) ?? []) : [];
      const neighbours = [...near.flatMap((other) => records.get(other.id) ?? []), ...openings.map((o) => o.record)];
      const same = kept(item, neighbours);
      if (same) return same;
      const outline = wallOutline(line, [line, ...near]).flatMap((p) => [p.x, p.y]);
      const g = toCanvasGeometry(item.fields);
      // A set height (decision 11, 6.5 reviews) is a label beside the wall's middle, on its normal side, upright, past a
      // door that swings that way (cameraDraw.tsx, besidePlace).
      const clears = openings.map((o) => ({ from: toCanvas(o.fields.along - o.fields.width / 2), to: toCanvas(o.fields.along + o.fields.width / 2), reach: toCanvas(openingFrame(item.fields, o.fields).hi) }));
      const made: CanvasItem = {
        id: item.record.id,
        ...g,
        label: wallLabel(item.fields, unit),
        // A wall snaps by its middle line's ends, never by its box (a move keeps it on the grid line it was on).
        snapPoints: [line.start, line.end],
        // Moved by its body, resized by its ends (6.19c): no anchor on its centre line.
        endsOnly: true,
        draw: () => createElement(Line, { key: 'wall', points: outline, closed: true, fill: ink, listening: false }),
        ...(heights.length > 0 ? { beyond: besideBeyond(g, { lines: heights, side: 1, edge: g.height / 2, clears }, PLAN_ZOOM.min) } : {}),
        sameInAndOut: true,
      };
      next.set(item.record.id, { record: item.record, unit, ink, locale, neighbours, item: made });
      return made;
    });
    const wallById = new Map(walls.map((item) => [item.record.id, item]));
    const openingItems = shown.filter(isOpeningItem).flatMap((item): CanvasItem[] => {
      const wall = wallById.get(item.fields.wallId);
      if (!wall) return [];
      const same = kept(item, [wall.record]);
      if (same) return [same];
      const made = openingItem(item.record.id, item.fields, wall.fields, unit);
      next.set(item.record.id, { record: item.record, unit, ink, locale, neighbours: [wall.record], item: made });
      return [made];
    });
    // Icons (6.3) over the walls and their openings, each made again only when its own record (or the unit, ink or
    // language) changed: it depends on nothing else.
    const iconItems = shown.filter(isIconItem).map((item): CanvasItem => {
      const same = kept(item, []);
      if (same) return same;
      const made = iconItem(item.record.id, item.fields, unit);
      next.set(item.record.id, { record: item.record, unit, ink, locale, neighbours: [], item: made });
      return made;
    });
    // Cameras (6.4) over the icons, each made again when its record or its look (its frames' lenses, its body, the
    // project's frame shape, the selection: read from other records) changed.
    const cameraItems = shown.filter(isCameraItem).map((item): CanvasItem => {
      const look = looks.get(item.record.id) ?? NO_LOOK;
      // A camera that moves (6.7) is made again when any of its later positions moves too: it carries their path.
      const path = blocking.paths.get(item.record.id) ?? null;
      const key = JSON.stringify([look, path]);
      const same = kept(item, [], key);
      if (same) return same;
      const made = cameraItem(item.record.id, item.fields, unit, look, path);
      next.set(item.record.id, { record: item.record, unit, ink, locale, neighbours: [], look: key, item: made });
      return made;
    });
    // Flags and diffusion (6.5) with the icons, each from its own record; lights over them, each made again when its look
    // (its watts, which may be its gear item's, the selection, the language) changed.
    const gripItems = shown.filter(isGripItem).map((item): CanvasItem => {
      const same = kept(item, []);
      if (same) return same;
      const made = gripItem(item.record.id, item.fields, unit);
      next.set(item.record.id, { record: item.record, unit, ink, locale, neighbours: [], item: made });
      return made;
    });
    const lightItems = shown.filter(isLightItem).map((item): CanvasItem => {
      const look = lights.get(item.record.id) ?? null;
      const key = JSON.stringify(look);
      const same = kept(item, [], key);
      if (same) return same;
      const made = lightItem(item.record.id, item.fields, unit, look);
      next.set(item.record.id, { record: item.record, unit, ink, locale, neighbours: [], look: key, item: made });
      return made;
    });
    // The room's north (6.6) with the icons, from its own record; sun paths over everything, each made again when its look
    // (the setup's frames, their day's date, the location's place and zone, the room's north, the selection, the
    // language: read from other records) changed.
    const northItems = shown.filter(isNorthItem).map((item): CanvasItem => {
      const same = kept(item, []);
      if (same) return same;
      const made = northItem(item.record.id, item.fields, unit);
      next.set(item.record.id, { record: item.record, unit, ink, locale, neighbours: [], item: made });
      return made;
    });
    const sunItems = shown.filter(isSunItem).map((item): CanvasItem => {
      const look = suns.get(item.record.id) ?? null;
      const key = JSON.stringify(look);
      const same = kept(item, [], key);
      if (same) return same;
      const made = sunItem(item.record.id, item.fields, look);
      next.set(item.record.id, { record: item.record, unit, ink, locale, neighbours: [], look: key, item: made });
      return made;
    });
    // Marks (6.7) over the set and under the setup's own items, so a camera's later positions draw under the cameras.
    // Each is made again when its look changed (its number, its owner's name, a ghost camera's icon and lens, the
    // selection, the language) or, on an owner's first position, any position of the path it carries.
    const markItems = shown.filter(isMarkItem).map((item): CanvasItem => {
      const look = blocking.marks.get(item.record.id) ?? null;
      const path = blocking.paths.get(item.record.id) ?? null;
      const key = JSON.stringify([look, path]);
      const same = kept(item, [], key);
      if (same) return same;
      const made = markItem(item.record.id, item.fields, unit, look, path);
      next.set(item.record.id, { record: item.record, unit, ink, locale, neighbours: [], look: key, item: made });
      return made;
    });
    // Underlays (6.9) beneath everything, each made again when its record or its picture's address changed; measures over
    // the cameras and under the sun paths, so a dimension reads over the set it measures.
    const underlayItems = shown.filter(isUnderlayItem).map((item): CanvasItem => {
      const sha = item.fields.mediaId === null ? null : (pictures.get(item.fields.mediaId) ?? null);
      const key = JSON.stringify(sha);
      const same = kept(item, [], key);
      if (same) return same;
      const made = underlayItem(item.record.id, item.fields, unit, sha);
      next.set(item.record.id, { record: item.record, unit, ink, locale, neighbours: [], look: key, item: made });
      return made;
    });
    const measureItems = shown.filter(isMeasureItem).map((item): CanvasItem => {
      const same = kept(item, []);
      if (same) return same;
      const made = measureItem(item.record.id, item.fields, unit);
      next.set(item.record.id, { record: item.record, unit, ink, locale, neighbours: [], item: made });
      return made;
    });
    // Each item's layer (6.8): a dimmed layer's drawn at the core's dim, a locked one's never picked. The state is part
    // of the key: an item is made again only when it, or its layer's look, changed. A hidden layer's never come here.
    const nextLayered = new Map<string, { from: CanvasItem; look: string; item: CanvasItem }>();
    const items = [...underlayItems, ...wallItems, ...openingItems, ...iconItems, ...northItems, ...markItems, ...gripItems, ...lightItems, ...cameraItems, ...measureItems, ...sunItems].map((item) => {
      const look = layers.get(item.id);
      if (!look || (!look.dim && !look.locked)) return item;
      const key = (look.dim ? 'dim' : '') + (look.locked ? 'locked' : '');
      const was = layered.get(item.id);
      if (was && was.from === item && was.look === key) {
        nextLayered.set(item.id, was);
        return was.item;
      }
      const made: CanvasItem = { ...item, ...(look.dim ? { dim: true } : {}), ...(look.locked ? { locked: true } : {}) };
      nextLayered.set(item.id, { from: item, look: key, item: made });
      return made;
    });
    layered = nextLayered;
    built = next;
    if (items.length === last.length && items.every((item, i) => item === last[i])) return last;
    last = items;
    return items;
  };
}

/** What the canvas draws for a view, back to front: walls as ink bars, mitred where two meet, then doors and windows. */
export function planCanvasItems(records: Records, sceneId: string, setupId: string | null, unit: PlanUnit, ink: string): readonly CanvasItem[] {
  return planItemsBuilder()(shownItems(records, sceneId, setupId), unit, ink);
}

/**
 * A view's shown items, kept between calls: the same list back while every item record is the one it was, so an edit
 * to anything else in the project (a frame, a scene) leaves the plan's items as they are.
 */
export function shownItemsKeeper(): (records: Records, sceneId: string, setupId: string | null) => readonly ShownItem[] {
  let last: readonly ShownItem[] = [];
  let lastKey = '';
  return (records, sceneId, setupId) => {
    const now = shownItems(records, sceneId, setupId);
    const key = viewKey(sceneId, setupId);
    const same = (item: ShownItem, i: number) => {
      const was = last[i];
      return was !== undefined && item.record === was.record && item.level === was.level;
    };
    if (key === lastKey && now.length === last.length && now.every(same)) return last;
    last = now;
    lastKey = key;
    return now;
  };
}

/** The room a run drawn in a scene's view goes into: the live scene's live room, or null (a scene in the Trash takes none). */
export function runRoomId(records: Records, sceneId: string): string | null {
  const scene = records[sceneId];
  if (scene?.type !== 'scene' || scene.trashedAt !== null) return null;
  return sceneRoomId(records, scene);
}

/** The kinds of plan item an edit here writes: each must still read (shownFields) once the edit is written. */
const WRITTEN_KINDS: readonly string[] = ['wall', 'door', 'window', 'icon', 'camera', 'light', 'flag', 'diffusion', 'north', 'sun', 'mark', 'underlay', 'measure'];

/**
 * Whether these changes would leave a wall, door, window, icon or camera unreadable (6.3 review, M5): past the plan's
 * reach or size (PLAN_REACH, PLAN_MAX_SIZE in src/core/model/plan.ts), where the reader keeps it unseen, so it would
 * vanish from the plan. The one check every write path here makes (typed fields, nudges, drags, pastes, runs of walls,
 * placements): refused, nothing is written.
 */
export function unreadableAfter(records: Records, changes: readonly Change[]): boolean {
  const after = new Map<string, Props>();
  const made: Props[] = [];
  for (const change of changes) {
    if (change.kind === 'create') {
      if (change.record.type !== 'plan_item') continue;
      const props = change.record.props ?? {};
      if (change.record.id === undefined) made.push(props);
      else after.set(change.record.id, props);
    } else if (change.kind === 'update') {
      const before = after.get(change.id) ?? (records[change.id]?.type === 'plan_item' ? records[change.id]?.props : undefined);
      if (before === undefined) continue;
      const gone = new Set(change.unset ?? []);
      after.set(change.id, Object.fromEntries(Object.entries({ ...before, ...change.set }).filter(([name]) => !gone.has(name))));
    }
  }
  return [...after.values(), ...made].some((props) => typeof props.kind === 'string' && WRITTEN_KINDS.includes(props.kind) && shownFields(props) === null);
}

/** The changes, or none when they would leave an item unreadable. */
const readableOnly = (records: Records, changes: Change[]): Change[] => (unreadableAfter(records, changes) ? [] : changes);

/** A run of walls drawn in a view (canvas units): one wall a segment, into that view's scene's room, never another's. */
export function drawWallsChanges(records: Records, sceneId: string, points: readonly Point[]): { ids: string[]; changes: Change[] } {
  const roomId = runRoomId(records, sceneId);
  if (roomId === null) return { ids: [], changes: [] };
  const run = wallsAlong(records, roomId, points.map((p) => ({ x: toMetres(p.x), y: toMetres(p.y) })));
  return unreadableAfter(records, run.changes) ? { ids: [], changes: [] } : run;
}

/** The props a new measure is written with (6.9): its box as a wall's, a centimetre deep. */
export const measureProps = (g: PlanGeometry): Props => ({ kind: 'measure', x: g.x, y: g.y, width: g.width, height: g.height, rotation: g.rotation });

/**
 * A run of measures drawn in a view (canvas units, 6.9): one measure a segment, at the front of that view's scene's room
 * (a wall-to-wall dimension is the room's), drawn as the Wall tool draws (pathRun.ts); segments of no length left out.
 */
export function drawMeasuresChanges(records: Records, sceneId: string, points: readonly Point[]): { ids: string[]; changes: Change[] } {
  const roomId = runRoomId(records, sceneId);
  if (roomId === null) return { ids: [], changes: [] };
  let previous = lastKeyUnder(records, roomId, 'plan_item');
  const ids: string[] = [];
  const changes: Change[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const from = { x: toMetres(a.x), y: toMetres(a.y) };
    const to = { x: toMetres(b.x), y: toMetres(b.y) };
    if (Math.hypot(to.x - from.x, to.y - from.y) < MIN_PLAN_SIZE) continue;
    const id = crypto.randomUUID();
    const sortKey = keyBetween(previous, null);
    previous = sortKey;
    ids.push(id);
    changes.push({ kind: 'create', record: { id, type: 'plan_item', parentId: roomId, sortKey, props: measureProps(wallBetween(from, to, MEASURE_THICKNESS)) } });
  }
  return unreadableAfter(records, changes) ? { ids: [], changes: [] } : { ids, changes };
}

const sameGeometry = (a: PlanGeometry, b: PlanGeometry): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.rotation === b.rotation;

/** Closer than this to what's stored is what's stored: the canvas's own rounding (0.1 mm, hundredths of a degree). */
const SAME_METRES = 0.00005;
const SAME_DEGREES = 0.005;

/**
 * A gesture's box with the stored values kept wherever it differs from them by no more than the canvas's rounding, so a
 * handle pressed without a drag writes nothing, and a resize keeps a wall's rotation to the millionth of a degree.
 */
function keptWhereSame(was: PlanGeometry, next: PlanGeometry): PlanGeometry {
  const near = (a: number, b: number) => (Math.abs(a - b) <= SAME_METRES + 1e-12 ? a : b);
  const turn = Math.abs(((((next.rotation - was.rotation) % 360) + 540) % 360) - 180);
  return {
    x: near(was.x, next.x),
    y: near(was.y, next.y),
    width: near(was.width, next.width),
    height: near(was.height, next.height),
    rotation: turn < SAME_DEGREES ? was.rotation : next.rotation,
  };
}

/** A box in metres, its length and thickness never under a centimetre. */
const metresOf = (g: Geometry): PlanGeometry => ({
  x: toMetres(g.x),
  y: toMetres(g.y),
  width: Math.max(MIN_PLAN_SIZE, toMetres(g.width)),
  height: Math.max(MIN_PLAN_SIZE, toMetres(g.height)),
  rotation: normalDegrees(g.rotation),
});

/** The wall from its start, turned and as long as given, keeping the rotation exactly (atan2 of a rounded end may differ). */
function wallFrom(start: Point, rotation: number, length: number, thickness: number): PlanGeometry {
  const turn = (rotation * Math.PI) / 180;
  const g = wallBetween(start, { x: start.x + Math.cos(turn) * length, y: start.y + Math.sin(turn) * length }, thickness);
  return { ...g, rotation: normalDegrees(rotation), width: Math.max(MIN_PLAN_SIZE, Math.round(length * 10000) / 10000) };
}

/**
 * The least length a wall can have from its start and keep its doors and windows where they are: every plan's (6.2b
 * review), so a wall shortened in one scene never runs past a door only another scene's setup shows.
 */
export const wallNeedOf = (records: Records, wallId: string): number => wallNeeds(openingsInView(records, wallId).map((o) => o.fields));

/** What holds a wall at its least length (6.2b review): the length, and where the opening that needs it shows when this view doesn't show it. */
export interface WallNeed {
  length: number;
  /** Null when the view shows that opening (or none holds the wall). */
  hidden: { kind: OpeningKind; place: string } | null;
}

/** "SC 04 · Setup 1", "SC 04": where an item of a scene's own plan shows; null for a room's (or a plan with no scene). */
export function planPlaceName(records: Records, planId: string | null): string | null {
  const plan = planId === null ? undefined : records[planId];
  const kind = plan ? planFields(plan.props)?.kind : undefined;
  const holder = plan?.parentId ? records[plan.parentId] : undefined;
  if (kind === 'blocking' && holder?.type === 'scene') return sceneLabel(sceneFields(holder.props).number);
  if (kind !== 'setup' || holder?.type !== 'setup' || !holder.parentId) return null;
  const scene = records[holder.parentId];
  if (scene?.type !== 'scene') return null;
  const label = sceneLabel(sceneFields(scene.props).number);
  const setup = holder.trashedAt === null ? sceneSetups(records, scene.id).find((s) => s.record.id === holder.id) : undefined;
  return t('plan.placeSetup', { scene: label, setup: setup ? setupLabel(setup) : t('plan.trashedSetup') });
}

/** The most the walls need, and where the opening that needs it is when the view doesn't show it. */
export function wallNeedIn(records: Records, ids: readonly string[], view?: PlanViewOf | null): WallNeed {
  let need: WallNeed = { length: 0, hidden: null };
  for (const id of ids) {
    if (!liveItem(records, id)) continue;
    const shown = new Set(view ? openingsInView(records, id, view).map((o) => o.record.id) : null);
    for (const o of openingsInView(records, id)) {
      const length = o.fields.along + o.fields.width / 2;
      if (length <= need.length + 1e-9) continue;
      const place = view && !shown.has(o.record.id) ? planPlaceName(records, o.record.parentId) : null;
      need = { length, hidden: place === null ? null : { kind: o.fields.kind, place } };
    }
  }
  return need;
}

interface Span {
  along: number;
  width: number;
}

/**
 * A wall's new box held so its doors and windows stay in it (6.2b), and how far its start moved along it (each
 * opening's `along_m` less that keeps it where it is in the room, 6.2b review). Only a change of length moves the
 * openings or is held: a move or a turn alone carries them with the wall, and never stretches a wall whose openings
 * need more than it has (after a restore or an import). The start's move is measured along the wall's new direction,
 * so a turn and a resize in one change keep them in place too; each end stops where the opening nearest it begins.
 */
function heldForOpenings(was: PlanItemFields, next: PlanGeometry, spans: readonly Span[]): { geometry: PlanGeometry; shift: number } {
  if (Math.abs(next.width - was.width) <= 1e-9) return { geometry: next, shift: 0 };
  const { dir } = wallAxes(next);
  const [s0] = wallEnds(was);
  const [s1] = wallEnds(next);
  const shift = (s1.x - s0.x) * dir.x + (s1.y - s0.y) * dir.y;
  if (spans.length === 0) return { geometry: next, shift };
  // Along the old start: the new end's place, and how far each end may come in, to the nearest opening's edge (never
  // in past where it is now, for openings that already overrun it).
  const end = shift + next.width;
  const startLimit = Math.max(0, Math.min(...spans.map((o) => o.along - o.width / 2)));
  const endLimit = Math.min(was.width, wallNeeds(spans));
  const startHeld = Math.min(shift, startLimit);
  const endHeld = Math.max(end, endLimit);
  if (startHeld === shift && endHeld === end) return { geometry: next, shift };
  const start = { x: s1.x + dir.x * (startHeld - shift), y: s1.y + dir.y * (startHeld - shift) };
  return { geometry: wallFrom(start, next.rotation, endHeld - startHeld, next.height), shift: startHeld };
}

interface WallChoice {
  id: string;
  fields: PlanItemFields;
}

/** The walls a door or window may go into: those the view shows, else those in the plan of its own wall. */
function candidateWalls(records: Records, opening: { wall: { record: SbdRecord } }, walls?: readonly WallChoice[]): readonly WallChoice[] {
  if (walls) return walls;
  return Object.values(records).flatMap((r) => {
    const fields = r.parentId === opening.wall.record.parentId && r.trashedAt === null && r.type === 'plan_item' ? planItemFields(r.props) : null;
    return fields ? [{ id: r.id, fields }] : [];
  });
}

/** How far beyond its face a wall takes a door or window dragged over it (metres). */
const OVER_WALL = 0.3;

/** The walls a view shows, for a door or window to go into. */
export const shownWalls = (shown: readonly ShownItem[]): WallChoice[] => shown.filter(isWall).map((item) => ({ id: item.record.id, fields: item.fields }));

/**
 * Where a door or window dragged to `centre` (metres) lands: on the wall it is over, else along its own, snapped to
 * `step` along the wall, never off its ends or over another opening (`others` gives each wall's, itself left out). On
 * another wall with no room for it, it stays on its own; null when nowhere takes it.
 */
function landing(
  opening: { id: string; fields: OpeningFields; wallId: string; storedWidth: number },
  centre: Point,
  walls: readonly WallChoice[],
  others: (wallId: string) => readonly { along: number; width: number }[],
  step: number,
): { wallId: string; wall: PlanItemFields; along: number; width: number } | null {
  const own = walls.find((w) => w.id === opening.wallId);
  const over = wallUnder(walls, centre, OVER_WALL);
  const tries = [...(over ? [{ wall: over, along: over.along }] : []), ...(own && over?.id !== own.id ? [{ wall: own, along: projectOnWall(own.fields, centre).along }] : [])];
  for (const { wall, along } of tries) {
    // In its own wall it is as wide as it reads there; on another it takes the width it is stored with (6.2b review).
    const width = wall.id === opening.wallId ? opening.fields.width : opening.storedWidth;
    const fit = fitAlong(wall.fields.width, width, onStep(along, step), others(wall.id));
    if (fit !== null) return { wallId: wall.id, wall: wall.fields, along: fit, width };
  }
  return null;
}

/** The width an opening is stored with, whatever its wall reads it as. */
const storedWidthOf = (record: SbdRecord, fields: OpeningFields): number => openingFields(record.props)?.width ?? fields.width;

/** The openings in a wall as the view shows them, but for the ones left out. */
const spansIn = (shown: readonly ShownItem[], wallId: string, leaveOut: ReadonlySet<string>) =>
  shown.filter(isOpeningItem).filter((item) => item.fields.wallId === wallId && !leaveOut.has(item.record.id)).map((item) => item.fields);

/** The grid's step along a wall for a snap (metres): the grid's, its fine step with Alt, none with ⌘ or Ctrl. */
const stepFor = (unit: PlanUnit, snap: GridSnap): number => {
  const { grid } = planScale(unit);
  return snap === 'off' ? 0 : toMetres(snap === 'fine' ? grid.fine : grid.step);
};

/**
 * Where a move puts a view's items (6.2b; the canvas's `constrainMove`): a door or window slides along its wall, or
 * onto the wall it is dragged over, snapped along it to the grid's step; one on a moving wall moves with it.
 */
export function planConstrain(shown: readonly ShownItem[], unit: PlanUnit): (moving: ReadonlyMap<string, Geometry>, snap: GridSnap) => ReadonlyMap<string, Geometry> {
  const walls = shownWalls(shown);
  const openings = shown.filter(isOpeningItem);
  return (moving, snap) => {
    if (!openings.some((o) => moving.has(o.record.id) || moving.has(o.fields.wallId))) return moving;
    const out = new Map(moving);
    const step = stepFor(unit, snap);
    const movingIds = new Set(moving.keys());
    const still = walls.filter((w) => !movingIds.has(w.id));
    for (const o of openings) {
      const wallMove = moving.get(o.fields.wallId);
      const wall = walls.find((w) => w.id === o.fields.wallId);
      if (!wall) continue;
      if (wallMove) {
        out.set(o.record.id, toCanvasGeometry(openingFrame({ ...wall.fields, ...metresOf(wallMove) }, o.fields).box));
        continue;
      }
      const g = moving.get(o.record.id);
      if (!g) continue;
      const centre = centreOfBox({ x: toMetres(g.x), y: toMetres(g.y), width: toMetres(g.width), height: toMetres(g.height), rotation: g.rotation }, { ...o.fields, width: toMetres(g.width) });
      const pool = still.some((w) => w.id === wall.id) ? still : [...still, wall];
      const landed = landing({ id: o.record.id, fields: o.fields, wallId: wall.id, storedWidth: storedWidthOf(o.record, o.fields) }, centre, pool, (wallId) => spansIn(shown, wallId, movingIds), step);
      const placed = landed ? { wall: landed.wall, along: landed.along, width: landed.width } : { wall: wall.fields, along: o.fields.along, width: o.fields.width };
      out.set(o.record.id, toCanvasGeometry(openingFrame(placed.wall, { ...o.fields, along: placed.along, width: placed.width }).box));
    }
    return out;
  };
}

const planKindOf = (records: Records, planId: string | null): string | null => (planId === null ? null : (planFields(records[planId]?.props ?? {})?.kind ?? null));

/**
 * A finished move, resize or turn (canvas units): one update per item that changed, all one op group. A wall shortened
 * is held at the length its doors and windows need, every plan's (6.2b review); resized from its start, every opening
 * in it keeps its place in the room. A door or window lands where its box was put, along a wall (onto another wall it
 * moves to that wall, `wall_id` and all), and one whose wall moved with it is left to follow it. A setup's own opening
 * stays in the setup's plan whatever wall it goes to; one at the room's level dragged onto a wall that is one setup's
 * only goes into that setup's plan with it.
 */
export function planGeometryChanges(records: Records, changes: readonly GeometryChange[], walls?: readonly WallChoice[], view?: PlanViewOf | null): Change[] {
  return readableOnly(records, geometryUpdates(records, changes, walls, view));
}

function geometryUpdates(records: Records, changes: readonly GeometryChange[], walls?: readonly WallChoice[], view?: PlanViewOf | null): Change[] {
  const changed = new Set(changes.map((c) => c.id));
  return changes.flatMap((c): Change[] => {
    const opening = liveOpening(records, c.id);
    if (opening) {
      if (changed.has(opening.fields.wallId)) return [];
      const centre = centreOfBox({ x: toMetres(c.x), y: toMetres(c.y), width: toMetres(c.width), height: toMetres(c.height), rotation: c.rotation }, { ...opening.fields, width: toMetres(c.width) });
      const pool = candidateWalls(records, opening, walls);
      const others = (wallId: string) => openingsInView(records, wallId, view).filter((o) => o.record.id !== c.id && !changed.has(o.record.id)).map((o) => o.fields);
      const landed = landing({ id: c.id, fields: opening.fields, wallId: opening.fields.wallId, storedWidth: storedWidthOf(opening.record, opening.fields) }, centre, pool.some((w) => w.id === opening.fields.wallId) ? pool : [...pool, { id: opening.wall.record.id, fields: opening.wall.fields }], others, 0);
      if (!landed || (landed.wallId === opening.fields.wallId && Math.abs(landed.along - opening.fields.along) < 1e-4)) return [];
      const set: Props = { along_m: landed.along };
      if (landed.wallId !== opening.fields.wallId) set.wall_id = landed.wallId;
      const move: Change[] = [];
      const wallPlan = records[landed.wallId]?.parentId ?? null;
      const ownPlan = opening.record.parentId;
      if (wallPlan !== null && wallPlan !== ownPlan && planKindOf(records, ownPlan) !== 'setup' && planKindOf(records, wallPlan) === 'setup') {
        move.push({ kind: 'move', id: c.id, parentId: wallPlan, sortKey: keyBetween(lastKeyUnder(records, wallPlan, 'plan_item'), null) });
      }
      return [{ kind: 'update', id: c.id, set }, ...move];
    }
    const icon = liveIcon(records, c.id);
    if (icon) {
      // An icon's box is just its box (6.3): moved, turned and resized as the gesture left it, in metres.
      const next = keptWhereSame(icon.fields, metresOf(c));
      if (sameGeometry(icon.fields, next)) return [];
      return [{ kind: 'update', id: c.id, set: { x: next.x, y: next.y, width: next.width, height: next.height, rotation: next.rotation } }];
    }
    const measure = liveMeasure(records, c.id);
    if (measure) {
      // A measure (6.9): moved, turned and stretched as the gesture left it, its depth as stored (a line has none to change),
      // about its middle line, so the line stays where the handles put it.
      const was = measure.fields;
      const gesture = metresOf(c);
      const cy = gesture.y + gesture.height / 2;
      const next = keptWhereSame(was, { ...gesture, y: Math.round((cy - was.height / 2) * 10000) / 10000, height: was.height });
      if (sameGeometry(was, next)) return [];
      return [{ kind: 'update', id: c.id, set: { x: next.x, y: next.y, width: next.width, height: next.height, rotation: next.rotation } }];
    }
    const live = liveItem(records, c.id);
    if (!live) return [];
    // Held by every plan's doors and windows (6.2b review): one only another scene shows keeps its place in the room too.
    const held = heldForOpenings(live.fields, keptWhereSame(live.fields, metresOf(c)), openingsInView(records, c.id).map((o) => o.fields));
    const next = keptWhereSame(live.fields, held.geometry);
    if (sameGeometry(live.fields, next)) return [];
    const wall: Change = { kind: 'update', id: c.id, set: { x: next.x, y: next.y, width: next.width, height: next.height, rotation: next.rotation } };
    if (Math.abs(held.shift) < 1e-4) return [wall];
    // Its start moved along it: each opening's distance from the start changes by as much, so it stays where it was.
    // Held at every opening, the shift never takes one below 0, so nothing is clamped (and no place is lost).
    const kept = openingsOf(records, c.id).flatMap((o): Change[] => {
      const along = Math.round((o.fields.along - held.shift) * 10000) / 10000;
      return Math.abs(along - o.fields.along) < 1e-6 ? [] : [{ kind: 'update', id: o.record.id, set: { along_m: along } }];
    });
    return [wall, ...kept];
  });
}

/**
 * An arrow key's nudge (canvas units), added to each item as it is when the edit is written. A door or window moves
 * along its wall by the nudge's length, towards the wall's end when the arrow points that way (Right and Down when it
 * points across); one whose wall is nudged too moves with it.
 */
export function planNudgeChanges(records: Records, ids: readonly string[], dx: number, dy: number, view?: PlanViewOf | null): Change[] {
  return readableOnly(records, nudgeUpdates(records, ids, dx, dy, view));
}

function nudgeUpdates(records: Records, ids: readonly string[], dx: number, dy: number, view?: PlanViewOf | null): Change[] {
  const picked = new Set(ids);
  return ids.flatMap((id): Change[] => {
    const opening = liveOpening(records, id);
    if (opening) {
      if (picked.has(opening.fields.wallId)) return [];
      const { dir } = wallAxes(opening.wall.fields);
      const towards = dx * dir.x + dy * dir.y;
      const sign = Math.abs(towards) > 1e-9 ? Math.sign(towards) : Math.sign(dx + dy);
      const wanted = opening.fields.along + sign * toMetres(Math.hypot(dx, dy));
      const others = openingsInView(records, opening.fields.wallId, view).filter((o) => o.record.id !== id).map((o) => o.fields);
      const fit = fitAlong(opening.wall.fields.width, opening.fields.width, wanted, others);
      if (fit === null || Math.abs(fit - opening.fields.along) < 1e-4) return [];
      return [{ kind: 'update', id, set: { along_m: fit } }];
    }
    const live = liveBoxed(records, id);
    if (!live) return [];
    const g = toCanvasGeometry(live.fields);
    return geometryUpdates(records, [{ id, ...g, x: g.x + dx, y: g.y + dy }], undefined, view);
  });
}

/**
 * The items to the Trash, in one group: a wall with the doors and windows in it, a camera with its later positions
 * (6.7), so a restore brings them back; an icon on its own.
 */
export function trashPlanItemsChanges(records: Records, ids: readonly string[]): Change[] {
  const going = new Set<string>();
  for (const id of ids) {
    if (!liveBoxed(records, id) && !liveOpening(records, id)) continue;
    going.add(id);
    if (liveItem(records, id)) for (const o of openingsOf(records, id)) going.add(o.record.id);
    if (records[id]?.props.kind === 'camera') for (const mark of cameraMarks(records, id)) going.add(mark.id);
  }
  return [...going].map((id): Change => ({ kind: 'trash', id }));
}

const bySortKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);
/** One plan's items as it draws them: ties (an import's, or keys written before 6.7's review) by id, as plan.ts reads them. */
const inDrawingOrder = (a: SbdRecord, b: SbdRecord) => bySortKey(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Forward, back, to the front or the back: each plan's walls and icons reordered among their own plan's (a level is a
 * plan). Walls are drawn under every icon whatever their order, so an icon's order counts among the icons. Marks are
 * left out (6.7 review): they draw in a pass of their own, and their numbers come from their own `order`, so Bring to
 * front never renumbers a position nor reads a mark's key. Two siblings sharing a key (existing data) never stop it:
 * sortKeysFor writes a fresh key for the item moved.
 */
export function reorderPlanChanges(records: Records, ids: readonly string[], mode: ReorderMode): Change[] {
  const byPlan = new Map<string, string[]>();
  for (const id of ids) {
    const live = liveBoxed(records, id);
    const planId = live?.record.parentId;
    if (planId && !isMark(live.fields)) byPlan.set(planId, [...(byPlan.get(planId) ?? []), id]);
  }
  return [...byPlan].flatMap(([planId, chosenIds]) => {
    // Every sibling but a mark holds a key, the Trash's too, so a new key never ties with one coming back.
    const all = Object.values(records)
      .filter((r) => r.type === 'plan_item' && r.parentId === planId && r.props.kind !== 'mark')
      .sort(inDrawingOrder);
    const live = all.filter((r) => r.trashedAt === null && (planItemFields(r.props) !== null || boxFields(r.props) !== null || measureFields(r.props) !== null)).map((r) => r.id);
    const chosen = new Set(chosenIds);
    const nextLive = reordered(live, chosen, mode);
    if (nextLive.every((id, i) => id === live[i])) return [];
    const fixed = all.map((r) => r.id).filter((id) => !chosen.has(id));
    let after: string[];
    if (mode === 'front') after = [...fixed, ...nextLive.filter((id) => chosen.has(id))];
    else if (mode === 'back') after = [...nextLive.filter((id) => chosen.has(id)), ...fixed];
    else {
      after = [...fixed];
      nextLive.forEach((id, i) => {
        if (!chosen.has(id)) return;
        const before = nextLive[i - 1];
        after.splice(before === undefined ? 0 : after.indexOf(before) + 1, 0, id);
      });
    }
    const keys = sortKeysFor(all.map((r) => r.id), after, new Map(all.map((r) => [r.id, r.sortKey])), chosen);
    return [...keys].map(([id, sortKey]): Change => ({ kind: 'move', id, parentId: planId, sortKey }));
  });
}

/** What Copy keeps: the items' props as they are (metres), back to front, with the id each was copied from and its plan. */
export interface PlanClip {
  id: string;
  props: SbdRecord['props'];
  fields: ShownFields;
  /** The plan the original sat in (6.2b review): a paste goes back to it, or to the same level of the view pasted in. */
  planId?: string | null;
  /**
   * An underlay's picture record's props as they were when copied (6.9 review, M1), as a board's clip keeps its
   * picture's: a Cut takes the underlay to the Trash, and its paste still names the stored picture.
   */
  media?: SbdRecord['props'];
}

/** The stored picture's address an underlay's clip names (its copy-time record, else the live one), or null for none. */
export function clipPictureSha(records: Records, item: PlanClip): string | null {
  if (item.props.kind !== 'underlay') return null;
  const mediaId = typeof item.props.media_id === 'string' ? item.props.media_id : '';
  const live = mediaId === '' ? undefined : records[mediaId];
  const props = item.media ?? (live?.type === 'media' ? live.props : undefined);
  return props ? (mediaFields(props)?.sha256 ?? null) : null;
}

/**
 * Copied walls and icons, with the doors and windows in the walls the view shows (with no view, every plan's); a door
 * or window copied without its wall isn't (it has nowhere to go). A camera takes its later positions with it (6.7
 * review, M3), as a wall takes its openings, so Cut and Paste never leaves a camera without its move (its marks went to
 * the Trash with it); they follow the camera's copy when pasted, keeping their `order`.
 */
export function planClipOf(records: Records, ids: readonly string[], view?: PlanViewOf | null): PlanClip[] {
  const walls = ids.flatMap((id) => {
    const live = liveBoxed(records, id);
    return live ? [live] : [];
  });
  const picked = new Set(walls.map((w) => w.record.id));
  const moves = walls.flatMap((w) => (w.fields.kind === 'camera' ? cameraMarks(records, w.record.id) : [])).filter((r) => {
    if (picked.has(r.id)) return false;
    picked.add(r.id);
    return true;
  });
  const openings = walls.flatMap((w) => (w.fields.kind === 'wall' ? openingsInView(records, w.record.id, view).map((o) => o.record) : []));
  return [...[...walls.map((w) => w.record), ...moves].sort(bySortKey), ...openings.sort(bySortKey)].flatMap((record) => {
    const fields = shownFields(record.props);
    if (!fields) return [];
    const mediaId = isUnderlay(fields) ? fields.mediaId : null;
    const media = mediaId === null ? undefined : records[mediaId];
    return [{ id: record.id, props: record.props, fields, planId: record.parentId, ...(media?.type === 'media' ? { media: media.props } : {}) }];
  });
}

/** Whether a door or window is selected without its wall: Copy and Duplicate leave it out, and say so. */
export const openingsLeftOut = (records: Records, ids: readonly string[]): boolean => {
  const picked = new Set(ids);
  return ids.some((id) => {
    const fields = openingFields(records[id]?.props ?? {});
    return fields !== null && records[id]?.trashedAt === null && !picked.has(fields.wallId);
  });
};

/**
 * Where a pasted item goes in a view (6.2b review): the plan its original sits in when the view shows that plan, else
 * the view's plan of the same level, else the scene's room; null when the scene has no room and nothing fits.
 */
export function pasteTarget(records: Records, view: PlanViewOf): (item: PlanClip) => string | null {
  const plans = plansShown(records, view.sceneId, view.setupId);
  const shown = shownPlanIds(plans);
  return (item) => {
    const from = item.planId ?? null;
    if (from !== null && shown.has(from)) return from;
    const kind = planKindOf(records, from);
    const same = kind === 'room' || kind === 'blocking' || kind === 'setup' ? plans[kind] : null;
    // A setup's own item never falls back to the room (6.2b review): planPasteInView makes the setup's plan for it.
    if (kind === 'setup') return same?.id ?? null;
    return same?.id ?? plans.room?.id ?? null;
  };
}

/**
 * Pasted at the front of its plan: at the pointer (canvas units) when there is one, else 16 cm from the originals, as
 * the core places a board's paste. Each keeps every prop it was copied with (not what it was copied from); a door or
 * window goes into its wall's copy. `into` is one plan for all, or where each goes (`pasteTarget`).
 */
export function planPasteChanges(records: Records, into: string | ((item: PlanClip) => string | null), clip: readonly PlanClip[], at: Point | null): { ids: string[]; changes: Change[] } {
  const planOf = typeof into === 'string' ? () => into : into;
  // Walls and icons keep their places to each other, all moved as one.
  const walls = clip.filter((item): item is PlanClip & { fields: PlanItemFields | BoxFields | MeasureFields } => !isOpening(item.fields));
  const placed = pasted(walls.map((item) => toCanvasGeometry(item.fields)), at);
  const lastKeys = new Map<string, string | null>();
  const ids: string[] = [];
  const changes: Change[] = [];
  const copies = new Map<string, string>();
  const make = (item: PlanClip, props: Props): string | null => {
    const id = crypto.randomUUID();
    // An underlay's copy (6.9) takes a picture record of its own naming the same stored picture, as a board's does; one
    // whose picture is known nowhere (deleted for good since the copy) isn't pasted: an underlay never names nothing.
    const picture = props.kind === 'underlay' ? underlayPictureCopy(records, props, id, item.media) : null;
    if (props.kind === 'underlay' && !picture) return null;
    const planId = planOf(item);
    if (planId === null) return null;
    const sortKey = keyBetween(lastKeys.has(planId) ? (lastKeys.get(planId) ?? null) : lastKeyUnder(records, planId, 'plan_item'), null);
    lastKeys.set(planId, sortKey);
    ids.push(id);
    // A camera's copy shoots none of the original's frames (6.4): two cameras never claim one frame.
    const own: Props = withoutFrameLinks({ ...props });
    delete own.copied_from;
    if (picture) own.media_id = picture.id;
    changes.push({ kind: 'create', record: { id, type: 'plan_item', parentId: planId, sortKey, props: own } });
    if (picture) changes.push(picture.change);
    return id;
  };
  walls.forEach((item, i) => {
    const g = placed[i];
    if (!g) return;
    const m = metresOf(g);
    const id = make(item, { ...item.props, x: m.x, y: m.y });
    if (id !== null) copies.set(item.id, id);
  });
  for (const item of clip) {
    if (!isOpening(item.fields)) continue;
    const wall = copies.get(item.fields.wallId);
    if (wall) make(item, { ...item.props, wall_id: wall });
  }
  // A camera's mark (6.7) follows its camera's copy when the camera is pasted with it, keeping its `order`; else it is a
  // plain mark, at a tape mark's size, unturned (6.7 review, L2).
  const plain = iconSize(MARK_ICON) ?? undefined;
  for (const change of changes) if (change.kind === 'create' && change.record.props?.kind === 'mark') change.record.props = repointCamera(change.record.props, copies, plain);
  // Pasted at a pointer past the plan's reach, the copies would never show: nothing is pasted.
  return unreadableAfter(records, changes) ? { ids: [], changes: [] } : { ids, changes };
}

/** What the Selection tile changes on walls; each field it leaves out stays as it is. */
export interface WallPatch {
  /** Metres: its start stays, its end follows. */
  length?: number;
  /** Metres, about its middle line. */
  thickness?: number;
  /** Metres; null takes it off. */
  heightM?: number | null;
  /** Degrees, turned about its start. */
  rotation?: number;
  /** Its start, metres. */
  startX?: number;
  startY?: number;
  name?: string;
}

/**
 * Whether walls can be this long and keep their doors and windows (6.2b): every plan's, those only another scene
 * shows too (6.2b review; wallNeedIn says where they are). A shorter length is refused.
 */
export const wallsTakeLength = (records: Records, ids: readonly string[], length: number): boolean => ids.every((id) => !liveItem(records, id) || length >= wallNeedOf(records, id) - 1e-4);

/** A field changed on the selected walls (6.2a Selection tile): one update per wall that changes, one op group. */
export function wallPatchChanges(records: Records, ids: readonly string[], patch: WallPatch): Change[] {
  if (patch.length !== undefined && !wallsTakeLength(records, ids, patch.length)) return [];
  return readableOnly(records, wallUpdates(records, ids, patch));
}

/** Whether the Selection tile refuses a change to the selected walls: one that would leave a wall past the plan's reach or size. */
export const wallPatchRefused = (records: Records, ids: readonly string[], patch: WallPatch): boolean => unreadableAfter(records, wallUpdates(records, ids, patch));

function wallUpdates(records: Records, ids: readonly string[], patch: WallPatch): Change[] {
  return ids.flatMap((id): Change[] => {
    const live = liveItem(records, id);
    if (!live) return [];
    const now = live.fields;
    const [start] = wallEnds(now);
    const length = patch.length ?? now.width;
    const thickness = patch.thickness ?? now.height;
    const from = { x: patch.startX ?? start.x, y: patch.startY ?? start.y };
    const changedShape = patch.length !== undefined || patch.thickness !== undefined || patch.rotation !== undefined || patch.startX !== undefined || patch.startY !== undefined;
    // A length typed as it was keeps the rotation it was typed with (atan2 of a rounded end may differ by a hundredth).
    const geometry = changedShape ? wallFrom(from, patch.rotation ?? now.rotation, length, thickness) : now;
    const set: SbdRecord['props'] = {};
    const unset: string[] = [];
    if (changedShape && !sameGeometry(now, geometry)) Object.assign(set, wallProps(geometry));
    if (patch.heightM !== undefined && patch.heightM !== now.heightM) {
      if (patch.heightM === null) unset.push('height_m');
      else set.height_m = patch.heightM;
    }
    if (patch.name !== undefined && patch.name.trim() !== now.name) {
      if (patch.name.trim() === '') unset.push('name');
      else set.name = patch.name.trim();
    }
    delete set.kind;
    if (Object.keys(set).length === 0 && unset.length === 0) return [];
    return [{ kind: 'update', id, ...(Object.keys(set).length > 0 ? { set } : {}), ...(unset.length > 0 ? { unset } : {}) }];
  });
}

/** What the Selection tile changes on measures (6.9), as on walls: a length keeps its start, a rotation turns about it. */
export type MeasurePatch = Pick<WallPatch, 'length' | 'rotation' | 'startX' | 'startY' | 'name'>;

/** A field changed on the selected measures: one update per measure that changes, one op group; nothing when refused. */
export function measurePatchChanges(records: Records, ids: readonly string[], patch: MeasurePatch): Change[] {
  return readableOnly(records, measureUpdates(records, ids, patch));
}

/** Whether the Selection tile refuses a change to the selected measures: one under a centimetre, or past the plan's reach or size. */
export const measurePatchRefused = (records: Records, ids: readonly string[], patch: MeasurePatch): boolean =>
  (patch.length !== undefined && patch.length < MIN_PLAN_SIZE) || unreadableAfter(records, measureUpdates(records, ids, patch));

function measureUpdates(records: Records, ids: readonly string[], patch: MeasurePatch): Change[] {
  return ids.flatMap((id): Change[] => {
    const live = liveMeasure(records, id);
    if (!live) return [];
    const now = live.fields;
    const [start] = wallEnds(now);
    const changedShape = patch.length !== undefined || patch.rotation !== undefined || patch.startX !== undefined || patch.startY !== undefined;
    const geometry = changedShape ? wallFrom({ x: patch.startX ?? start.x, y: patch.startY ?? start.y }, patch.rotation ?? now.rotation, patch.length ?? now.width, now.height) : now;
    const set: Props = {};
    const unset: string[] = [];
    if (changedShape && !sameGeometry(now, geometry)) Object.assign(set, { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, rotation: geometry.rotation });
    if (patch.name !== undefined && patch.name.trim() !== now.name) {
      if (patch.name.trim() === '') unset.push('name');
      else set.name = patch.name.trim();
    }
    if (Object.keys(set).length === 0 && unset.length === 0) return [];
    return [{ kind: 'update', id, ...(Object.keys(set).length > 0 ? { set } : {}), ...(unset.length > 0 ? { unset } : {}) }];
  });
}

/** What the Selection tile changes on doors and windows (6.2b); each field it leaves out stays as it is. */
export interface OpeningPatch {
  /** Metres, about its middle. */
  width?: number;
  /** Metres from the wall's start to the opening's near edge, or from the wall's end to its far edge. */
  fromStart?: number;
  fromEnd?: number;
  hinge?: Hinge;
  swing?: Swing;
  /** Metres; null takes it off. */
  heightM?: number | null;
  name?: string;
}

/** An opening's distances from its wall's two ends to its edges, metres. */
export const openingDistances = (wall: PlanItemFields, o: OpeningFields): { fromStart: number; fromEnd: number } => ({
  fromStart: Math.round((o.along - o.width / 2) * 10000) / 10000,
  fromEnd: Math.round((wall.width - o.along - o.width / 2) * 10000) / 10000,
});

/**
 * A field changed on the selected doors and windows: one update each, one op group; null when a new width or place
 * doesn't fit one of them in its wall (off its end, or over another opening the view shows, the selected ones each at
 * its new place), and nothing is written.
 */
export function openingPatchChanges(records: Records, ids: readonly string[], patch: OpeningPatch, view?: PlanViewOf | null): Change[] | null {
  const changes: Change[] = [];
  const moving = patch.width !== undefined || patch.fromStart !== undefined || patch.fromEnd !== undefined;
  // Every new span first, so the selected are checked against each other where they will be, not where they were.
  const planned = ids.flatMap((id) => {
    const live = liveOpening(records, id);
    if (!live) return [];
    const width = patch.width ?? live.fields.width;
    const along = patch.fromStart !== undefined ? patch.fromStart + width / 2 : patch.fromEnd !== undefined ? live.wall.fields.width - patch.fromEnd - width / 2 : live.fields.along;
    return [{ id, live, width, tidyAlong: Math.round(along * 10000) / 10000 }];
  });
  const newSpan = new Map(planned.map((p) => [p.id, { along: p.tidyAlong, width: p.width }]));
  for (const { id, live, width, tidyAlong } of planned) {
    const now = live.fields;
    if (moving) {
      const others = openingsInView(records, now.wallId, view)
        .filter((o) => o.record.id !== id)
        .map((o) => newSpan.get(o.record.id) ?? o.fields);
      if (!fitsAt(live.wall.fields.width, { along: tidyAlong, width }, others)) return null;
    }
    const set: Props = {};
    const unset: string[] = [];
    // Only an edit that moves or widens it writes its place or width (6.2b review): one read inside a wall shorter than
    // it was kept for keeps what is stored through a name, hinge, swing or height.
    if (patch.width !== undefined && Math.abs(width - now.width) > 1e-6) set.width_m = Math.round(width * 10000) / 10000;
    if (moving && Math.abs(tidyAlong - now.along) > 1e-6) set.along_m = tidyAlong;
    if (now.kind === 'door' && patch.hinge !== undefined && patch.hinge !== now.hinge) set.hinge = patch.hinge;
    if (now.kind === 'door' && patch.swing !== undefined && patch.swing !== now.swing) set.swing = patch.swing;
    if (patch.heightM !== undefined && patch.heightM !== now.heightM) {
      if (patch.heightM === null) unset.push('height_m');
      else set.height_m = patch.heightM;
    }
    if (patch.name !== undefined && patch.name.trim() !== now.name) {
      if (patch.name.trim() === '') unset.push('name');
      else set.name = patch.name.trim();
    }
    if (Object.keys(set).length === 0 && unset.length === 0) continue;
    changes.push({ kind: 'update', id, ...(Object.keys(set).length > 0 ? { set } : {}), ...(unset.length > 0 ? { unset } : {}) });
  }
  // A width past the plan's size reads as nothing: refused as one that doesn't fit.
  return unreadableAfter(records, changes) ? null : changes;
}

/** F flips the selected doors' swing to the wall's other side; Shift+F moves their hinge to the opening's other end. */
export function flipDoorsChanges(records: Records, ids: readonly string[], what: 'swing' | 'hinge'): Change[] {
  return ids.flatMap((id): Change[] => {
    const live = liveOpening(records, id);
    if (live?.fields.kind !== 'door') return [];
    const set: Props = what === 'swing' ? { swing: live.fields.swing === 'left' ? 'right' : 'left' } : { hinge: live.fields.hinge === 'start' ? 'end' : 'start' };
    return [{ kind: 'update', id, set }];
  });
}

/** Where a new door or window would sit (6.2b): in the wall under the point (canvas units), snapped along it to `step` metres. */
export interface OpeningSpot {
  wallId: string;
  wall: PlanItemFields;
  along: number;
}

/** How far off a wall's face a door or window put by the pointer still goes into it (metres): a 10 cm wall is hard to hit. */
const PUT_REACH = 0.15;

/** Whether a wall the view shows is under the point (canvas units), as the Door and Window tools find one. */
export const wallAtPoint = (shown: readonly ShownItem[], at: Point): boolean => wallUnder(shownWalls(shown), { x: toMetres(at.x), y: toMetres(at.y) }, PUT_REACH) !== null;

/** The spot a door or window takes when put at a point: on the wall it is over, at a free place along it; null over no wall. */
export function openingSpot(shown: readonly ShownItem[], at: Point, kind: OpeningKind, step: number): OpeningSpot | null {
  const walls = shownWalls(shown);
  const point = { x: toMetres(at.x), y: toMetres(at.y) };
  // Over the wall itself, or a little off its face.
  const over = wallUnder(walls, point, PUT_REACH);
  if (!over) return null;
  const along = fitAlong(over.fields.width, OPENING_WIDTH[kind], onStep(over.along, step), spansIn(shown, over.id, new Set()));
  return along === null ? null : { wallId: over.id, wall: over.fields, along };
}

/** The spot a door or window takes from the keyboard: the middle of the one selected wall, or the nearest free place to it. */
export function openingSpotInWall(shown: readonly ShownItem[], wallId: string, kind: OpeningKind): OpeningSpot | null {
  const wall = shownWalls(shown).find((w) => w.id === wallId);
  if (!wall) return null;
  const along = fitAlong(wall.fields.width, OPENING_WIDTH[kind], wall.fields.width / 2, spansIn(shown, wallId, new Set()));
  return along === null ? null : { wallId, wall: wall.fields, along };
}

/** The props a new door or window is written with: a door hinged at its start, opening to the left. */
export const openingProps = (kind: OpeningKind, wallId: string, along: number): Props =>
  kind === 'door' ? { kind, wall_id: wallId, along_m: along, width_m: OPENING_WIDTH.door, hinge: 'start', swing: 'left' } : { kind, wall_id: wallId, along_m: along, width_m: OPENING_WIDTH.window };

/** A door or window put in a wall, at the front of the wall's plan (so it is at the wall's level), one op. */
export function placeOpeningChanges(records: Records, spot: OpeningSpot, kind: OpeningKind, id: string = crypto.randomUUID(), view?: PlanViewOf | null): Change[] {
  const wall = liveItem(records, spot.wallId);
  if (!wall?.record.parentId) return [];
  const others = openingsInView(records, spot.wallId, view).map((o) => o.fields);
  if (!fitsAt(wall.fields.width, { along: spot.along, width: OPENING_WIDTH[kind] }, others)) return [];
  const planId = wall.record.parentId;
  return readableOnly(records, [{ kind: 'create', record: { id, type: 'plan_item', parentId: planId, sortKey: keyBetween(lastKeyUnder(records, planId, 'plan_item'), null), props: openingProps(kind, spot.wallId, spot.along) } }]);
}

/** A plan made under a parent for a level, in the same group as what needs it (6.2a's rule: never ahead). */
function newPlanChange(records: Records, parentId: string, kind: 'blocking' | 'setup', id: string): Change {
  return { kind: 'create', record: { id, type: 'plan', parentId, sortKey: keyBetween(lastKeyUnder(records, parentId, 'plan'), null), props: { kind, name: '' } } };
}

/** Why an icon can't be placed in a view, or null when it can (6.3): the Library says it in words. */
export type IconRefusal = 'coming' | 'tool' | 'shown' | 'noRoom' | 'noSetup' | 'noScene';

export function iconRefusal(records: Records, view: PlanViewOf | null, icon: string): IconRefusal | null {
  const use = iconUse(icon);
  if (use !== 'place') return use;
  if (!view || runRoomId(records, view.sceneId) === null) return view && records[view.sceneId]?.type === 'scene' ? 'noRoom' : 'noScene';
  if (iconHome(icon) === 'setup') {
    const setup = view.setupId === null ? undefined : records[view.setupId];
    if (setup?.type !== 'setup' || setup.trashedAt !== null || setup.parentId !== view.sceneId) return 'noSetup';
  }
  return null;
}

/**
 * A library icon placed in a view (6.3), its middle at `centre` (metres), at its default size, at the front of the plan
 * of the level it belongs to (decision 2): a set piece in the scene's room, so every scene and setup in the room shows
 * it; anything else in the setup shown, its plan made now when it has none, in the same group. Nothing when it can't be
 * placed there (iconRefusal says why).
 */
export function placeIconChanges(records: Records, view: PlanViewOf, icon: string, centre: Point, id: string = crypto.randomUUID(), newPlanId: string = crypto.randomUUID()): Change[] {
  const size = iconSize(icon);
  if (!size || iconRefusal(records, view, icon) !== null) return [];
  const plans = plansShown(records, view.sceneId, view.setupId);
  // One north per room (6.6): placing it where the room has one already places nothing (placeIcon selects that one).
  if (icon === NORTH_ICON && roomNorthItem(records, plans.room?.id ?? null) !== null) return [];
  const home = iconHome(icon);
  const changes: Change[] = [];
  let planId: string | null = null;
  if (home === 'room') planId = plans.room?.id ?? null;
  else if (home === 'blocking') {
    planId = plans.blocking?.id ?? null;
    if (planId === null) {
      planId = newPlanId;
      changes.push(newPlanChange(records, view.sceneId, 'blocking', planId));
    }
  } else if (view.setupId !== null) {
    planId = plans.setup?.id ?? null;
    if (planId === null) {
      planId = newPlanId;
      changes.push(newPlanChange(records, view.setupId, 'setup', planId));
    }
  }
  if (planId === null) return [];
  const tidy = (m: number) => Math.round(m * 10000) / 10000;
  // A camera icon is placed as a camera (6.4), a light as a light and a flag or diffusion frame as one (6.5), the icon it
  // was placed as kept; north as the room's north and the sun path as a setup's, at noon (6.6); a cast mark or a tape
  // mark as a plain mark in the scene's blocking (6.7), given its character in the Selection tile; any other as an icon.
  const markIcon = icon === CAST_MARK_ICON || icon === MARK_ICON;
  const kind = isCameraIcon(icon) ? 'camera' : isLightIcon(icon) ? 'light' : icon === NORTH_ICON ? 'north' : icon === SUN_ICON ? 'sun' : markIcon ? 'mark' : (gripKindOf(icon) ?? 'icon');
  const props: Props = { kind, icon, x: tidy(centre.x - size.width / 2), y: tidy(centre.y - size.depth / 2), width: size.width, height: size.depth, rotation: 0 };
  if (kind === 'sun') props.time = DEFAULT_SUN_TIME;
  const sortKey = keyBetween(changes.length > 0 ? null : lastKeyUnder(records, planId, 'plan_item'), null);
  changes.push({ kind: 'create', record: { id, type: 'plan_item', parentId: planId, sortKey, props } });
  // Placed in a view centred past the plan's reach, it would never show: nothing is placed (the plan made for it neither).
  return readableOnly(records, changes);
}

/**
 * A pasted or duplicated character's mark (6.7 review): a new position. Decided from the scene, never the view (6.7
 * second review, M2): when that character has any mark in the scene (the blocking or any setup's, the Trash's too), its
 * `order` goes after the character's last there, the owner's orders made sound first in the same group (soundOrders);
 * several in the order they had. In a scene where it has none, each keeps its `order` while they stay unique, in
 * order. A camera's marks pasted with their camera keep theirs: the camera's copy has no other positions. Writes into
 * the changes' new props, and adds the updates that make the orders sound.
 */
function freshPositions(records: Records, view: PlanViewOf, changes: Change[]): void {
  const made = changes.flatMap((change) => {
    if (change.kind !== 'create' || change.record.props?.kind !== 'mark') return [];
    const props = change.record.props;
    const character = props.character_id;
    if (typeof character !== 'string' || typeof props.camera_id === 'string') return [];
    return [{ props, character, order: markFields(props)?.order ?? null }];
  });
  // In the order they had (one without after those with one), as byPositionOrder reads positions.
  const rank = (o: string | null) => (o === null ? 1 : 0);
  made.sort((a, b) => rank(a.order) - rank(b.order) || (a.order !== null && b.order !== null && a.order !== b.order ? (a.order < b.order ? -1 : 1) : 0));
  // Per character: the last `order` given so far, and whether each copy takes a fresh one (the scene has its marks).
  const given = new Map<string, { last: string | null; fresh: boolean }>();
  for (const { props, character, order } of made) {
    let state = given.get(character);
    if (!state) {
      const owner: MarkOwner = { kind: 'character', id: character };
      if (ownerMarks(records, view.sceneId, owner).length === 0) state = { last: null, fresh: false };
      else {
        const sound = soundOrders(records, view.sceneId, owner);
        changes.push(...sound.changes);
        state = { last: sound.last, fresh: true };
      }
      given.set(character, state);
    }
    // In a scene without its marks, a copy keeps its own `order` while it stays above the one before it.
    const keep = !state.fresh && order !== null && (state.last === null || order > state.last);
    const next = keep ? order : keyBetween(state.last, null);
    props.order = next;
    state.last = next;
  }
}

/**
 * Paste or Duplicate in a view (6.3): each copy into the plan its original sits in, or the view's plan of that level
 * (pasteTarget). An icon that belongs to a setup, or any item copied from a setup's own plan (6.2b review), goes into
 * the setup shown, its plan made now when it has none, in the same group; with no setup shown it is left out.
 */
export function planPasteInView(
  records: Records,
  view: PlanViewOf,
  clip: readonly PlanClip[],
  at: Point | null,
  newPlanId: string = crypto.randomUUID(),
  newBlockingId: string = crypto.randomUUID(),
): { ids: string[]; changes: Change[]; leftOut: number; northKept?: number } {
  const base = pasteTarget(records, view);
  const plans = plansShown(records, view.sceneId, view.setupId);
  const shown = shownPlanIds(plans);
  const setup = view.setupId === null ? undefined : records[view.setupId];
  const hasSetup = setup?.type === 'setup' && setup.trashedAt === null && setup.parentId === view.sceneId;
  // Holders, since the target sets them as the paste reads each item.
  const made: { id: string | null } = { id: null };
  const madeBlocking: { id: string | null } = { id: null };
  const clipIds = new Set(clip.map((item) => item.id));
  const out = { count: 0, north: 0 };
  // One north per room (6.6): a paste never makes a second, into a room that has one or twice in one paste.
  const northIn = new Set<string>();
  const roomFor = (planId: string | null): string | null => {
    // A scene with no room has nowhere for it: left out, as any item with no plan to go to (6.6 review).
    if (planId === null || planKindOf(records, planId) !== 'room') {
      out.count += 1;
      return null;
    }
    if (northIn.has(planId) || roomNorthItem(records, planId) !== null) {
      out.north += 1;
      return null;
    }
    northIn.add(planId);
    return planId;
  };
  const target = (item: PlanClip): string | null => {
    // North is the room's alone: into the room shown, whatever plan it was copied from.
    if (isNorth(item.fields)) return roomFor(plans.room?.id ?? null);
    const from = item.planId ?? null;
    const fromSetup = planKindOf(records, from) === 'setup';
    // A mark (6.7): a camera's goes with its camera when that is pasted too (into the setup shown, below); any other is a
    // character's or a plain mark, into the scene's blocking (made now when it has none), or into the setup shown when
    // it was a mark of that setup's only.
    const withCamera = isMark(item.fields) && item.fields.cameraId !== null && clipIds.has(item.fields.cameraId);
    if (isMark(item.fields) && !withCamera) {
      if (item.fields.cameraId === null && from !== null && from === plans.setup?.id) return from;
      if (plans.blocking) return plans.blocking.id;
      madeBlocking.id = newBlockingId;
      return newBlockingId;
    }
    // A setup's icon, or any item copied from a setup's own plan (6.2b review), goes into the setup shown; a sun path (6.6) too.
    const setupLevel =
      fromSetup || withCamera || item.fields.kind === 'camera' || isLight(item.fields) || isGrip(item.fields) || isSun(item.fields) || (item.fields.kind === 'icon' && iconHome(item.fields.icon) === 'setup');
    if (!setupLevel || (from !== null && shown.has(from) && fromSetup)) return base(item);
    if (!hasSetup || view.setupId === null) {
      // A camera's marks are left out with it, counted once as the camera (6.7 second review, L4).
      if (!withCamera) out.count += 1;
      return null;
    }
    if (plans.setup) return plans.setup.id;
    made.id = newPlanId;
    return newPlanId;
  };
  const pasted = planPasteChanges(records, target, clip, at);
  freshPositions(records, view, pasted.changes);
  // Nothing pasted (refused past the plan's reach, or all left out): no setup plan made for it either.
  // How many norths were left out, only when some were (the room has its one).
  const north = out.north > 0 ? { northKept: out.north } : {};
  if (pasted.changes.length === 0) return { ids: [], changes: [], leftOut: out.count, ...north };
  const plansMade = [
    ...(madeBlocking.id !== null ? [newPlanChange(records, view.sceneId, 'blocking', madeBlocking.id)] : []),
    ...(made.id !== null && view.setupId !== null ? [newPlanChange(records, view.setupId, 'setup', made.id)] : []),
  ];
  return { ids: pasted.ids, changes: [...plansMade, ...pasted.changes], leftOut: out.count, ...north };
}

/** What the Selection tile changes on icons (6.3); each field it leaves out stays as it is. */
export interface IconPatch {
  /** Metres, about its middle. */
  width?: number;
  depth?: number;
  /** Metres; null takes it off. */
  heightM?: number | null;
  /** Degrees, turned about its middle. */
  rotation?: number;
  /** Its middle, metres. */
  centreX?: number;
  centreY?: number;
  name?: string;
  /**
   * A width or depth typed keeps each item's own proportions (6.9 review, L3: underlays, whose pictures are never
   * stretched): the other side follows, item by item.
   */
  keepRatio?: boolean;
}

/** An icon's middle, metres. */
export const iconCentre = (fields: PlanGeometry): Point => ({ x: Math.round((fields.x + fields.width / 2) * 10000) / 10000, y: Math.round((fields.y + fields.height / 2) * 10000) / 10000 });

type IconUpdate = Change & { kind: 'update' };

/**
 * Whether the Selection tile refuses a change to the selected icons (6.3 review): a width or depth under a centimetre
 * (stored as a centimetre, its middle would be worked out from a size it doesn't have), or one that would leave an icon
 * past the plan's reach or size (PLAN_REACH, PLAN_MAX_SIZE), where it could no longer be read.
 */
export function iconPatchRefused(records: Records, ids: readonly string[], patch: IconPatch): boolean {
  if ((patch.width !== undefined && patch.width < MIN_PLAN_SIZE) || (patch.depth !== undefined && patch.depth < MIN_PLAN_SIZE)) return true;
  // A side that follows the one typed (keepRatio) is under a centimetre for none of them.
  if (patch.keepRatio && ids.some((id) => {
    const live = liveIcon(records, id);
    const size = live ? sizeKeptRatio(live.fields, patch) : null;
    return size !== null && (size.width < MIN_PLAN_SIZE || size.height < MIN_PLAN_SIZE);
  })) return true;
  return unreadableAfter(records, iconUpdates(records, ids, patch));
}

/** The size a typed width or depth gives an item when it keeps its proportions; null when the patch types neither. */
function sizeKeptRatio(now: PlanGeometry, patch: IconPatch): { width: number; height: number } | null {
  if (patch.width !== undefined) return { width: patch.width, height: now.width > 0 ? (patch.width * now.height) / now.width : now.height };
  if (patch.depth !== undefined) return { width: now.height > 0 ? (patch.depth * now.width) / now.height : now.width, height: patch.depth };
  return null;
}

/** A field changed on the selected icons: one update per icon that changes, one op group; its middle stays where it is. Nothing when refused. */
export function iconPatchChanges(records: Records, ids: readonly string[], patch: IconPatch): Change[] {
  return iconPatchRefused(records, ids, patch) ? [] : iconUpdates(records, ids, patch);
}

function iconUpdates(records: Records, ids: readonly string[], patch: IconPatch): IconUpdate[] {
  const tidy = (m: number) => Math.round(m * 10000) / 10000;
  return ids.flatMap((id): IconUpdate[] => {
    const live = liveIcon(records, id);
    if (!live) return [];
    const now = live.fields;
    const centre = iconCentre(now);
    const kept = patch.keepRatio ? sizeKeptRatio(now, patch) : null;
    const width = kept ? tidy(kept.width) : (patch.width ?? now.width);
    const height = kept ? tidy(kept.height) : (patch.depth ?? now.height);
    const cx = patch.centreX ?? centre.x;
    const cy = patch.centreY ?? centre.y;
    const set: Props = {};
    const unset: string[] = [];
    if ((patch.width !== undefined || kept) && Math.abs(width - now.width) > 1e-6) set.width = tidy(width);
    if ((patch.depth !== undefined || kept) && Math.abs(height - now.height) > 1e-6) set.height = tidy(height);
    const x = tidy(cx - width / 2);
    const y = tidy(cy - height / 2);
    if (Math.abs(x - now.x) > 1e-6) set.x = x;
    if (Math.abs(y - now.y) > 1e-6) set.y = y;
    if (patch.rotation !== undefined && normalDegrees(patch.rotation) !== now.rotation) set.rotation = normalDegrees(patch.rotation);
    if (patch.heightM !== undefined && patch.heightM !== now.heightM) {
      if (patch.heightM === null) unset.push('height_m');
      else set.height_m = patch.heightM;
    }
    if (patch.name !== undefined && patch.name.trim() !== now.name) {
      if (patch.name.trim() === '') unset.push('name');
      else set.name = patch.name.trim();
    }
    if (Object.keys(set).length === 0 && unset.length === 0) return [];
    return [{ kind: 'update', id, ...(Object.keys(set).length > 0 ? { set } : {}), ...(unset.length > 0 ? { unset } : {}) }];
  });
}

/**
 * Whether the turn keys turn an item: a camera (6.4) or a light (6.5), both of which point, a flag or diffusion frame
 * (6.5 review), set at an angle to a light, and the room's north (6.6), whose turn is the room's north. Never a sun path.
 * A mark turns only as a camera's later position whose link reads (6.7 review, L1: markLayer), which needs `records`.
 */
export const turnsByKey = (fields: ShownFields, records?: Records, record?: SbdRecord): boolean =>
  fields.kind === 'camera' ||
  fields.kind === 'light' ||
  fields.kind === 'flag' ||
  fields.kind === 'diffusion' ||
  fields.kind === 'north' ||
  // A camera's later position (6.7) points, as its camera does.
  (fields.kind === 'mark' && records !== undefined && record !== undefined && markLayer(records, record) === 'camera');

/** [ and ] or comma and period (6.4): each selected camera, light or frame turned by `by` degrees from where it points now, round its middle; one group. */
export function turnChanges(records: Records, ids: readonly string[], by: number): Change[] {
  return ids.flatMap((id) => {
    const live = liveIcon(records, id);
    return live && turnsByKey(live.fields, records, live.record) ? iconPatchChanges(records, [id], { rotation: normalDegrees(live.fields.rotation + by) }) : [];
  });
}

/**
 * A size by the name crews use (6.5: 4×4, 8×8) on each selected flag or diffusion frame, about its middle: a standing
 * frame takes the size's width, its depth as it is; one lying flat both sides. One group; nothing for an unknown size,
 * or when refused (past the plan's reach or size, as every write path here is).
 */
export function frameSizeChanges(records: Records, ids: readonly string[], sizeId: string): Change[] {
  const size = FRAME_SIZES.find((s) => s.id === sizeId);
  if (!size) return [];
  const changes = ids.flatMap((id): Change[] => {
    const live = liveIcon(records, id);
    if (!live || !isGrip(live.fields)) return [];
    const box = frameSizeBox(live.fields, size);
    return iconUpdates(records, [id], { width: box.width, depth: box.depth });
  });
  return readableOnly(records, changes);
}

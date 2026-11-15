import { t } from '../i18n';
import type { Change } from '../ops/ops';
import { frameLens, inRange, isFocal, lensFields, projectBodies, type BodyFields, type LensFields } from './cameraGear';
import { framesOffCameras } from './cameraLinks';
import { fieldOfView, type FieldOfView } from './fieldOfView';
import { cameraFields, planFields, setupPlanOf, type CameraFields } from './plan';
import type { JsonValue, Props, SbdRecord } from './record';
import { frameSetupId, setupFrames } from './setup';
import { aspectRatioValue, projectStoryboard, shotFields } from './storyboard';

// A camera on a setup's plan (6.4, docs/PHASE6_DECISIONS.md 4, 5, 6 and 11). It is a `plan_item` of kind `camera` in
// the setup's own plan, and everything it shows is read live, never copied (decision 6): the frames shot from it, the
// one whose lens its field of view draws, that frame's focal length and its lens's squeeze, the camera's body (the
// project's default body unless it names one) and the project's frame shape. Change a lens on the board and the cone
// follows with no edit to the plan.
//
// One reader decides which frames a camera shoots (cameraFrames): a frame counts only while it is live and in the
// camera's own setup (frameSetupId), and only for the first camera of that setup, in plan order, that lists it, so a
// frame is never shot from two cameras whatever a file says. An id that is trashed, gone or in another setup reads as
// not linked; it stays in the file, so a restore brings the link back. But a frame given to a camera, set to none, or
// taken out of its setup comes off every camera record that lists it, in the same group (cameraLinks.ts), so nothing
// restored or moved back later hands it silently to another camera. Every edit here is an op list, one group.

type Records = Readonly<Record<string, SbdRecord>>;

/** How long the cone is drawn, metres: a constant, never a prop. Its far edge stays open. */
export const CONE_LENGTH_M = 6;

/** The camera icons a camera can be placed as (decision 4). `camera/field-of-view` is the cone's picture, not an item. */
export const CAMERA_ICONS = ['camera/camera', 'camera/sticks', 'camera/dolly-track', 'camera/slider', 'camera/jib-crane', 'camera/gimbal', 'camera/handheld', 'camera/steadicam', 'camera/drone'] as const;
export const isCameraIcon = (icon: string): boolean => (CAMERA_ICONS as readonly string[]).includes(icon);

const bySortKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A live camera, with its fields. */
export function liveCamera(records: Records, id: string): { record: SbdRecord; fields: CameraFields } | null {
  const record = records[id];
  if (record?.type !== 'plan_item' || record.trashedAt !== null) return null;
  const fields = cameraFields(record.props);
  return fields ? { record, fields } : null;
}

// Worked out once per set of records (6.4 review): a plan draws every camera's cone and labels, and the Frames tile asks
// who shoots each frame, on every edit. Each reading of a setup (its plan, frames, cameras and who holds each frame) and
// of a project's bodies scans every record, so each is kept for the records object it was read from; an edit makes a
// new records object, and with it new readings.
const memos = new WeakMap<Records, Map<string, unknown>>();

function memo<T>(records: Records, key: string, make: () => T): T {
  let known = memos.get(records);
  if (!known) {
    known = new Map();
    memos.set(records, known);
  }
  if (known.has(key)) return known.get(key) as T;
  const made = make();
  known.set(key, made);
  return made;
}

/** What a setup's cameras read from: its own plan, its frames in board order, its live cameras in plan order, and who shoots each frame. */
interface SetupReading {
  planId: string | null;
  frames: readonly SbdRecord[];
  cameras: readonly { record: SbdRecord; fields: CameraFields }[];
  /** Frame id to camera id, by the first camera in plan order that lists it. */
  held: ReadonlyMap<string, string>;
}

let setupReadings = 0;

/** How many times a setup's reading has been worked out from the records: for tests, which check it's once per records. */
export const setupReadingsMade = (): number => setupReadings;

function setupReading(records: Records, setupId: string): SetupReading {
  return memo(records, `setup:${setupId}`, (): SetupReading => {
    setupReadings += 1;
    const plan = setupPlanOf(records, setupId);
    const frames = setupFrames(records, setupId);
    const cameras = plan
      ? Object.values(records)
          .filter((r) => r.type === 'plan_item' && r.parentId === plan.id && r.trashedAt === null)
          .sort(bySortKey)
          .flatMap((record) => {
            const fields = cameraFields(record.props);
            return fields ? [{ record, fields }] : [];
          })
      : [];
    const ids = new Set(frames.map((shot) => shot.id));
    const held = new Map<string, string>();
    for (const camera of cameras) {
      for (const id of camera.fields.shotIds) if (ids.has(id) && !held.has(id)) held.set(id, camera.record.id);
    }
    return { planId: plan?.id ?? null, frames, cameras, held };
  });
}

/** The live setup a camera's plan belongs to, or null (a camera in a room or a blocking plan shoots no frame). */
export function cameraSetupId(records: Records, camera: SbdRecord): string | null {
  const plan = camera.parentId ? records[camera.parentId] : undefined;
  if (plan?.type !== 'plan' || plan.trashedAt !== null || planFields(plan.props)?.kind !== 'setup' || !plan.parentId) return null;
  const setup = records[plan.parentId];
  if (setup?.type !== 'setup' || setup.trashedAt !== null) return null;
  // Only the setup's own plan (its first live one), as the plan view reads it.
  return setupReading(records, setup.id).planId === plan.id ? setup.id : null;
}

/** A setup's frames in board order (setupFrames), read once per records with its cameras. */
export function cameraSetupFrames(records: Records, setupId: string): readonly SbdRecord[] {
  return setupReading(records, setupId).frames;
}

/** A setup's live cameras in plan order (back to front). */
export function setupCameras(records: Records, setupId: string): readonly { record: SbdRecord; fields: CameraFields }[] {
  return setupReading(records, setupId).cameras;
}

/** Who shoots each frame of a setup: frame id to camera id, by the first camera in plan order that lists it. */
function holders(records: Records, setupId: string): ReadonlyMap<string, string> {
  return setupReading(records, setupId).held;
}

/** The camera that shoots a frame, or null: the one reader of every camera's `shot_ids` for that frame. */
export function frameCamera(records: Records, shotId: string): string | null {
  const shot = records[shotId];
  if (shot?.type !== 'shot' || shot.trashedAt !== null) return null;
  const setupId = frameSetupId(records, shot);
  if (setupId === null) return null;
  return holders(records, setupId).get(shotId) ?? null;
}

/** The frames shot from a camera, in board order: live, in its setup, and not held by an earlier camera of it. */
export function cameraFrames(records: Records, cameraId: string): SbdRecord[] {
  const camera = liveCamera(records, cameraId);
  const setupId = camera ? cameraSetupId(records, camera.record) : null;
  if (!camera || setupId === null) return [];
  const reading = setupReading(records, setupId);
  return reading.frames.filter((shot) => reading.held.get(shot.id) === cameraId);
}

/** The frame whose lens the cone draws: `shown_shot_id` when it is linked, else the first linked frame in board order. */
export function shownFrame(records: Records, cameraId: string): SbdRecord | null {
  const frames = cameraFrames(records, cameraId);
  const stored = liveCamera(records, cameraId)?.fields.shownShotId ?? null;
  return frames.find((shot) => shot.id === stored) ?? frames[0] ?? null;
}

/** The project a record sits in, by its ancestors. */
function projectOf(records: Records, record: SbdRecord): string | null {
  let at: SbdRecord | undefined = record;
  for (let i = 0; at && i < 16; i += 1) {
    if (at.type === 'project') return at.id;
    at = at.parentId ? records[at.parentId] : undefined;
  }
  return null;
}

export interface CameraBody {
  record: SbdRecord;
  fields: BodyFields;
  /** The project's default body, read live: the camera names none, or one no longer a live body of the project. */
  isDefault: boolean;
}

/** The body a camera is: the live body it names, else the project's default body; null when the project has none. */
export function cameraBody(records: Records, camera: SbdRecord): CameraBody | null {
  const projectId = projectOf(records, camera);
  if (projectId === null) return null;
  const fields = cameraFields(camera.props);
  const bodies = bodiesOf(records, projectId);
  const named = fields?.bodyId ? bodies.find((b) => b.record.id === fields.bodyId) : undefined;
  if (named) return { ...named, isDefault: false };
  // The default body is the first of the project's (defaultBody), read from the same list.
  const fallback = bodies[0];
  return fallback ? { ...fallback, isDefault: true } : null;
}

/** The project's live bodies (projectBodies), once per records. */
const bodiesOf = (records: Records, projectId: string): readonly { record: SbdRecord; fields: BodyFields }[] => memo(records, `bodies:${projectId}`, () => projectBodies(records, projectId));

/** A live lens by id, or null. */
function liveLens(records: Records, id: string | null): { record: SbdRecord; fields: LensFields } | null {
  const lens = id ? records[id] : undefined;
  return lens?.type === 'gear_item' && lens.trashedAt === null && lens.props.kind === 'lens' ? { record: lens, fields: lensFields(lens.props) } : null;
}

export interface CameraLens {
  /** Where it comes from: the shown frame (read only here), or typed on the camera while it has no frame. */
  from: 'frame' | 'camera';
  shot: SbdRecord | null;
  /** The focal length, mm; null when none is set. */
  mm: number | null;
  /** The lens picked, live, or null. */
  lens: { record: SbdRecord; fields: LensFields } | null;
  squeeze: number;
}

/** The lens the cone draws: the shown frame's focal length and its picked lens's squeeze, else the camera's typed lens. */
export function cameraLens(records: Records, cameraId: string): CameraLens | null {
  const camera = liveCamera(records, cameraId);
  if (!camera) return null;
  const shot = shownFrame(records, cameraId);
  if (shot) {
    const lens = frameLens(records, shot);
    return { from: 'frame', shot, mm: shotFields(shot.props).lensMm, lens, squeeze: lens?.fields.squeeze ?? 1 };
  }
  const lens = liveLens(records, camera.fields.lensId);
  return { from: 'camera', shot: null, mm: camera.fields.lensMm, lens, squeeze: lens?.fields.squeeze ?? 1 };
}

/** A camera's height (decision 11): the shown frame's when it has one (3.18's choice, read live), else its own metres. */
export type CameraHeight = { from: 'frame'; shot: SbdRecord; value: string } | { from: 'camera'; metres: number } | null;

export function cameraHeight(records: Records, cameraId: string): CameraHeight {
  const camera = liveCamera(records, cameraId);
  if (!camera) return null;
  const shot = shownFrame(records, cameraId);
  const frameHeight = shot ? shotFields(shot.props).height.trim() : '';
  if (shot && frameHeight !== '') return { from: 'frame', shot, value: frameHeight };
  return camera.fields.heightM === null ? null : { from: 'camera', metres: camera.fields.heightM };
}

/** What the cone needs and lacks, or its numbers. */
export type CameraCone =
  | { missing: 'noBody' | 'noSensor' | 'noFocal'; letter: string | null }
  | (FieldOfView & { letter: string | null; focalMm: number; sensorWidthMm: number; sensorHeightMm: number; onSide: boolean });

/**
 * The cone's numbers for a camera, live: its body's mode, the lens it draws (cameraLens), the project's frame shape and
 * `on_side`, through fieldOfView. What is missing is said instead, and no cone is drawn.
 */
export function cameraCone(records: Records, cameraId: string): CameraCone | null {
  const camera = liveCamera(records, cameraId);
  if (!camera) return null;
  const body = cameraBody(records, camera.record);
  const letter = body?.fields.letter ?? null;
  if (!body) return { missing: 'noBody', letter };
  const { sensorWidthMm, sensorHeightMm } = body.fields;
  if (sensorWidthMm === null || sensorHeightMm === null) return { missing: 'noSensor', letter };
  const lens = cameraLens(records, cameraId);
  const projectId = projectOf(records, camera.record);
  const aspect = aspectRatioValue(projectStoryboard(projectId ? records[projectId]?.props : undefined).aspectRatio);
  const fov = fieldOfView({ sensorWidthMm, sensorHeightMm, squeeze: lens?.squeeze ?? 1, focalMm: lens?.mm, aspect, onSide: camera.fields.onSide });
  if (!fov || lens?.mm === null || lens?.mm === undefined) return { missing: 'noFocal', letter };
  return { ...fov, letter, focalMm: lens.mm, sensorWidthMm, sensorHeightMm, onSide: camera.fields.onSide };
}

/** A camera as its setup's lists name it: "A · Dolly track", its name in place of the icon's when it has one. */
export function cameraTitle(records: Records, cameraId: string, iconName: (icon: string) => string): string {
  const camera = liveCamera(records, cameraId);
  if (!camera) return '';
  const letter = cameraBody(records, camera.record)?.fields.letter ?? null;
  const base = camera.fields.name !== '' ? camera.fields.name : iconName(camera.fields.icon);
  const title = letter ? t('plan.camera.title', { letter, name: base }) : base;
  // Two cameras of a setup that would read the same are told apart by their place in it.
  const setupId = cameraSetupId(records, camera.record);
  if (setupId === null) return title;
  const same = setupCameras(records, setupId).filter((c) => {
    const l = cameraBody(records, c.record)?.fields.letter ?? null;
    const b = c.fields.name !== '' ? c.fields.name : iconName(c.fields.icon);
    return l === letter && b === base;
  });
  if (same.length < 2) return title;
  return t('plan.camera.nth', { title, n: same.findIndex((c) => c.record.id === cameraId) + 1 });
}

// The edits.

/** A camera's `shot_ids` written as given: unset when empty, and `shown_shot_id` taken off when it names a frame no longer in it. */
function linksUpdate(camera: { record: SbdRecord; fields: CameraFields }, ids: readonly string[]): Change | null {
  const set: Record<string, JsonValue> = {};
  const unset: string[] = [];
  const same = ids.length === camera.fields.shotIds.length && ids.every((id, i) => id === camera.fields.shotIds[i]);
  if (!same) {
    if (ids.length === 0) unset.push('shot_ids');
    else set.shot_ids = [...ids];
  }
  if (camera.fields.shownShotId !== null && !ids.includes(camera.fields.shownShotId)) unset.push('shown_shot_id');
  if (Object.keys(set).length === 0 && unset.length === 0) return null;
  return { kind: 'update', id: camera.record.id, ...(Object.keys(set).length > 0 ? { set } : {}), ...(unset.length > 0 ? { unset } : {}) };
}

/**
 * A frame linked to a camera: only a live frame of the camera's own setup. It comes off every other camera record that
 * lists it in the same group (framesOffCameras: those in the Trash and in other setups too), so a frame is shot from one
 * camera, and a camera restored later never takes it back from the one it was given to. Nothing when it is that
 * camera's already and no other lists it.
 */
export function linkFrameChanges(records: Records, cameraId: string, shotId: string): Change[] {
  const camera = liveCamera(records, cameraId);
  const setupId = camera ? cameraSetupId(records, camera.record) : null;
  if (!camera || setupId === null || !setupReading(records, setupId).frames.some((shot) => shot.id === shotId)) return [];
  const others = framesOffCameras(records, [shotId], cameraId);
  const own = camera.fields.shotIds.includes(shotId) ? null : linksUpdate(camera, [...camera.fields.shotIds, shotId]);
  return [...others, ...(own ? [own] : [])];
}

/**
 * A frame unlinked from a camera: out of its `shot_ids`, no longer its shown frame, and off every other camera record
 * that lists it in the same group (framesOffCameras), so it never reads as another camera's once this one lets it go.
 * Nothing when this camera doesn't list it.
 */
export function unlinkFrameChanges(records: Records, cameraId: string, shotId: string): Change[] {
  const camera = liveCamera(records, cameraId);
  if (!camera || !camera.fields.shotIds.includes(shotId)) return [];
  return framesOffCameras(records, [shotId]);
}

/** Which camera shoots a frame (the Frames tile's choice): one camera, linked as linkFrameChanges does, or none: off every camera that lists it. */
export function assignFrameChanges(records: Records, shotId: string, cameraId: string | null): Change[] {
  if (cameraId !== null) return linkFrameChanges(records, cameraId, shotId);
  return framesOffCameras(records, [shotId]);
}

/** A linked frame made the one the cone draws. Nothing when it already is, or isn't linked. */
export function showFrameChanges(records: Records, cameraId: string, shotId: string): Change[] {
  const camera = liveCamera(records, cameraId);
  if (!camera || !cameraFrames(records, cameraId).some((shot) => shot.id === shotId)) return [];
  if (shownFrame(records, cameraId)?.id === shotId && (camera.fields.shownShotId === shotId || camera.fields.shownShotId === null)) return [];
  return [{ kind: 'update', id: cameraId, set: { shown_shot_id: shotId } }];
}

/** A camera's body: one of the project's live bodies, or null for the default body. */
export function cameraBodyChanges(records: Records, cameraId: string, bodyId: string | null): Change[] {
  const camera = liveCamera(records, cameraId);
  if (!camera) return [];
  if (bodyId === null) return camera.fields.bodyId === null ? [] : [{ kind: 'update', id: cameraId, unset: ['body_id'] }];
  const projectId = projectOf(records, camera.record);
  if (projectId === null || !projectBodies(records, projectId).some((b) => b.record.id === bodyId) || camera.fields.bodyId === bodyId) return [];
  return [{ kind: 'update', id: cameraId, set: { body_id: bodyId } }];
}

/** "On its side", on or off, for each camera that isn't so already: one group. */
export function cameraOnSideChanges(records: Records, ids: readonly string[], on: boolean): Change[] {
  return ids.flatMap((id): Change[] => {
    const camera = liveCamera(records, id);
    if (!camera || camera.fields.onSide === on) return [];
    return [on ? { kind: 'update', id, set: { on_side: true } } : { kind: 'update', id, unset: ['on_side'] }];
  });
}

/** Why a focal length typed on a camera is refused, or null when it is taken: a length, inside its picked lens's range. */
export function cameraLensRefusal(records: Records, cameraId: string, mm: number): { range: { min: number; max: number } } | 'notFocal' | null {
  if (!isFocal(mm)) return 'notFocal';
  const lens = liveLens(records, liveCamera(records, cameraId)?.fields.lensId ?? null);
  if (lens && !inRange(lens.fields, mm) && lens.fields.range) return { range: lens.fields.range };
  return null;
}

/** A focal length typed on a camera with no frame (null takes it off); nothing when refused or unchanged. */
export function cameraLensMmChanges(records: Records, cameraId: string, mm: number | null): Change[] {
  const camera = liveCamera(records, cameraId);
  if (!camera) return [];
  if (mm === null) return camera.fields.lensMm === null ? [] : [{ kind: 'update', id: cameraId, unset: ['lens_mm'] }];
  if (cameraLensRefusal(records, cameraId, mm) !== null || camera.fields.lensMm === mm) return [];
  return [{ kind: 'update', id: cameraId, set: { lens_mm: mm } }];
}

/**
 * A lens picked on a camera with no frame, as a frame picks one (pickLens): a prime sets the focal length to its own; a
 * zoom keeps the typed one inside its range, else the nearest end. Null takes the pick off and keeps the focal length.
 */
export function pickCameraLensChanges(records: Records, cameraId: string, lensId: string | null): Change[] {
  const camera = liveCamera(records, cameraId);
  if (!camera) return [];
  if (lensId === null) return camera.fields.lensId === null ? [] : [{ kind: 'update', id: cameraId, unset: ['lens_id'] }];
  const lens = liveLens(records, lensId);
  if (!lens) return [];
  const set: Props = {};
  if (camera.fields.lensId !== lensId) set.lens_id = lensId;
  const { range } = lens.fields;
  const mm = camera.fields.lensMm;
  if (range) {
    const next = mm === null ? range.min : Math.min(range.max, Math.max(range.min, mm));
    if (next !== mm) set.lens_mm = next;
  }
  return Object.keys(set).length === 0 ? [] : [{ kind: 'update', id: cameraId, set }];
}

/** "Use the frame's lens" (the lens check's button): the lens typed on the camera taken off, one op. */
export function takeFrameLensChanges(records: Records, cameraId: string): Change[] {
  const camera = liveCamera(records, cameraId);
  if (!camera || (camera.fields.lensMm === null && camera.fields.lensId === null)) return [];
  const unset = [...(camera.fields.lensMm !== null ? ['lens_mm'] : []), ...(camera.fields.lensId !== null ? ['lens_id'] : [])];
  return [{ kind: 'update', id: cameraId, unset }];
}

/** A camera's props as a copy keeps them (decision: copies drop frame links): never its `shot_ids` or `shown_shot_id`. */
export function withoutFrameLinks(props: Props): Props {
  if (props.kind !== 'camera') return props;
  const own: Props = { ...props };
  delete own.shot_ids;
  delete own.shown_shot_id;
  return own;
}

/** The lens check's question for one camera (src/core/checks/planLens.ts): its linked frames whose focal length differs from its typed one. */
export function framesDiffering(records: Records, cameraId: string): { shot: SbdRecord; frameMm: number; cameraMm: number }[] {
  const camera = liveCamera(records, cameraId);
  const typed = camera?.fields.lensMm ?? null;
  if (!camera || typed === null) return [];
  return cameraFrames(records, cameraId).flatMap((shot) => {
    const mm = shotFields(shot.props).lensMm;
    return mm !== null && mm !== typed ? [{ shot, frameMm: mm, cameraMm: typed }] : [];
  });
}

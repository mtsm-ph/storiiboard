import type { StoreApi } from 'zustand/vanilla';
import { showInfo } from '../../../app/notice';
import { projectStore, type ProjectState } from '../../../app/projectStore';
import { t } from '../../../core/i18n';
import type { Project } from '../../../core/storage/project';
import { CAST_MARK_ICON, MARK_ICON, NEXT_POSITION_ICON, NORTH_ICON, plansShown, renamePlanChanges, shownItems, startRoomChanges, type OpeningKind } from '../../../core/model/plan';
import { castMarkFor, markOwnerChanges, movePositionChanges, nextPositionChanges, ownerIn, placeMarkChanges, type OwnerChoice } from '../../../core/model/planBlocking';
import { roomNorthItem, sunTimeChanges } from '../../../core/model/planSun';
import { copySetupChanges, deleteRoomChanges, deleteUnusedRoomChanges, replaceRoomChanges, separateCopyChanges, setupOnlyChanges, setRoomChanges } from '../../../core/model/planRooms';
import {
  assignFrameChanges,
  cameraBodyChanges,
  cameraLensMmChanges,
  cameraOnSideChanges,
  linkFrameChanges,
  pickCameraLensChanges,
  showFrameChanges,
  unlinkFrameChanges,
  takeFrameLensChanges,
} from '../../../core/model/planCamera';
import { lightBeamChanges, lightWattsChanges, planGearChanges } from '../../../core/model/planLight';
import { pickableIds } from '../../../core/model/planLayers';
import type { Change } from '../../../core/ops/ops';
import type { SbdRecord } from '../../../core/model/record';
import type { GeometryChange, Point, ReorderMode } from '../../../ui/canvas/types';
import {
  drawWallsChanges,
  flipDoorsChanges,
  frameSizeChanges,
  iconPatchChanges,
  iconRefusal,
  openingPatchChanges,
  openingsLeftOut,
  placeIconChanges,
  placeOpeningChanges,
  planClipOf,
  planGeometryChanges,
  planNudgeChanges,
  planPasteInView,
  reorderPlanChanges,
  runRoomId,
  shownWalls,
  trashPlanItemsChanges,
  turnChanges,
  unreadableAfter,
  viewKey,
  wallPatchChanges,
  type IconPatch,
  type IconRefusal,
  type OpeningPatch,
  type OpeningSpot,
  type WallPatch,
} from './planItems';
import { iconSize } from './iconSizes';
import { layerStatesNow, revealLayersOf } from './layersStore';
import { planStore } from './planStore';

// What a person does on a plan (6.2a, 6.2b), as edits through projectStore.applyWith: each is one op group, so one ⌘Z,
// as a board's are (src/features/moodboards/boardActions.ts). New walls go into the scene's room; a door or window into
// its wall's plan.

type Records = Readonly<Record<string, SbdRecord>>;

/** A plan view: the scene, and the setup when one is picked. */
export interface PlanView {
  sceneId: string;
  setupId: string | null;
}

/**
 * What a step made or picked is selected; every placement goes through here, so an item placed on a hidden or locked
 * layer has that layer shown and unlocked first, and said (6.8): nothing is placed that can't then be seen and picked.
 */
const select = (view: PlanView, ids: readonly string[], records: Records = projectStore.getState().records) => {
  revealLayersOf(ids, records);
  planStore.getState().select(viewKey(view.sceneId, view.setupId), ids);
};

/** The selected ids that are live items the view shows, on layers that can be picked (6.8: never a hidden or locked one). */
export function planSelection(records: Records, view: PlanView): string[] {
  const shown = new Set(shownItems(records, view.sceneId, view.setupId).map((item) => item.record.id));
  const picked = (planStore.getState().selections[viewKey(view.sceneId, view.setupId)] ?? []).filter((id) => shown.has(id));
  return pickableIds(records, picked, layerStatesNow());
}

/** "Start the room": the room and the scene's `room_id`, one op group. */
export async function startRoom(sceneId: string): Promise<boolean> {
  const { project } = projectStore.getState();
  if (!project) return false;
  return projectStore.getState().applyWith((records) => ({ changes: startRoomChanges(records, project.projectId, sceneId) }));
}

/**
 * "New room" (6.2b): a new room for the scene, whether or not it had one; the old one is left as it is, but for the
 * doors and windows this scene put in its walls at its own level, which go to the Trash with the step.
 */
export async function newRoom(sceneId: string): Promise<boolean> {
  const { project } = projectStore.getState();
  if (!project) return false;
  return projectStore.getState().applyWith((records) => ({ changes: replaceRoomChanges(records, project.projectId, sceneId) }));
}

/** A room no scene uses, deleted from the chooser (6.2b review): it and its items to the Trash, one op group. */
export async function deleteUnusedRoom(roomId: string): Promise<boolean> {
  return projectStore.getState().applyWith((records) => ({ changes: deleteUnusedRoomChanges(records, roomId) }));
}

/** "Use a room already drawn" (6.2b): the scene's `room_id`, one op. */
export async function chooseRoom(sceneId: string, roomId: string): Promise<boolean> {
  return projectStore.getState().applyWith((records) => ({ changes: setRoomChanges(records, sceneId, roomId) }));
}

/** "Make a separate copy" (6.2b): the room and its items copied for this scene alone, one op group. */
export async function separateCopy(sceneId: string): Promise<boolean> {
  const { project } = projectStore.getState();
  if (!project) return false;
  return projectStore.getState().applyWith((records) => ({ changes: separateCopyChanges(records, project.projectId, sceneId) }));
}

/** "Delete room" (6.2b): only when no other scene uses it; the room and its items to the Trash. */
export async function deleteRoom(sceneId: string): Promise<boolean> {
  return projectStore.getState().applyWith((records) => ({ changes: deleteRoomChanges(records, sceneId) }));
}

export async function renameRoom(roomId: string, name: string): Promise<boolean> {
  return projectStore.getState().applyWith((records) => ({ changes: renamePlanChanges(records, roomId, name) }));
}

/**
 * "Start from another setup" (6.2b): that setup's items copied into this one, one op group. The copies' layers are
 * shown and unlocked where hidden or locked, with the usual notice (6.8 review, L5), so nothing copied lands unseen.
 */
export async function copySetup(view: PlanView, fromSetupId: string): Promise<boolean> {
  const to = view.setupId;
  if (to === null) return false;
  let ids: string[] = [];
  const written = await projectStore.getState().applyWith((records) => {
    const changes = copySetupChanges(records, fromSetupId, to);
    ids = changes.flatMap((c) => (c.kind === 'create' && c.record.id !== undefined ? [c.record.id] : []));
    return { changes };
  });
  if (written) revealLayersOf(ids);
  return written;
}

/** "This setup only" on or off (6.2b), for the selected items: moved into the setup's plan, or back to their level. */
export async function setupOnly(view: PlanView, ids: readonly string[], on: boolean): Promise<boolean> {
  const setupId = view.setupId;
  if (setupId === null) return false;
  return projectStore.getState().applyWith((records) => ({ changes: setupOnlyChanges(records, view.sceneId, setupId, ids, on) }));
}

/**
 * A run of walls drawn (canvas units): one wall a segment, the whole run one op group, the new walls selected. Always
 * into the room of the view the run was drawn in, even when it ends because another view was picked; and only into the
 * open project it was drawn in (`madeIn`): a run that ends after a switch (to a version or a backup that shares its
 * ids) writes nothing anywhere. A room gone meanwhile (to the Trash, or its scene) is said, never silently dropped.
 */
export async function drawWalls(view: PlanView, points: readonly Point[], madeIn: Project | null, store: StoreApi<ProjectState> = projectStore): Promise<boolean> {
  // Checked before the edit is queued: applyWith takes the project open when it's called as the one the edit is for.
  if (madeIn === null || store.getState().project !== madeIn) return false;
  let ids: string[] = [];
  // A holder, since the build sets it inside a callback.
  const room = { gone: false };
  const written = await store.getState().applyWith((records) => {
    if (runRoomId(records, view.sceneId) === null) {
      room.gone = true;
      return { changes: [] };
    }
    const made = drawWallsChanges(records, view.sceneId, points);
    ids = made.ids;
    return { changes: made.changes };
  });
  // An edit with no changes counts as written: a room gone is told apart by the build.
  if (room.gone) {
    if (written && points.length >= 2 && store.getState().project === madeIn) showInfo(t('plan.wallsNotDrawn'));
    return false;
  }
  if (written) select(view, ids, store.getState().records);
  return written;
}

/** A door or window put in a wall (6.2b), selected once it's written. */
export async function placeOpening(view: PlanView, spot: OpeningSpot, kind: OpeningKind): Promise<void> {
  const id = crypto.randomUUID();
  const written = await projectStore.getState().applyWith((records) => ({ changes: placeOpeningChanges(records, spot, kind, id, view) }));
  if (written) select(view, [id]);
}

/** A finished move, resize or turn; a door or window may land on any wall the view shows, checked against what it shows. */
export async function changePlanGeometry(changes: readonly GeometryChange[], view?: PlanView): Promise<void> {
  await projectStore.getState().applyWith((records) => ({ changes: planGeometryChanges(records, changes, view ? shownWalls(shownItems(records, view.sceneId, view.setupId)) : undefined, view) }));
}

export async function nudgePlan(ids: readonly string[], dx: number, dy: number, view?: PlanView): Promise<void> {
  await projectStore.getState().applyWith((records) => ({ changes: planNudgeChanges(records, ids, dx, dy, view) }));
}

export async function reorderPlan(view: PlanView, mode: ReorderMode): Promise<void> {
  await projectStore.getState().applyWith((records) => ({ changes: reorderPlanChanges(records, planSelection(records, view), mode) }));
}

export async function deletePlanSelection(view: PlanView): Promise<void> {
  const written = await projectStore.getState().applyWith((records) => ({ changes: trashPlanItemsChanges(records, planSelection(records, view)) }));
  if (written) select(view, []);
}

/** A door or window selected without its wall is copied only with it: said, as the usual notice. */
function sayLeftOut(records: Records, ids: readonly string[]): void {
  if (openingsLeftOut(records, ids)) showInfo(t('plan.openingCopiedWithWall'));
}

export function copyPlanSelection(view: PlanView): number {
  const { records } = projectStore.getState();
  const ids = planSelection(records, view);
  const clip = planClipOf(records, ids, view);
  sayLeftOut(records, ids);
  if (clip.length > 0) planStore.getState().copy(clip);
  return clip.length;
}

export async function cutPlanSelection(view: PlanView): Promise<void> {
  if (copyPlanSelection(view) > 0) await deletePlanSelection(view);
}

/**
 * Paste, each copy into the plan its original sits in (a setup's only wall stays that setup's), or the view's plan of
 * that level; at the pointer or 16 cm from the originals; the pasted are selected. A setup's icon pasted into a scene
 * with no setup shown is left out, and said.
 */
export async function pastePlan(view: PlanView, at: Point | null, clip = planStore.getState().clipboard): Promise<void> {
  if (clip.length === 0) return;
  let ids: string[] = [];
  const out = { count: 0, north: 0 };
  const written = await projectStore.getState().applyWith((records) => {
    const made = planPasteInView(records, view, clip, at);
    ids = made.ids;
    out.count = made.leftOut;
    out.north = made.northKept ?? 0;
    return { changes: made.changes };
  });
  if (out.count > 0) showInfo(t('library.noSetup'));
  // One north per room (6.6): a pasted north the room already has is left out, and said; the room's own is selected
  // with what was pasted, and its layer shown and unlocked, as placing a north does (6.8 review, L6).
  if (out.north > 0) showInfo(t('plan.north.notPasted'));
  const records = projectStore.getState().records;
  const kept = out.north > 0 ? (roomNorthItem(records, plansShown(records, view.sceneId, view.setupId).room?.id ?? null)?.record.id ?? null) : null;
  if (written) select(view, kept === null ? ids : [...ids, kept]);
}

/** Duplicate is Copy then Paste offset from the originals, without touching the clipboard. */
export async function duplicatePlanSelection(view: PlanView): Promise<void> {
  const { records } = projectStore.getState();
  const ids = planSelection(records, view);
  sayLeftOut(records, ids);
  await pastePlan(view, null, planClipOf(records, ids, view));
}

/** A field changed in the Selection tile, on every selected wall it fits (every plan's doors counted): one op group. */
export async function changeWalls(ids: readonly string[], patch: WallPatch): Promise<boolean> {
  return projectStore.getState().applyWith((records) => ({ changes: wallPatchChanges(records, ids, patch) }));
}

/** A field changed on the selected doors and windows: one op group, nothing when it doesn't fit. */
export async function changeOpenings(ids: readonly string[], patch: OpeningPatch, view?: PlanView): Promise<boolean> {
  return projectStore.getState().applyWith((records) => ({ changes: openingPatchChanges(records, ids, patch, view) ?? [] }));
}

/** F and Shift+F: the selected doors' swing or hinge flipped, one op group. */
export async function flipDoors(ids: readonly string[], what: 'swing' | 'hinge'): Promise<boolean> {
  return projectStore.getState().applyWith((records) => ({ changes: flipDoorsChanges(records, ids, what) }));
}

/**
 * Why a placement wrote nothing: a refusal the Library says, the drag or key ended in another project than it began, or
 * (6.6) north placed in a room that has one, which is selected instead.
 */
export type PlaceOutcome = IconRefusal | 'otherProject' | 'hasNorth' | 'noOwner' | 'saidAlready' | null;

/**
 * A library icon placed in a view (6.3), its middle at `centre` (metres): one op group, the setup's plan made in it
 * when needed; the new icon is selected. Refused, nothing is written and the refusal comes back for the Library to say.
 * Only into the open project the drag or key began in (`madeIn`, as drawWalls has it): one dropped after a switch (to a
 * version or a backup sharing its ids) writes nothing anywhere.
 */
export async function placeIcon(view: PlanView, icon: string, centre: { x: number; y: number }, madeIn: Project | null, store: StoreApi<ProjectState> = projectStore): Promise<PlaceOutcome> {
  // Checked before the edit is queued: applyWith takes the project open when it's called as the one the edit is for.
  if (madeIn === null || store.getState().project !== madeIn) return 'otherProject';
  // The Library's next position (6.7) follows the one mark or camera selected: dropped, where it was dropped.
  if (icon === NEXT_POSITION_ICON) return nextFromSelection(view, madeIn, centre, store);
  if (icon === CAST_MARK_ICON) return placeCastMark(view, centre, madeIn, store);
  const id = crypto.randomUUID();
  const refused: { why: IconRefusal | null; north: string | null } = { why: null, north: null };
  const written = await store.getState().applyWith((records) => {
    refused.why = iconRefusal(records, view, icon);
    // One north per room (6.6): the room's own is selected instead, and the Library says so.
    refused.north = refused.why === null && icon === NORTH_ICON ? (roomNorthItem(records, plansShown(records, view.sceneId, view.setupId).room?.id ?? null)?.record.id ?? null) : null;
    return { changes: refused.why === null && refused.north === null ? placeIconChanges(records, view, icon, centre, id) : [] };
  });
  if (refused.why !== null) return refused.why;
  if (refused.north !== null) {
    if (store.getState().project === madeIn) select(view, [refused.north], store.getState().records);
    return 'hasNorth';
  }
  if (written && store.getState().project === madeIn) select(view, [id], store.getState().records);
  return null;
}

/**
 * The Library's "Cast mark" (6.7 review, L3), so the figure dragged is the one that lands: with a character's mark
 * selected, that character's next position; else, when the scene has one character with no position in the view yet,
 * that character's first; else a plain mark (drawn as a tape mark, at its size), and the notice says to give it its
 * character. Where it was dropped, selected; one op group, only into the project it began in.
 */
async function placeCastMark(view: PlanView, centre: Point, madeIn: Project, store: StoreApi<ProjectState>): Promise<PlaceOutcome> {
  const id = crypto.randomUUID();
  const picked = planSelection(store.getState().records, view);
  const what: { refused: IconRefusal | null; plain: boolean } = { refused: null, plain: false };
  const sizes = markSizes();
  const written = await store.getState().applyWith((records) => {
    what.refused = iconRefusal(records, view, CAST_MARK_ICON);
    if (what.refused !== null) return { changes: [] };
    const target = castMarkFor(records, view, picked);
    what.plain = target === null;
    const changes =
      target === null
        ? placeMarkChanges(records, view, centre, sizes.plain, null, id)
        : target.kind === 'next'
          ? nextPositionChanges(records, view, target.fromId, iconSize(NEXT_POSITION_ICON) ?? sizes.character, centre, id)
          : placeMarkChanges(records, view, centre, sizes.character, target.characterId, id);
    return { changes: unreadableAfter(records, changes) ? [] : changes };
  });
  if (what.refused !== null) return what.refused;
  if (written && store.getState().project === madeIn) {
    select(view, [id], store.getState().records);
    if (what.plain) showInfo(t('plan.mark.giveCharacter'));
  }
  return null;
}

// Marks (6.7), each one op group, worked out from the records as it lands and through the one check every plan write
// makes (unreadableAfter). A placement writes only into the project it began in (`madeIn`), as placeIcon's does.

/** Why a mark wasn't placed: no room shown (a plan needs one), a plain mark has no next position, or nothing to follow. */
export type MarkOutcome = 'noRoom' | 'plainMark' | 'nothing' | 'otherProject' | null;

/** The Mark tool (6.7): a plain mark, its middle at `centre` (metres), in the scene's blocking (made in the same step); selected. */
export async function placeMark(view: PlanView, centre: Point, madeIn: Project | null, store: StoreApi<ProjectState> = projectStore): Promise<MarkOutcome> {
  if (madeIn === null || store.getState().project !== madeIn) return 'otherProject';
  const id = crypto.randomUUID();
  const size = iconSize(MARK_ICON) ?? { width: 0.3, depth: 0.3 };
  const why: { refused: MarkOutcome } = { refused: null };
  const written = await store.getState().applyWith((records) => {
    if (runRoomId(records, view.sceneId) === null) {
      why.refused = 'noRoom';
      return { changes: [] };
    }
    const changes = placeMarkChanges(records, view, centre, size, null, id);
    return { changes: unreadableAfter(records, changes) ? [] : changes };
  });
  if (why.refused !== null) return why.refused;
  if (written && store.getState().project === madeIn) select(view, [id], store.getState().records);
  return null;
}

/**
 * "Next position" (6.7) for the mark or camera `fromId`: a new position 1 m to the right of its owner's last one (or at
 * `at`, metres, when dropped from the Library), selected, so the arrows and a drag put it in place. A plain mark has no
 * next position: said.
 */
export async function nextPosition(view: PlanView, fromId: string, madeIn: Project | null, at: Point | null = null, store: StoreApi<ProjectState> = projectStore): Promise<MarkOutcome> {
  if (madeIn === null || store.getState().project !== madeIn) return 'otherProject';
  const id = crypto.randomUUID();
  const size = iconSize(NEXT_POSITION_ICON) ?? { width: 0.5, depth: 0.5 };
  const why: { refused: MarkOutcome } = { refused: null };
  const written = await store.getState().applyWith((records) => {
    if (ownerIn(records, view, fromId) === null) {
      why.refused = records[fromId]?.props.kind === 'mark' ? 'plainMark' : 'nothing';
      return { changes: [] };
    }
    const changes = nextPositionChanges(records, view, fromId, size, at, id);
    return { changes: unreadableAfter(records, changes) ? [] : changes };
  });
  if (why.refused !== null) {
    if (store.getState().project === madeIn) showInfo(t(why.refused === 'plainMark' ? 'plan.mark.plainNoNext' : 'plan.mark.selectFirst'));
    return why.refused;
  }
  if (written && store.getState().project === madeIn) select(view, [id], store.getState().records);
  return null;
}

/**
 * The Library's next position (6.7): after the one mark or camera selected, 1 m to the right of its last position, or
 * where it was dropped (`at`). With no one mark or camera selected, nothing: the Library says so ('noOwner').
 */
export async function nextFromSelection(view: PlanView, madeIn: Project | null, at: Point | null, store: StoreApi<ProjectState> = projectStore): Promise<PlaceOutcome> {
  const picked = planSelection(store.getState().records, view);
  const [from] = picked;
  if (picked.length !== 1 || from === undefined) return 'noOwner';
  const outcome = await nextPosition(view, from, madeIn, at, store);
  return outcome === null ? null : outcome === 'otherProject' ? 'otherProject' : 'saidAlready';
}

/** The selected marks given to a character, a camera or no one (6.7): one op group. */
export const setMarkOwner = (view: PlanView, ids: readonly string[], choice: OwnerChoice) =>
  plannedEdit((r) => markOwnerChanges(r, view, ids, choice, markSizes()));

/** The sizes a mark takes when it becomes a character's or a plain one (iconSizes.ts). */
export const markSizes = () => ({ character: iconSize(CAST_MARK_ICON) ?? { width: 0.5, depth: 0.5 }, plain: iconSize(MARK_ICON) ?? { width: 0.3, depth: 0.3 } });

/** A position moved earlier or later among its owner's (6.7): one op group. */
export const movePosition = (view: PlanView, id: string, by: -1 | 1) => plannedEdit((r) => movePositionChanges(r, view, id, by));

/** A field changed on the selected icons in the Selection tile: one op group. */
export async function changeIcons(ids: readonly string[], patch: IconPatch): Promise<boolean> {
  return projectStore.getState().applyWith((records) => ({ changes: iconPatchChanges(records, ids, patch) }));
}

/** [ and ] or comma and period (6.4, 6.5): the selected cameras and lights turned, one op group. */
export async function turnCameras(ids: readonly string[], by: number): Promise<boolean> {
  return projectStore.getState().applyWith((records) => ({ changes: turnChanges(records, ids, by) }));
}

// A camera's own edits (6.4), each one op group, worked out from the records as it lands.
const cameraEdit = (build: (records: Records) => Change[]): Promise<boolean> => projectStore.getState().applyWith((records) => ({ changes: build(records) }));

export const linkFrame = (cameraId: string, shotId: string) => cameraEdit((r) => linkFrameChanges(r, cameraId, shotId));
export const unlinkFrame = (cameraId: string, shotId: string) => cameraEdit((r) => unlinkFrameChanges(r, cameraId, shotId));
export const assignFrame = (shotId: string, cameraId: string | null) => cameraEdit((r) => assignFrameChanges(r, shotId, cameraId));
export const showFrame = (cameraId: string, shotId: string) => cameraEdit((r) => showFrameChanges(r, cameraId, shotId));
export const setCameraBody = (cameraId: string, bodyId: string | null) => cameraEdit((r) => cameraBodyChanges(r, cameraId, bodyId));
export const setOnSide = (ids: readonly string[], on: boolean) => cameraEdit((r) => cameraOnSideChanges(r, ids, on));
export const typeCameraLens = (cameraId: string, mm: number | null) => cameraEdit((r) => cameraLensMmChanges(r, cameraId, mm));
export const pickCameraLens = (cameraId: string, lensId: string | null) => cameraEdit((r) => pickCameraLensChanges(r, cameraId, lensId));
export const takeFrameLens = (cameraId: string) => cameraEdit((r) => takeFrameLensChanges(r, cameraId));

// A light's, flag's or diffusion frame's own edits (6.5), each one op group, worked out from the records as it lands, and
// through the one check every plan write makes (unreadableAfter), though none moves or resizes anything.
const plannedEdit = (build: (records: Records) => Change[]): Promise<boolean> =>
  projectStore.getState().applyWith((records) => {
    const changes = build(records);
    return { changes: unreadableAfter(records, changes) ? [] : changes };
  });

export const setPlanGear = (ids: readonly string[], gearId: string | null) => plannedEdit((r) => planGearChanges(r, ids, gearId));
export const setLightWatts = (ids: readonly string[], watts: number | null) => plannedEdit((r) => lightWattsChanges(r, ids, watts));
export const setLightBeam = (ids: readonly string[], degrees: number) => plannedEdit((r) => lightBeamChanges(r, ids, degrees));
export const setFrameSize = (ids: readonly string[], sizeId: string) => plannedEdit((r) => frameSizeChanges(r, ids, sizeId));

/** A sun path's time of day (6.6), "HH:mm": one op group. */
export const setSunTime = (ids: readonly string[], time: string) => plannedEdit((r) => sunTimeChanges(r, ids, time));

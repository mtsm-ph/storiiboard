import type { StoreApi } from 'zustand/vanilla';
import { showInfo } from '../../../app/notice';
import { projectStore, type ProjectState } from '../../../app/projectStore';
import { t } from '../../../core/i18n';
import type { Project } from '../../../core/storage/project';
import { renamePlanChanges, shownItems, startRoomChanges, type OpeningKind } from '../../../core/model/plan';
import { copySetupChanges, deleteRoomChanges, deleteUnusedRoomChanges, replaceRoomChanges, separateCopyChanges, setupOnlyChanges, setRoomChanges } from '../../../core/model/planRooms';
import type { SbdRecord } from '../../../core/model/record';
import type { GeometryChange, Point, ReorderMode } from '../../../ui/canvas/types';
import {
  drawWallsChanges,
  flipDoorsChanges,
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
  viewKey,
  wallPatchChanges,
  type IconPatch,
  type IconRefusal,
  type OpeningPatch,
  type OpeningSpot,
  type WallPatch,
} from './planItems';
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

const select = (view: PlanView, ids: readonly string[]) => {
  planStore.getState().select(viewKey(view.sceneId, view.setupId), ids);
};

/** The selected ids that are live items the view shows. */
export function planSelection(records: Records, view: PlanView): string[] {
  const shown = new Set(shownItems(records, view.sceneId, view.setupId).map((item) => item.record.id));
  return (planStore.getState().selections[viewKey(view.sceneId, view.setupId)] ?? []).filter((id) => shown.has(id));
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

/** "Start from another setup" (6.2b): that setup's items copied into this one, one op group. */
export async function copySetup(view: PlanView, fromSetupId: string): Promise<boolean> {
  const to = view.setupId;
  if (to === null) return false;
  return projectStore.getState().applyWith((records) => ({ changes: copySetupChanges(records, fromSetupId, to) }));
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
  if (written) select(view, ids);
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
  const out = { count: 0 };
  const written = await projectStore.getState().applyWith((records) => {
    const made = planPasteInView(records, view, clip, at);
    ids = made.ids;
    out.count = made.leftOut;
    return { changes: made.changes };
  });
  if (out.count > 0) showInfo(t('library.noSetup'));
  if (written) select(view, ids);
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

/** Why a placement wrote nothing: a refusal the Library says, or the drag or key ended in another project than it began. */
export type PlaceOutcome = IconRefusal | 'otherProject' | null;

/**
 * A library icon placed in a view (6.3), its middle at `centre` (metres): one op group, the setup's plan made in it
 * when needed; the new icon is selected. Refused, nothing is written and the refusal comes back for the Library to say.
 * Only into the open project the drag or key began in (`madeIn`, as drawWalls has it): one dropped after a switch (to a
 * version or a backup sharing its ids) writes nothing anywhere.
 */
export async function placeIcon(view: PlanView, icon: string, centre: { x: number; y: number }, madeIn: Project | null, store: StoreApi<ProjectState> = projectStore): Promise<PlaceOutcome> {
  // Checked before the edit is queued: applyWith takes the project open when it's called as the one the edit is for.
  if (madeIn === null || store.getState().project !== madeIn) return 'otherProject';
  const id = crypto.randomUUID();
  const refused: { why: IconRefusal | null } = { why: null };
  const written = await store.getState().applyWith((records) => {
    refused.why = iconRefusal(records, view, icon);
    return { changes: refused.why === null ? placeIconChanges(records, view, icon, centre, id) : [] };
  });
  if (refused.why !== null) return refused.why;
  if (written && store.getState().project === madeIn) select(view, [id]);
  return null;
}

/** A field changed on the selected icons in the Selection tile: one op group. */
export async function changeIcons(ids: readonly string[], patch: IconPatch): Promise<boolean> {
  return projectStore.getState().applyWith((records) => ({ changes: iconPatchChanges(records, ids, patch) }));
}

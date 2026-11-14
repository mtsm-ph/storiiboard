import type { StoreApi } from 'zustand/vanilla';
import { showInfo } from '../../../app/notice';
import { projectStore, type ProjectState } from '../../../app/projectStore';
import { t } from '../../../core/i18n';
import type { Project } from '../../../core/storage/project';
import { newRoomChanges, renamePlanChanges, sceneRoomId, shownItems, startRoomChanges, type OpeningKind } from '../../../core/model/plan';
import { copySetupChanges, deleteRoomChanges, separateCopyChanges, setupOnlyChanges, setRoomChanges } from '../../../core/model/planRooms';
import type { SbdRecord } from '../../../core/model/record';
import type { GeometryChange, Point, ReorderMode } from '../../../ui/canvas/types';
import {
  drawWallsChanges,
  flipDoorsChanges,
  openingPatchChanges,
  placeOpeningChanges,
  planClipOf,
  planGeometryChanges,
  planNudgeChanges,
  planPasteChanges,
  reorderPlanChanges,
  runRoomId,
  shownWalls,
  trashPlanItemsChanges,
  viewKey,
  wallPatchChanges,
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

/** "New room" (6.2b): a new room for the scene, whether or not it had one; the old one is left as it is. */
export async function newRoom(sceneId: string): Promise<boolean> {
  const { project } = projectStore.getState();
  if (!project) return false;
  return projectStore.getState().applyWith((records) => ({ changes: newRoomChanges(records, project.projectId, sceneId) }));
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
  const written = await projectStore.getState().applyWith((records) => ({ changes: placeOpeningChanges(records, spot, kind, id) }));
  if (written) select(view, [id]);
}

/** A finished move, resize or turn; a door or window may land on any wall the view shows. */
export async function changePlanGeometry(changes: readonly GeometryChange[], view?: PlanView): Promise<void> {
  await projectStore.getState().applyWith((records) => ({ changes: planGeometryChanges(records, changes, view ? shownWalls(shownItems(records, view.sceneId, view.setupId)) : undefined) }));
}

export async function nudgePlan(ids: readonly string[], dx: number, dy: number): Promise<void> {
  await projectStore.getState().applyWith((records) => ({ changes: planNudgeChanges(records, ids, dx, dy) }));
}

export async function reorderPlan(view: PlanView, mode: ReorderMode): Promise<void> {
  await projectStore.getState().applyWith((records) => ({ changes: reorderPlanChanges(records, planSelection(records, view), mode) }));
}

export async function deletePlanSelection(view: PlanView): Promise<void> {
  const written = await projectStore.getState().applyWith((records) => ({ changes: trashPlanItemsChanges(records, planSelection(records, view)) }));
  if (written) select(view, []);
}

export function copyPlanSelection(view: PlanView): number {
  const { records } = projectStore.getState();
  const clip = planClipOf(records, planSelection(records, view));
  if (clip.length > 0) planStore.getState().copy(clip);
  return clip.length;
}

export async function cutPlanSelection(view: PlanView): Promise<void> {
  if (copyPlanSelection(view) > 0) await deletePlanSelection(view);
}

/** Paste into the scene's room, at the pointer or 16 cm from the originals; the pasted are selected. */
export async function pastePlan(view: PlanView, at: Point | null, clip = planStore.getState().clipboard): Promise<void> {
  if (clip.length === 0) return;
  let ids: string[] = [];
  const written = await projectStore.getState().applyWith((records) => {
    const roomId = sceneRoomId(records, records[view.sceneId]);
    if (roomId === null) return { changes: [] };
    const made = planPasteChanges(records, roomId, clip, at);
    ids = made.ids;
    return { changes: made.changes };
  });
  if (written) select(view, ids);
}

/** Duplicate is Copy then Paste offset from the originals, without touching the clipboard. */
export async function duplicatePlanSelection(view: PlanView): Promise<void> {
  const { records } = projectStore.getState();
  await pastePlan(view, null, planClipOf(records, planSelection(records, view)));
}

/** A field changed in the Selection tile, on every selected wall it fits: one op group. */
export async function changeWalls(ids: readonly string[], patch: WallPatch): Promise<boolean> {
  return projectStore.getState().applyWith((records) => ({ changes: wallPatchChanges(records, ids, patch) }));
}

/** A field changed on the selected doors and windows: one op group, nothing when it doesn't fit. */
export async function changeOpenings(ids: readonly string[], patch: OpeningPatch): Promise<boolean> {
  return projectStore.getState().applyWith((records) => ({ changes: openingPatchChanges(records, ids, patch) ?? [] }));
}

/** F and Shift+F: the selected doors' swing or hinge flipped, one op group. */
export async function flipDoors(ids: readonly string[], what: 'swing' | 'hinge'): Promise<boolean> {
  return projectStore.getState().applyWith((records) => ({ changes: flipDoorsChanges(records, ids, what) }));
}

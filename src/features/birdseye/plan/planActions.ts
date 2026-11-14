import { projectStore } from '../../../app/projectStore';
import { renamePlanChanges, sceneRoomId, shownItems, startRoomChanges, wallsAlong } from '../../../core/model/plan';
import type { SbdRecord } from '../../../core/model/record';
import type { GeometryChange, Point, ReorderMode } from '../../../ui/canvas/types';
import { planClipOf, planGeometryChanges, planNudgeChanges, planPasteChanges, reorderPlanChanges, trashPlanItemsChanges, viewKey, wallPatchChanges, type WallPatch } from './planItems';
import { toMetres } from './planScale';
import { planStore } from './planStore';

// What a person does on a plan (6.2a), as edits through projectStore.applyWith: each is one op group, so one ⌘Z, as a
// board's are (src/features/moodboards/boardActions.ts). New items go into the scene's room in this milestone.

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

export async function renameRoom(roomId: string, name: string): Promise<boolean> {
  return projectStore.getState().applyWith((records) => ({ changes: renamePlanChanges(records, roomId, name) }));
}

/** A run of walls drawn (canvas units): one wall a segment, the whole run one op group, the new walls selected. */
export async function drawWalls(view: PlanView, points: readonly Point[]): Promise<void> {
  let ids: string[] = [];
  const written = await projectStore.getState().applyWith((records) => {
    const roomId = sceneRoomId(records, records[view.sceneId]);
    if (roomId === null) return { changes: [] };
    const made = wallsAlong(records, roomId, points.map((p) => ({ x: toMetres(p.x), y: toMetres(p.y) })));
    ids = made.ids;
    return { changes: made.changes };
  });
  if (written) select(view, ids);
}

export async function changePlanGeometry(changes: readonly GeometryChange[]): Promise<void> {
  await projectStore.getState().applyWith((records) => ({ changes: planGeometryChanges(records, changes) }));
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

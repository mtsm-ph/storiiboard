import type { StoreApi } from 'zustand/vanilla';
import { showInfo, showNotice } from '../../../app/notice';
import type { PictureFile } from '../../../app/pictures';
import { projectStore, type ProjectState } from '../../../app/projectStore';
import { localizeError, t, tn } from '../../../core/i18n';
import type { Project } from '../../../core/storage/project';
import { CAST_MARK_ICON, MARK_ICON, NEXT_POSITION_ICON, NORTH_ICON, plansShown, renamePlanChanges, shownItems, startRoomChanges, type OpeningKind } from '../../../core/model/plan';
import { castMarkFor, markOwnerChanges, movePositionChanges, nextPositionChanges, ownerIn, placeMarkChanges, type OwnerChoice } from '../../../core/model/planBlocking';
import { roomNorthItem, sunTimeChanges } from '../../../core/model/planSun';
import type { Coordinates } from '../../../core/model/coordinates';
import { ownDateChanges, ownPlaceChanges } from '../../../core/model/sunSources';
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
import { lightBeamChanges, lightWattsChanges, planGearChanges, stopAtWallsChanges } from '../../../core/model/planLight';
import { pickableIds, rowState, UNDERLAY_ROW } from '../../../core/model/planLayers';
import type { Change } from '../../../core/ops/ops';
import type { SbdRecord } from '../../../core/model/record';
import type { GeometryChange, Point, ReorderMode } from '../../../ui/canvas/types';
import {
  drawMeasuresChanges,
  drawWallsChanges,
  flipDoorsChanges,
  frameSizeChanges,
  iconPatchChanges,
  iconRefusal,
  measurePatchChanges,
  openingPatchChanges,
  openingsLeftOut,
  placeIconChanges,
  placeOpeningChanges,
  clipPictureSha,
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
  type MeasurePatch,
  type OpeningPatch,
  type OpeningSpot,
  type WallPatch,
} from './planItems';
import { iconSize } from './iconSizes';
import { layerStatesNow, ownEdit, revealLayersOf, showUnderlayRow } from './layersStore';
import { addUnderlayChanges, setScaleChanges, underlayFileKind } from './underlayEdits';
import { prepare, reason } from '../../storyboard/addPictures';
import { picturesBusy } from '../../storyboard/picturesBusy';
import { planStore } from './planStore';
import { planClipMarker, PLAN_CLIP_TEXT } from './planClipboard';
import { openingKey } from './shownPlan';

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
 * `lead`: what else the step says, in the same notice before the reveal's (L4).
 */
const select = (view: PlanView, ids: readonly string[], records: Records = projectStore.getState().records, lead: readonly string[] = []) => {
  revealLayersOf(ids, records, lead);
  planStore.getState().select(viewKey(view.sceneId, view.setupId), ids);
};

/**
 * Items selected in a view as the keyboard picks them on the canvas (the compass, 6.5.5: north and the sun path): only
 * those on a layer that can be picked (shown and unlocked: pickableIds), and no layer is shown or unlocked for them.
 */
export const selectPlanItems = (view: PlanView, ids: readonly string[], records: Records = projectStore.getState().records) => {
  planStore.getState().select(viewKey(view.sceneId, view.setupId), pickableIds(records, ids, layerStatesNow()));
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

/** A door or window selected without its wall is copied only with it: the words for it, or none. */
const leftOutWords = (records: Records, ids: readonly string[]): string[] => (openingsLeftOut(records, ids) ? [t('plan.openingCopiedWithWall')] : []);

/** Whether the last Copy or Cut on a plan took anything (a lone door takes nothing: it is copied only with its wall). */
let lastCopyTook = false;

/**
 * Copy: the items kept inside the app with the opening of the project they were copied in (6.9 review, M1), and the
 * system clipboard marked as the plan's (M2: planClipboard.ts), so a picture copied before can't win over them.
 */
export function copyPlanSelection(view: PlanView): number {
  const { records, project } = projectStore.getState();
  const ids = planSelection(records, view);
  const clip = planClipOf(records, ids, view);
  for (const words of leftOutWords(records, ids)) showInfo(words);
  lastCopyTook = clip.length > 0;
  if (clip.length > 0) {
    planStore.getState().copy(clip, openingKey(project));
    planClipMarker.clipTaken(PLAN_CLIP_TEXT);
  }
  return clip.length;
}

/**
 * The canvas's copy event or its copy key (6.9 review, L8): the system clipboard is marked only when the copy took
 * something. A copy that took nothing leaves the system clipboard as it was (false: the canvas leaves the event alone),
 * so the token of the items copied before never lands on it again over what was copied since.
 */
export function markPlanClipboard(data: DataTransfer | null, native: Event | null): boolean {
  if (!lastCopyTook) return false;
  planClipMarker.markSystemClipboard(data, native);
  return true;
}

/**
 * Whether the plan has items copied that would paste here (6.9 review, L1): copied in this opening of the project. A
 * clip from another opening (a backup, an opened version, a switch) pastes nothing, so it neither offers Paste nor stops
 * a picture on the system clipboard from becoming an underlay.
 */
export function planClipHere(project = projectStore.getState().project): boolean {
  const { clipboard, clipFrom } = planStore.getState();
  return clipboard.length > 0 && clipFrom === openingKey(project);
}

export async function cutPlanSelection(view: PlanView): Promise<void> {
  if (copyPlanSelection(view) > 0) await deletePlanSelection(view);
}

/**
 * Paste, each copy into the plan its original sits in (a setup's only wall stays that setup's), or the view's plan of
 * that level; at the pointer or 16 cm from the originals; the pasted are selected. A setup's icon pasted into a scene
 * with no setup shown is left out, and said. Everything the paste says is one notice (L4), in order: `lead` (what a
 * Duplicate left out), what was left out or not pasted, then what the reveal showed or unlocked and a solo ended.
 * What was copied pastes only into the opening of the project it was copied in (6.9 review, M1): its cameras, marks,
 * lights and underlays name that project's bodies, frames, characters, gear and pictures. There, an underlay whose
 * stored picture has gone since (Empty Trash) is left out, looked at inside the edit's turn, after any Empty Trash
 * ahead of it, as a board's paste does; the rest goes through.
 */
export async function pastePlan(
  view: PlanView,
  at: Point | null,
  clip = planStore.getState().clipboard,
  lead: readonly string[] = [],
  store: StoreApi<ProjectState> = projectStore,
): Promise<void> {
  if (clip.length === 0) {
    if (lead.length > 0) showInfo(lead.join(' '));
    return;
  }
  const { project } = store.getState();
  if (!project) return;
  const { clipboard, clipFrom } = planStore.getState();
  // A Duplicate gives its clip directly, from this project. Another opening (a backup, an opened version, a switch) is another project.
  if (clip === clipboard && clipFrom !== openingKey(project)) {
    showInfo([...lead, t('plan.pasteElsewhere')].join(' '));
    return;
  }
  let ids: string[] = [];
  const out = { count: 0, north: 0, gone: 0 };
  const written = await store.getState().applyWith(async (records) => {
    const shas = [...new Set(clip.flatMap((item) => [clipPictureSha(records, item)].filter((sha): sha is string => sha !== null)))];
    const rows = shas.length === 0 ? [] : await project.file.query('SELECT sha256 FROM media_files WHERE sha256 IN (SELECT value FROM json_each(?))', [JSON.stringify(shas)]);
    const stored = new Set(rows.map((row) => String(row.sha256)));
    const kept = clip.filter((item) => {
      if (item.props.kind !== 'underlay') return true;
      const sha = clipPictureSha(records, item);
      return sha !== null && stored.has(sha);
    });
    out.gone = clip.length - kept.length;
    if (kept.length === 0) return { changes: [] };
    // The records as they are now: the query above waited its turn.
    const made = planPasteInView(store.getState().records, view, kept, at);
    ids = made.ids;
    out.count = made.leftOut;
    out.north = made.northKept ?? 0;
    return { changes: made.changes };
  });
  // One north per room (6.6): a pasted north the room already has is left out, and said; the room's own is selected
  // with what was pasted, and its layer shown and unlocked, as placing a north does (6.8 review, L6).
  const said = [
    ...lead,
    ...(out.gone > 0 ? [t('plan.underlay.pasteGone')] : []),
    ...(out.count > 0 ? [t('library.noSetup')] : []),
    ...(out.north > 0 ? [t('plan.north.notPasted')] : []),
  ];
  if (store.getState().project !== project) return;
  const records = store.getState().records;
  const kept = out.north > 0 ? (roomNorthItem(records, plansShown(records, view.sceneId, view.setupId).room?.id ?? null)?.record.id ?? null) : null;
  if (written) select(view, kept === null ? ids : [...ids, kept], records, said);
  else if (said.length > 0) showInfo(said.join(' '));
}

/** Duplicate is Copy then Paste offset from the originals, without touching the clipboard; one notice for both. */
export async function duplicatePlanSelection(view: PlanView): Promise<void> {
  const { records } = projectStore.getState();
  const ids = planSelection(records, view);
  await pastePlan(view, null, planClipOf(records, ids, view), leftOutWords(records, ids));
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

/**
 * The selected marks given to a character, a camera or no one (6.7): one op group. A mark given a camera moves to the
 * camera's layer: hidden or locked, that layer is shown and unlocked, and said, so the mark stays selected (L1).
 */
export const setMarkOwner = (view: PlanView, ids: readonly string[], choice: OwnerChoice) =>
  ownEdit(ids, () => plannedEdit((r) => markOwnerChanges(r, view, ids, choice, markSizes())));

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
/** Stop at walls (6.18) on a camera or a light: one op group, undoable. */
export const setStopAtWalls = (ids: readonly string[], on: boolean) => plannedEdit((r) => stopAtWallsChanges(r, ids, on));

/** A sun path's time of day (6.6), "HH:mm": one op group. */
export const setSunTime = (ids: readonly string[], time: string) => plannedEdit((r) => sunTimeChanges(r, ids, time));
/** A sun path's own place (6.5.5), both coordinates, or taken off with null: one op group. */
export const setSunOwnPlace = (id: string, place: Coordinates | null) => plannedEdit((r) => ownPlaceChanges(r, id, place));
/** A sun path's own date (6.5.5), YYYY-MM-DD, or taken off with null: one op group. */
export const setSunOwnDate = (id: string, date: string | null) => plannedEdit((r) => ownDateChanges(r, id, date));

// The room's underlays and measures (6.9), each one op group, only into the open project the gesture began in (`madeIn`).

/**
 * A run of measures drawn (canvas units, 6.9): one measure a segment, the run one op group, into the room of the view it
 * was drawn in, the new measures selected (their layer, production's, shown and unlocked first). Only into the open
 * project it was drawn in, as a run of walls; a room gone meanwhile is said.
 */
export async function drawMeasures(view: PlanView, points: readonly Point[], madeIn: Project | null, store: StoreApi<ProjectState> = projectStore): Promise<boolean> {
  if (madeIn === null || store.getState().project !== madeIn) return false;
  let ids: string[] = [];
  const room = { gone: false };
  const written = await store.getState().applyWith((records) => {
    if (runRoomId(records, view.sceneId) === null) {
      room.gone = true;
      return { changes: [] };
    }
    const made = drawMeasuresChanges(records, view.sceneId, points);
    ids = made.ids;
    return { changes: made.changes };
  });
  if (room.gone) {
    if (written && points.length >= 2 && store.getState().project === madeIn) showInfo(t('plan.measuresNotDrawn'));
    return false;
  }
  if (written) select(view, ids, store.getState().records);
  return written;
}

/** A field changed on the selected measures in the Selection tile (6.9): one op group. */
export async function changeMeasures(ids: readonly string[], patch: MeasurePatch): Promise<boolean> {
  return projectStore.getState().applyWith((records) => ({ changes: measurePatchChanges(records, ids, patch) }));
}

/**
 * Why an underlay wasn't added: a PDF (not read in this milestone), something that isn't a picture, no room, another
 * project open, nothing that reads.
 */
export type UnderlayOutcome = 'pdf' | 'notPicture' | 'noRoom' | 'otherProject' | 'failed' | null;

/**
 * Pictures added under the room (6.9): the first picture of a choice, a drop or a paste, prepared as a board's pictures
 * are (capped, colour kept, thumbnail made: src/features/storyboard/addPictures.ts), then an underlay with its picture
 * in one op group, its middle at `centre` (metres). Each file is told by its name and type before anything is read
 * (6.9 review, L6): a PDF is said ("Save it as a picture first"), anything that isn't a picture is said and never read,
 * opened or run; of several pictures the first is added and the rest are said (L7). A file that can't be read is named
 * in a notice. Only into the project the choice or drop began in (`madeIn`), and only while the scene still has a room.
 * Added, it is said to be locked so walls are traced over it (L8), with the underlay's row drawn if it was hidden, its
 * lock kept, so nothing is selected; everything in one notice.
 */
export async function addUnderlay(view: PlanView, files: readonly PictureFile[], centre: Point, madeIn: Project | null, store: StoreApi<ProjectState> = projectStore): Promise<UnderlayOutcome> {
  if (madeIn === null || store.getState().project !== madeIn) return 'otherProject';
  const kinds = files.map((file) => underlayFileKind({ name: file.name, type: file.file?.type }));
  const pictures = files.filter((_, i) => kinds[i] === 'picture');
  const said = [...(kinds.includes('pdf') ? [t('plan.underlay.pdf')] : []), ...(kinds.includes('other') ? [t('plan.underlay.notPicture')] : [])];
  const [file] = pictures;
  if (!file) {
    if (said.length > 0) showInfo(said.join(' '));
    return files.length === 0 ? null : kinds.includes('pdf') ? 'pdf' : 'notPicture';
  }
  if (pictures.length > 1) said.push(tn('plan.underlay.oneAtATime', pictures.length));
  picturesBusy.setState((s) => ({ count: s.count + 1 }));
  let prepared: Awaited<ReturnType<typeof prepare>> | null = null;
  try {
    prepared = await prepare({ kind: 'picture', file }, madeIn.file.nativeHandle);
  } catch (error) {
    showNotice([...said, localizeError(reason(error))].join(' '));
    return 'failed';
  } finally {
    picturesBusy.setState((s) => ({ count: s.count - 1 }));
  }
  // Another project may have opened while the picture was prepared: it belongs to the one it was added in.
  if (prepared.kind !== 'picture' || store.getState().project !== madeIn) return 'otherProject';
  const picture = prepared.picture;
  const outcome: { why: UnderlayOutcome } = { why: null };
  const written = await store.getState().applyWith((records) => {
    if (runRoomId(records, view.sceneId) === null) {
      outcome.why = 'noRoom';
      return { changes: [] };
    }
    const made = addUnderlayChanges(records, view.sceneId, picture, centre, madeIn.file.path);
    return { changes: made.changes, alsoWrite: made.alsoWrite };
  });
  if (store.getState().project !== madeIn) return outcome.why ?? null;
  if (outcome.why === 'noRoom') {
    showInfo([...said, t('library.needsRoom')].join(' '));
    return 'noRoom';
  }
  if (!written) {
    if (said.length > 0) showInfo(said.join(' '));
    return null;
  }
  showUnderlayRow([...said, t(rowState(layerStatesNow(), UNDERLAY_ROW).locked ? 'plan.underlay.addedLocked' : 'plan.underlay.added')]);
  return null;
}

/**
 * "Set scale" answered (6.9): the underlay scaled about the first of the two points so they are `typed` metres apart,
 * one op group. Only into the project the two clicks were made in (`madeIn`); false when nothing was written.
 */
export async function setUnderlayScale(underlayId: string, a: Point, b: Point, typed: number, madeIn: Project | null, store: StoreApi<ProjectState> = projectStore): Promise<boolean> {
  if (madeIn === null || store.getState().project !== madeIn) return false;
  const wrote = { any: false };
  const written = await store.getState().applyWith((records) => {
    const changes = setScaleChanges(records, underlayId, a, b, typed);
    wrote.any = changes.length > 0;
    return { changes };
  });
  return written && wrote.any;
}

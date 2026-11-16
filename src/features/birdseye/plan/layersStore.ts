import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { showInfo } from '../../../app/notice';
import { projectStore, useProject } from '../../../app/projectStore';
import { projectRoleOf, projectSelfStore, useMyPart } from '../../../app/settings/projectRole';
import { list, t, tn } from '../../../core/i18n';
import type { PlanLayer } from '../../../core/model/plan';
import {
  ALL_SHOWN,
  departmentRows,
  keepUnknownRows,
  layerOfItem,
  myDepartmentStates,
  pickableIds,
  revealedStates,
  ROW_ORDER,
  rowState,
  soloStates,
  UNDERLAY_ROW,
  type LayerRow,
  type LayerShow,
  type LayerState,
  type PlanLayerStates,
} from '../../../core/model/planLayers';
import { myPart } from '../../../core/model/person';
import type { SbdRecord } from '../../../core/model/record';
import { loadSettings, saveSettings } from '../../../core/storage/settings';
import type { Tool } from '../../../ui/canvas/types';
import { groupName } from './library';
import { DOOR_TOOL, MEASURE_TOOL, WALL_TOOL, WINDOW_TOOL } from './planScale';
import { planStore } from './planStore';

// The layers' state (6.8) that the Plan and Layers tiles both read: this computer's, one for every plan, kept in its
// settings (never in a project, never an op, nothing in History). Until the person first changes a layer the state is
// worked out from who they are ("This is me", else their role on this project: projectRole.ts, as 3.6c's perspective
// views read it), so it follows a change of who they are; from then on it is what they chose.
//
// A solo (6.8 review) dims and locks every other layer and remembers the state before it; ending it (Solo again, the
// same layer or another's Solo pressed twice) puts that state back exactly. While it is on, the other rows' choices and
// locks are the solo's: held, changed by nothing (6.8 second review, M-a); the solo row's own choices and lock work and
// keep the solo, applied to it and to what comes back. A solo ends only by its own Solo, another row's Solo (it moves),
// Show all, My department, key 0 or a reveal, and any of those but its own button says it ended, so a jump of every row
// back is never a mystery. The settings keep the state from before a solo, so a reload during one comes back without
// it; a solo begun while nothing was saved writes nothing (L5), so the start still follows "This is me" after it.

/** A layer soloed, with the state before it, so pressing Solo again puts that back; in memory only. */
interface Solo {
  layer: PlanLayer;
  before: PlanLayerStates;
  /** Begun while nothing was chosen (`saved` null), and nothing chosen since: ended by its button, the start follows again. */
  fromNull: boolean;
}

interface LayersState {
  /** What was chosen, or null while the start follows the person's department. */
  saved: PlanLayerStates | null;
  solo: Solo | null;
  /**
   * The last change in words, for screen readers (L3): read by the canvas's spoken line when made on the plan (its keys,
   * its header's Show all), by the Layers tile's when made there.
   */
  said: { text: string; by: SaidBy };
}

/** Where a change was made, so its words are read out there: on the plan, or in the Layers tile. */
export type SaidBy = 'plan' | 'tile';

export const layersStore = createStore<LayersState>()(() => ({ saved: loadSettings().planLayers, solo: null, said: { text: '', by: 'tile' } }));

/** "My department" for the open project's person, read outside React. */
function myDepartmentNow(): PlanLayerStates {
  const { project, records } = projectStore.getState();
  const projectId = project?.projectId ?? '';
  const selfId = projectId === '' ? null : (projectSelfStore.getState()[projectId] ?? null);
  return myDepartmentStates(myPart(records, projectId, selfId, projectId === '' ? null : projectRoleOf(projectId)));
}

/** The layers' state now, read outside React (an edit, the selection's check). */
export const layerStatesNow = (): PlanLayerStates => layersStore.getState().saved ?? myDepartmentNow();

/** The layers' state for the open project's person, live. */
export function usePlanLayerStates(): PlanLayerStates {
  const saved = useStore(layersStore, (s) => s.saved);
  const part = useMyPart(useProject((s) => s.project?.projectId));
  // myDepartmentStates gives the same object for the same own layers, so this changes only when they do.
  const mine = myDepartmentStates(part);
  return saved ?? mine;
}

/** The layer soloed now, or null. */
export const useSoloLayer = (): PlanLayer | null => useStore(layersStore, (s) => s.solo?.layer ?? null);

/** The last change's words, when made `by` there; '' otherwise. */
export const useLayersSaid = (by: SaidBy): string => useStore(layersStore, (s) => (s.said.by === by ? s.said.text : ''));

/** No words: a single control speaks its own new state, so nothing is said for it on either line (L3). */
function unsay(): void {
  if (layersStore.getState().said.text !== '') layersStore.setState({ said: { text: '', by: 'tile' } });
}

/**
 * Set in one step (L3): an empty tick between would let the canvas read its selection summary first. The same words
 * said twice end in a no-break space the second time, so they change and are read out again.
 */
function say(text: string, by: SaidBy): void {
  const was = layersStore.getState().said;
  layersStore.setState({ said: { text: was.by === by && was.text === text ? `${text}\u00a0` : text, by } });
}

// The canvas's spoken line goes back to the selection once that changes (L3), whichever tile changed it (the Frames
// tile, Open on the plan, a placement), as the Moodboard's select clears its announcement. Here and not in
// planStore.select, which this file's own imports would make a loop of.
planStore.subscribe((state, previous) => {
  if (state.selections !== previous.selections) unsay();
});

/** Two spoken lines as one ("Camera solo ended. All layers shown, none locked"). */
const then = (first: string, next: string): string => t('layers.said.then', { first, then: next });

/**
 * Every view's selection keeps only what can still be picked (6.8): an item whose layer is now hidden or locked leaves
 * it, so a Delete or a nudge never reaches what the person can't pick.
 */
function pruneSelections(states: PlanLayerStates): void {
  const { records } = projectStore.getState();
  const { selections } = planStore.getState();
  const kept = Object.entries(selections).map(([key, ids]) => [key, ids, pickableIds(records, ids, states)] as const);
  if (kept.every(([, ids, left]) => left.length === ids.length)) return;
  planStore.setState({ selections: Object.fromEntries(kept.map(([key, , left]) => [key, left])) });
}

/** Edits of the person's own under way (`ownEdit`): their items' selection is kept through them, not pruned. */
let ownEdits = 0;

// An item's layer can change with no change of the layers (6.8 review, M1): a mark given a camera moves to the camera
// layer. So the selections are pruned after every change of the records too (a layer hidden meanwhile, an undo), not
// only of the layers' state; but not during a person's own edit of the selected items, which reveals instead (L1).
projectStore.subscribe((state, previous) => {
  if (state.records !== previous.records && ownEdits === 0) pruneSelections(layerStatesNow());
});

/**
 * A person's own edit of these selected items (L1: a mark given a locked layer's camera in the Selection tile): the
 * layers they land on are shown and unlocked after it, as placing does, with the usual notice, so the items stay
 * selected and the Selection tile keeps them; then anything else no longer pickable leaves the selection as ever.
 */
export async function ownEdit<T>(ids: readonly string[], edit: () => Promise<T>): Promise<T> {
  ownEdits += 1;
  try {
    return await edit();
  } finally {
    ownEdits -= 1;
    revealLayersOf(ids);
    pruneSelections(layerStatesNow());
  }
}

/**
 * The layers' state changed. `states` null: nothing chosen, the start follows the person's department again. During a
 * solo the settings keep what comes back after it, and nothing while it began from nothing (L5); rows a newer version
 * keeps are carried as stored (L9).
 */
function commit(states: PlanLayerStates | null, solo: Solo | null = null): void {
  const keep = solo ? (solo.fromNull ? null : solo.before) : states;
  if (keep !== null) saveSettings({ planLayers: keepUnknownRows(loadSettings().planLayers, keep) });
  layersStore.setState({ saved: states, solo });
  pruneSelections(layerStatesNow());
}

/** The state a change that ends a solo applies to: the one before the solo while one is on, else the state now. */
const baseNow = (): PlanLayerStates => layersStore.getState().solo?.before ?? layerStatesNow();

/** The spoken words of a change that ends a solo other than by its own button: the solo's end said first (M-a). */
const endingSolo = (words: string): string => {
  const { solo } = layersStore.getState();
  return solo ? then(t('layers.said.soloEndedBy', { layer: groupName(solo.layer) }), words) : words;
};

/** A change of the solo row's own choice or lock: made in the solo and in what comes back after it, the solo kept. */
function changeSoloRow(solo: Solo, patch: Partial<LayerState>): void {
  const now = layerStatesNow();
  commit({ ...now, [solo.layer]: { ...rowState(now, solo.layer), ...patch } }, { layer: solo.layer, before: { ...solo.before, [solo.layer]: { ...rowState(solo.before, solo.layer), ...patch } }, fromNull: false });
}

/** The reveal notice's words by what it did (L4), each counted by the layers it names. */
const REVEALED = { shown: 'layers.revealed.shown', unlocked: 'layers.revealed.unlocked', both: 'layers.revealed.both' } as const;

const SHOW_SAID = { shown: 'layers.showIn.shown', dimmed: 'layers.showIn.dimmed', hidden: 'layers.showIn.hidden' } as const satisfies Record<LayerShow, string>;

/** A row's name: a department layer's as the Library names its group, the underlay's own (6.9). */
export const rowName = (row: LayerRow): string => (row === UNDERLAY_ROW ? t('layers.underlay') : groupName(row));

/**
 * A row's Shown, Dimmed or Hidden. The choice already current does nothing, ever. During a solo another row's is the
 * solo's, held (M-a): nothing changes and the solo stays; the solo row's own is changed and the solo kept. Said only on
 * the plan's line when made there: in the tile the control speaks its own new state (L3).
 */
export function setLayerShow(layer: LayerRow, show: LayerShow, by: SaidBy = 'tile'): void {
  const { solo } = layersStore.getState();
  const now = layerStatesNow();
  if (rowState(now, layer).show === show) return;
  if (solo && solo.layer !== layer) return;
  if (solo) changeSoloRow(solo, { show });
  else commit({ ...now, [layer]: { ...rowState(now, layer), show } });
  if (by === 'plan') say(t(SHOW_SAID[show], { layer: rowName(layer) }), by);
  else unsay();
}

/** A row's lock, held during another row's solo and kept with the solo on its own row, as its choice is (M-a). */
export function setLayerLocked(layer: LayerRow, locked: boolean, by: SaidBy = 'tile'): void {
  const { solo } = layersStore.getState();
  const now = layerStatesNow();
  if (rowState(now, layer).locked === locked) return;
  if (solo && solo.layer !== layer) return;
  if (solo) changeSoloRow(solo, { locked });
  else commit({ ...now, [layer]: { ...rowState(now, layer), locked } });
  if (by === 'plan') say(t(locked ? 'layers.said.locked' : 'layers.said.unlocked', { layer: rowName(layer) }), by);
  else unsay();
}

/**
 * "Show all": every department layer shown, none locked. The underlay's row keeps its lock (6.9: never unlocked by
 * surprise while walls are traced over it); hidden, it comes back dimmed, so nothing on the plan stays out of sight.
 * During a solo it ends the solo, and says so.
 */
export function showAllLayers(by: SaidBy = 'tile'): void {
  const base = baseNow();
  const underlay = rowState(base, UNDERLAY_ROW);
  const words = endingSolo(t('layers.said.all'));
  commit({ ...base, ...departmentRows(ALL_SHOWN), [UNDERLAY_ROW]: underlay.show === 'hidden' ? { ...underlay, show: 'dimmed' } : underlay });
  say(words, by);
}

/**
 * "My department": the person's own layers shown, the rest dimmed, none locked; the underlay's row as it is (6.9).
 * During a solo it ends the solo, and says so.
 */
export function myDepartmentLayers(by: SaidBy = 'tile'): void {
  const words = endingSolo(t('layers.said.mine'));
  commit({ ...baseNow(), ...departmentRows(myDepartmentNow()) });
  say(words, by);
}

/**
 * Solo (keys 1 to 7, or a row's Solo): this layer shown and the others dimmed and locked. Pressed again for the layer
 * soloed, what was before comes back (nothing saved, if nothing was before: L5). Another layer soloed during a solo
 * moves it, carrying the state from before the first, so 1, 2, then 2 again goes back to what was there before 1 (L1);
 * the move says the first solo ended.
 */
export function soloLayer(layer: PlanLayer, by: SaidBy = 'tile'): void {
  const { solo, saved } = layersStore.getState();
  if (solo?.layer === layer) {
    commit(solo.fromNull ? null : solo.before);
    say(t('layers.said.soloEnded'), by);
    return;
  }
  const words = endingSolo(t('layers.said.solo', { layer: groupName(layer) }));
  const before = baseNow();
  commit(soloStates(before, layer), { layer, before, fromNull: solo ? solo.fromNull : saved === null });
  say(words, by);
}

/**
 * These layers shown and unlocked where they are hidden or locked (placing onto one, being taken to an item on one, a
 * tool that draws on one), and the notice says which and what was done (L4). During a solo, one that isn't the solo
 * layer ends it first (its lock is the solo's), the reveal applies to what comes back, and the notice says the solo
 * ended. `lead`: what else the step just said (left out, not pasted), put first in the same notice, so one notice
 * never hides another (L4).
 */
export function revealLayers(layers: readonly LayerRow[], lead: readonly string[] = []): void {
  const words = [...lead, ...revealed(layers)];
  if (words.length > 0) showInfo(words.join(' '));
}

/** What a reveal did, in sentences, in order: shown or unlocked, then the solo ended. */
function revealed(layers: readonly LayerRow[]): string[] {
  if (layers.length === 0) return [];
  const { solo } = layersStore.getState();
  const now = layerStatesNow();
  if (solo && layers.every((l) => l === solo.layer)) {
    // Only the solo layer: shown already; unlocked in the solo and after it, the solo kept.
    if (!rowState(now, solo.layer).locked) return [];
    changeSoloRow(solo, { locked: false });
    return [tn('layers.revealed.unlocked', 1, { layers: groupName(solo.layer) })];
  }
  const { states, changed, did } = revealedStates(solo ? solo.before : now, layers);
  if (!solo && changed.length === 0) return [];
  commit(states);
  return [...(changed.length > 0 ? [tn(REVEALED[did], changed.length, { layers: list(changed.map(rowName)) })] : []), ...(solo ? [t('layers.soloEnded', { layer: groupName(solo.layer) })] : [])];
}

/** After placing items, or before selecting them from elsewhere (6.8): their layers shown and unlocked, and said. */
export function revealLayersOf(ids: readonly string[], records: Readonly<Record<string, SbdRecord>> = projectStore.getState().records, lead: readonly string[] = []): void {
  const layers = ids.flatMap((id) => {
    const record = records[id];
    const layer = record ? layerOfItem(records, record) : null;
    return layer === null ? [] : [layer];
  });
  revealLayers(ROW_ORDER.filter((l) => layers.includes(l)), lead);
}

/**
 * A plan tool picked, from the toolbar, its key or the Library (6.8 review, L7; 6.9): the Wall, Door and Window tools
 * draw on the set's layer and Measure on production's, so that layer is shown and unlocked first (with the usual
 * notice), as placing on it would: a door is never refused for walls out of sight, a measure never drawn unseen.
 */
export function choosePlanTool(next: Tool): void {
  if (next === WALL_TOOL || next === DOOR_TOOL || next === WINDOW_TOOL) revealLayers(['set-art']);
  if (next === MEASURE_TOOL) revealLayers(['production']);
  planStore.getState().setTool(next);
}

/**
 * The underlay's row seen (6.9): a picture just added onto a hidden row is drawn dimmed, as the row starts, its lock as
 * it was, so walls are traced over it and it is never picked by surprise. Said as revealing is. Nothing during a solo:
 * the solo's dim already shows it. `lead`: what else the step says, first in the same notice (L4), said even when the
 * row was drawn already.
 */
export function showUnderlayRow(lead: readonly string[] = []): void {
  const { solo } = layersStore.getState();
  const now = layerStatesNow();
  const row = rowState(now, UNDERLAY_ROW);
  const reveal = !solo && row.show === 'hidden';
  if (reveal) commit({ ...now, [UNDERLAY_ROW]: { ...row, show: 'dimmed' } });
  const words = [...lead, ...(reveal ? [tn('layers.revealed.shown', 1, { layers: rowName(UNDERLAY_ROW) })] : [])];
  if (words.length > 0) showInfo(words.join(' '));
}

/**
 * "Set scale" started (6.9) from the room's menu, the Layers row, the header's note or the Selection tile: the
 * underlay's row drawn first when it was hidden, and said (6.9 review, L4), so its two clicks land on a picture in view.
 */
export function startUnderlayScale(underlayId: string): void {
  showUnderlayRow();
  planStore.getState().startScale(underlayId);
}

/**
 * The layers' state replaced by a preset's (6.5.8): chosen states, or null to follow the person's department again. Any
 * solo ends, quietly: the preset's state is what the person asked for. A preset carries only the rows this version knows;
 * rows a newer version keeps in this computer's own settings stay as stored (keepUnknownRows), as for any change here.
 */
export function setPlanLayerStates(states: PlanLayerStates | null): void {
  saveSettings({ planLayers: states === null ? null : keepUnknownRows(loadSettings().planLayers, states) });
  layersStore.setState({ saved: states, solo: null });
  unsay();
  pruneSelections(layerStatesNow());
}

/** For tests: the state as a fresh session reads it from settings. */
export function reloadLayersForTests(): void {
  layersStore.setState({ saved: loadSettings().planLayers, solo: null, said: { text: '', by: 'tile' } });
}

import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { showInfo } from '../../../app/notice';
import { projectStore, useProject } from '../../../app/projectStore';
import { projectRoleOf, projectSelfStore, useMyPart } from '../../../app/settings/projectRole';
import { list, t, tn } from '../../../core/i18n';
import type { PlanLayer } from '../../../core/model/plan';
import {
  ALL_SHOWN,
  keepUnknownRows,
  LAYER_ORDER,
  layerOfItem,
  myDepartmentStates,
  pickableIds,
  revealedStates,
  soloStates,
  type LayerShow,
  type PlanLayerStates,
} from '../../../core/model/planLayers';
import { myPart } from '../../../core/model/person';
import type { SbdRecord } from '../../../core/model/record';
import { loadSettings, saveSettings } from '../../../core/storage/settings';
import { groupName } from './library';
import { planStore } from './planStore';

// The layers' state (6.8) that the Plan and Layers tiles both read: this computer's, one for every plan, kept in its
// settings (never in a project, never an op, nothing in History). Until the person first changes a layer the state is
// worked out from who they are ("This is me", else their role on this project: projectRole.ts, as 3.6c's perspective
// views read it), so it follows a change of who they are; from then on it is what they chose.
//
// A solo (6.8 review) dims and locks every other layer and remembers the state before it; ending it (Solo again, the
// same layer or another's Solo pressed twice) puts that state back exactly. Any other change made during a solo ends it
// first and applies to the state from before it, so a solo's locks never outlive it. The settings keep the state from
// before a solo, so a reload during one comes back without it.

interface LayersState {
  /** What was chosen, or null while the start follows the person's department. */
  saved: PlanLayerStates | null;
  /** A layer soloed, with the state before it, so pressing Solo again puts that back; in memory only. */
  solo: { layer: PlanLayer; before: PlanLayerStates } | null;
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

/** The canvas's spoken line goes back to the selection once that changes. */
export function clearLayersSaid(): void {
  if (layersStore.getState().said.text !== '') layersStore.setState({ said: { text: '', by: 'tile' } });
}

/** Cleared first and set on the next tick, so the same words said twice are read out twice (as a board's announce). */
function say(text: string, by: SaidBy): void {
  layersStore.setState({ said: { text: '', by } });
  setTimeout(() => {
    layersStore.setState({ said: { text, by } });
  }, 0);
}

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

// An item's layer can change with no change of the layers (6.8 review, M1): a mark given a camera moves to the camera
// layer. So the selections are pruned after every change of the records too, not only of the layers' state.
projectStore.subscribe((state, previous) => {
  if (state.records !== previous.records) pruneSelections(layerStatesNow());
});

function commit(states: PlanLayerStates, solo: LayersState['solo'] = null): void {
  // During a solo the settings keep what comes back after it; rows a newer version keeps are carried as stored (L9).
  saveSettings({ planLayers: keepUnknownRows(loadSettings().planLayers, solo ? solo.before : states) });
  layersStore.setState({ saved: states, solo });
  pruneSelections(states);
}

/** The state a change applies to: the one before the solo while one is on (the change ends it), else the state now. */
const baseNow = (): PlanLayerStates => layersStore.getState().solo?.before ?? layerStatesNow();

/** The reveal notice's words by what it did (L4), each counted by the layers it names. */
const REVEALED = { shown: 'layers.revealed.shown', unlocked: 'layers.revealed.unlocked', both: 'layers.revealed.both' } as const;

const SHOW_SAID = { shown: 'layers.showIn.shown', dimmed: 'layers.showIn.dimmed', hidden: 'layers.showIn.hidden' } as const satisfies Record<LayerShow, string>;

export function setLayerShow(layer: PlanLayer, show: LayerShow, by: SaidBy = 'tile'): void {
  const { solo } = layersStore.getState();
  const base = baseNow();
  if (!solo && base[layer].show === show) return;
  commit({ ...base, [layer]: { ...base[layer], show } });
  say(t(SHOW_SAID[show], { layer: groupName(layer) }), by);
}

export function setLayerLocked(layer: PlanLayer, locked: boolean, by: SaidBy = 'tile'): void {
  const { solo } = layersStore.getState();
  const words = t(locked ? 'layers.said.locked' : 'layers.said.unlocked', { layer: groupName(layer) });
  if (solo?.layer === layer) {
    // The solo layer's own lock: changed in the solo and in what comes back after it, the solo kept.
    const now = layerStatesNow();
    if (now[layer].locked === locked) return;
    commit({ ...now, [layer]: { ...now[layer], locked } }, { layer, before: { ...solo.before, [layer]: { ...solo.before[layer], locked } } });
    say(words, by);
    return;
  }
  const base = baseNow();
  if (!solo && base[layer].locked === locked) return;
  commit({ ...base, [layer]: { ...base[layer], locked } });
  say(words, by);
}

/** "Show all": every layer shown, none locked. */
export function showAllLayers(by: SaidBy = 'tile'): void {
  commit({ ...baseNow(), ...ALL_SHOWN });
  say(t('layers.said.all'), by);
}

/** "My department": the person's own layers shown, the rest dimmed, none locked. */
export function myDepartmentLayers(by: SaidBy = 'tile'): void {
  commit({ ...baseNow(), ...myDepartmentNow() });
  say(t('layers.said.mine'), by);
}

/**
 * Solo (keys 1 to 7, or a row's Solo): this layer shown and the others dimmed and locked. Pressed again for the layer
 * soloed, what was before comes back. Another layer soloed during a solo carries the state from before the first, so
 * 1, 2, then 2 again goes back to what was there before 1 (L1).
 */
export function soloLayer(layer: PlanLayer, by: SaidBy = 'tile'): void {
  const { solo } = layersStore.getState();
  if (solo?.layer === layer) {
    commit(solo.before);
    say(t('layers.said.soloEnded'), by);
    return;
  }
  const before = baseNow();
  commit(soloStates(before, layer), { layer, before });
  say(t('layers.said.solo', { layer: groupName(layer) }), by);
}

/**
 * These layers shown and unlocked where they are hidden or locked (placing onto one, being taken to an item on one, a
 * tool that draws on one), and the notice says which and what was done (L4). During a solo, one that isn't the solo
 * layer ends it first (its lock is the solo's), and the reveal applies to what comes back.
 */
export function revealLayers(layers: readonly PlanLayer[]): void {
  if (layers.length === 0) return;
  const { solo } = layersStore.getState();
  const now = layerStatesNow();
  if (solo && layers.every((l) => l === solo.layer)) {
    // Only the solo layer: shown already; unlocked in the solo and after it, the solo kept.
    if (!now[solo.layer].locked) return;
    const unlock = (s: PlanLayerStates): PlanLayerStates => ({ ...s, [solo.layer]: { ...s[solo.layer], locked: false } });
    commit(unlock(now), { layer: solo.layer, before: unlock(solo.before) });
    showInfo(tn('layers.revealed.unlocked', 1, { layers: groupName(solo.layer) }));
    return;
  }
  const { states, changed, did } = revealedStates(solo ? solo.before : now, layers);
  if (!solo && changed.length === 0) return;
  commit(states);
  if (changed.length > 0) showInfo(tn(REVEALED[did], changed.length, { layers: list(changed.map(groupName)) }));
  else if (solo) showInfo(t('layers.soloEnded', { layer: groupName(solo.layer) }));
}

/** After placing items, or before selecting them from elsewhere (6.8): their layers shown and unlocked, and said. */
export function revealLayersOf(ids: readonly string[], records: Readonly<Record<string, SbdRecord>> = projectStore.getState().records): void {
  const layers = ids.flatMap((id) => {
    const record = records[id];
    const layer = record ? layerOfItem(records, record) : null;
    return layer === null ? [] : [layer];
  });
  revealLayers(LAYER_ORDER.filter((l) => layers.includes(l)));
}

/** For tests: the state as a fresh session reads it from settings. */
export function reloadLayersForTests(): void {
  layersStore.setState({ saved: loadSettings().planLayers, solo: null, said: { text: '', by: 'tile' } });
}

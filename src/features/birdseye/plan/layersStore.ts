import { useMemo } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { showInfo } from '../../../app/notice';
import { projectStore, useProject } from '../../../app/projectStore';
import { projectRoleOf, projectSelfStore, useMyPart } from '../../../app/settings/projectRole';
import { list, t } from '../../../core/i18n';
import type { PlanLayer } from '../../../core/model/plan';
import { layerOfItem, myDepartmentStates, pickableIds, revealedStates, sameStates, soloStates, type LayerShow, type PlanLayerStates } from '../../../core/model/planLayers';
import { myPart } from '../../../core/model/person';
import type { SbdRecord } from '../../../core/model/record';
import { loadSettings, saveSettings } from '../../../core/storage/settings';
import { groupName } from './library';
import { planStore } from './planStore';

// The layers' state (6.8) that the Plan and Layers tiles both read: this computer's, one for every plan, kept in its
// settings (never in a project, never an op, nothing in History). Until the person first changes a layer the state is
// worked out from who they are ("This is me", else their role on this project: projectRole.ts, as 3.6c's perspective
// views read it), so it follows a change of who they are; from then on it is what they chose.

interface LayersState {
  /** What was chosen, or null while the start follows the person's department. */
  saved: PlanLayerStates | null;
  /** A layer soloed, with the state before it, so pressing Solo again puts that back; in memory only. */
  solo: { layer: PlanLayer; before: PlanLayerStates } | null;
}

export const layersStore = createStore<LayersState>()(() => ({ saved: loadSettings().planLayers, solo: null }));

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
  const key = `${String(part.fullView)}:${part.departments.join(',')}`;
  // Keyed by the person's departments, not the part object, so the same department gives the same state object.
  const mine = useMemo(() => myDepartmentStates(part), [key]);
  return saved ?? mine;
}

/** The layer soloed now, or null. */
export const useSoloLayer = (): PlanLayer | null => useStore(layersStore, (s) => s.solo?.layer ?? null);

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

function commit(states: PlanLayerStates, solo: LayersState['solo'] = null): void {
  saveSettings({ planLayers: states });
  layersStore.setState({ saved: states, solo });
  pruneSelections(states);
}

export function setLayerShow(layer: PlanLayer, show: LayerShow): void {
  const now = layerStatesNow();
  if (now[layer].show === show) return;
  commit({ ...now, [layer]: { ...now[layer], show } });
}

export function setLayerLocked(layer: PlanLayer, locked: boolean): void {
  const now = layerStatesNow();
  if (now[layer].locked === locked) return;
  commit({ ...now, [layer]: { ...now[layer], locked } });
}

/** "Show all": every layer shown, none locked. */
export function showAllLayers(): void {
  commit(myDepartmentStates({ fullView: true, departments: [] }));
}

/** "My department": the person's own layers shown, the rest dimmed, none locked. */
export function myDepartmentLayers(): void {
  commit(myDepartmentNow());
}

/**
 * Solo (keys 1 to 7, or a row's Solo): this layer shown and the others dimmed; pressed again for the same layer while
 * nothing else changed, what was before comes back.
 */
export function soloLayer(layer: PlanLayer): void {
  const now = layerStatesNow();
  const { solo } = layersStore.getState();
  if (solo && solo.layer === layer && sameStates(now, soloStates(solo.before, layer))) {
    commit(solo.before);
    return;
  }
  commit(soloStates(now, layer), { layer, before: now });
}

/**
 * After placing items (6.8): any of them whose layer is hidden or locked has that layer shown and unlocked, and the
 * notice says so, so nothing is placed out of sight or out of reach.
 */
export function revealLayersOf(ids: readonly string[], records: Readonly<Record<string, SbdRecord>> = projectStore.getState().records): void {
  const layers = ids.flatMap((id) => {
    const record = records[id];
    const layer = record ? layerOfItem(records, record) : null;
    return layer === null ? [] : [layer];
  });
  if (layers.length === 0) return;
  const { states, changed } = revealedStates(layerStatesNow(), layers);
  if (changed.length === 0) return;
  commit(states);
  showInfo(t('layers.revealed', { layers: list(changed.map(groupName)) }));
}

/** For tests: the state as a fresh session reads it from settings. */
export function reloadLayersForTests(): void {
  layersStore.setState({ saved: loadSettings().planLayers, solo: null });
}

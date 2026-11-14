import { DEPARTMENTS, type Department } from './department';
import { openingFields, PLAN_LAYERS, type PlanLayer, type ShownItem } from './plan';
import { itemLayer } from './planBlocking';
import type { SbdRecord } from './record';

// The plan's department layers (6.8, docs/PHASE6_DECISIONS.md 10): each shown, dimmed or hidden, and locked or not. A
// focus view, never access control (as 3.6c's perspective views): the state is this computer's, one for every plan, kept
// in its settings (src/core/storage/settings.ts), never in a project, never an op. An item's layer is worked out from
// what it is (itemLayer), never stored; an item with no layer (an icon outside every group) is always drawn and picked.

type Records = Readonly<Record<string, SbdRecord>>;

export const LAYER_SHOWS = ['shown', 'dimmed', 'hidden'] as const;
export type LayerShow = (typeof LAYER_SHOWS)[number];

export interface LayerState {
  show: LayerShow;
  locked: boolean;
}

export type PlanLayerStates = Readonly<Record<PlanLayer, LayerState>>;

/** The call sheet's department each layer belongs to: lighting and grip are both grip and electric. */
export const LAYER_DEPARTMENT: Readonly<Record<PlanLayer, Department>> = {
  camera: 'camera',
  lighting: 'grip-electric',
  grip: 'grip-electric',
  'set-art': 'art',
  cast: 'cast',
  sound: 'sound',
  production: 'production',
};

/** The layers in call-sheet order (camera, lighting, grip, art, sound, production, cast): the Layers tile's rows and keys 1 to 7. */
export const LAYER_ORDER: readonly PlanLayer[] = [...PLAN_LAYERS].sort(
  (a, b) => DEPARTMENTS.indexOf(LAYER_DEPARTMENT[a]) - DEPARTMENTS.indexOf(LAYER_DEPARTMENT[b]) || PLAN_LAYERS.indexOf(a) - PLAN_LAYERS.indexOf(b),
);

const SHOWN: LayerState = { show: 'shown', locked: false };

const statesWith = (each: (layer: PlanLayer) => LayerState): PlanLayerStates =>
  Object.fromEntries(PLAN_LAYERS.map((layer) => [layer, each(layer)])) as Record<PlanLayer, LayerState>;

/** Every layer shown, none locked: "Show all". */
export const ALL_SHOWN: PlanLayerStates = statesWith(() => SHOWN);

const isShow = (value: unknown): value is LayerShow => typeof value === 'string' && (LAYER_SHOWS as readonly string[]).includes(value);

/**
 * The settings' `planLayers` as kept (the migration): null when it was never set (an older settings file, or nothing
 * chosen yet), so the start follows the person's department; otherwise each layer's state, a layer missing or unreadable
 * (a newer version's value) read as shown and unlocked, and layers this version doesn't know left out.
 */
export function planLayerStatesOf(value: unknown): PlanLayerStates | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const saved = value as Record<string, unknown>;
  return statesWith((layer) => {
    const entry = Object.hasOwn(saved, layer) ? saved[layer] : undefined;
    const own = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    return { show: isShow(own.show) ? own.show : 'shown', locked: own.locked === true };
  });
}

/** The layers a department works on. */
const DEPARTMENT_LAYERS: Readonly<Partial<Record<Department, readonly PlanLayer[]>>> = {
  camera: ['camera'],
  'grip-electric': ['lighting', 'grip'],
  art: ['set-art'],
  cast: ['cast'],
  sound: ['sound'],
  production: ['production'],
};

/**
 * "My department", and the start while nothing was chosen: the person's own layers shown and the rest dimmed; every
 * layer shown for the director, the DP, anyone with Full view (3.6c), and anyone whose departments have no layer of
 * their own (HMU, wardrobe, post, client). Nothing locked.
 */
export function myDepartmentStates(part: { fullView: boolean; departments: readonly Department[] }): PlanLayerStates {
  if (part.fullView) return ALL_SHOWN;
  const mine = new Set(part.departments.flatMap((d) => DEPARTMENT_LAYERS[d] ?? []));
  if (mine.size === 0) return ALL_SHOWN;
  return statesWith((layer) => ({ show: mine.has(layer) ? 'shown' : 'dimmed', locked: false }));
}

export const sameStates = (a: PlanLayerStates, b: PlanLayerStates): boolean => PLAN_LAYERS.every((l) => a[l].show === b[l].show && a[l].locked === b[l].locked);

/** Solo: this layer shown, every other dimmed (a hidden one too, so the plan reads around it); each keeps its lock. */
export const soloStates = (states: PlanLayerStates, layer: PlanLayer): PlanLayerStates =>
  statesWith((l) => ({ show: l === layer ? 'shown' : 'dimmed', locked: states[l].locked }));

/** Whether a layer's items can be picked: drawn (shown or dimmed) and not locked. An item with no layer always can. */
export const layerPickable = (states: PlanLayerStates, layer: PlanLayer | null): boolean => layer === null || (states[layer].show !== 'hidden' && !states[layer].locked);

/** The states with these layers shown and unlocked (placing onto one, 6.8), and which of them changed. */
export function revealedStates(states: PlanLayerStates, layers: readonly PlanLayer[]): { states: PlanLayerStates; changed: PlanLayer[] } {
  const changed = LAYER_ORDER.filter((l) => layers.includes(l) && (states[l].show === 'hidden' || states[l].locked));
  if (changed.length === 0) return { states, changed };
  return { states: statesWith((l) => (changed.includes(l) ? { show: 'shown', locked: false } : states[l])), changed };
}

/**
 * A plan item's layer for the layers' state: a door or window follows its wall's (so a hidden wall hides its openings),
 * any other item its own (itemLayer: a mark's by whether its camera link reads).
 */
export function layerOfItem(records: Records, record: SbdRecord): PlanLayer | null {
  const opening = openingFields(record.props);
  if (opening) {
    const wall = records[opening.wallId];
    if (wall?.type === 'plan_item') return itemLayer(records, wall);
  }
  return itemLayer(records, record);
}

/** How an item is drawn under its layer's state: dimmed, locked, both or neither. */
export interface LayerLook {
  dim: boolean;
  locked: boolean;
}

/**
 * A view's items under the layers' state: those drawn (a hidden layer's left out, and a door or window whose wall is),
 * and how each drawn one is dimmed or locked (only those that are). Pure, so the Plan tile memoises it.
 */
export function layeredItems(records: Records, shown: readonly ShownItem[], states: PlanLayerStates): { visible: readonly ShownItem[]; looks: ReadonlyMap<string, LayerLook> } {
  const looks = new Map<string, LayerLook>();
  const visible = shown.filter((item) => {
    const layer = layerOfItem(records, item.record);
    if (layer === null) return true;
    const state = states[layer];
    if (state.show === 'hidden') return false;
    if (state.show === 'dimmed' || state.locked) looks.set(item.record.id, { dim: state.show === 'dimmed', locked: state.locked });
    return true;
  });
  return { visible: visible.length === shown.length ? shown : visible, looks };
}

/** The ids of `ids` that can be picked under the state: a hidden or locked layer's are left out. */
export function pickableIds(records: Records, ids: readonly string[], states: PlanLayerStates): string[] {
  return ids.filter((id) => {
    const record = records[id];
    return !record || layerPickable(states, layerOfItem(records, record));
  });
}

/** How many of a view's items are on each layer. */
export function layerCounts(records: Records, shown: readonly ShownItem[]): Readonly<Record<PlanLayer, number>> {
  const counts = Object.fromEntries(PLAN_LAYERS.map((l) => [l, 0])) as Record<PlanLayer, number>;
  for (const item of shown) {
    const layer = layerOfItem(records, item.record);
    if (layer !== null) counts[layer] += 1;
  }
  return counts;
}

/** How many layers are hidden, and how many locked: the Plan tile's note. */
export const layerNote = (states: PlanLayerStates): { hidden: number; locked: number } => ({
  hidden: PLAN_LAYERS.filter((l) => states[l].show === 'hidden').length,
  locked: PLAN_LAYERS.filter((l) => states[l].locked).length,
});

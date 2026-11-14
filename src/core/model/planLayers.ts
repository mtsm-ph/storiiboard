import { DEPARTMENTS, type Department } from './department';
import { approverRoles, type ProjectRole } from './departmentStatus';
import { PLAN_LAYERS, type PlanLayer, type ShownItem } from './plan';
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

/**
 * Every row the layers' state keeps that this version knows: the department layers. The one list: 6.9 adds its
 * "Underlay" row here, and every reader of the state (reading the setting, comparing, the note) goes by it. A row a
 * newer version keeps that isn't here is carried along as stored, never read and never dropped (keepUnknownRows).
 */
export const LAYER_ROWS: readonly PlanLayer[] = PLAN_LAYERS;
export type LayerRow = PlanLayer;

export type PlanLayerStates = Readonly<Record<LayerRow, LayerState>>;

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

const statesWith = (each: (layer: LayerRow) => LayerState): PlanLayerStates =>
  Object.fromEntries(LAYER_ROWS.map((layer) => [layer, each(layer)])) as Record<LayerRow, LayerState>;

/** Every layer shown, none locked: "Show all". */
export const ALL_SHOWN: PlanLayerStates = statesWith(() => SHOWN);

const isShow = (value: unknown): value is LayerShow => typeof value === 'string' && (LAYER_SHOWS as readonly string[]).includes(value);
const isKnownRow = (key: string): boolean => (LAYER_ROWS as readonly string[]).includes(key);

/** The rows of a stored state this version doesn't know (a newer version's), as they were stored. */
const unknownRows = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => !isKnownRow(key))) : {};

/**
 * The settings' `planLayers` as kept (the migration): null when it was never set (an older settings file, or nothing
 * chosen yet), so the start follows the person's department; otherwise each layer's state, a layer missing or unreadable
 * (a newer version's value) read as shown and unlocked. A row this version doesn't know (a newer version's) is kept as
 * stored, never read, so saving any setting from an older build never erases it (6.8 review).
 */
export function planLayerStatesOf(value: unknown): PlanLayerStates | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const saved = value as Record<string, unknown>;
  const known = statesWith((layer) => {
    const entry = Object.hasOwn(saved, layer) ? saved[layer] : undefined;
    const own = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    return { show: isShow(own.show) ? own.show : 'shown', locked: own.locked === true };
  });
  return { ...unknownRows(saved), ...known };
}

/** The states to store: `states`' known rows, with the rows `stored` has that this version doesn't know, as they were. */
export function keepUnknownRows(stored: unknown, states: PlanLayerStates): PlanLayerStates {
  return { ...unknownRows(stored), ...statesWith((layer) => states[layer]) };
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

// One state object per set of own layers, so the same department always gives the same object (a reader keyed on it,
// the Plan tile's memo, builds nothing again).
const departmentStates = new Map<string, PlanLayerStates>();

/**
 * "My department", and the start while nothing was chosen: the person's own layers shown and the rest dimmed; every
 * layer shown for the director and the DP whatever their Full view switch says (the brief: they see every layer), for
 * anyone else with Full view (3.6c), and for anyone whose departments have no layer of their own (HMU, wardrobe,
 * post, client). Nothing locked.
 */
export function myDepartmentStates(part: { role?: ProjectRole | null; fullView: boolean; departments: readonly Department[] }): PlanLayerStates {
  if (part.fullView || approverRoles(part.role ?? null).length > 0) return ALL_SHOWN;
  const mine = LAYER_ORDER.filter((layer) => part.departments.some((d) => DEPARTMENT_LAYERS[d]?.includes(layer)));
  if (mine.length === 0) return ALL_SHOWN;
  const key = mine.join(',');
  const kept = departmentStates.get(key);
  if (kept) return kept;
  const made = statesWith((layer) => ({ show: mine.includes(layer) ? 'shown' : 'dimmed', locked: false }));
  departmentStates.set(key, made);
  return made;
}

export const sameStates = (a: PlanLayerStates, b: PlanLayerStates): boolean => LAYER_ROWS.every((l) => a[l].show === b[l].show && a[l].locked === b[l].locked);

/**
 * Solo: this layer shown (keeping its own lock), every other dimmed (a hidden one too, so the plan reads around it) and
 * locked (6.8 review), so nothing picks a layer the person isn't working on: Select all then Delete during a solo
 * touches only the solo layer. Ending the solo puts back the state from before it, locks and all (layersStore.ts).
 */
export const soloStates = (states: PlanLayerStates, layer: PlanLayer): PlanLayerStates =>
  statesWith((l) => (l === layer ? { show: 'shown', locked: states[l].locked } : { show: 'dimmed', locked: true }));

/** Whether a layer's items can be picked: drawn (shown or dimmed) and not locked. An item with no layer always can. */
export const layerPickable = (states: PlanLayerStates, layer: PlanLayer | null): boolean => layer === null || (states[layer].show !== 'hidden' && !states[layer].locked);

/** What revealing did to the layers it changed, for the notice's words: shown them, unlocked them, or both. */
export type Revealed = 'shown' | 'unlocked' | 'both';

/**
 * The states with these layers shown and unlocked (placing onto one, 6.8), which of them changed, and what was done to
 * them: only shown (they were hidden), only unlocked (they were locked), or both.
 */
export function revealedStates(states: PlanLayerStates, layers: readonly PlanLayer[]): { states: PlanLayerStates; changed: PlanLayer[]; did: Revealed } {
  const changed = LAYER_ORDER.filter((l) => layers.includes(l) && (states[l].show === 'hidden' || states[l].locked));
  const hid = changed.some((l) => states[l].show === 'hidden');
  const locked = changed.some((l) => states[l].locked);
  const did: Revealed = hid && locked ? 'both' : hid ? 'shown' : 'unlocked';
  if (changed.length === 0) return { states, changed, did };
  return { states: { ...states, ...statesWith((l) => (changed.includes(l) ? { show: 'shown', locked: false } : states[l])) }, changed, did };
}

/**
 * A plan item's layer for the layers' state: its own (itemLayer: a mark's by whether its camera link reads). A door or
 * window needs no reading of its wall: walls, doors and windows are all the set's layer by what they are (planItemLayer),
 * so a hidden wall hides its openings with it (6.8 review, L13: the branch that read the wall's could never differ).
 */
export const layerOfItem = (records: Records, record: SbdRecord): PlanLayer | null => itemLayer(records, record);

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

type Layered = ReturnType<typeof layeredItems>;

/**
 * layeredItems kept as it was while nothing it reads changed (6.8 review, L12): the same shown items, the same states,
 * and each mark on the same layer. A mark is the one item whose layer reads other records (its camera's, through
 * markLayer); every other item's comes from its own props, which the same shown items carry. So an edit elsewhere in
 * the project gives back the very same visible list and looks, and nothing after them (the canvas items, the move
 * constraint, the tests' data) is worked out again.
 */
export function layeredItemsKeeper(): (records: Records, shown: readonly ShownItem[], states: PlanLayerStates) => Layered {
  let last: { shown: readonly ShownItem[]; states: PlanLayerStates; marks: readonly (PlanLayer | null)[]; result: Layered } | null = null;
  return (records, shown, states) => {
    const marks = shown.flatMap((item) => (item.record.props.kind === 'mark' ? [layerOfItem(records, item.record)] : []));
    if (last && last.shown === shown && last.states === states && last.marks.length === marks.length && marks.every((l, i) => l === last?.marks[i])) return last.result;
    last = { shown, states, marks, result: layeredItems(records, shown, states) };
    return last.result;
  };
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
  hidden: LAYER_ROWS.filter((l) => states[l].show === 'hidden').length,
  locked: LAYER_ROWS.filter((l) => states[l].locked).length,
});

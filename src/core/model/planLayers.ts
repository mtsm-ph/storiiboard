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

/** The underlay's own row (6.9, decision 12): never a department's, and never one of the keys 1 to 7. */
export const UNDERLAY_ROW = 'underlay';

/**
 * Every row the layers' state keeps that this version knows: the department layers, then the underlay's (6.9). The one
 * list: every reader of the state (reading the setting, comparing) goes by it. A row a newer version keeps that isn't
 * here is carried along as stored, never read and never dropped (keepUnknownRows).
 */
export const LAYER_ROWS: readonly LayerRow[] = [...PLAN_LAYERS, UNDERLAY_ROW];
export type LayerRow = PlanLayer | typeof UNDERLAY_ROW;

export type PlanLayerStates = Readonly<Record<LayerRow, LayerState>>;

/**
 * The underlay's row until it is changed (decision 12): dimmed and locked, so walls are traced over the picture and a
 * click never picks it. A department layer's is shown and unlocked.
 */
export const UNDERLAY_START: LayerState = { show: 'dimmed', locked: true };
const startOf = (row: LayerRow): LayerState => (row === UNDERLAY_ROW ? UNDERLAY_START : SHOWN_ROW);
const SHOWN_ROW: LayerState = { show: 'shown', locked: false };

/** A row's state, its start when a state object lacks it (one built before 6.9, a test's). */
export const rowState = (states: PlanLayerStates, row: LayerRow): LayerState => (states as Partial<Record<LayerRow, LayerState>>)[row] ?? startOf(row);

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

const statesWith = (each: (layer: LayerRow) => LayerState): PlanLayerStates =>
  Object.fromEntries(LAYER_ROWS.map((layer) => [layer, each(layer)])) as Record<LayerRow, LayerState>;

/**
 * Every department layer shown, none locked ("Show all"), and the underlay's row at its start (6.9). "Show all" applies
 * it to the department rows only: the underlay keeps the state it has (layersStore.ts), so it is never unlocked by
 * surprise while walls are traced over it.
 */
export const ALL_SHOWN: PlanLayerStates = statesWith(startOf);

/** The department rows of a state, to spread over another and leave its underlay row as it is. */
export const departmentRows = (states: PlanLayerStates): Partial<Record<LayerRow, LayerState>> => Object.fromEntries(PLAN_LAYERS.map((l) => [l, rowState(states, l)]));

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
    // The underlay's row missing (settings from 6.8) is its start, dimmed and locked; a department's, shown.
    if (typeof entry !== 'object' || entry === null) return startOf(layer);
    const own = entry as Record<string, unknown>;
    const start = startOf(layer);
    return { show: isShow(own.show) ? own.show : start.show, locked: typeof own.locked === 'boolean' ? own.locked : start.locked };
  });
  return { ...unknownRows(saved), ...known };
}

/** The states to store: `states`' known rows, with the rows `stored` has that this version doesn't know, as they were. */
export function keepUnknownRows(stored: unknown, states: PlanLayerStates): PlanLayerStates {
  return { ...unknownRows(stored), ...statesWith((layer) => rowState(states, layer)) };
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
  // The underlay's row at its start: "My department" is about the department layers.
  const made = statesWith((layer) => (layer === UNDERLAY_ROW ? UNDERLAY_START : { show: mine.includes(layer) ? 'shown' : 'dimmed', locked: false }));
  departmentStates.set(key, made);
  return made;
}

export const sameStates = (a: PlanLayerStates, b: PlanLayerStates): boolean =>
  LAYER_ROWS.every((l) => rowState(a, l).show === rowState(b, l).show && rowState(a, l).locked === rowState(b, l).locked);

/**
 * Solo: this layer shown (keeping its own lock), every other row dimmed (a hidden one too, so the plan reads around it)
 * and locked (6.8 review), the underlay's too (6.9), so nothing picks a layer the person isn't working on: Select all
 * then Delete during a solo touches only the solo layer. Ending the solo puts back the state from before it, locks and
 * all (layersStore.ts).
 */
export const soloStates = (states: PlanLayerStates, layer: PlanLayer): PlanLayerStates =>
  statesWith((l) => (l === layer ? { show: 'shown', locked: rowState(states, l).locked } : { show: 'dimmed', locked: true }));

/** Whether a row's items can be picked: drawn (shown or dimmed) and not locked. An item with no layer always can. */
export const layerPickable = (states: PlanLayerStates, layer: LayerRow | null): boolean => layer === null || (rowState(states, layer).show !== 'hidden' && !rowState(states, layer).locked);

/** What revealing did to the layers it changed, for the notice's words: shown them, unlocked them, or both. */
export type Revealed = 'shown' | 'unlocked' | 'both';

/**
 * The states with these layers shown and unlocked (placing onto one, 6.8), which of them changed, and what was done to
 * them: only shown (they were hidden), only unlocked (they were locked), or both.
 */
export function revealedStates(states: PlanLayerStates, layers: readonly LayerRow[]): { states: PlanLayerStates; changed: LayerRow[]; did: Revealed } {
  const changed = ROW_ORDER.filter((l) => layers.includes(l) && (rowState(states, l).show === 'hidden' || rowState(states, l).locked));
  const hid = changed.some((l) => rowState(states, l).show === 'hidden');
  const locked = changed.some((l) => rowState(states, l).locked);
  const did: Revealed = hid && locked ? 'both' : hid ? 'shown' : 'unlocked';
  if (changed.length === 0) return { states, changed, did };
  return { states: { ...states, ...statesWith((l) => (changed.includes(l) ? { show: 'shown', locked: false } : rowState(states, l))) }, changed, did };
}

/** The Layers tile's rows top to bottom: the department layers in call-sheet order, then the underlay's (6.9). */
export const ROW_ORDER: readonly LayerRow[] = [...LAYER_ORDER, UNDERLAY_ROW];

/**
 * A plan item's row for the layers' state: an underlay's own (6.9); any other's its layer (itemLayer: a mark's by whether
 * its camera link reads). A door or window needs no reading of its wall: walls, doors and windows are all the set's
 * layer by what they are (planItemLayer), so a hidden wall hides its openings with it (6.8 review, L13).
 */
export const layerOfItem = (records: Records, record: SbdRecord): LayerRow | null => (record.props.kind === 'underlay' ? UNDERLAY_ROW : itemLayer(records, record));

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
    const state = rowState(states, layer);
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
  let last: { shown: readonly ShownItem[]; states: PlanLayerStates; marks: readonly (LayerRow | null)[]; result: Layered } | null = null;
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

/** How many of a view's items are on each row, the underlay's too (6.9). */
export function layerCounts(records: Records, shown: readonly ShownItem[]): Readonly<Record<LayerRow, number>> {
  const counts = Object.fromEntries(LAYER_ROWS.map((l) => [l, 0])) as Record<LayerRow, number>;
  for (const item of shown) {
    const layer = layerOfItem(records, item.record);
    if (layer !== null) counts[layer] += 1;
  }
  return counts;
}

/**
 * How many rows are hidden, and how many department layers locked: the Plan tile's note. The underlay's lock isn't
 * counted (6.9): it starts locked, so the note would never go away; hidden, it is, so a missing picture isn't a mystery.
 */
export const layerNote = (states: PlanLayerStates): { hidden: number; locked: number } => ({
  hidden: LAYER_ROWS.filter((l) => rowState(states, l).show === 'hidden').length,
  locked: PLAN_LAYERS.filter((l) => rowState(states, l).locked).length,
});

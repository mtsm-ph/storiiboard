import type { Change } from '../ops/ops';
import { keyAfterKeys } from '../ops/order';
import {
  BOARD_GRID_KEY,
  boardGridOf,
  CANVAS_VIEW_KEY,
  canvasViewsOf,
  cleanProfileText,
  CLOSE_BACKUP_FAILED_KEY,
  customWorkspacesOf,
  departmentWorkspacesOf,
  isThemePreference,
  MAX_CUSTOM_WORKSPACES,
  MAX_PROFILE_NAME,
  SETTINGS_KEY,
  TRACKPAD_MODE_KEY,
  type BoardGrid,
  type CanvasViews,
  type SavedCustomWorkspace,
  type Settings,
  type ThemePreference,
} from '../storage/settings';
import { DEPARTMENTS, isDepartment, type Department } from './department';
import { LAYER_SHOWS, planLayerStatesOf, ROW_ORDER, type PlanLayerStates } from './planLayers';
import type { Props, SbdRecord } from './record';

// Settings presets (6.5.8, Kevin, Nov 16): a named set of this computer's look-and-layout settings, kept as a
// `settings_preset` record under the project so it travels with the file. A preset travels to other people with the
// project too, so it holds look and layout only, never what follows a person's computer or region, how their work is
// protected, or who they are. The one list of what a preset holds is PRESET_FIELDS; nothing outside it is ever saved or
// applied, and NEVER_IN_PRESET names every other setting with the reason (a test walks both against every setting).
//
// A preset is read as untrusted input: it may come from another computer, a newer version or a hand-edited file. Every
// field goes back through its own reader; a field this version doesn't know is skipped and named, one it can't read is
// dropped and named, and neither changes anything on this computer.

/** A workspace of the person's own as a preset holds it: `layout` as current, and `saved` only where it differs. */
export interface PresetWorkspace extends SavedCustomWorkspace {
  saved?: unknown;
}

/** What a preset holds, each in the form its own reader gives. */
export interface PresetSettings {
  theme: ThemePreference;
  /** Kept with the theme, which reads `system` as chosen only with it (settings.ts); applying a theme always chooses it. */
  themeChosen: boolean;
  /** Paper or Dark for plans and for boards (6.5.1), from `storiiboard.canvasView`. */
  canvasViews: CanvasViews;
  /** The boards' dot grid and its snap (6.5.7a), from `storiiboard.boardGrid`. */
  boardGrid: BoardGrid;
  /**
   * The person's own workspaces (3.6d): id, name, its tiles' numbering, and what the person sees (round 4): `layout`, its
   * CURRENT layout in the layout store (else the one it was made from), and `saved`, its saved layout where that differs.
   */
  customWorkspaces: PresetWorkspace[];
  /** The department workspaces the sidebar lists (3.6a). */
  departmentWorkspaces: Department[];
  /** The plan's layer states (6.8); null while they follow the person's department. */
  planLayers: PlanLayerStates | null;
  /** Scene palettes in the storyboard PDF (polish PP). */
  pdfScenePalettes: boolean;
}

export type PresetField = keyof PresetSettings;

/** The one list: every field a preset holds, in the order its differences are listed. */
export const PRESET_FIELDS = [
  'theme',
  'themeChosen',
  'canvasViews',
  'boardGrid',
  'customWorkspaces',
  'departmentWorkspaces',
  'planLayers',
  'pdfScenePalettes',
] as const satisfies readonly PresetField[];

/** Where each preset field is kept on this computer: a key of the settings object, or a storage key of its own. */
export const PRESET_SOURCES: Readonly<Record<PresetField, { setting: keyof Settings } | { storageKey: string }>> = {
  theme: { setting: 'theme' },
  themeChosen: { setting: 'themeChosen' },
  canvasViews: { storageKey: CANVAS_VIEW_KEY },
  boardGrid: { storageKey: BOARD_GRID_KEY },
  customWorkspaces: { setting: 'customWorkspaces' },
  departmentWorkspaces: { setting: 'departmentWorkspaces' },
  planLayers: { setting: 'planLayers' },
  pdfScenePalettes: { setting: 'pdfScenePalettes' },
};

/**
 * Every setting a preset never holds, with why. Settings' keys by name; settings under keys of their own by the key.
 * A setting added later goes in this list or in PRESET_FIELDS, or settingsPreset.test.ts fails.
 */
export const NEVER_IN_PRESET: Readonly<Record<string, string>> = {
  language: 'Follows each person; a preset travels to other people with the project.',
  weekStart: 'Follows each computer’s region.',
  weatherUnits: 'Follows each computer’s region.',
  planUnits: 'Follows each computer’s region.',
  callSheetPaper: 'Follows each computer’s region.',
  directionsApp: 'Each person’s own map app.',
  backups: 'A preset never changes how someone’s work is protected.',
  backupsNextToProject: 'A preset never changes how someone’s work is protected.',
  profile: 'Who the person is: name, initials, role, initials in History.',
  projectRoles: 'The person’s role in each project.',
  projectSelves: 'Who the person is in each project’s Cast and crew.',
  companies: 'The person’s saved company profiles, with their details.',
  syncNoted: 'This computer’s bookkeeping: projects already told they are in a synced folder (paths).',
  tilesOffered: 'This computer’s bookkeeping: tiles already offered to a saved layout.',
  sidebarHidden: 'This computer’s bookkeeping: the sidebar folded.',
  [TRACKPAD_MODE_KEY]: 'How this computer’s pointing device reads the wheel (Kevin, Nov 16: stays out).',
  'storiiboard.layouts.2': 'The built-in and department workspaces’ layouts as arranged on this computer, and every layout undo: never in a preset, never touched by one. A workspace of the person’s own travels whole in customWorkspaces, its layout as arranged.',
  'storiiboard.board-view': 'The Storyboard tile’s Grid or List view on this computer; not in the preset’s list.',
};

/**
 * Settings shown in Settings but never kept themselves, worked out from ones that are, with why: never in a preset either.
 * Not keys of the settings object, so they're listed here rather than in NEVER_IN_PRESET, and what they're read from is.
 */
export const WORKED_OUT_NEVER_IN_PRESET: Readonly<Record<string, { from: readonly (keyof Settings)[]; reason: string }>> = {
  measurementSystem: {
    from: ['weatherUnits', 'planUnits'],
    reason: 'The Measurement system (Kevin, Nov 18) follows each computer’s region, as the two units it is read from do; it is never stored.',
  },
};

/** Storage keys the app writes that are not a setting of their own, with why. */
export const NOT_A_SETTING: Readonly<Record<string, string>> = {
  [SETTINGS_KEY]: 'The settings object itself: its keys are walked one by one.',
  'storiiboard.app-data': 'The browser build’s stand-in for app data files: recent projects, never in a preset.',
  'storiiboard.memory-files': 'Projects kept in the page by the dev-only memory build.',
  [CLOSE_BACKUP_FAILED_KEY]: 'A failed backup at a project’s close, said once when that project next opens: a note.',
  'storiiboard.changes': 'A change file’s format name (7.1, src/core/storage/changeFile.ts), not a storage key: nothing is kept under it.',
  'storiiboard.suggestions-folder':
    'A Suggestions folder’s marker format (7.1; written by the MCP server in 7.6, mcp/src/changeFolder.ts), not a storage key: nothing is kept under it.',
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isKnownField = (key: string): key is PresetField => (PRESET_FIELDS as readonly string[]).includes(key);
/** Exactly these keys, each there: a part this version doesn't know makes the whole field unreadable here. */
const hasExactly = (value: Record<string, unknown>, keys: readonly string[], optional: readonly string[] = []): boolean =>
  keys.every((k) => Object.hasOwn(value, k)) && Object.keys(value).every((k) => keys.includes(k) || optional.includes(k));

/** The whole `settings` value, as JSON, at most this many bytes; past it the preset isn't read at all. */
export const MAX_PRESET_BYTES = 512 * 1024;

/** A workspace's layout from a preset, rebuilt within these bounds (round 3), so no untrusted shape reaches the shell. */
export const LAYOUT_LIMITS = { depth: 16, stacks: 64, tiles: 200, idLength: 100, children: 64 } as const;

/** A node id as kept: text, short. */
const isNodeId = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= LAYOUT_LIMITS.idLength;

/**
 * A layout from a preset rebuilt clean: only the known keys of each node, at most LAYOUT_LIMITS deep and wide, each tile
 * once and only tiles this version knows (`isTile`). Null when any part can't be read so: the workspace is then unusable
 * here. Depth-limited, and every array's length is checked before it is walked, so an untrusted shape costs little.
 */
export function cleanLayout(value: unknown, isTile: (id: string) => boolean): Record<string, unknown> | null {
  if (!isPlainObject(value) || !hasExactly(value, ['root', 'maximized'])) return null;
  const { maximized } = value;
  if (maximized !== null && !isNodeId(maximized)) return null;
  const seen = new Set<string>();
  const ids = new Set<string>();
  // Maximized names a stack, never a split (round 4).
  const stackIds = new Set<string>();
  let stacks = 0;
  const node = (raw: unknown, depth: number): Record<string, unknown> | null => {
    if (depth > LAYOUT_LIMITS.depth || !isPlainObject(raw) || !isNodeId(raw.id) || ids.has(raw.id)) return null;
    ids.add(raw.id);
    if (raw.kind === 'stack') {
      const { tiles, active } = raw;
      if (!hasExactly(raw, ['kind', 'id', 'tiles', 'active']) || !Array.isArray(tiles) || tiles.length === 0) return null;
      stacks += 1;
      stackIds.add(raw.id);
      if (stacks > LAYOUT_LIMITS.stacks || seen.size + tiles.length > LAYOUT_LIMITS.tiles) return null;
      const kept: string[] = [];
      for (const tile of tiles as unknown[]) {
        if (typeof tile !== 'string' || seen.has(tile) || !isTile(tile)) return null;
        seen.add(tile);
        kept.push(tile);
      }
      if (typeof active !== 'string' || !kept.includes(active)) return null;
      return { kind: 'stack', id: raw.id, tiles: kept, active };
    }
    if (raw.kind !== 'split' || !hasExactly(raw, ['kind', 'id', 'direction', 'children', 'sizes'])) return null;
    const { direction, children, sizes } = raw;
    if (direction !== 'row' && direction !== 'column') return null;
    if (!Array.isArray(children) || !Array.isArray(sizes) || children.length < 2 || children.length > LAYOUT_LIMITS.children || children.length !== sizes.length) return null;
    if (!(sizes as unknown[]).every((s) => typeof s === 'number' && Number.isFinite(s) && s > 0)) return null;
    const kids: Record<string, unknown>[] = [];
    for (const child of children as unknown[]) {
      const made = node(child, depth + 1);
      if (!made) return null;
      kids.push(made);
    }
    return { kind: 'split', id: raw.id, direction, children: kids, sizes: [...(sizes as number[])] };
  };
  const root = node(value.root, 1);
  if (!root || (maximized !== null && !stackIds.has(maximized))) return null;
  return { root, maximized };
}

/** The person's own workspaces from a preset, every one readable, or null: one unusable workspace leaves the whole list as it is. */
function presetWorkspacesOf(value: unknown, isTile: (id: string) => boolean): PresetWorkspace[] | null {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_WORKSPACES) return null;
  const kept: PresetWorkspace[] = [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    if (!isPlainObject(entry) || !hasExactly(entry, ['id', 'name', 'layout'], ['order', 'saved'])) return null;
    const { id, name, order } = entry;
    const clean = typeof name === 'string' ? cleanProfileText(name, MAX_PROFILE_NAME) : '';
    if (typeof id !== 'string' || !/^custom-[0-9a-f-]{8,64}$/.test(id) || seen.has(id) || clean === '') return null;
    const layout = cleanLayout(entry.layout, isTile);
    if (!layout) return null;
    // Its saved layout where it differs from the current one, cleaned the same way, within the same bounds.
    const saved = entry.saved === undefined ? undefined : cleanLayout(entry.saved, isTile);
    if (saved === null) return null;
    let numbering: string[] | undefined;
    if (order !== undefined) {
      if (!Array.isArray(order) || order.length > LAYOUT_LIMITS.tiles) return null;
      if (!(order as unknown[]).every((tile) => typeof tile === 'string' && isTile(tile))) return null;
      numbering = [...new Set(order as string[])];
    }
    seen.add(id);
    kept.push({ id, name: clean, layout, ...(numbering ? { order: numbering } : {}), ...(saved ? { saved } : {}) });
  }
  // Through the settings' own reader too, so a preset's list is never one the settings would read otherwise.
  return customWorkspacesOf(kept).length === kept.length ? kept : null;
}

/** The plan's layers from a preset: null, or only the rows this version knows, each read whole; any bad row leaves them as they are. */
function presetLayersOf(value: unknown): PlanLayerStates | null | undefined {
  if (value === null) return null;
  if (!isPlainObject(value)) return undefined;
  const known: Record<string, unknown> = {};
  for (const row of ROW_ORDER) {
    if (!Object.hasOwn(value, row)) continue;
    const state = value[row];
    if (!isPlainObject(state) || !hasExactly(state, ['show', 'locked']) || !(LAYER_SHOWS as readonly unknown[]).includes(state.show) || typeof state.locked !== 'boolean') return undefined;
    known[row] = { show: state.show, locked: state.locked };
  }
  // Rows this version doesn't know are never written to this computer from a preset.
  return planLayerStatesOf(known) ?? undefined;
}

/** One field read whole; undefined when any part of it can't be read here, so the setting stays exactly as it is. */
function fieldOf<K extends PresetField>(key: K, value: unknown, isTile: (id: string) => boolean): PresetSettings[K] | undefined {
  const read = (): PresetSettings[PresetField] | null | undefined => {
    switch (key) {
      case 'theme':
        return isThemePreference(value) ? value : undefined;
      case 'themeChosen':
      case 'pdfScenePalettes':
        return typeof value === 'boolean' ? value : undefined;
      case 'canvasViews': {
        const isView = (v: unknown) => v === 'paper' || v === 'dark';
        return isPlainObject(value) && hasExactly(value, ['plan', 'board']) && isView(value.plan) && isView(value.board) ? canvasViewsOf(value) : undefined;
      }
      case 'boardGrid':
        return isPlainObject(value) && hasExactly(value, ['boardGrid', 'boardGridSnap']) && typeof value.boardGrid === 'boolean' && typeof value.boardGridSnap === 'boolean'
          ? boardGridOf(value)
          : undefined;
      case 'customWorkspaces':
        return presetWorkspacesOf(value, isTile) ?? undefined;
      case 'departmentWorkspaces':
        return Array.isArray(value) && value.length <= DEPARTMENTS.length * 4 && (value as unknown[]).every(isDepartment) ? departmentWorkspacesOf(value) : undefined;
      case 'planLayers':
        return presetLayersOf(value);
    }
    return undefined;
  };
  return read() as PresetSettings[K] | undefined;
}

/** A field name from a file, as it may be shown: cleaned as a name is, never a control character or a direction flip. */
const shownName = (key: string): string => cleanProfileText(key, MAX_PROFILE_NAME) || '?';

/** At most this many skipped names are listed; the rest are counted in. */
const MAX_SKIPPED_SHOWN = 20;

export interface ReadPreset {
  /** The fields this version knows and could read whole, each through its reader. */
  settings: Partial<PresetSettings>;
  /** Fields this version doesn't know (a newer version's), by name: never applied. */
  skipped: string[];
  /** Fields it knows but couldn't read whole: never applied, so the setting stays exactly as it is. */
  dropped: PresetField[];
  /** Over MAX_PRESET_BYTES, or not even JSON: nothing in it is read or applied. */
  tooLarge: boolean;
}

/** Its size as JSON in bytes, or null when it can't be written as JSON at all (too deep, say). */
function jsonBytes(value: unknown): number | null {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return null;
  }
}

/**
 * A preset's `settings` as this version reads it, bounded and cleaned before anything is shown or written. Anything but
 * an object holds nothing. `isTile`: whether this version has a tile of that id (the shell's list), for the layouts.
 */
export function presetSettingsOf(value: unknown, isTile: (id: string) => boolean = () => false): ReadPreset {
  const settings: Partial<Record<PresetField, unknown>> = {};
  const skipped: string[] = [];
  const dropped: PresetField[] = [];
  if (!isPlainObject(value)) return { settings: {}, skipped, dropped, tooLarge: false };
  const bytes = jsonBytes(value);
  if (bytes === null || bytes > MAX_PRESET_BYTES) return { settings: {}, skipped, dropped, tooLarge: true };
  let unknown = 0;
  for (const [key, raw] of Object.entries(value)) {
    if (!isKnownField(key)) {
      unknown += 1;
      if (skipped.length < MAX_SKIPPED_SHOWN) skipped.push(shownName(key));
      continue;
    }
    const read = fieldOf(key, raw, isTile);
    if (read === undefined) dropped.push(key);
    else settings[key] = read;
  }
  if (unknown > skipped.length) skipped.push(`+${String(unknown - skipped.length)}`);
  return { settings: settings as Partial<PresetSettings>, skipped, dropped, tooLarge: false };
}

/** Only the listed fields, in the list's order: what a preset's `settings` prop is written as. */
export function presetSettingsProp(settings: PresetSettings): Props {
  const kept: Record<string, unknown> = {};
  for (const field of PRESET_FIELDS) kept[field] = settings[field];
  // Through JSON, so what's stored is plain data whatever the reader handed over.
  return JSON.parse(JSON.stringify(kept)) as Props;
}

/** A preset's name as kept: cleaned as a workspace's name is, at most MAX_PROFILE_NAME characters. */
export const cleanPresetName = (name: string): string => cleanProfileText(name, MAX_PROFILE_NAME);

/** A preset record as the app reads it. */
export interface Preset {
  id: string;
  name: string;
  record: SbdRecord;
}

/** This project's presets, not in the Trash, in the order they were made. */
export function presetsOf(records: Readonly<Record<string, SbdRecord>>, projectId: string): Preset[] {
  return Object.values(records)
    .filter((r) => r.type === 'settings_preset' && r.parentId === projectId && r.trashedAt === null)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id.localeCompare(b.id)))
    .map((record) => ({ id: record.id, name: typeof record.props.name === 'string' ? cleanPresetName(record.props.name) : '', record }));
}

const sameName = (a: string, b: string): boolean => cleanPresetName(a).toLocaleLowerCase() === cleanPresetName(b).toLocaleLowerCase();

/** The preset of this project with this name, as a person reads names (case aside), or null. */
export function presetNamed(records: Readonly<Record<string, SbdRecord>>, projectId: string, name: string): Preset | null {
  return presetsOf(records, projectId).find((p) => sameName(p.name, name)) ?? null;
}

/**
 * Saving under a name: a new preset last in the list, or the one already called that with its settings replaced (the
 * caller has asked "Replace [name]?"). One op either way. Nothing for an empty name.
 */
export function savePresetChanges(records: Readonly<Record<string, SbdRecord>>, projectId: string, name: string, settings: PresetSettings): Change[] {
  const clean = cleanPresetName(name);
  if (clean === '' || !records[projectId]) return [];
  const same = presetNamed(records, projectId, clean);
  const prop = presetSettingsProp(settings);
  if (same) return [{ kind: 'update', id: same.id, set: { name: clean, settings: prop } }];
  const keys = Object.values(records)
    .filter((r) => r.type === 'settings_preset' && r.parentId === projectId)
    .map((r) => r.sortKey);
  return [{ kind: 'create', record: { type: 'settings_preset', parentId: projectId, sortKey: keyAfterKeys(keys), props: { name: clean, settings: prop } } }];
}

/** A new name for a preset; nothing when it's empty, the same, or another preset's. */
export function renamePresetChanges(records: Readonly<Record<string, SbdRecord>>, projectId: string, id: string, name: string): Change[] {
  const clean = cleanPresetName(name);
  const preset = presetsOf(records, projectId).find((p) => p.id === id);
  if (!preset || clean === '' || clean === preset.name) return [];
  const other = presetNamed(records, projectId, clean);
  if (other && other.id !== id) return [];
  return [{ kind: 'update', id, set: { name: clean } }];
}

/**
 * Deleting a preset: a trash op, so it's in History and undo brings it back. A preset is never content: the Trash tile
 * doesn't list it and Empty Trash doesn't count or delete it (only the kinds people delete to the Trash are; ops.ts).
 */
export function deletePresetChanges(records: Readonly<Record<string, SbdRecord>>, projectId: string, id: string): Change[] {
  return presetsOf(records, projectId).some((p) => p.id === id) ? [{ kind: 'trash', id }] : [];
}

/** "Before " + name + any words after, the name cut so the whole fits MAX_PROFILE_NAME; `tag` (" 2") kept whole at the end. */
function beforeOf(name: string, words: (name: string) => string, tag = ''): string {
  const [head = '', tail = ''] = words('\u0000').split('\u0000');
  const room = MAX_PROFILE_NAME - Array.from(head).length - Array.from(tail).length - Array.from(tag).length;
  const cut = Array.from(name).slice(0, Math.max(0, room)).join('').trimEnd();
  return cleanPresetName(`${head}${cut}${tail}${tag}`);
}

/**
 * The name a preset's "Before" is kept under when applying it (round 3): the Before words with the name, cut so the
 * whole fits 60 characters. Where cutting makes two presets' Befores the same, the presets share it in the order they
 * were made, the second's " 2", the third's " 3"; and a number is added too where it would be the preset's own name,
 * so applying never overwrites the preset being applied or another preset's Before. Worked out from the names alone, so
 * applying the same preset again finds the same Before and replaces it. `words`: the Before words, in the language now.
 */
export function beforePresetName(records: Readonly<Record<string, SbdRecord>>, projectId: string, presetId: string, words: (name: string) => string): string {
  const all = presetsOf(records, projectId);
  const me = all.find((p) => p.id === presetId);
  if (!me) return beforeOf('', words);
  const base = beforeOf(me.name, words);
  // Every live preset whose own Before would read the same, the Befores among them left out (a "Before" preset's
  // Before starts with the words twice, so it never reads as its source's).
  const sharing = all.filter((p) => sameName(beforeOf(p.name, words), base));
  const rank = sharing.findIndex((p) => p.id === presetId);
  for (let n = rank + 1; ; n += 1) {
    const name = n === 1 ? base : beforeOf(me.name, words, ` ${String(n)}`);
    const taken = all.find((p) => sameName(p.name, name));
    // Never the preset itself, nor another preset's own Before (one sharing this base under another rank).
    const ownedByAnother = sharing.some((p, i) => p.id !== presetId && i !== rank && sameName(beforeOf(p.name, words, i === 0 ? '' : ` ${String(i + 1)}`), name));
    if (!sameName(name, me.name) && taken?.id !== presetId && !ownedByAnother) return name;
  }
}

/** The first "Preset N" no preset of this project is called yet. */
export function nextPresetName(records: Readonly<Record<string, SbdRecord>>, projectId: string, nameFor: (n: number) => string): string {
  for (let n = 1; ; n += 1) {
    const name = nameFor(n);
    if (!presetNamed(records, projectId, name)) return name;
  }
}

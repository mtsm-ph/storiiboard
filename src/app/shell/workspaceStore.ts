import { createStore } from 'zustand/vanilla';
import { t } from '../../core/i18n';
import { useStore } from 'zustand';
import { DEPARTMENTS, type Department } from '../../core/model/department';
import { cleanProfileText, loadSettings, MAX_CUSTOM_WORKSPACES, MAX_PROFILE_NAME, saveSettings, type SavedCustomWorkspace } from '../../core/storage/settings';
import { layoutStore, usable } from './docking/layoutStore';
import { tilesIn, type Layout, type TileId } from './docking/layout';
import {
  departmentOf,
  departmentWorkspaceId,
  isCustomWorkspaceId,
  newCustomWorkspaceId,
  registerCustomWorkspaces,
  TILES,
  type CustomWorkspace,
  type CustomWorkspaceId,
  type WorkspaceId,
} from './workspaces';

// Which workspace is on screen, which department workspaces the sidebar lists (3.6a), and the person's own workspaces
// (3.6d). The workspace on screen is where the person is, never saved; the lists are theirs, kept in this computer's
// settings as their layouts are, so every project shows the same ones.

interface WorkspaceState {
  active: WorkspaceId;
  departments: readonly Department[];
  customs: readonly CustomWorkspace[];
}

/** The person's own workspaces as saved, those this version can lay out. */
function customsOf(saved: readonly SavedCustomWorkspace[]): CustomWorkspace[] {
  return saved.flatMap((entry) => {
    const layout = usable(entry.layout);
    if (!isCustomWorkspaceId(entry.id) || !layout) return [];
    return [{ id: entry.id, name: entry.name, layout, order: orderOf(entry.order, layout) }];
  });
}

/** A saved numbering, the tiles this version has; the layout's own order when there's none. */
function orderOf(value: unknown, layout: Layout): TileId[] {
  const tiles = tilesIn(layout);
  const saved = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && Object.hasOwn(TILES, v)) : [];
  return saved.length > 0 ? saved : tiles;
}

const initialCustoms = customsOf(loadSettings().customWorkspaces);
registerCustomWorkspaces(initialCustoms);

export const workspaceStore = createStore<WorkspaceState>()(() => ({
  active: 'storyboard',
  departments: loadSettings().departmentWorkspaces,
  customs: initialCustoms,
}));

function setCustoms(customs: readonly CustomWorkspace[]): void {
  saveSettings({ customWorkspaces: customs.map((c) => ({ id: c.id, name: c.name, layout: c.layout, order: [...c.order] })) });
  registerCustomWorkspaces(customs);
  workspaceStore.setState({ customs });
}

/** Whether another workspace of the person's own can be made: at most MAX_CUSTOM_WORKSPACES. */
export const canAddCustomWorkspace = (): boolean => workspaceStore.getState().customs.length < MAX_CUSTOM_WORKSPACES;

/**
 * A new workspace of the person's own (3.6d), made from a layout (the one on screen, or another workspace's), last in
 * the sidebar's list. Reset to default layout brings that layout back. Null when there are too many, or no name.
 */
export function createCustomWorkspace(name: string, layout: Layout, order: readonly TileId[] = tilesIn(layout)): CustomWorkspaceId | null {
  const trimmed = cleanProfileText(name, MAX_PROFILE_NAME);
  if (trimmed === '' || !canAddCustomWorkspace()) return null;
  const id = newCustomWorkspaceId();
  const copy = structuredClone({ ...layout, maximized: null });
  setCustoms([...workspaceStore.getState().customs, { id, name: trimmed, layout: copy, order: [...order] }]);
  layoutStore.getState().add(id, copy);
  return id;
}

/** "<name> copy", the name cut first when the whole would pass the cap, so the copy still says it's one. */
export function copyNameOf(label: string): string {
  const full = t('manageWorkspaces.copyName', { name: label });
  const over = Array.from(full).length - MAX_PROFILE_NAME;
  return over > 0 ? t('manageWorkspaces.copyName', { name: Array.from(label).slice(0, -over).join('').trimEnd() }) : full;
}

/** A new name for one; an empty one changes nothing. */
export function renameCustomWorkspace(id: CustomWorkspaceId, name: string): void {
  const trimmed = cleanProfileText(name, MAX_PROFILE_NAME);
  const customs = workspaceStore.getState().customs;
  if (trimmed === '' || !customs.some((c) => c.id === id && c.name !== trimmed)) return;
  setCustoms(customs.map((c) => (c.id === id ? { ...c, name: trimmed } : c)));
}

/** Deletes one and its layouts. On screen, the Storyboard takes its place. Layouts are the person's: nothing in a project changes. */
export function deleteCustomWorkspace(id: CustomWorkspaceId): void {
  // Off screen first, so nothing draws a workspace whose layout is gone.
  if (workspaceStore.getState().active === id) showWorkspace('storyboard');
  setCustoms(workspaceStore.getState().customs.filter((c) => c.id !== id));
  layoutStore.getState().remove(id);
}

/** A workspace of one's own as a preset holds it (6.5.8): `layout` is its current layout, `saved` its saved one where that differs. */
export interface ArrangedWorkspace extends SavedCustomWorkspace {
  saved?: unknown;
}

/**
 * The person's own workspaces as a preset holds them (6.5.8, rounds 3 and 4): what the person sees, each one's CURRENT
 * layout in the layout store (else the one it was made from), and its saved layout where that differs, so a preset or a
 * "Before" carries an arrangement never saved with Save layout too, and shows it unsaved again.
 */
export function arrangedCustomWorkspaces(): ArrangedWorkspace[] {
  const { layouts } = layoutStore.getState();
  return workspaceStore.getState().customs.map((c) => {
    const entry = layouts[c.id];
    const current = entry?.current ?? c.layout;
    const saved = entry && JSON.stringify(entry.saved) !== JSON.stringify(current) ? { saved: structuredClone(entry.saved) } : {};
    return { id: c.id, name: c.name, layout: structuredClone(current), order: [...c.order], ...saved };
  });
}

/** A preset's workspaces as this version lays them out: each current layout and saved one through the shell's check, null for one it can't. */
function usableArranged(list: readonly ArrangedWorkspace[]): (CustomWorkspace & { saved: Layout })[] | null {
  const made = customsOf(list);
  if (made.length !== list.length) return null;
  const out: (CustomWorkspace & { saved: Layout })[] = [];
  for (const [i, custom] of made.entries()) {
    const raw = list[i]?.saved;
    const saved = raw === undefined ? custom.layout : usable(raw);
    if (!saved) return null;
    out.push({ ...custom, saved });
  }
  return out;
}

/**
 * The person's own workspaces replaced by a preset's (6.5.8, rounds 3 and 4), each layout through the shell's check
 * first. Each in the preset whose current or saved layout differs from this computer's is set to them in the layout
 * store (saved = current where the preset gives none; its layout undo cleared); an unchanged one keeps its layouts and
 * its layout undo. One this computer lacks is added; one the preset lacks leaves the screen first and goes with its
 * layouts (they are in the "Before" preset). A workspace kept keeps the layout it was made from here, for Reset to
 * default. Built-in and department workspaces' layouts are never touched.
 */
export function replaceCustomWorkspaces(list: readonly ArrangedWorkspace[]): void {
  const arranged = usableArranged(list);
  if (!arranged) return;
  const before = workspaceStore.getState().customs;
  const next = arranged.map((c) => ({ id: c.id, name: c.name, order: c.order, layout: before.find((b) => b.id === c.id)?.layout ?? c.layout }));
  const kept = new Set(next.map((c) => c.id));
  const active = workspaceStore.getState().active;
  if (isCustomWorkspaceId(active) && !kept.has(active)) showWorkspace('storyboard');
  setCustoms(next);
  for (const gone of before.filter((c) => !kept.has(c.id))) layoutStore.getState().remove(gone.id);
  for (const custom of arranged) {
    const entry = layoutStore.getState().layouts[custom.id];
    const same = entry && JSON.stringify(entry.current) === JSON.stringify(custom.layout) && JSON.stringify(entry.saved) === JSON.stringify(custom.saved);
    if (!same) layoutStore.getState().put(custom.id, structuredClone(custom.layout), structuredClone(custom.saved));
  }
}

/** The department workspaces the sidebar lists, replaced by a preset's (6.5.8); one on screen that goes leaves for the Storyboard. */
export function replaceDepartmentWorkspaces(list: readonly Department[]): void {
  const departments = saveSettings({ departmentWorkspaces: DEPARTMENTS.filter((d) => list.includes(d)) }).departmentWorkspaces;
  const active = workspaceStore.getState().active;
  const shown = departmentOf(active);
  workspaceStore.setState({ departments, active: shown !== null && !departments.includes(shown) ? 'storyboard' : active });
}

/**
 * A preset's workspaces as this version can lay them out, current and saved layouts both (saved given only where it
 * differs): what a preset compares and applies (6.5.8). An empty list when any one can't be laid out: the caller checks
 * the length, so a list is never applied in part.
 */
export const usableCustomWorkspaces = (list: readonly ArrangedWorkspace[]): ArrangedWorkspace[] =>
  (usableArranged(list) ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    layout: c.layout,
    order: [...c.order],
    ...(JSON.stringify(c.saved) === JSON.stringify(c.layout) ? {} : { saved: c.saved }),
  }));

export function useWorkspaceState<T>(select: (state: WorkspaceState) => T): T {
  return useStore(workspaceStore, select);
}

export function showWorkspace(id: WorkspaceId): void {
  workspaceStore.setState({ active: id });
}

/** Opens a department's workspace, adding it to the sidebar if it isn't there yet. */
export function openDepartmentWorkspace(department: Department): void {
  const listed = workspaceStore.getState().departments;
  if (!listed.includes(department)) {
    // In the call sheet's order, as the settings read them back, whichever was opened first.
    const departments = DEPARTMENTS.filter((d) => d === department || listed.includes(d));
    saveSettings({ departmentWorkspaces: departments });
    workspaceStore.setState({ departments });
  }
  showWorkspace(departmentWorkspaceId(department));
}

/**
 * Takes a department's workspace off the sidebar. Its layout stays, for the next time it's opened. On screen, the
 * Storyboard takes its place, since that's where its frames are.
 */
export function closeDepartmentWorkspace(department: Department): void {
  const listed = workspaceStore.getState().departments;
  const departments = saveSettings({ departmentWorkspaces: listed.filter((d) => d !== department) }).departmentWorkspaces;
  const active = workspaceStore.getState().active;
  workspaceStore.setState({ departments, active: departmentOf(active) === department ? 'storyboard' : active });
}

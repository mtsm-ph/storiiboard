import { split, stack, type Layout, type TileId } from './docking/layout';

// The four saved workspaces and their default layouts, taken from the design boards in the kit (04_Design_Source),
// sized for the boards' 1440px. People rearrange them by docking (D2); the tiles stay empty until each tool's phase
// fills them. D3 turns the workspaces into the sidebar's sections.

export type WorkspaceId = 'storyboard' | 'production' | 'birdseye' | 'callsheet';

export interface TileInfo {
  title: string;
  /** What will live here, and when. */
  note: string;
}

/** Every tile, by an id unique across workspaces, so any tile can open in any workspace. */
export const TILES: Readonly<Record<TileId, TileInfo>> = {
  scenes: { title: 'Scenes', note: 'Scene list from script import. Phase 1.' },
  board: { title: 'Storyboard', note: 'Frames by scene, auto shot numbers. Phase 1.' },
  inspector: { title: 'Frame inspector', note: 'Shot size, lens, T-stop, status. Phase 1.' },
  player: { title: 'Player', note: 'Proxy playback, in and out, capture. Phase 2.' },
  moodboard: { title: 'Moodboard', note: 'Department boards and references. Phase 6.' },
  gear: { title: 'Gear', note: 'Packages per shoot day, linked to shots. Phase 3.' },
  locations: { title: 'Locations', note: 'Addresses, contacts, parking, power. Phase 3.' },
  layers: { title: 'Layers', note: 'Camera, lighting, grip, art, cast. Phase 5.' },
  plan: { title: 'Set plan', note: 'Top-down plan in real units. Phase 5.' },
  selection: { title: 'Selection', note: 'Camera lens, field of view, light beam. Phase 5.' },
  frames: { title: 'Frames in setup', note: 'The shots this setup covers. Phase 5.' },
  library: { title: 'Library', note: '68 plan icons by department. Phase 5.' },
  days: { title: 'Shoot days', note: 'Frames grouped into days, golden hour. Phase 3.' },
  sheet: { title: 'Call sheet', note: 'Calls, weather, sun times, map. Phase 4.' },
  // In no default layout: opened in any workspace when needed (CLAUDE.md).
  calendar: { title: 'Calendar', note: 'Shoot days and availability by month and week. Phase 3.' },
  notifications: { title: 'Notifications', note: 'What changed, who, when. Phase 3.' },
  trash: { title: 'Trash', note: 'Deleted frames, shots and scenes, restorable. Phase 1.' },
};

export interface Workspace {
  id: WorkspaceId;
  label: string;
  /** How the design numbers this workspace's tiles (01 / Scenes…); tiles opened later count on after them. */
  order: readonly TileId[];
  /** A fresh copy each call, so a layout can never share nodes with the defaults. */
  defaultLayout: () => Layout;
}

const layout = (root: Layout['root']): Layout => ({ root, maximized: null });

// Sizes are in px at the boards' 1440 x 900; the layout keeps them as shares, so they scale with the window.
export const WORKSPACES: readonly [Workspace, ...Workspace[]] = [
  {
    id: 'storyboard',
    label: 'Storyboard',
    order: ['scenes', 'board', 'inspector', 'player'],
    defaultLayout: () =>
      layout(
        split(
          'row',
          [stack(['scenes']), split('column', [stack(['board']), stack(['player'])], [518, 290]), stack(['inspector'])],
          [248, 824, 336],
        ),
      ),
  },
  {
    id: 'production',
    label: 'Production',
    order: ['moodboard', 'gear', 'locations'],
    defaultLayout: () =>
      layout(split('row', [stack(['moodboard']), split('column', [stack(['gear']), stack(['locations'])], [478, 330])], [1056, 360])),
  },
  {
    id: 'birdseye',
    label: "Bird's-eye",
    order: ['layers', 'plan', 'selection', 'frames', 'library'],
    defaultLayout: () =>
      layout(
        split(
          'row',
          [
            split('column', [stack(['layers']), stack(['library'])], [120, 688]),
            split('column', [stack(['plan']), stack(['frames'])], [658, 150]),
            stack(['selection']),
          ],
          [248, 824, 336],
        ),
      ),
  },
  {
    id: 'callsheet',
    label: 'Call sheet',
    order: ['days', 'sheet'],
    defaultLayout: () => layout(split('row', [stack(['days']), stack(['sheet'])], [500, 916])),
  },
];

export const WORKSPACE_PANEL_ID = 'workspace-panel';

export function workspaceTabId(id: WorkspaceId): string {
  return `workspace-tab-${id}`;
}

type ShortcutEvent = Pick<KeyboardEvent, 'altKey' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'code' | 'target'>;

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

// On a Mac, Option+number is how some layouts type characters (# is Option+3 on a British keyboard), so the
// shortcut steps aside while someone is typing.
export function isTextEntry(target: EventTarget | null): boolean {
  if (target === null || !('tagName' in target)) return false;
  const element = target as HTMLElement;
  if (element.isContentEditable || element.tagName === 'TEXTAREA') return true;
  return element.tagName === 'INPUT' && TEXT_INPUT_TYPES.has((element as HTMLInputElement).type);
}

/** Alt+1–4. Read from event.code, because Option+number types ¡™£¢ on a Mac keyboard. */
export function workspaceForShortcut(event: ShortcutEvent): Workspace | undefined {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || isTextEntry(event.target)) return undefined;
  const match = /^Digit([1-9])$/.exec(event.code);
  return match ? WORKSPACES[Number(match[1]) - 1] : undefined;
}

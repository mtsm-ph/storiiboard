import { split, stack, type Layout, type TileId } from './docking/layout';

// One workspace per sidebar section (D3), in the sidebar's order, with default layouts sized for the design boards'
// 1440px. People rearrange them by docking (D2); the tiles stay empty until each tool's phase fills them.

export type WorkspaceId = 'storyboard' | 'assets' | 'team' | 'setup' | 'production' | 'moodboard' | 'settings';

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
  assets: { title: 'Assets', note: 'Images, clips and attachments, linked to frames. Phase 2.' },
  team: { title: 'Team', note: 'Who is on the project; from Phase 9, what each person sees on the web. Phase 3.' },
  // Production's cast and crew tile and the Team section read the same person records.
  people: { title: 'Cast and crew', note: 'People by department, characters, contacts. Phase 3.' },
  project: { title: 'Project', note: 'Title and notes.' },
  settings: { title: 'Backups', note: 'Backup settings and Open backup. 0.7.' },
  // Notifications and Trash are in no default layout, and Calendar only in Production's: any workspace opens them.
  calendar: { title: 'Calendar', note: 'Shoot days and availability by month and week. Phase 3.' },
  notifications: { title: 'Notifications', note: 'What changed, who, when. Phase 3.' },
  trash: { title: 'Trash', note: 'Deleted frames, shots and scenes, restorable. Phase 1.' },
};

export interface Workspace {
  id: WorkspaceId;
  label: string;
  /** When the section's tools arrive; the sidebar shows it until then. */
  phase: string;
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
    phase: 'Phase 1',
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
    id: 'assets',
    label: 'Assets',
    phase: 'Phase 2',
    order: ['assets', 'player'],
    defaultLayout: () => layout(split('row', [stack(['assets']), stack(['player'])], [1056, 360])),
  },
  {
    id: 'team',
    label: 'Team',
    phase: 'Phase 3',
    order: ['team'],
    defaultLayout: () => layout(stack(['team'])),
  },
  {
    // Home of the bird's-eye view (CLAUDE.md, Navigation).
    id: 'setup',
    label: 'Setup',
    phase: 'Phase 5',
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
    id: 'production',
    label: 'Production',
    phase: 'Phases 3–4',
    order: ['days', 'calendar', 'sheet', 'locations', 'gear', 'people'],
    defaultLayout: () =>
      layout(
        split(
          'row',
          [
            split('column', [stack(['days']), stack(['calendar'])], [404, 404]),
            stack(['sheet']),
            split('column', [stack(['locations']), stack(['gear']), stack(['people'])], [270, 269, 269]),
          ],
          [400, 680, 336],
        ),
      ),
  },
  {
    id: 'moodboard',
    label: 'Moodboard',
    phase: 'Phase 6',
    order: ['moodboard'],
    defaultLayout: () => layout(stack(['moodboard'])),
  },
  {
    id: 'settings',
    label: 'Settings',
    phase: '0.7',
    order: ['project', 'settings'],
    defaultLayout: () => layout(split('row', [stack(['project']), stack(['settings'])], [760, 656])),
  },
];

export const WORKSPACE_PANEL_ID = 'workspace-panel';

/** The sidebar entry that opens a workspace, for focus to land on. */
export function sectionId(id: WorkspaceId): string {
  return `section-${id}`;
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

/** Alt+1–7, in the sidebar's order. Read from event.code, because Option+number types ¡™£¢ on a Mac keyboard. */
export function workspaceForShortcut(event: ShortcutEvent): Workspace | undefined {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || isTextEntry(event.target)) return undefined;
  const match = /^Digit([1-9])$/.exec(event.code);
  return match ? WORKSPACES[Number(match[1]) - 1] : undefined;
}

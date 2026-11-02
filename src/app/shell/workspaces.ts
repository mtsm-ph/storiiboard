// The four saved workspaces and their default tile layouts, taken from the design boards in the kit
// (04_Design_Source). Static until docking (D2) lets people rearrange them; the tiles are empty until each
// tool's phase fills them.

export type WorkspaceId = 'storyboard' | 'production' | 'birdseye' | 'callsheet';

export interface PlaceholderTile {
  /** Grid area name, unique within the workspace. */
  area: string;
  index: number;
  title: string;
  /** What will live here, and when. */
  note: string;
}

export interface Workspace {
  id: WorkspaceId;
  label: string;
  columns: string;
  rows: string;
  areas: string;
  tiles: readonly PlaceholderTile[];
}

export const WORKSPACES: readonly [Workspace, ...Workspace[]] = [
  {
    id: 'storyboard',
    label: 'Storyboard',
    columns: '248px minmax(0, 1fr) 336px',
    rows: 'minmax(0, 1fr) 290px',
    areas: '"scenes board inspector" "scenes player inspector"',
    tiles: [
      { area: 'scenes', index: 1, title: 'Scenes', note: 'Scene list from script import. Phase 1.' },
      { area: 'board', index: 2, title: 'Storyboard', note: 'Frames by scene, auto shot numbers. Phase 1.' },
      { area: 'inspector', index: 3, title: 'Frame inspector', note: 'Shot size, lens, T-stop, status. Phase 1.' },
      { area: 'player', index: 4, title: 'Player', note: 'Proxy playback, in and out, capture. Phase 2.' },
    ],
  },
  {
    id: 'production',
    label: 'Production',
    columns: 'minmax(0, 1fr) 360px',
    rows: 'minmax(0, 1fr) 330px',
    areas: '"moodboard gear" "moodboard locations"',
    tiles: [
      { area: 'moodboard', index: 1, title: 'Moodboard', note: 'Department boards and references. Phase 6.' },
      { area: 'gear', index: 2, title: 'Gear', note: 'Packages per shoot day, linked to shots. Phase 3.' },
      { area: 'locations', index: 3, title: 'Locations', note: 'Addresses, contacts, parking, power. Phase 3.' },
    ],
  },
  {
    id: 'birdseye',
    label: "Bird's-eye",
    columns: '248px minmax(0, 1fr) 336px',
    rows: 'auto minmax(0, 1fr) 150px',
    areas: '"layers plan selection" "library plan selection" "library frames selection"',
    tiles: [
      { area: 'layers', index: 1, title: 'Layers', note: 'Camera, lighting, grip, art, cast. Phase 5.' },
      { area: 'plan', index: 2, title: 'Set plan', note: 'Top-down plan in real units. Phase 5.' },
      { area: 'selection', index: 3, title: 'Selection', note: 'Camera lens, field of view, light beam. Phase 5.' },
      { area: 'frames', index: 4, title: 'Frames in setup', note: 'The shots this setup covers. Phase 5.' },
      { area: 'library', index: 5, title: 'Library', note: '68 plan icons by department. Phase 5.' },
    ],
  },
  {
    id: 'callsheet',
    label: 'Call sheet',
    columns: '500px minmax(0, 1fr)',
    rows: 'minmax(0, 1fr)',
    areas: '"days sheet"',
    tiles: [
      { area: 'days', index: 1, title: 'Shoot days', note: 'Frames grouped into days, golden hour. Phase 3.' },
      { area: 'sheet', index: 2, title: 'Call sheet', note: 'Calls, weather, sun times, map. Phase 4.' },
    ],
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
function isTextEntry(target: EventTarget | null): boolean {
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

import { t } from '../../core/i18n';
import { split, stack, type Layout, type TileId } from './docking/layout';

// One workspace per sidebar section (D3), in the sidebar's order, with default layouts sized for the design boards'
// 1440px. People rearrange them by docking (D2); the tiles stay empty until each tool's phase fills them.

export type WorkspaceId = 'storyboard' | 'assets' | 'team' | 'setup' | 'production' | 'moodboard';

export interface TileInfo {
  title: string;
  /** What will live here, and when. */
  note: string;
}

// Tiles the app has today. A new tile is one id here, plus its title and note in each translation file. Settings'
// project, app, theme, backups and storage are tabs in the Settings window (polish B), not tiles.
const BUILT_IN_TILES = [
  'scenes',
  'board',
  'inspector',
  'player',
  'moodboard',
  'gear',
  'locations',
  'layers',
  'plan',
  'selection',
  'frames',
  'library',
  'days',
  'sheet',
  'assets',
  'team',
  'people',
  'calendar',
  'notifications',
  'history',
  'trash',
  'colorScript',
] as const;
type BuiltInTile = (typeof BUILT_IN_TILES)[number];

// Getters, so a tile's words follow the app's language wherever they're read.
function tileInfo(id: BuiltInTile): TileInfo {
  return {
    get title() {
      return t(`tile.${id}.title`);
    },
    get note() {
      return t(`tile.${id}.note`);
    },
  };
}

/**
 * Every tile, by an id unique across workspaces, so any tile can open in any workspace. Notifications and Trash are
 * in no default layout, and Calendar only in Production's: any workspace opens them from the Layout menu once they're
 * built (until then the menu leaves placeholders out, so Notifications shows nowhere before Phase 3). Production's
 * cast and crew tile and the Team section read the same person records.
 */
export const TILES: Readonly<Record<TileId, TileInfo>> = Object.fromEntries(BUILT_IN_TILES.map((id) => [id, tileInfo(id)]));

export interface Workspace {
  id: WorkspaceId;
  label: string;
  /** When the section's tools arrive; the sidebar shows it until then. Null once they're built. */
  phase: string | null;
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
    get label() {
      return t('workspace.storyboard');
    },
    get phase() {
      return t('phase.number', { phase: 1 });
    },
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
    get label() {
      return t('workspace.assets');
    },
    get phase() {
      return t('phase.number', { phase: 3 });
    },
    order: ['assets', 'player'],
    defaultLayout: () => layout(split('row', [stack(['assets']), stack(['player'])], [1056, 360])),
  },
  {
    id: 'team',
    get label() {
      return t('workspace.team');
    },
    get phase() {
      return t('phase.number', { phase: 3 });
    },
    order: ['team'],
    defaultLayout: () => layout(stack(['team'])),
  },
  {
    // Home of the bird's-eye view (CLAUDE.md, Navigation).
    id: 'setup',
    get label() {
      return t('workspace.setup');
    },
    get phase() {
      return t('phase.number', { phase: 6 });
    },
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
    get label() {
      return t('workspace.production');
    },
    get phase() {
      return t('phase.range', { from: 3, to: 4 });
    },
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
    get label() {
      return t('workspace.moodboard');
    },
    get phase() {
      return t('phase.number', { phase: 5 });
    },
    order: ['moodboard'],
    defaultLayout: () => layout(stack(['moodboard'])),
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

/**
 * The app's own shortcuts step aside while a modal dialog is open (Export, Watermark Settings, Import Script…): the
 * app behind it is inert, so a key pressed on a slider or a button in the dialog never edits, undoes or rearranges what
 * the backdrop hides. A dialog whose work is the project's own edits marks itself `data-project-undo` (the sketch
 * editor, whose strokes undo with ⌘Z); `projectUndo` lets ⌘Z through there. The event's target first, then the
 * document, for a key pressed while focus sits on the dialog's body rather than a control.
 */
export function inModalDialog(target: EventTarget | null, projectUndo = false): boolean {
  const own = target !== null && typeof (target as Partial<Element>).closest === 'function' ? (target as Element).closest('dialog[open]') : null;
  // The top one: a question over Settings blocks ⌘Z even though Settings would let it through.
  const open = own ?? (typeof document === 'undefined' ? null : ([...document.querySelectorAll('dialog[open]')].at(-1) ?? null));
  return open !== null && !(projectUndo && open.hasAttribute('data-project-undo'));
}

/** Alt+1–6, in the sidebar's order. Read from event.code, because Option+number types ¡™£¢ on a Mac keyboard. */
export function workspaceForShortcut(event: ShortcutEvent): Workspace | undefined {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || isTextEntry(event.target) || inModalDialog(event.target)) return undefined;
  const match = /^Digit([1-9])$/.exec(event.code);
  return match ? WORKSPACES[Number(match[1]) - 1] : undefined;
}

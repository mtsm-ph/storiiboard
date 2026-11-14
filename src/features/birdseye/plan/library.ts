import { t } from '../../../core/i18n';
import { DEPARTMENTS, type Department } from '../../../core/model/department';
import { sceneRoom, type PlanLayer, type PlanViewOf } from '../../../core/model/plan';
import type { SbdRecord } from '../../../core/model/record';
import { sceneFields, sceneLabel } from '../../../core/model/storyboard';
import type { GridSnap } from '../../../ui/canvas/scale';
import { gridPull } from '../../../ui/canvas/scale';
import type { GridSpec, Point } from '../../../ui/canvas/types';
import { PLAN_ICONS, type PlanIcon } from '../../../ui/icons/plan/planIcons';
import { iconSize, iconUse, type IconUse } from './iconSizes';
import { iconLabel } from './iconWords';
import { toCanvas, toMetres } from './planScale';

// The Library tile's reading (6.3), pure so it is tested without a screen: the icons by department in call-sheet
// order, narrowed by a filter, what the tile says when nothing can be placed, and where a dropped icon lands.

type Records = Readonly<Record<string, SbdRecord>>;

/** The call sheet's department each icon group is listed under: lighting and grip are both grip and electric. */
const GROUP_DEPARTMENT: Readonly<Record<PlanLayer, Department>> = {
  camera: 'camera',
  lighting: 'grip-electric',
  grip: 'grip-electric',
  'set-art': 'art',
  cast: 'cast',
  sound: 'sound',
  production: 'production',
};

const GROUP_WORDS = {
  camera: 'library.group.camera',
  lighting: 'library.group.lighting',
  grip: 'library.group.grip',
  'set-art': 'library.group.set-art',
  cast: 'library.group.cast',
  sound: 'library.group.sound',
  production: 'library.group.production',
} as const;

export const groupName = (group: PlanLayer): string => t(GROUP_WORDS[group]);

export interface LibraryEntry {
  icon: PlanIcon;
  label: string;
  use: IconUse;
}

export interface LibraryGroup {
  group: PlanLayer;
  entries: LibraryEntry[];
}

/** Letters without their accents, in lower case, so "sofa" finds "Sofá". */
const folded = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();

/**
 * The icons by department in call-sheet order (camera, grip and electric's lighting then grip, art, sound, production,
 * cast), each by its name in the app's language; a filter keeps those whose name (or the kit's English title) has it.
 */
export function libraryGroups(filter: string): LibraryGroup[] {
  const wanted = folded(filter);
  const order = (group: PlanLayer) => DEPARTMENTS.indexOf(GROUP_DEPARTMENT[group]);
  const groups = new Map<PlanLayer, LibraryEntry[]>();
  for (const icon of PLAN_ICONS) {
    const label = iconLabel(icon.id);
    if (wanted !== '' && !folded(label).includes(wanted) && !folded(icon.label).includes(wanted)) continue;
    groups.set(icon.group, [...(groups.get(icon.group) ?? []), { icon, label, use: iconUse(icon.id) }]);
  }
  return [...groups]
    .sort(([a], [b]) => order(a) - order(b) || PLAN_ICONS.findIndex((i) => i.group === a) - PLAN_ICONS.findIndex((i) => i.group === b))
    .map(([group, entries]) => ({ group, entries }));
}

/** What the Library says above its icons: nothing shown; a scene with no room; a scene with no setup; or ready. */
export type LibraryState = { kind: 'noView' } | { kind: 'noRoom'; scene: string } | { kind: 'noSetup' } | { kind: 'ready' };

export function libraryState(records: Records, view: PlanViewOf | null): LibraryState {
  const scene = view ? records[view.sceneId] : undefined;
  if (!view || scene?.type !== 'scene' || scene.trashedAt !== null) return { kind: 'noView' };
  if (!sceneRoom(records, view.sceneId)) return { kind: 'noRoom', scene: sceneLabel(sceneFields(scene.props).number) };
  return view.setupId === null ? { kind: 'noSetup' } : { kind: 'ready' };
}

/** The view a drop or Enter lands in, as the plan canvas reports it. */
export interface DropView {
  cx: number;
  cy: number;
  zoom: number;
  /** The canvas's size, screen pixels. */
  width: number;
  height: number;
}

/**
 * Where an icon dragged over the plan lands (6.3): its middle under the pointer (`local`, screen pixels in the canvas),
 * its box at its real size pulled onto the grid as a moved item's is (Alt: the fine step; ⌘ or Ctrl: none). Metres for
 * the record, and the box on screen for the ghost; null for an icon that isn't placed.
 */
export function dropAt(icon: string, local: Point, view: DropView, grid: GridSpec, snap: GridSnap): { centre: Point; screen: { x: number; y: number; width: number; height: number } } | null {
  const size = iconSize(icon);
  if (!size) return null;
  const w = toCanvas(size.width);
  const h = toCanvas(size.depth);
  const world = { x: view.cx + (local.x - view.width / 2) / view.zoom, y: view.cy + (local.y - view.height / 2) / view.zoom };
  const rect = { x: world.x - w / 2, y: world.y - h / 2, width: w, height: h };
  const pull = gridPull(rect, grid, view.zoom, snap);
  const x = rect.x + pull.dx;
  const y = rect.y + pull.dy;
  return {
    centre: { x: toMetres(x + w / 2), y: toMetres(y + h / 2) },
    screen: { x: (x - view.cx) * view.zoom + view.width / 2, y: (y - view.cy) * view.zoom + view.height / 2, width: w * view.zoom, height: h * view.zoom },
  };
}

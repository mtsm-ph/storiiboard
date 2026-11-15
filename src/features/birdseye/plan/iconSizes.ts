import { BEAM_ICON } from '../../../core/model/planLight';
import { ICON_BOXES } from './iconBoxes';
import { DOOR_TOOL, WALL_TOOL, WINDOW_TOOL } from './planScale';

// What each library icon is when it is placed (6.3, docs/PHASE6_DECISIONS.md 8): its real default size in metres,
// width by depth (a symbol's longer side, its other in its drawing's proportions), editable once it's down. Three
// set-art icons are 6.2's tools instead (the Library picks the tool), and the icons later milestones make live (cameras
// 6.4, lights, flags and diffusion 6.5, north and the sun path 6.6 and cast marks 6.7 are placed now; the measure 6.9)
// show in the Library but can't be placed yet. Every other icon is placeable and has a size
// here, and nothing else does (iconSizes.test.ts).

export interface IconSize {
  /** Metres across. */
  width: number;
  /** Metres deep: the item's `height`, as a board's box names it. */
  depth: number;
}

/**
 * How an icon's size is stated (6.6 review): a footprint's real width by depth (a sofa, a dolly track, a flag's frame),
 * or a symbol's longer side alone (a camera, a light, a C-stand, north), the other side following its drawing's own
 * proportions (iconBoxes.ts), so a symbol is never stretched to a box of another shape: north's tall arrow drawn fat, a
 * C-stand's round hub an ellipse.
 */
type StatedSize = IconSize | { side: number };

const STATED_SIZES: Readonly<Record<string, StatedSize>> = {
  // Cameras (6.4): placed as `camera` items, each the icon it was placed as. Symbols, but for the track, the slider and
  // the jib, whose length is real.
  'camera/camera': { side: 0.4 },
  'camera/sticks': { side: 1.0 },
  'camera/dolly-track': { width: 1.0, depth: 3.0 },
  'camera/slider': { width: 1.2, depth: 0.3 },
  'camera/jib-crane': { width: 1.5, depth: 4.0 },
  'camera/gimbal': { side: 0.5 },
  'camera/handheld': { side: 0.6 },
  'camera/steadicam': { side: 0.7 },
  'camera/drone': { side: 0.6 },
  // Lights (6.5): placed as `light` items, each the icon it was placed as; all symbols.
  'lighting/fresnel': { side: 0.4 },
  'lighting/led-panel': { side: 0.7 },
  'lighting/tube': { side: 1.2 },
  'lighting/cob-softbox': { side: 0.9 },
  'lighting/hmi-par': { side: 0.6 },
  'lighting/china-ball': { side: 0.6 },
  'lighting/practical': { side: 0.3 },
  'lighting/spacelight': { side: 0.8 },
  'lighting/rgb-gel': { side: 0.4 },
  'lighting/window-light': { side: 1.2 },
  // Flags and diffusion (6.5): a standing frame is a line from above, 5 cm deep; the overhead lies flat, a square.
  'grip/flag': { width: 0.91, depth: 0.05 },
  'grip/floppy': { width: 1.22, depth: 0.05 },
  'grip/neg-fill': { width: 1.22, depth: 0.05 },
  'grip/diffusion-4x4': { width: 1.22, depth: 0.05 },
  'grip/bounce': { width: 1.22, depth: 0.05 },
  'grip/overhead-8x8': { width: 2.44, depth: 2.44 },
  // North and the sun path (6.6): placed as `north` (in the room's plan) and `sun` (in the setup's) items.
  'production/north': { side: 0.6 },
  'lighting/sun-path': { side: 0.8 },
  // Cast blocking (6.7): marks are placed as `mark` items in the scene's blocking, the eyeline and the background as
  // icons there. All symbols (6.6 review), so each keeps its drawing's proportions: a tape mark 0.30 × 0.28 m, an
  // eyeline 1.5 m long by its arrow's depth, the background figure 0.5 m across.
  'cast/cast-mark': { side: 0.5 },
  'cast/next-position': { side: 0.5 },
  'cast/tape-mark': { side: 0.3 },
  'cast/eyeline': { side: 1.5 },
  'cast/background': { side: 0.5 },
  'set-art/table': { width: 1.5, depth: 0.8 },
  'set-art/chair': { width: 0.5, depth: 0.5 },
  'set-art/sofa': { width: 2.0, depth: 0.9 },
  'set-art/bed': { width: 1.5, depth: 2.0 },
  'set-art/car': { width: 1.8, depth: 4.5 },
  'set-art/stairs': { width: 1.0, depth: 3.0 },
  'set-art/column': { width: 0.4, depth: 0.4 },
  'set-art/plant-tree': { width: 0.6, depth: 0.6 },
  'set-art/counter-bar': { width: 2.4, depth: 0.6 },
  'grip/c-stand': { side: 0.9 },
  'grip/combo-stand': { side: 1.2 },
  'grip/sandbag': { side: 0.4 },
  'grip/apple-box': { side: 0.5 },
  'grip/ladder': { width: 0.6, depth: 1.2 },
  'grip/rostrum': { width: 1.2, depth: 2.4 },
  'sound/boom': { side: 0.6 },
  'sound/lav': { side: 0.3 },
  'sound/sound-cart': { side: 0.9 },
  'sound/playback': { side: 0.4 },
  'production/video-village': { width: 2.0, depth: 1.5 },
  'production/generator': { width: 0.9, depth: 0.6 },
  'production/distro-cable': { width: 0.6, depth: 0.4 },
  'production/basecamp': { width: 6.0, depth: 3.0 },
  'production/first-aid': { side: 0.5 },
  'production/parking': { width: 2.5, depth: 5.0 },
  'production/hazard': { side: 0.6 },
  'production/zone': { width: 3.0, depth: 3.0 },
  'production/note': { width: 1.5, depth: 0.5 },
  'production/snap-point': { side: 0.2 },
};

/** To the centimetre, never less than one. */
const toCentimetre = (metres: number): number => Math.max(0.01, Math.round(metres * 100) / 100);

/**
 * A symbol's size from its longer side: that side as stated, the other in its drawing's proportions (its ink box in
 * iconBoxes.ts, width across and height down the plan). A drawing with no box (none should lack one) is a square.
 */
export function symbolSize(id: string, side: number): IconSize {
  const box = Object.hasOwn(ICON_BOXES, id) ? ICON_BOXES[id] : undefined;
  if (!box || !(box.width > 0) || !(box.height > 0)) return { width: side, depth: side };
  const ratio = box.width / box.height;
  return ratio >= 1 ? { width: side, depth: toCentimetre(side / ratio) } : { width: toCentimetre(side * ratio), depth: side };
}

/** Whether an icon's size is stated as a symbol's longer side (its other side from its drawing). */
export const isSymbolSize = (id: string): boolean => Object.hasOwn(STATED_SIZES, id) && 'side' in (STATED_SIZES[id] ?? {});

/**
 * Each placeable icon's default size, metres, worked out once from STATED_SIZES. Items already in a file keep the size
 * they were placed at: this is read only when one is placed.
 */
export const ICON_SIZES: Readonly<Record<string, IconSize>> = Object.fromEntries(
  Object.entries(STATED_SIZES).map(([id, stated]): [string, IconSize] => [id, 'side' in stated ? symbolSize(id, stated.side) : { width: stated.width, depth: stated.depth }]),
);

/** The set-art icons that are 6.2's tools: in the Library they pick the tool. */
export const TOOL_ICONS: Readonly<Record<string, string>> = {
  'set-art/wall': WALL_TOOL,
  'set-art/door': DOOR_TOOL,
  'set-art/window': WINDOW_TOOL,
};

/** Whole groups and single icons a later milestone of this phase makes live. */
const COMING_GROUPS: ReadonlySet<string> = new Set<string>();
const COMING_ICONS: ReadonlySet<string> = new Set(['production/measure']);

/** The field of view's picture (6.4): every camera draws its own cone, so it is never placed as an item. */
export const FIELD_OF_VIEW_ICON = 'camera/field-of-view';
/** A walk path's picture (6.7): the plan draws each character's and camera's path between its positions. */
export const WALK_PATH_ICON = 'cast/walk-path';
/** The beam's picture (6.5): every light draws its own beam, so it is never placed either. */
const SHOWN_ICONS: ReadonlySet<string> = new Set([FIELD_OF_VIEW_ICON, BEAM_ICON, WALK_PATH_ICON]);

/** Icons that resize freely, their proportions never kept: a zone's outline and a note. */
export const FREE_RESIZE: ReadonlySet<string> = new Set(['production/zone', 'production/note']);

export type IconUse = 'place' | 'tool' | 'coming' | 'shown';

/** What the Library does with an icon: place it, pick its tool, say it comes later in this phase, or that each camera draws it. */
export function iconUse(id: string): IconUse {
  if (SHOWN_ICONS.has(id)) return 'shown';
  if (id in TOOL_ICONS) return 'tool';
  if (COMING_ICONS.has(id) || COMING_GROUPS.has(id.split('/')[0] ?? '')) return 'coming';
  return 'place';
}

/** The size an icon is placed at, or null for one that isn't placed. */
export const iconSize = (id: string): IconSize | null => (Object.hasOwn(ICON_SIZES, id) ? (ICON_SIZES[id] ?? null) : null);

import { DOOR_TOOL, WALL_TOOL, WINDOW_TOOL } from './planScale';

// What each library icon is when it is placed (6.3, docs/PHASE6_DECISIONS.md 8): its real default size in metres,
// width by depth, editable once it's down. Three set-art icons are 6.2's tools instead (the Library picks the tool),
// and the icons later milestones make live (cameras 6.4; lights, flags and diffusion 6.5; north and the sun 6.6; cast
// marks 6.7; the measure 6.9) show in the Library but can't be placed yet. Every other icon is placeable and has a size
// here, and nothing else does (iconSizes.test.ts).

export interface IconSize {
  /** Metres across. */
  width: number;
  /** Metres deep: the item's `height`, as a board's box names it. */
  depth: number;
}

export const ICON_SIZES: Readonly<Record<string, IconSize>> = {
  // Cameras (6.4): placed as `camera` items, each the icon it was placed as.
  'camera/camera': { width: 0.4, depth: 0.4 },
  'camera/sticks': { width: 1.0, depth: 1.0 },
  'camera/dolly-track': { width: 1.0, depth: 3.0 },
  'camera/slider': { width: 1.2, depth: 0.3 },
  'camera/jib-crane': { width: 1.5, depth: 4.0 },
  'camera/gimbal': { width: 0.5, depth: 0.5 },
  'camera/handheld': { width: 0.6, depth: 0.6 },
  'camera/steadicam': { width: 0.7, depth: 0.7 },
  'camera/drone': { width: 0.6, depth: 0.6 },
  'set-art/table': { width: 1.5, depth: 0.8 },
  'set-art/chair': { width: 0.5, depth: 0.5 },
  'set-art/sofa': { width: 2.0, depth: 0.9 },
  'set-art/bed': { width: 1.5, depth: 2.0 },
  'set-art/car': { width: 1.8, depth: 4.5 },
  'set-art/stairs': { width: 1.0, depth: 3.0 },
  'set-art/column': { width: 0.4, depth: 0.4 },
  'set-art/plant-tree': { width: 0.6, depth: 0.6 },
  'set-art/counter-bar': { width: 2.4, depth: 0.6 },
  'grip/c-stand': { width: 0.9, depth: 0.9 },
  'grip/combo-stand': { width: 1.2, depth: 1.2 },
  'grip/sandbag': { width: 0.4, depth: 0.25 },
  'grip/apple-box': { width: 0.5, depth: 0.3 },
  'grip/ladder': { width: 0.6, depth: 1.2 },
  'grip/rostrum': { width: 1.2, depth: 2.4 },
  'sound/boom': { width: 0.6, depth: 0.6 },
  'sound/lav': { width: 0.3, depth: 0.3 },
  'sound/sound-cart': { width: 0.6, depth: 0.9 },
  'sound/playback': { width: 0.4, depth: 0.4 },
  'production/video-village': { width: 2.0, depth: 1.5 },
  'production/generator': { width: 0.9, depth: 0.6 },
  'production/distro-cable': { width: 0.6, depth: 0.4 },
  'production/basecamp': { width: 6.0, depth: 3.0 },
  'production/first-aid': { width: 0.5, depth: 0.5 },
  'production/parking': { width: 2.5, depth: 5.0 },
  'production/hazard': { width: 0.6, depth: 0.6 },
  'production/zone': { width: 3.0, depth: 3.0 },
  'production/note': { width: 1.5, depth: 0.5 },
  'production/snap-point': { width: 0.2, depth: 0.2 },
};

/** The set-art icons that are 6.2's tools: in the Library they pick the tool. */
export const TOOL_ICONS: Readonly<Record<string, string>> = {
  'set-art/wall': WALL_TOOL,
  'set-art/door': DOOR_TOOL,
  'set-art/window': WINDOW_TOOL,
};

/** Whole groups and single icons a later milestone of this phase makes live. */
const COMING_GROUPS: ReadonlySet<string> = new Set(['lighting', 'cast']);
const COMING_ICONS: ReadonlySet<string> = new Set(['grip/flag', 'grip/floppy', 'grip/diffusion-4x4', 'grip/bounce', 'grip/overhead-8x8', 'grip/neg-fill', 'production/north', 'production/measure']);

/** The field of view's picture (6.4): every camera draws its own cone, so it is never placed as an item. */
export const FIELD_OF_VIEW_ICON = 'camera/field-of-view';

/** Icons that resize freely, their proportions never kept: a zone's outline and a note. */
export const FREE_RESIZE: ReadonlySet<string> = new Set(['production/zone', 'production/note']);

export type IconUse = 'place' | 'tool' | 'coming' | 'shown';

/** What the Library does with an icon: place it, pick its tool, say it comes later in this phase, or that each camera draws it. */
export function iconUse(id: string): IconUse {
  if (id === FIELD_OF_VIEW_ICON) return 'shown';
  if (id in TOOL_ICONS) return 'tool';
  if (COMING_ICONS.has(id) || COMING_GROUPS.has(id.split('/')[0] ?? '')) return 'coming';
  return 'place';
}

/** The size an icon is placed at, or null for one that isn't placed. */
export const iconSize = (id: string): IconSize | null => (Object.hasOwn(ICON_SIZES, id) ? (ICON_SIZES[id] ?? null) : null);

import type { Change } from '../ops/ops';
import { gearWatts, MAX_WATTS } from './gear';
import { gripFields, lightFields, type GripFields, type LightFields } from './plan';
import type { Props, SbdRecord } from './record';

// Lights, flags and diffusion on a setup's plan (6.5, docs/PHASE6_DECISIONS.md 8 and 11). A light is a `plan_item` of
// kind `light`, pointing where its rotation says, with a beam angle (its icon's unless one is typed), a height, and
// watts: typed on it, or read live from the `gear_item` it is when it has none typed, never copied. Flags, bounces and
// diffusion are kinds `flag` and `diffusion`, at the real sizes crews call them by (4×4, 8×8). Each may be the gear
// item it is (`gear_id`), so the day's gear check covers the plan (src/core/checks/gearOnDay.ts). Every edit here is
// an op list, one group.

type Records = Readonly<Record<string, SbdRecord>>;

/** How long a beam is drawn, metres: a constant, never a prop (a camera's cone is CONE_LENGTH_M). */
export const BEAM_LENGTH_M = 4;
/** A beam angle that shines all round: drawn as a soft circle, no cone. */
export const ALL_ROUND = 360;

/** The lights a light can be placed as. `lighting/beam-cone` is the beam's picture, never placed; `lighting/sun-path` comes in 6.6. */
export const LIGHT_ICONS = [
  'lighting/fresnel',
  'lighting/led-panel',
  'lighting/tube',
  'lighting/cob-softbox',
  'lighting/hmi-par',
  'lighting/china-ball',
  'lighting/practical',
  'lighting/spacelight',
  'lighting/rgb-gel',
  'lighting/window-light',
] as const;
export const FLAG_ICONS = ['grip/flag', 'grip/floppy', 'grip/neg-fill'] as const;
export const DIFFUSION_ICONS = ['grip/diffusion-4x4', 'grip/bounce', 'grip/overhead-8x8'] as const;
/** The beam's picture (6.5): every light draws its own beam, so it is never placed as an item. */
export const BEAM_ICON = 'lighting/beam-cone';

export const isLightIcon = (icon: string): boolean => (LIGHT_ICONS as readonly string[]).includes(icon);

/** The kind a grip icon is placed as: a flag, a diffusion frame, or null for any other icon. */
export function gripKindOf(icon: string): 'flag' | 'diffusion' | null {
  if ((FLAG_ICONS as readonly string[]).includes(icon)) return 'flag';
  if ((DIFFUSION_ICONS as readonly string[]).includes(icon)) return 'diffusion';
  return null;
}

/** The beam each light has when none is typed, degrees; the china ball, the practical and the spacelight shine all round. */
export const BEAM_DEFAULTS: Readonly<Record<string, number>> = {
  'lighting/fresnel': 40,
  'lighting/led-panel': 100,
  'lighting/tube': 120,
  'lighting/cob-softbox': 90,
  'lighting/hmi-par': 30,
  'lighting/china-ball': ALL_ROUND,
  'lighting/practical': ALL_ROUND,
  'lighting/spacelight': ALL_ROUND,
  'lighting/rgb-gel': 60,
  'lighting/window-light': 90,
};

/**
 * Which way each light's own drawing points (6.5 review), degrees clockwise from up its box: added to the item's
 * rotation, it is the beam's direction. A light's `rotation` turns its icon, and the beam follows the icon's facing, so
 * the beam always leaves the side the drawing shines from. Read from each icon's vectors (src/features/birdseye/plan/
 * iconBoxes.ts, the kit's 32-unit box, y down).
 */
export const BEAM_FACING: Readonly<Record<string, number>> = {
  // The lens (the circles low in the box) with its rays fanning out above it, to the top: up.
  'lighting/fresnel': 0,
  // A flat panel, wider than deep, its grid the same both ways: no side drawn as the front, so up, across its width.
  'lighting/led-panel': 0,
  // A long tube lying across the box: it lights to either side of its length; up, across it.
  'lighting/tube': 0,
  // An octagon round a centre dot, the same every way: up.
  'lighting/cob-softbox': 0,
  // The lamp (the circle) on the left, its dashed beam widening to the right edge: right, +x.
  'lighting/hmi-par': 90,
  // All round (a soft circle, no beam): the facing never shows; up.
  'lighting/china-ball': 0,
  'lighting/practical': 0,
  'lighting/spacelight': 0,
  // The lamp (the filled box) on the left, its gel (the orange box) on the right it shines through: right, +x.
  'lighting/rgb-gel': 90,
  // The window's frame across the box, its rays coming through it out of the bottom edge: down, +y.
  'lighting/window-light': 180,
};

/** Which way an icon's drawing points, degrees clockwise from up: the table's, else up (an icon this version doesn't know). */
export const beamFacing = (icon: string): number => (Object.hasOwn(BEAM_FACING, icon) ? (BEAM_FACING[icon] ?? 0) : 0);

/** Where a light's beam points on the plan, degrees clockwise from up: its rotation plus its icon's facing, 0 up to 360. */
export const beamDirection = (fields: Pick<LightFields, 'icon' | 'rotation'>): number => (((fields.rotation + beamFacing(fields.icon)) % 360) + 360) % 360;

/** An icon's own beam: the table's, else a fresnel's (an icon this version doesn't know). */
export const defaultBeam = (icon: string): number => (Object.hasOwn(BEAM_DEFAULTS, icon) ? (BEAM_DEFAULTS[icon] ?? 40) : 40);

/** A light's beam angle, degrees: typed, else its icon's. ALL_ROUND (360) shines all round. */
export const beamOf = (fields: LightFields): number => fields.beamDeg ?? defaultBeam(fields.icon);

export const isAllRound = (degrees: number): boolean => degrees >= ALL_ROUND;

/** A live light, with its fields. */
export function liveLight(records: Records, id: string): { record: SbdRecord; fields: LightFields } | null {
  const record = records[id];
  if (record?.type !== 'plan_item' || record.trashedAt !== null) return null;
  const fields = lightFields(record.props);
  return fields ? { record, fields } : null;
}

/** A live flag or diffusion frame, with its fields. */
export function liveGrip(records: Records, id: string): { record: SbdRecord; fields: GripFields } | null {
  const record = records[id];
  if (record?.type !== 'plan_item' || record.trashedAt !== null) return null;
  const fields = gripFields(record.props);
  return fields ? { record, fields } : null;
}

/** A live gear item by id, or null (one in the Trash, or an id naming nothing, reads as none). */
export function liveGear(records: Records, id: string | null): SbdRecord | null {
  const item = id ? records[id] : undefined;
  return item?.type === 'gear_item' && item.trashedAt === null ? item : null;
}

/** The `gear_id` of a light, flag or diffusion frame, as the one reader has it: a live gear item's id, else null. */
export function planItemGear(records: Records, props: Props): SbdRecord | null {
  const fields = lightFields(props) ?? gripFields(props);
  return fields ? liveGear(records, fields.gearId) : null;
}

/** A light's wattage: typed on it, else its live gear item's, read live; null when neither has one (unknown). */
export type LightWatts = { from: 'light'; watts: number } | { from: 'gear'; watts: number; gear: SbdRecord } | null;

/** The one reader of a light's wattage. */
export function lightWatts(records: Records, lightId: string): LightWatts {
  const light = liveLight(records, lightId);
  if (!light) return null;
  if (light.fields.watts !== null) return { from: 'light', watts: light.fields.watts };
  const gear = liveGear(records, light.fields.gearId);
  const watts = gear ? gearWatts(gear.props) : null;
  return gear && watts !== null ? { from: 'gear', watts, gear } : null;
}

/** The sizes crews call frames by (6.5): feet across by feet long, and those in metres. */
export interface FrameSize {
  id: string;
  /** Feet, as the name says it: 2×3. */
  feet: readonly [number, number];
  /** Metres: the short side, then the long one. */
  short: number;
  long: number;
}

export const FRAME_SIZES: readonly FrameSize[] = [
  { id: '2x3', feet: [2, 3], short: 0.61, long: 0.91 },
  { id: '4x4', feet: [4, 4], short: 1.22, long: 1.22 },
  { id: '6x6', feet: [6, 6], short: 1.83, long: 1.83 },
  { id: '8x8', feet: [8, 8], short: 2.44, long: 2.44 },
  { id: '12x12', feet: [12, 12], short: 3.66, long: 3.66 },
  { id: '20x20', feet: [20, 20], short: 6.1, long: 6.1 },
];

/** Frames that lie flat (an overhead), seen from above at their whole size; every other one stands, and is a line. */
const FLAT_ICONS: ReadonlySet<string> = new Set(['grip/overhead-8x8']);
export const liesFlat = (icon: string): boolean => FLAT_ICONS.has(icon);

/** What a size makes a frame, metres: standing, its width the long side (its depth as it is); lying flat, both sides. */
export function frameSizeBox(fields: Pick<GripFields, 'icon' | 'height'>, size: FrameSize): { width: number; depth: number } {
  return liesFlat(fields.icon) ? { width: size.long, depth: size.short } : { width: size.long, depth: fields.height };
}

// Half a centimetre (6.5 second review): a size typed in feet is the exact inch (8' is 2.4384 m, 3' 0.9144 m) against
// the presets' rounded centimetres, and still reads as the crew size; presets are at least 0.3 m apart, so none blur.
const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

/** The size a frame is now, or null for one typed by hand. */
export function frameSizeOf(fields: Pick<GripFields, 'icon' | 'width' | 'height'>): FrameSize | null {
  return (
    FRAME_SIZES.find((size) =>
      liesFlat(fields.icon) ? (near(fields.width, size.long) && near(fields.height, size.short)) || (near(fields.width, size.short) && near(fields.height, size.long)) : near(fields.width, size.long),
    ) ?? null
  );
}

// The edits.

/** Each item's own update, or none when nothing changes. */
const updates = (ids: readonly string[], make: (id: string) => Change | null): Change[] => ids.flatMap((id) => make(id) ?? []);

/** The gear item each selected light, flag or diffusion frame is (any live item of the project); null takes it off. */
export function planGearChanges(records: Records, ids: readonly string[], gearId: string | null): Change[] {
  if (gearId !== null && !liveGear(records, gearId)) return [];
  return updates(ids, (id) => {
    const item = liveLight(records, id) ?? liveGrip(records, id);
    if (!item || item.fields.gearId === gearId) return null;
    return gearId === null ? { kind: 'update', id, unset: ['gear_id'] } : { kind: 'update', id, set: { gear_id: gearId } };
  });
}

/** Whether a wattage can be typed: above 0, up to MAX_WATTS. */
export const isWatts = (watts: number): boolean => Number.isFinite(watts) && watts > 0 && watts <= MAX_WATTS;

/** Watts typed on each selected light, to a tenth; null takes them off, so its gear item's are read again. */
export function lightWattsChanges(records: Records, ids: readonly string[], watts: number | null): Change[] {
  if (watts !== null && !isWatts(watts)) return [];
  const next = watts === null ? null : Math.round(watts * 10) / 10;
  return updates(ids, (id) => {
    const light = liveLight(records, id);
    if (!light || light.fields.watts === next) return null;
    return next === null ? { kind: 'update', id, unset: ['watts'] } : { kind: 'update', id, set: { watts: next } };
  });
}

/** Whether a beam angle can be typed: above 0, up to 360 (all round). */
export const isBeam = (degrees: number): boolean => Number.isFinite(degrees) && degrees > 0 && degrees <= ALL_ROUND;

/**
 * A beam typed on each selected light, to a tenth of a degree. A light whose beam already reads so writes nothing: typing
 * its icon's own angle on a light with none typed leaves it with none, so it follows the icon's.
 */
export function lightBeamChanges(records: Records, ids: readonly string[], degrees: number): Change[] {
  if (!isBeam(degrees)) return [];
  const next = Math.round(degrees * 10) / 10;
  return updates(ids, (id) => {
    const light = liveLight(records, id);
    if (!light || beamOf(light.fields) === next) return null;
    return { kind: 'update', id, set: { beam_deg: next } };
  });
}

import { t, type MessageKey } from '../../../core/i18n';
import { formatLength, type PlanUnit } from '../../../core/model/length';
import type { GripFields } from '../../../core/model/plan';
import { frameSizeOf, liesFlat } from '../../../core/model/planLight';
import { PLAN_ICONS, type PlanIcon } from '../../../ui/icons/plan/planIcons';

// What each plan icon is called (6.3): the kit's SVG titles are English, so every icon's name is in the translation
// files, keyed by its id, as a label ("Sofa") and as a step in History names one ("a sofa"). An icon without words
// here (one a newer kit adds) falls back to its SVG's title, and History to "a plan item".

const WORDS: Readonly<Record<string, { label: MessageKey; a: MessageKey }>> = {
  'camera/camera': { label: 'planIcon.camera.camera', a: 'planIcon.a.camera.camera' },
  'camera/sticks': { label: 'planIcon.camera.sticks', a: 'planIcon.a.camera.sticks' },
  'camera/dolly-track': { label: 'planIcon.camera.dolly-track', a: 'planIcon.a.camera.dolly-track' },
  'camera/slider': { label: 'planIcon.camera.slider', a: 'planIcon.a.camera.slider' },
  'camera/jib-crane': { label: 'planIcon.camera.jib-crane', a: 'planIcon.a.camera.jib-crane' },
  'camera/gimbal': { label: 'planIcon.camera.gimbal', a: 'planIcon.a.camera.gimbal' },
  'camera/handheld': { label: 'planIcon.camera.handheld', a: 'planIcon.a.camera.handheld' },
  'camera/steadicam': { label: 'planIcon.camera.steadicam', a: 'planIcon.a.camera.steadicam' },
  'camera/drone': { label: 'planIcon.camera.drone', a: 'planIcon.a.camera.drone' },
  'camera/field-of-view': { label: 'planIcon.camera.field-of-view', a: 'planIcon.a.camera.field-of-view' },
  'lighting/fresnel': { label: 'planIcon.lighting.fresnel', a: 'planIcon.a.lighting.fresnel' },
  'lighting/led-panel': { label: 'planIcon.lighting.led-panel', a: 'planIcon.a.lighting.led-panel' },
  'lighting/tube': { label: 'planIcon.lighting.tube', a: 'planIcon.a.lighting.tube' },
  'lighting/cob-softbox': { label: 'planIcon.lighting.cob-softbox', a: 'planIcon.a.lighting.cob-softbox' },
  'lighting/hmi-par': { label: 'planIcon.lighting.hmi-par', a: 'planIcon.a.lighting.hmi-par' },
  'lighting/china-ball': { label: 'planIcon.lighting.china-ball', a: 'planIcon.a.lighting.china-ball' },
  'lighting/practical': { label: 'planIcon.lighting.practical', a: 'planIcon.a.lighting.practical' },
  'lighting/spacelight': { label: 'planIcon.lighting.spacelight', a: 'planIcon.a.lighting.spacelight' },
  'lighting/rgb-gel': { label: 'planIcon.lighting.rgb-gel', a: 'planIcon.a.lighting.rgb-gel' },
  'lighting/beam-cone': { label: 'planIcon.lighting.beam-cone', a: 'planIcon.a.lighting.beam-cone' },
  'lighting/sun-path': { label: 'planIcon.lighting.sun-path', a: 'planIcon.a.lighting.sun-path' },
  'lighting/window-light': { label: 'planIcon.lighting.window-light', a: 'planIcon.a.lighting.window-light' },
  'grip/c-stand': { label: 'planIcon.grip.c-stand', a: 'planIcon.a.grip.c-stand' },
  'grip/flag': { label: 'planIcon.grip.flag', a: 'planIcon.a.grip.flag' },
  'grip/floppy': { label: 'planIcon.grip.floppy', a: 'planIcon.a.grip.floppy' },
  'grip/diffusion-4x4': { label: 'planIcon.grip.diffusion-4x4', a: 'planIcon.a.grip.diffusion-4x4' },
  'grip/bounce': { label: 'planIcon.grip.bounce', a: 'planIcon.a.grip.bounce' },
  'grip/overhead-8x8': { label: 'planIcon.grip.overhead-8x8', a: 'planIcon.a.grip.overhead-8x8' },
  'grip/neg-fill': { label: 'planIcon.grip.neg-fill', a: 'planIcon.a.grip.neg-fill' },
  'grip/sandbag': { label: 'planIcon.grip.sandbag', a: 'planIcon.a.grip.sandbag' },
  'grip/apple-box': { label: 'planIcon.grip.apple-box', a: 'planIcon.a.grip.apple-box' },
  'grip/ladder': { label: 'planIcon.grip.ladder', a: 'planIcon.a.grip.ladder' },
  'grip/combo-stand': { label: 'planIcon.grip.combo-stand', a: 'planIcon.a.grip.combo-stand' },
  'grip/rostrum': { label: 'planIcon.grip.rostrum', a: 'planIcon.a.grip.rostrum' },
  'set-art/wall': { label: 'planIcon.set-art.wall', a: 'planIcon.a.set-art.wall' },
  'set-art/door': { label: 'planIcon.set-art.door', a: 'planIcon.a.set-art.door' },
  'set-art/window': { label: 'planIcon.set-art.window', a: 'planIcon.a.set-art.window' },
  'set-art/table': { label: 'planIcon.set-art.table', a: 'planIcon.a.set-art.table' },
  'set-art/chair': { label: 'planIcon.set-art.chair', a: 'planIcon.a.set-art.chair' },
  'set-art/sofa': { label: 'planIcon.set-art.sofa', a: 'planIcon.a.set-art.sofa' },
  'set-art/bed': { label: 'planIcon.set-art.bed', a: 'planIcon.a.set-art.bed' },
  'set-art/car': { label: 'planIcon.set-art.car', a: 'planIcon.a.set-art.car' },
  'set-art/stairs': { label: 'planIcon.set-art.stairs', a: 'planIcon.a.set-art.stairs' },
  'set-art/column': { label: 'planIcon.set-art.column', a: 'planIcon.a.set-art.column' },
  'set-art/plant-tree': { label: 'planIcon.set-art.plant-tree', a: 'planIcon.a.set-art.plant-tree' },
  'set-art/counter-bar': { label: 'planIcon.set-art.counter-bar', a: 'planIcon.a.set-art.counter-bar' },
  'cast/cast-mark': { label: 'planIcon.cast.cast-mark', a: 'planIcon.a.cast.cast-mark' },
  'cast/next-position': { label: 'planIcon.cast.next-position', a: 'planIcon.a.cast.next-position' },
  'cast/tape-mark': { label: 'planIcon.cast.tape-mark', a: 'planIcon.a.cast.tape-mark' },
  'cast/walk-path': { label: 'planIcon.cast.walk-path', a: 'planIcon.a.cast.walk-path' },
  'cast/eyeline': { label: 'planIcon.cast.eyeline', a: 'planIcon.a.cast.eyeline' },
  'cast/background': { label: 'planIcon.cast.background', a: 'planIcon.a.cast.background' },
  'sound/boom': { label: 'planIcon.sound.boom', a: 'planIcon.a.sound.boom' },
  'sound/lav': { label: 'planIcon.sound.lav', a: 'planIcon.a.sound.lav' },
  'sound/sound-cart': { label: 'planIcon.sound.sound-cart', a: 'planIcon.a.sound.sound-cart' },
  'sound/playback': { label: 'planIcon.sound.playback', a: 'planIcon.a.sound.playback' },
  'production/video-village': { label: 'planIcon.production.video-village', a: 'planIcon.a.production.video-village' },
  'production/generator': { label: 'planIcon.production.generator', a: 'planIcon.a.production.generator' },
  'production/distro-cable': { label: 'planIcon.production.distro-cable', a: 'planIcon.a.production.distro-cable' },
  'production/basecamp': { label: 'planIcon.production.basecamp', a: 'planIcon.a.production.basecamp' },
  'production/first-aid': { label: 'planIcon.production.first-aid', a: 'planIcon.a.production.first-aid' },
  'production/parking': { label: 'planIcon.production.parking', a: 'planIcon.a.production.parking' },
  'production/north': { label: 'planIcon.production.north', a: 'planIcon.a.production.north' },
  'production/measure': { label: 'planIcon.production.measure', a: 'planIcon.a.production.measure' },
  'production/snap-point': { label: 'planIcon.production.snap-point', a: 'planIcon.a.production.snap-point' },
  'production/zone': { label: 'planIcon.production.zone', a: 'planIcon.a.production.zone' },
  'production/note': { label: 'planIcon.production.note', a: 'planIcon.a.production.note' },
  'production/hazard': { label: 'planIcon.production.hazard', a: 'planIcon.a.production.hazard' },
};

const byId = new Map(PLAN_ICONS.map((icon) => [icon.id, icon]));

/** The kit's icon with this id, or null for one this version doesn't have. */
export const planIconOf = (id: string): PlanIcon | null => byId.get(id) ?? null;

/**
 * An icon's name in the app's language: "Sofa"; its SVG's title when it has no words; for an id this version has no icon
 * for (a newer version's, or an import's), "Unknown plan item (set-art/grand-piano)", so it is never shown bare.
 */
export function iconLabel(id: string): string {
  const words = Object.hasOwn(WORDS, id) ? WORDS[id] : undefined;
  if (words) return t(words.label);
  return byId.get(id)?.label ?? t('library.unknownIcon', { id });
}

/** An icon as a line in History names it: "a sofa". */
export function anIcon(id: string): string {
  const words = Object.hasOwn(WORDS, id) ? WORDS[id] : undefined;
  return words ? t(words.a) : t('history.aPlanItem');
}

/**
 * A flag's or diffusion frame's plain name (6.5 review, M2), without the size its icon was placed at: a 4×4 diffusion
 * set to 8×8 is a diffusion, never "Diffusion 4×4". Its size goes beside it (frameLabel).
 */
const FRAME_WORDS: Readonly<Record<string, { label: MessageKey; a: MessageKey }>> = {
  'grip/flag': { label: 'planFrame.grip.flag', a: 'planFrame.a.grip.flag' },
  'grip/floppy': { label: 'planFrame.grip.floppy', a: 'planFrame.a.grip.floppy' },
  'grip/neg-fill': { label: 'planFrame.grip.neg-fill', a: 'planFrame.a.grip.neg-fill' },
  'grip/diffusion-4x4': { label: 'planFrame.grip.diffusion-4x4', a: 'planFrame.a.grip.diffusion-4x4' },
  'grip/bounce': { label: 'planFrame.grip.bounce', a: 'planFrame.a.grip.bounce' },
  'grip/overhead-8x8': { label: 'planFrame.grip.overhead-8x8', a: 'planFrame.a.grip.overhead-8x8' },
};

/** A frame's kind as words: "Diffusion"; an icon without frame words is named as its icon is. */
export function frameName(icon: string): string {
  const words = Object.hasOwn(FRAME_WORDS, icon) ? FRAME_WORDS[icon] : undefined;
  return words ? t(words.label) : iconLabel(icon);
}

/** The size a frame is, as crews say it: "8×8", "2×3"; else what was typed, in the unit shown ("1.50 m", "2.00 m × 3.00 m" lying flat). */
export function frameSizeText(fields: Pick<GripFields, 'icon' | 'width' | 'height'>, unit: PlanUnit): string {
  const size = frameSizeOf(fields);
  if (size) return t('selection.frame.sizeOption', { across: String(size.feet[0]), long: String(size.feet[1]) });
  if (!liesFlat(fields.icon)) return formatLength(fields.width, unit);
  return t('plan.frame.typedFlat', { width: formatLength(fields.width, unit), depth: formatLength(fields.height, unit) });
}

/** What every label calls a flag or diffusion frame: its kind and size, "Diffusion · 8×8", "Bounce · 1.50 m". */
export const frameLabel = (fields: Pick<GripFields, 'icon' | 'width' | 'height'>, unit: PlanUnit): string => t('plan.frame.label', { what: frameName(fields.icon), size: frameSizeText(fields, unit) });

/** A frame as the legend lists it: its kind and size, or its own name with its size ("Key bounce · 4×4"). */
export const frameItemLabel = (fields: Pick<GripFields, 'icon' | 'width' | 'height' | 'name'>, unit: PlanUnit): string =>
  fields.name === '' ? frameLabel(fields, unit) : t('plan.frame.label', { what: fields.name, size: frameSizeText(fields, unit) });

/** A frame as a line in History names it: "a diffusion · 8×8". */
export function aFrame(fields: Pick<GripFields, 'icon' | 'width' | 'height'>, unit: PlanUnit): string {
  const words = Object.hasOwn(FRAME_WORDS, fields.icon) ? FRAME_WORDS[fields.icon] : undefined;
  return t('plan.frame.label', { what: words ? t(words.a) : anIcon(fields.icon), size: frameSizeText(fields, unit) });
}

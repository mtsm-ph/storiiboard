import { t, type MessageKey } from '../../../core/i18n';
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

/** An icon's name in the app's language: "Sofa"; its SVG's title when it has no words, its id when there's no icon. */
export function iconLabel(id: string): string {
  const words = Object.hasOwn(WORDS, id) ? WORDS[id] : undefined;
  if (words) return t(words.label);
  return byId.get(id)?.label ?? id;
}

/** An icon as a line in History names it: "a sofa". */
export function anIcon(id: string): string {
  const words = Object.hasOwn(WORDS, id) ? WORDS[id] : undefined;
  return words ? t(words.a) : t('history.aPlanItem');
}

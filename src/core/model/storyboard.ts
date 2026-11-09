import { readCrop, type Crop } from '../media/crop';
import { departmentStatuses, type DepartmentStatuses } from './departmentStatus';
import type { Props } from './record';
import { SHOT_STATUSES, type ShotStatus } from './shotStatus';
import { labels, t } from '../i18n';

// The storyboard's records, read from their props (docs/SBD_FORMAT.md, Storyboard props). Props stay open JSON, so
// these readers never trust a value: a missing or odd one reads as empty, and custom props pass through untouched.

export const SHOT_SIZES = ['EWS', 'WS', 'MS', 'MCU', 'CU', 'ECU', 'INSERT'] as const;
export type ShotSize = (typeof SHOT_SIZES)[number];
/** How each size reads on a card and in the shot list, in the app's language; the stored value stays as above. */
export const SHOT_SIZE_LABEL: Readonly<Record<ShotSize, string>> = labels({
  EWS: 'shotSize.ews',
  WS: 'shotSize.ws',
  MS: 'shotSize.ms',
  MCU: 'shotSize.mcu',
  CU: 'shotSize.cu',
  ECU: 'shotSize.ecu',
  INSERT: 'shotSize.insert',
});

export const SUPPORTS = ['sticks', 'handheld', 'shoulder', 'gimbal', 'steadicam', 'dolly', 'slider', 'crane', 'drone', 'car'] as const;
export const HEIGHTS = ['ground', 'low', 'hip', 'chest', 'eye', 'high', 'overhead'] as const;
export const MOVES = [
  'static',
  'pan',
  'tilt',
  'push in',
  'pull out',
  'track',
  'arc',
  'crane up',
  'crane down',
  'zoom in',
  'zoom out',
  'follow',
] as const;

export type Support = (typeof SUPPORTS)[number];
export type Height = (typeof HEIGHTS)[number];
export type Move = (typeof MOVES)[number];

export const INT_EXT = ['INT', 'EXT', 'INT/EXT'] as const;
export type IntExt = (typeof INT_EXT)[number];
export const DAY_NIGHT = ['DAY', 'NIGHT', 'DAWN', 'DUSK', 'MAGIC HOUR'] as const;
export type DayNight = (typeof DAY_NIGHT)[number];

// The words for each choice in the app's language. The file keeps the English value above, so a project reads the
// same in every language and exports from one language import into another.
export const SUPPORT_LABEL: Readonly<Record<Support, string>> = labels({
  sticks: 'support.sticks',
  handheld: 'support.handheld',
  shoulder: 'support.shoulder',
  gimbal: 'support.gimbal',
  steadicam: 'support.steadicam',
  dolly: 'support.dolly',
  slider: 'support.slider',
  crane: 'support.crane',
  drone: 'support.drone',
  car: 'support.car',
});
export const HEIGHT_LABEL: Readonly<Record<Height, string>> = labels({
  ground: 'height.ground',
  low: 'height.low',
  hip: 'height.hip',
  chest: 'height.chest',
  eye: 'height.eye',
  high: 'height.high',
  overhead: 'height.overhead',
});
export const MOVE_LABEL: Readonly<Record<Move, string>> = labels({
  static: 'move.static',
  pan: 'move.pan',
  tilt: 'move.tilt',
  'push in': 'move.push-in',
  'pull out': 'move.pull-out',
  track: 'move.track',
  arc: 'move.arc',
  'crane up': 'move.crane-up',
  'crane down': 'move.crane-down',
  'zoom in': 'move.zoom-in',
  'zoom out': 'move.zoom-out',
  follow: 'move.follow',
});
export const INT_EXT_LABEL: Readonly<Record<IntExt, string>> = labels({
  INT: 'intExt.int',
  EXT: 'intExt.ext',
  'INT/EXT': 'intExt.int-ext',
});
export const DAY_NIGHT_LABEL: Readonly<Record<DayNight, string>> = labels({
  DAY: 'dayNight.day',
  NIGHT: 'dayNight.night',
  DAWN: 'dayNight.dawn',
  DUSK: 'dayNight.dusk',
  'MAGIC HOUR': 'dayNight.magic-hour',
});

/** A stored choice in the app's language; a value from a later version or a hand edit reads as it is. */
export function choiceLabel(table: Readonly<Record<string, string>>, value: string): string {
  return Object.hasOwn(table, value) ? (table[value] ?? value) : value;
}

/** The project's frame shape (approved Nov 2), as written on a camera report, with its width over height. */
export const ASPECT_RATIOS = [
  { id: '2.39:1', ratio: 2.39 },
  { id: '2:1', ratio: 2 },
  { id: '1.85:1', ratio: 1.85 },
  { id: '16:9', ratio: 16 / 9 },
  { id: '4:3', ratio: 4 / 3 },
  { id: '1:1', ratio: 1 },
  { id: '4:5', ratio: 4 / 5 },
  { id: '9:16', ratio: 9 / 16 },
] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number]['id'];
export const DEFAULT_ASPECT_RATIO: AspectRatio = '16:9';

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const oneOf = <T extends string>(options: readonly T[], value: unknown): T | null =>
  options.includes(value as T) ? (value as T) : null;
const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export interface ProjectStoryboard {
  aspectRatio: AspectRatio;
  /** Skip I and O in shot letters; true unless the project allows them. */
  skipIO: boolean;
}

export function projectStoryboard(props: Props | undefined): ProjectStoryboard {
  return {
    aspectRatio: oneOf(ASPECT_RATIOS.map((a) => a.id), props?.aspect_ratio) ?? DEFAULT_ASPECT_RATIO,
    skipIO: props?.shot_letters_allow_io !== true,
  };
}

export function aspectRatioValue(id: AspectRatio): number {
  return ASPECT_RATIOS.find((a) => a.id === id)?.ratio ?? 16 / 9;
}

export interface SceneFields {
  /** As on the slate and in the script: "4", "4A", "12". */
  number: string;
  name: string;
  intExt: IntExt | null;
  dayNight: DayNight | null;
  locationId: string | null;
  /** Script length in eighths of a page; null until a script is imported or it's typed in. */
  pageEighths: number | null;
  numbersLocked: boolean;
  /** The scene's characters (3.13, schema 12): ids of the project's character records, in the script's order. */
  characterIds: string[];
}

export function sceneFields(props: Props): SceneFields {
  const characterIds = Array.isArray(props.character_ids) ? props.character_ids.filter((c): c is string => typeof c === 'string') : [];
  return {
    number: text(props.number),
    // Scenes made before 1.6 kept their heading in `heading`.
    name: text(props.name) || text(props.heading),
    intExt: oneOf(INT_EXT, props.int_ext),
    dayNight: oneOf(DAY_NIGHT, props.day_night),
    locationId: typeof props.location_id === 'string' ? props.location_id : null,
    pageEighths: number(props.page_eighths),
    numbersLocked: props.numbers_locked === true,
    characterIds,
  };
}

export interface ShotFields {
  number: string;
  /** An optional title (Nov 5), edited in place on the card and in the inspector: "Mary's reaction", "Wide on the dock". */
  title: string;
  size: ShotSize | null;
  lensMm: number | null;
  tStop: number | null;
  support: string;
  height: string;
  move: string;
  status: ShotStatus;
  action: string;
  dialogue: string;
  /** How far each department has got with the frame (polish 6). */
  departmentStatus: DepartmentStatuses;
  /** The `media` record the frame shows (1.11), a child of the shot; null for an empty frame. */
  mediaId: string | null;
  /** How the picture sits in the frame; centred and just covering it unless the person moved it. */
  crop: Crop;
}

export function shotFields(props: Props): ShotFields {
  return {
    number: text(props.number),
    title: text(props.title),
    size: oneOf(SHOT_SIZES, props.size),
    lensMm: number(props.lens_mm),
    tStop: number(props.t_stop),
    support: text(props.support),
    height: text(props.height),
    move: text(props.move),
    // A frame starts as one still to shoot.
    status: oneOf(SHOT_STATUSES, props.status) ?? 'need',
    action: text(props.action),
    dialogue: text(props.dialogue),
    departmentStatus: departmentStatuses(props),
    mediaId: typeof props.media_id === 'string' && props.media_id !== '' ? props.media_id : null,
    crop: readCrop(props),
  };
}

/** "6/8 pg", "1 pg", "1 3/8 pg": how page counts read on a breakdown sheet. */
export function pageLabel(eighths: number | null): string {
  if (eighths === null) return '—';
  return t('pages.label', { pages: pagesText(eighths) });
}

/** "6/8", "1", "1 3/8": a page count without its unit, as the inspector's Length field takes it. */
export function pagesText(eighths: number): string {
  const pages = Math.floor(eighths / 8);
  const rest = eighths % 8;
  if (rest === 0) return String(pages);
  return pages === 0 ? `${String(rest)}/8` : `${String(pages)} ${String(rest)}/8`;
}

/** "WS · 24MM · T2.8": a frame card's spec line, leaving out what isn't set. */
export function specLine(shot: ShotFields): string {
  const parts = [
    shot.size ? SHOT_SIZE_LABEL[shot.size] : null,
    shot.lensMm === null ? null : t('spec.lens', { mm: shot.lensMm }),
    shot.tStop === null ? null : tStopLabel(shot.tStop),
  ];
  return parts.filter((p) => p !== null).join(' · ');
}

/** T2.0, T2.8, T5.6 as lenses mark them, with one decimal; T11 and up as whole stops. */
export function tStopLabel(stop: number): string {
  return `T${stop >= 10 ? String(Math.round(stop)) : stop.toFixed(1)}`;
}

/** "SC 04": a plain number gets two digits, as on the boards; a lettered one ("4A") is kept as the slate has it. */
export function sceneLabel(number: string): string {
  return t('scene.label', { number: sceneNumberLabel(number) });
}

/** "04", "4A": a scene's number as its label shows it, without the "SC". */
export function sceneNumberLabel(number: string): string {
  return /^\d$/.test(number) ? number.padStart(2, '0') : number;
}

/** Every stop in thirds, as cine lenses are marked, from T1 to T22. */
export const T_STOPS = [1, 1.1, 1.3, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22] as const;

/** "1 3/8", "6/8" or "2" (pages) to eighths; null for anything else. The inverse of pageLabel. */
export function parsePages(text: string): number | null {
  const match = /^\s*(?:(\d+)\s+)?(?:(\d+)\s*\/\s*8|(\d+))\s*(?:pg|pages?)?\s*$/i.exec(text);
  if (!match) return null;
  const [, whole, eighths, plain] = match;
  if (plain !== undefined) return whole === undefined ? Number(plain) * 8 : null;
  const rest = Number(eighths);
  return rest < 8 ? Number(whole ?? 0) * 8 + rest : null;
}

/** A scene number as scripts write them: 4, 12, 4A, A1, 12BC. Stored upper-case. */
export function isSceneNumber(text: string): boolean {
  return /^[A-Z]{0,2}\d+[A-Z]{0,3}$/.test(text);
}

/**
 * Why a scene can't take `number`, or null when it can: it must read as a scene number, and no other scene may have
 * it, live or in the Trash (a trashed scene comes back with its number, so it stays taken until the Trash is emptied).
 */
export function sceneNumberProblem(number: string, live: readonly string[], trashed: readonly string[]): string | null {
  if (!isSceneNumber(number)) return t('scene.numberShape');
  if (live.includes(number)) return t('scene.numberTaken', { number });
  if (trashed.includes(number)) return t('scene.numberInTrash', { number });
  return null;
}

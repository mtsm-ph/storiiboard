import { labels, t } from '../i18n';
import type { Change } from '../ops/ops';
import type { JsonValue, Props, SbdRecord } from './record';

// Camera bodies and lenses (6.1, docs/PHASE6_DECISIONS.md 4 and 5). Both are `gear_item` records, so day lists, the
// gear check and the catalogue's totals count them as the gear they are; `kind` says which (`camera_body` or `lens`;
// absent, or anything else, for all other gear, so every item made before reads as gear).
//
// A body keeps the sensor area of the recording mode used (`sensor_width_mm`, `sensor_height_mm`, `sensor_mode`), a
// camera letter ("A", "B"…, unique among the project's live bodies) and `focal_equivalent` for a phone. The project's
// first body by letter is the default body, the one a camera on a plan uses until it's told otherwise (6.4).
//
// A lens keeps its focal range (`focal_min_mm`, `focal_max_mm`, equal for a prime) and its `squeeze` (1 when absent).
// A frame picks one by `lens_id`; its `lens_mm` stays the focal length used and must sit in the range. One reader
// decides what a frame's `lens_id` means (frameLens): a live lens, or none. A lens in the Trash, one turned into other
// gear, or an id naming nothing reads as "no lens picked", squeeze 1, everywhere; the frame keeps its id, so a restore
// brings the lens back to it untouched (as 6.0's setups do).

type Records = Readonly<Record<string, SbdRecord>>;

export const GEAR_KINDS = ['gear', 'camera_body', 'lens'] as const;
export type GearKind = (typeof GEAR_KINDS)[number];

export const GEAR_KIND_LABEL: Readonly<Record<GearKind, string>> = labels({
  gear: 'gear.kind.gear',
  camera_body: 'gear.kind.camera_body',
  lens: 'gear.kind.lens',
});

/** What an item is: a camera body, a lens, or gear (anything else, an item from before 6.1 included). */
export function gearKind(props: Props): GearKind {
  return props.kind === 'camera_body' || props.kind === 'lens' ? props.kind : 'gear';
}

/** The longest focal length a frame or a lens takes, as the Inspector's lens field has it. */
export const MAX_FOCAL_MM = 2000;
/** Large enough for any recording area made (65 mm formats are about 54 mm wide). */
export const MAX_SENSOR_MM = 100;
export const MIN_SQUEEZE = 1;
export const MAX_SQUEEZE = 2.5;
/** The usual anamorphic squeezes; any other between 1 and 2.5 is typed. */
export const SQUEEZES = [1, 1.33, 1.5, 1.8, 2] as const;

const within = (value: JsonValue | undefined, max: number): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max ? value : null;

export const isFocal = (mm: number): boolean => Number.isFinite(mm) && mm > 0 && mm <= MAX_FOCAL_MM;
export const isSensorSize = (mm: number): boolean => Number.isFinite(mm) && mm > 0 && mm <= MAX_SENSOR_MM;
export const isSqueeze = (squeeze: number): boolean => Number.isFinite(squeeze) && squeeze >= MIN_SQUEEZE && squeeze <= MAX_SQUEEZE;

// Bodies.

export const CAMERA_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export interface BodyFields {
  /** The recording mode's name, as typed or picked: "4.3K LF 16:9"; '' for none. */
  sensorMode: string;
  sensorWidthMm: number | null;
  sensorHeightMm: number | null;
  /** "A" for A cam; null when it has none (or one this version doesn't read). */
  letter: string | null;
  /** Its focal lengths are full-frame equivalents (a phone). */
  focalEquivalent: boolean;
}

export function bodyFields(props: Props): BodyFields {
  const letter = props.camera_letter;
  return {
    sensorMode: typeof props.sensor_mode === 'string' ? props.sensor_mode : '',
    sensorWidthMm: within(props.sensor_width_mm, MAX_SENSOR_MM),
    sensorHeightMm: within(props.sensor_height_mm, MAX_SENSOR_MM),
    letter: typeof letter === 'string' && CAMERA_LETTERS.includes(letter) ? letter : null,
    focalEquivalent: props.focal_equivalent === true,
  };
}

const live = (records: Records, projectId: string, kind: GearKind): SbdRecord[] =>
  Object.values(records).filter((r) => r.type === 'gear_item' && r.parentId === projectId && r.trashedAt === null && gearKind(r.props) === kind);

const bySortKey = (a: SbdRecord, b: SbdRecord) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

/** The project's live camera bodies by letter (A first), those without one last, in the order they were made. */
export function projectBodies(records: Records, projectId: string): { record: SbdRecord; fields: BodyFields }[] {
  const rank = (letter: string | null) => (letter === null ? CAMERA_LETTERS.length : CAMERA_LETTERS.indexOf(letter));
  return live(records, projectId, 'camera_body')
    .sort(bySortKey)
    .map((record) => ({ record, fields: bodyFields(record.props) }))
    .sort((a, b) => rank(a.fields.letter) - rank(b.fields.letter));
}

/** The default body: the project's first by letter, or null when it has none. */
export function defaultBody(records: Records, projectId: string): { record: SbdRecord; fields: BodyFields } | null {
  return projectBodies(records, projectId)[0] ?? null;
}

/** The letters a body can take, in order: those no other live body of the project has, and its own. */
export function freeLetters(records: Records, projectId: string, bodyId: string | null = null): string[] {
  const taken = new Set(projectBodies(records, projectId).flatMap(({ record, fields }) => (record.id !== bodyId && fields.letter ? [fields.letter] : [])));
  return CAMERA_LETTERS.filter((letter) => !taken.has(letter));
}

// Lenses.

export interface LensFields {
  /** The focal range in mm, equal ends for a prime; null when none is set. */
  range: { min: number; max: number } | null;
  /** 1 for a spherical lens, and when absent or out of range. */
  squeeze: number;
}

export function lensFields(props: Props): LensFields {
  const min = within(props.focal_min_mm, MAX_FOCAL_MM);
  const max = within(props.focal_max_mm, MAX_FOCAL_MM);
  const squeeze = props.squeeze;
  const low = min ?? max;
  return {
    range: low === null ? null : { min: low, max: max !== null && max >= low ? max : low },
    squeeze: typeof squeeze === 'number' && isSqueeze(squeeze) ? squeeze : 1,
  };
}

export const isPrime = (fields: LensFields): boolean => fields.range !== null && fields.range.min === fields.range.max;

/** The project's live lenses, in the order they were made. */
export function projectLenses(records: Records, projectId: string): { record: SbdRecord; fields: LensFields }[] {
  return live(records, projectId, 'lens')
    .sort(bySortKey)
    .map((record) => ({ record, fields: lensFields(record.props) }));
}

/** "35 mm" or "24–70 mm"; '' with no range. */
export function focalLabel(range: LensFields['range']): string {
  if (!range) return '';
  return range.min === range.max ? t('lens.prime', { mm: range.min }) : t('lens.zoom', { from: range.min, to: range.max });
}

/** "24–70 mm 2×": its range, with its squeeze when it isn't 1. */
export function lensSpec(fields: LensFields): string {
  const focal = focalLabel(fields.range) || t('lens.noFocal');
  return fields.squeeze === 1 ? focal : t('lens.squeezed', { focal, squeeze: fields.squeeze });
}

/** A lens as a choice names it: "Cooke S4 · 35 mm", or its spec alone when unnamed. */
export function lensLabel(lens: { record: SbdRecord; fields: LensFields }): string {
  const name = typeof lens.record.props.name === 'string' ? lens.record.props.name.trim() : '';
  return name === '' ? lensSpec(lens.fields) : t('lens.named', { name, spec: lensSpec(lens.fields) });
}

/** A live lens by its id, or null. */
function liveLens(records: Records, id: string): SbdRecord | null {
  const lens = records[id];
  return lens?.type === 'gear_item' && lens.trashedAt === null && gearKind(lens.props) === 'lens' ? lens : null;
}

/**
 * The one reader of a frame's `lens_id`: the live lens it names, else null ("No lens picked", squeeze 1). A lens in
 * the Trash, one made into other gear, or an id that names nothing all read as none.
 */
export function frameLens(records: Records, shot: SbdRecord): { record: SbdRecord; fields: LensFields } | null {
  const id = shot.props.lens_id;
  if (typeof id !== 'string' || id === '') return null;
  const lens = liveLens(records, id);
  return lens ? { record: lens, fields: lensFields(lens.props) } : null;
}

/** The squeeze a frame is shot with: its lens's, else 1. */
export const frameSqueeze = (records: Records, shot: SbdRecord): number => frameLens(records, shot)?.fields.squeeze ?? 1;

/** Whether a focal length sits in a lens's range; any does when the lens has none. */
export const inRange = (fields: LensFields, mm: number): boolean => fields.range === null || (mm >= fields.range.min && mm <= fields.range.max);

/**
 * A frame's lens picked, or none (null), as one edit. A prime sets the frame's focal length to its own; a zoom keeps
 * the frame's when it's in the range, else takes the nearest end (the wide end when the frame has none). No lens
 * picked keeps the focal length as it is. Nothing when it's already so, or the frame or lens isn't live.
 */
export function pickLens(records: Records, shotId: string, lensId: string | null): Change[] {
  const shot = records[shotId];
  if (shot?.type !== 'shot' || shot.trashedAt !== null) return [];
  if (lensId === null) return shot.props.lens_id === undefined ? [] : [{ kind: 'update', id: shotId, unset: ['lens_id'] }];
  const lens = liveLens(records, lensId);
  if (!lens) return [];
  const { range } = lensFields(lens.props);
  const set: Record<string, JsonValue> = {};
  if (shot.props.lens_id !== lensId) set.lens_id = lensId;
  const mm = typeof shot.props.lens_mm === 'number' && Number.isFinite(shot.props.lens_mm) ? shot.props.lens_mm : null;
  if (range) {
    const next = mm === null ? range.min : Math.min(range.max, Math.max(range.min, mm));
    if (next !== mm) set.lens_mm = next;
  }
  return Object.keys(set).length === 0 ? [] : [{ kind: 'update', id: shotId, set }];
}

import { bodyFields, frameLens, freeLetters, gearKind, isFocal, isSensorSize, isSqueeze, type GearKind } from '../../core/model/cameraGear';
import { isDepartment } from '../../core/model/department';
import { gearFields, MAX_QUANTITY } from '../../core/model/gear';
import type { JsonValue, SbdRecord } from '../../core/model/record';
import { SENSOR_MODES } from '../../core/model/sensorModes';
import { keyBetween } from '../../core/ops/order';
import type { Change } from '../../core/ops/ops';

// The edits the Gear tile makes (3.9a): an item made, one field changed, one to the Trash, the project's currency.
// Each is one op group, so one ⌘Z.

type Records = Readonly<Record<string, SbdRecord>>;

const liveItem = (records: Records, id: string): SbdRecord | null => {
  const item = records[id];
  return item?.type === 'gear_item' && item.trashedAt === null ? item : null;
};

/** A new item after the project's others (in the Trash too, so a restored one never shares a key): one, owned. */
export function newGearItem(records: Records, projectId: string, id: string = crypto.randomUUID()): Extract<Change, { kind: 'create' }> {
  const last = Object.values(records)
    .filter((r) => r.type === 'gear_item' && r.parentId === projectId)
    .reduce<string | null>((max, r) => (max === null || r.sortKey > max ? r.sortKey : max), null);
  return { kind: 'create', record: { id, type: 'gear_item', parentId: projectId, sortKey: keyBetween(last, null), props: { name: '', quantity: 1, source: 'owned' } } };
}

/** A text field (name, owner, notes); nothing when it's already that, or something other than text is there. */
export function gearTextChange(records: Records, id: string, prop: 'name' | 'owner' | 'notes', value: string): Change[] {
  const item = liveItem(records, id);
  if (!item) return [];
  const stored = item.props[prop];
  if (stored !== undefined && typeof stored !== 'string') return [];
  return (stored ?? '') === value ? [] : [{ kind: 'update', id, set: { [prop]: value } }];
}

/** Its department, or none. */
export function gearDepartmentChange(records: Records, id: string, department: string | null): Change[] {
  const item = liveItem(records, id);
  if (!item || (department !== null && !isDepartment(department))) return [];
  const current = isDepartment(item.props.department) ? item.props.department : null;
  if (current === department) return [];
  return department === null ? [{ kind: 'update', id, unset: ['department'] }] : [{ kind: 'update', id, set: { department } }];
}

/** How many: a whole number from 1 to 999. */
export function gearQuantityChange(records: Records, id: string, quantity: number): Change[] {
  const item = liveItem(records, id);
  if (!item || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY || item.props.quantity === quantity) return [];
  return [{ kind: 'update', id, set: { quantity } }];
}

/** Owned or rented; one this version can't read is changed only when the person picks either. */
export function gearSourceChange(records: Records, id: string, source: 'owned' | 'rental'): Change[] {
  const item = liveItem(records, id);
  if (!item || gearFields(item.props).source === source) return [];
  return [{ kind: 'update', id, set: { source } }];
}

/** Its day rate, kept to the currency's smallest unit (`digits` decimals: 2 for cents, 0 for yen), or none with null. */
export function gearRateChange(records: Records, id: string, rate: number | null, digits = 2): Change[] {
  const item = liveItem(records, id);
  if (!item || (rate !== null && (!Number.isFinite(rate) || rate < 0))) return [];
  const unit = 10 ** digits;
  // Scaled, then read to 15 significant digits before rounding, so 1.005 or 349.995 (each a hair under in binary)
  // round up as written.
  const cents = rate === null ? null : Math.round(Number((rate * unit).toPrecision(15))) / unit;
  const current = typeof item.props.day_rate === 'number' ? item.props.day_rate : null;
  if (current === cents) return [];
  return cents === null ? [{ kind: 'update', id, unset: ['day_rate'] }] : [{ kind: 'update', id, set: { day_rate: cents } }];
}

/** An item to the Trash. */
export function trashGearItem(records: Records, id: string): Change[] {
  return liveItem(records, id) ? [{ kind: 'trash', id }] : [];
}

/** The project's currency for every price: a three-letter code. */
export function currencyChange(records: Records, projectId: string, currency: string): Change[] {
  const project = records[projectId];
  if (!project || !/^[A-Z]{3}$/.test(currency) || project.props.currency === currency) return [];
  return [{ kind: 'update', id: projectId, set: { currency } }];
}

/**
 * An item on or off a shot's gear or a shoot day's list (3.9b), as one edit; several at once with `gearIds`. What
 * else the list holds (another version's entries, items since deleted) is written back as it was. Nothing when it's
 * already so, the record isn't a live shot or day, or an item to add isn't live gear.
 */
export function gearListChange(records: Records, recordId: string, gearIds: readonly string[], on: boolean): Change[] {
  const record = records[recordId];
  if ((record?.type !== 'shot' && record?.type !== 'shoot_day') || record.trashedAt !== null) return [];
  const stored = record.props.gear_ids;
  // Something other than a list there (a newer version's) is never written over from here.
  if (stored !== undefined && !Array.isArray(stored)) return [];
  const list = Array.isArray(stored) ? stored : [];
  if (on && gearIds.some((id) => !liveItem(records, id))) return [];
  const asked = [...new Set(gearIds)];
  const next = on ? [...list, ...asked.filter((id) => !list.includes(id))] : list.filter((v) => typeof v !== 'string' || !gearIds.includes(v));
  if (next.length === list.length) return [];
  return next.length === 0 ? [{ kind: 'update', id: recordId, unset: ['gear_ids'] }] : [{ kind: 'update', id: recordId, set: { gear_ids: next } }];
}

// Camera bodies and lenses (6.1): what an item is, a body's recording mode and letter, a lens's range and squeeze.

/**
 * What an item is: gear, a camera body or a lens. Its other props are kept whatever it becomes, so turning it back
 * loses nothing. A body with no letter takes the first free one in the same edit.
 */
export function gearKindChange(records: Records, id: string, kind: GearKind): Change[] {
  const item = liveItem(records, id);
  if (!item || gearKind(item.props) === kind) return [];
  if (kind === 'gear') return [{ kind: 'update', id, unset: ['kind'] }];
  const set: Record<string, JsonValue> = { kind };
  if (kind === 'camera_body' && item.parentId) {
    const own = bodyFields(item.props).letter;
    const free = freeLetters(records, item.parentId, id);
    const letter = own !== null && free.includes(own) ? own : free[0];
    if (letter !== undefined && letter !== own) set.camera_letter = letter;
  }
  return [{ kind: 'update', id, set }];
}

const liveBody = (records: Records, id: string): SbdRecord | null => {
  const item = liveItem(records, id);
  return item && gearKind(item.props) === 'camera_body' ? item : null;
};

const liveLensItem = (records: Records, id: string): SbdRecord | null => {
  const item = liveItem(records, id);
  return item && gearKind(item.props) === 'lens' ? item : null;
};

/** A body's camera and recording mode picked from the table: its name, width and height, and whether it's a phone. */
export function sensorModePick(records: Records, id: string, modeId: string): Change[] {
  const item = liveBody(records, id);
  const entry = SENSOR_MODES.find((m) => m.id === modeId);
  if (!item || !entry) return [];
  const set: Record<string, JsonValue> = {};
  if (item.props.sensor_mode !== entry.mode) set.sensor_mode = entry.mode;
  if (item.props.sensor_width_mm !== entry.widthMm) set.sensor_width_mm = entry.widthMm;
  if (item.props.sensor_height_mm !== entry.heightMm) set.sensor_height_mm = entry.heightMm;
  if (entry.focalEquivalent === true && item.props.focal_equivalent !== true) set.focal_equivalent = true;
  const unset = entry.focalEquivalent !== true && item.props.focal_equivalent !== undefined ? ['focal_equivalent'] : [];
  if (Object.keys(set).length === 0 && unset.length === 0) return [];
  return [{ kind: 'update', id, ...(Object.keys(set).length > 0 ? { set } : {}), ...(unset.length > 0 ? { unset } : {}) }];
}

/** A body's mode name typed by hand; '' takes it off. */
export function sensorModeNameChange(records: Records, id: string, name: string): Change[] {
  const item = liveBody(records, id);
  if (!item) return [];
  const next = name.trim();
  const stored = item.props.sensor_mode;
  if (stored !== undefined && typeof stored !== 'string') return [];
  if ((stored ?? '') === next) return [];
  return next === '' ? [{ kind: 'update', id, unset: ['sensor_mode'] }] : [{ kind: 'update', id, set: { sensor_mode: next } }];
}

/**
 * A body's sensor width or height in mm, typed by hand; null takes it off. A size typed over the phones entry's 36 × 24
 * is no longer full-frame equivalents, so `focal_equivalent` comes off in the same edit (picking the entry sets it again).
 */
export function sensorSizeChange(records: Records, id: string, prop: 'sensor_width_mm' | 'sensor_height_mm', mm: number | null): Change[] {
  const item = liveBody(records, id);
  if (!item || (mm !== null && !isSensorSize(mm))) return [];
  const current = typeof item.props[prop] === 'number' ? item.props[prop] : null;
  if (current === mm) return [];
  const width = prop === 'sensor_width_mm' ? mm : item.props.sensor_width_mm;
  const height = prop === 'sensor_height_mm' ? mm : item.props.sensor_height_mm;
  const phones = SENSOR_MODES.find((m) => m.focalEquivalent === true);
  const equivalent = phones !== undefined && width === phones.widthMm && height === phones.heightMm;
  const unset = [...(mm === null ? [prop] : []), ...(item.props.focal_equivalent !== undefined && !equivalent ? ['focal_equivalent'] : [])];
  return [{ kind: 'update', id, ...(mm === null ? {} : { set: { [prop]: mm } }), ...(unset.length > 0 ? { unset } : {}) }];
}

/** A body's camera letter: one no other live body of the project has. */
export function cameraLetterChange(records: Records, id: string, letter: string): Change[] {
  const item = liveBody(records, id);
  if (!item?.parentId || !freeLetters(records, item.parentId, id).includes(letter) || item.props.camera_letter === letter) return [];
  return [{ kind: 'update', id, set: { camera_letter: letter } }];
}

/**
 * The frames whose lens (read through frameLens) is this one and whose focal length sits outside min–max, each with
 * the end of the range it would take: the nearer one, or the wide end for a frame with none (as pickLens gives it).
 * Frames in the Trash are among them, marked `trashed`: one left outside would come back from the Trash outside its
 * lens's range. Frames of a lens in the Trash are left as they are.
 */
export function framesOutsideRange(records: Records, lensId: string, min: number, max: number): { id: string; mm: number; trashed: boolean }[] {
  return Object.values(records).flatMap((shot) => {
    if (shot.type !== 'shot' || frameLens(records, shot)?.record.id !== lensId) return [];
    const stored = shot.props.lens_mm;
    // A value this version can't read (a newer one's) is never written over.
    if (stored !== undefined && (typeof stored !== 'number' || !Number.isFinite(stored))) return [];
    const mm = stored ?? null;
    if (mm !== null && mm >= min && mm <= max) return [];
    return [{ id: shot.id, mm: mm === null || mm < min ? min : max, trashed: shot.trashedAt !== null }];
  });
}

/**
 * The cameras on a plan (6.4) whose picked lens (`lens_id`) is this one and whose typed focal length sits outside
 * min–max, each with the nearer end, as framesOutsideRange has them: those in the Trash too, marked `trashed`. A camera
 * with no typed focal length keeps none (its own field takes an empty one), and a value this version can't read is
 * never written over.
 */
export function camerasOutsideRange(records: Records, lensId: string, min: number, max: number): { id: string; mm: number; trashed: boolean }[] {
  return Object.values(records).flatMap((camera) => {
    if (camera.type !== 'plan_item' || camera.props.kind !== 'camera' || camera.props.lens_id !== lensId) return [];
    const mm = camera.props.lens_mm;
    if (typeof mm !== 'number' || !Number.isFinite(mm) || (mm >= min && mm <= max)) return [];
    return [{ id: camera.id, mm: mm < min ? min : max, trashed: camera.trashedAt !== null }];
  });
}

/**
 * A lens's focal range in mm: from ≤ to, equal for a prime. Both ends in one edit, with every frame using the lens
 * outside the new range (in the Trash too) set to its nearer end, so a frame's `lens_mm` always sits in its lens's
 * range and one ⌘Z brings the range and the frames back together; so are the cameras on a plan that picked the lens
 * (6.4 review), whose own field would refuse a length outside it. The Gear tile asks before it when live ones change.
 */
export function lensRangeChange(records: Records, id: string, min: number, max: number): Change[] {
  const item = liveLensItem(records, id);
  if (!item || !isFocal(min) || !isFocal(max) || min > max) return [];
  if (item.props.focal_min_mm === min && item.props.focal_max_mm === max) return [];
  return [
    { kind: 'update', id, set: { focal_min_mm: min, focal_max_mm: max } },
    ...[...framesOutsideRange(records, id, min, max), ...camerasOutsideRange(records, id, min, max)].map(({ id: changed, mm }): Change => ({ kind: 'update', id: changed, set: { lens_mm: mm } })),
  ];
}

/** A lens's squeeze, from 1 to 2.5. */
export function lensSqueezeChange(records: Records, id: string, squeeze: number): Change[] {
  const item = liveLensItem(records, id);
  if (!item || !isSqueeze(squeeze) || item.props.squeeze === squeeze || (squeeze === 1 && item.props.squeeze === undefined)) return [];
  return [{ kind: 'update', id, set: { squeeze } }];
}

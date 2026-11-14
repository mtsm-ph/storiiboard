import { mediaFields } from '../../core/media/store';
import { departmentName, statusText } from '../../core/model/departmentStatus';
import { sceneApprovalText } from '../../core/model/sceneApprovals';
import { dayDateLabel, shootDayFields } from '../../core/model/shootDay';
import { DEPARTMENT_LABELS, isDepartment } from '../../core/model/department';
import { GEAR_SOURCE_LABEL, gearIdsOf } from '../../core/model/gear';
import { focalLabel, GEAR_KIND_LABEL, gearKind, lensFields } from '../../core/model/cameraGear';
import { modeLabel } from '../../core/model/sensorModes';
import { attachmentFields } from '../../core/model/attachment';
import { countryName } from '../../core/model/countries';
import { LOCATION_STATUS_LABEL } from '../../core/model/location';
import { PROJECT_STAGE_LABEL } from '../../core/model/projectDetails';
import { boardTitle } from '../moodboards/boards';
import { connectorFields, isConnector } from '../moodboards/connectorFields';
import { arrangedAs, coveredRows } from '../moodboards/arrangeNames';
import { itemFields, type ItemKind } from '../moodboards/items';
import { DECK_FIELD_LABEL } from '../moodboards/pageFormats';
import { ROLE_LABELS } from '../../core/model/role';
import { formatLength } from '../../core/model/length';
import { planUnitNow } from '../../app/planUnits';
import type { JsonValue, Props, SbdRecord } from '../../core/model/record';
import { SHOT_STATUS_LABELS } from '../../core/model/shotStatus';
import { HEIGHT_LABEL, MOVE_LABEL, pageLabel, sceneFields, sceneLabel, SHOT_SIZE_LABEL, shotFields, SUPPORT_LABEL } from '../../core/model/storyboard';
import type { GroupKind, LoggedOp, OpGroup } from '../../core/ops/ops';
import { POSITION_LABEL, POSITIONS } from '../export/watermark';
import { getLocale, labels, t, tn, type MessageKey, type Params, type PluralBase } from '../../core/i18n';

// What each step in History says (1.22): one line for an op group, in the board's words ("Added frame 4C", "4A: lens
// 35 → 50"), worked out from its ops' before and after. A drag that renumbers a scene is one step, "Moved 4B"; the
// renumbering it carried isn't listed apart. Undo, redo and restore name the step they went back to.

/**
 * A piece of a line: words, or a technical value (a shot or scene number, a lens, a T-stop) that the tile sets in
 * JetBrains Mono, as every technical value is (CLAUDE.md, Design). Kept apart in the line rather than found again
 * in its text, so a count ("3 frames") or a typed value never turns mono by looking like a number.
 */
export type Part = string | { mono: string };
export type Line = readonly Part[];

/** A line as plain text: for labels, notices and tests. */
export const lineText = (line: Line): string => line.map((part) => (typeof part === 'string' ? part : part.mono)).join('');

/**
 * A translated line whose placeholders can be parts: `{name}` takes parts.name, a frame's number in mono or words.
 * The message stays one sentence, so a language can put the name where its grammar wants it.
 */
function line(key: MessageKey, parts: Readonly<Record<string, Part>> = {}, params?: Params): Part[] {
  // The markers can't come from people's text: a NUL in a field's name is dropped, not taken for a part.
  const marked: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(params ?? {})) marked[name] = typeof value === 'string' ? value.split('\u0000').join('') : value;
  for (const name of Object.keys(parts)) marked[name] = `\u0000${name}\u0000`;
  return t(key, marked)
    .split('\u0000')
    .flatMap((piece, i): Part[] => (i % 2 === 1 ? [parts[piece] ?? ''] : piece === '' ? [] : [piece]));
}

/** What a relink changes on a video record: where its file is and what was read from it (src/core/media/video.ts). */
const VIDEO_FILE_PROPS = ['source_path', 'source_name', 'source_size', 'duration_frames', 'fps', 'start_timecode', 'width', 'height', 'codec'] as const;

/** Props by the names the inspector and the board give them. */
const FIELD: Readonly<Record<string, string>> = labels({
  number: 'history.field.number',
  size: 'history.field.size',
  lens_mm: 'history.field.lensMm',
  t_stop: 'history.field.tStop',
  support: 'history.field.support',
  height: 'history.field.height',
  move: 'history.field.move',
  status: 'history.field.status',
  action: 'history.field.action',
  dialogue: 'history.field.dialogue',
  departments: 'history.field.departments',
  department_status: 'history.field.departments',
  department_approvals: 'history.field.approvals',
  media_id: 'history.field.mediaId',
  crop: 'history.field.crop',
  clip: 'history.field.clip',
  lut: 'history.field.lut',
  custom: 'history.field.custom',
  name: 'history.field.name',
  int_ext: 'history.field.intExt',
  day_night: 'history.field.dayNight',
  location_id: 'history.field.locationId',
  cast_id: 'history.field.castId',
  page_eighths: 'history.field.pageEighths',
  numbers_locked: 'history.field.numbersLocked',
  shoot_day_id: 'history.field.shootDay',
  setup_id: 'history.field.setup',
  date: 'history.field.date',
  call_time: 'history.field.callTime',
  wrap_time: 'history.field.wrapTime',
  // A location's place on the map (3.4): three props, one thing to a person.
  latitude: 'history.field.mapPlace',
  longitude: 'history.field.mapPlace',
  map_name: 'history.field.mapPlace',
  map_moved: 'history.field.mapPlace',
  setup_minutes: 'history.field.setupMinutes',
  hmu_minutes: 'history.field.hmuMinutes',
  crew: 'history.field.crew',
  quantity: 'history.field.quantity',
  source: 'history.field.source',
  owner: 'history.field.owner',
  day_rate: 'history.field.dayRate',
  department: 'history.field.department',
  currency: 'history.field.currency',
  gear_ids: 'history.field.gearIds',
  full_view: 'history.field.fullView',
  contact_on_sheet: 'history.field.contactOnSheet',
  people_ids: 'history.field.peopleIds',
  department_calls: 'history.field.departmentCalls',
  person_times: 'history.field.personTimes',
  characters: 'history.field.characters',
  character_ids: 'history.field.characters',
  // A board's links (5.4).
  scene_ids: 'history.field.sceneIds',
  location_ids: 'history.field.locationIds',
  text: 'history.field.text',
  theme: 'history.field.theme',
  title: 'history.field.title',
  notes: 'history.field.notes',
  aspect_ratio: 'history.field.aspectRatio',
  state: 'history.field.state',
  palette: 'history.field.palette',
  shot_letters_allow_io: 'history.field.lettersAllowIO',
  stage: 'history.field.stage',
  logline: 'history.field.logline',
  format: 'history.field.format',
  runtime: 'history.field.runtime',
  client: 'history.field.client',
  deliverables: 'history.field.deliverables',
  company: 'history.field.company',
  address: 'history.field.address',
  contact_name: 'history.field.contactName',
  contact_phone: 'history.field.contactPhone',
  contact_email: 'history.field.contactEmail',
  parking: 'history.field.parking',
  time_zone: 'history.field.timeZone',
  country_code: 'history.field.countryCode',
  hospital_name: 'history.field.hospitalName',
  hospital_address: 'history.field.hospitalAddress',
  hospital_phone: 'history.field.hospitalPhone',
  hospital_latitude: 'history.field.hospitalLatitude',
  hospital_longitude: 'history.field.hospitalLongitude',
  hospital_emergency: 'history.field.hospitalEmergency',
  hospital_source: 'history.field.hospitalSource',
  phone: 'history.field.phone',
  email: 'history.field.email',
  role: 'history.field.role',
  power: 'history.field.power',
  rotation: 'history.field.rotation',
  // Camera bodies and lenses (6.1).
  kind: 'history.field.kind',
  sensor_mode: 'history.field.sensorMode',
  sensor_width_mm: 'history.field.sensorWidth',
  sensor_height_mm: 'history.field.sensorHeight',
  camera_letter: 'history.field.cameraLetter',
  focal_equivalent: 'history.field.focalEquivalent',
  focal_min_mm: 'history.field.focalMin',
  focal_max_mm: 'history.field.focalMax',
  squeeze: 'history.field.squeeze',
  lens_id: 'history.field.lensId',
  // A scene's room (6.2a).
  room_id: 'history.field.room',
});

/** Values that are slate and camera data, set in mono wherever a line shows them. */
const MONO = new Set(['number', 'lens_mm', 't_stop', 'sensor_width_mm', 'sensor_height_mm', 'camera_letter', 'focal_min_mm', 'focal_max_mm', 'squeeze']);

export const fieldLabel = (prop: string): string => FIELD[prop] ?? prop.replace(/_/g, ' ');

type JsonObject = { [key: string]: JsonValue };
const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The parts of a watermark (Watermark Settings, 1.24), by the names the dialog gives them. */
const WATERMARK_PART: Readonly<Record<string, string>> = labels({
  text: 'history.watermark.text',
  position: 'history.watermark.position',
  opacity: 'history.watermark.strength',
  applies_to: 'history.watermark.on',
});

function watermarkPart(part: string, value: JsonValue | undefined): string {
  if (part === 'text') return typeof value === 'string' ? `“${value.length > 30 ? `${value.slice(0, 29)}…` : value}”` : '—';
  if (part === 'opacity') return typeof value === 'number' ? `${String(Math.round(value * 100))}%` : '—';
  if (part === 'position') {
    if (typeof value !== 'string') return '—';
    return (POSITIONS as readonly string[]).includes(value) ? POSITION_LABEL[value as (typeof POSITIONS)[number]].toLowerCase() : value.replace(/-/g, ' ');
  }
  return Array.isArray(value) && value.length > 0 ? value.map((v) => (typeof v === 'string' ? v.toUpperCase() : JSON.stringify(v))).join(', ') : '—';
}

/**
 * A watermark step in words. The prop is one object, so the plain line read "watermark changed → changed" and
 * someone looking for the strength they had before couldn't tell one step from the next.
 */
function describeWatermark(before: JsonValue | undefined, after: JsonValue | undefined): string {
  const text = (value: JsonObject) => watermarkPart('text', value.text);
  if (!isObject(after)) return isObject(before) ? t('history.watermark.removedText', { text: text(before) }) : t('history.watermark.removed');
  if (!isObject(before)) return t('history.watermark.set', { text: text(after) });
  const parts = Object.keys(WATERMARK_PART).filter((part) => JSON.stringify(before[part]) !== JSON.stringify(after[part]));
  const [only] = parts;
  if (parts.length === 1 && only) {
    const change = { part: WATERMARK_PART[only] ?? only, before: watermarkPart(only, before[only]), after: watermarkPart(only, after[only]) };
    return only === 'text' ? t('history.watermark.textChange', change) : t('history.watermark.partChange', { ...change, text: text(after) });
  }
  return t('history.watermark.changed', { text: text(after), parts: parts.map((part) => WATERMARK_PART[part] ?? part).join(', ') });
}

/** A palette in a step: "#A35139 (locked), #1F2F4D (count 8)", or "no colours (count 8)". */
function paletteText(value: JsonObject): string {
  const colors = Array.isArray(value.colors) ? value.colors.filter(isObject) : [];
  const named = colors.flatMap((c) => (typeof c.hex === 'string' ? [c.locked === true ? t('history.paletteLocked', { hex: c.hex }) : c.hex] : []));
  const list = named.length > 0 ? named.join(', ') : t('history.paletteEmpty');
  // The count too, so a step that only changed it reads apart from its neighbours.
  return typeof value.size === 'number' ? t('history.paletteWithCount', { colours: list, count: value.size }) : list;
}

/** One deliverable as a step names it: its text, marked once delivered; `—` where there was none. */
function deliverableText(item: JsonValue | undefined, full: boolean): string {
  if (!isObject(item) || typeof item.text !== 'string') return '—';
  const text = full ? item.text : valueLabel('', item.text);
  return item.done === true ? t('history.deliverableDone', { text }) : text;
}

/** A project's deliverables by id: each one added, removed or changed is a change of its own (3.1). */
const deliverablesById = (props: Props): Readonly<Record<string, JsonValue>> => {
  const items = Array.isArray(props.deliverables) ? props.deliverables : [];
  return Object.fromEntries(items.flatMap((item) => (isObject(item) && typeof item.id === 'string' ? [[item.id, item] as const] : [])));
};

/** Whether a field's values are technical ones, shown in mono. */
export const isMono = (prop: string): boolean => MONO.has(prop);

/** A stored code by the word the board and the inspector show for it ("hmu" → "HMU", "need" → "Need to shoot"). */
const CHOICE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  departments: DEPARTMENT_LABELS,
  status: SHOT_STATUS_LABELS,
  size: SHOT_SIZE_LABEL,
  support: SUPPORT_LABEL,
  height: HEIGHT_LABEL,
  move: MOVE_LABEL,
  stage: PROJECT_STAGE_LABEL,
  role: ROLE_LABELS,
  // A connector's route and arrowheads (5.2).
  route: labels({ straight: 'history.route.straight', elbow: 'history.route.elbow', curved: 'history.route.curved' }),
  start_head: labels({ none: 'history.head.none', arrow: 'history.head.arrow' }),
  end_head: labels({ none: 'history.head.none', arrow: 'history.head.arrow' }),
};
/** Support, height and move read in lower case; the inspector's menus start them with a capital. */
const CAPITALISED = new Set(['support', 'height', 'move']);
const choiceLabel = (prop: string, value: string): string => {
  // A location's status (TBD, confirmed, cancelled, 3.3) shares the prop with a frame's (have, need, source): the codes
  // never overlap. Each table read as it is, so the words follow the language now, never the one at load.
  const table: Readonly<Record<string, string>> | undefined =
    prop === 'status' && Object.hasOwn(LOCATION_STATUS_LABEL, value) ? LOCATION_STATUS_LABEL : CHOICE[prop];
  const label = table && Object.hasOwn(table, value) ? (table[value] ?? value) : value;
  return CAPITALISED.has(prop) ? label.charAt(0).toUpperCase() + label.slice(1) : label;
};

/** A value as a step's line shows it: in the board's words, `—` for nothing, and a long text cut to one short line. */
export function valueLabel(prop: string, value: JsonValue | undefined): string {
  const text = valueText(prop, value);
  if (typeof value !== 'string' && typeof value !== 'number') return text;
  const line = text.replace(/\s+/g, ' ');
  return line.length > 40 ? `${line.slice(0, 39)}…` : line;
}

/**
 * A value in full, line breaks and all: what an item's own history shows, since that's where a person reads an old
 * action or dialogue before putting it back over the one there now.
 */
export function valueText(prop: string, value: JsonValue | undefined): string {
  if (value === undefined || value === null || value === '') return '—';
  // Its text, where and how strong, so an old watermark can be told apart before it's put back.
  if (prop === 'watermark' && isObject(value)) {
    return `${watermarkPart('text', value.text)}, ${watermarkPart('position', value.position)}, ${watermarkPart('opacity', value.opacity)}`;
  }
  // Kept by id, which means nothing to a person: a step names the location as it was then (describeEdit), and a
  // picture change reads as set, removed or replaced (pictureChange).
  if (prop === 'location_id') return t('history.aLocation');
  if (prop === 'cast_id') return t('history.aPerson');
  if (prop === 'shoot_day_id') return t('history.aShootDay');
  if (prop === 'setup_id') return t('history.aSetup');
  if (prop === 'lens_id') return t('history.aLens');
  if (prop === 'room_id') return t('history.aRoom');
  if (prop === 'wall_id') return t('history.aWall');
  // What a gear item is (6.1): gear, a camera body or a lens, in words. The values never meet another record's kinds.
  if (prop === 'kind' && (value === 'camera_body' || value === 'lens')) return GEAR_KIND_LABEL[value];
  // A body's sensor and a lens's range, in mm; its squeeze as a factor; the phones entry's mode in the language in use.
  if ((prop === 'sensor_width_mm' || prop === 'sensor_height_mm' || prop === 'focal_min_mm' || prop === 'focal_max_mm') && typeof value === 'number') {
    return t('history.mmValue', { mm: value });
  }
  if (prop === 'squeeze' && typeof value === 'number') return t('history.squeezeValue', { squeeze: value });
  if (prop === 'sensor_mode' && typeof value === 'string') return modeLabel(value);
  // Who's confirmed for a shoot day (3.8), kept by person id: said as how many.
  if (prop === 'crew' && isObject(value)) return tn('history.crewConfirmed', Object.values(value).filter((v) => v === 'confirmed').length);
  // The people on a shoot day (4.2), kept by id (some may since be in the Trash): a step names who, this just says it changed.
  if (prop === 'people_ids' && Array.isArray(value)) return value.length === 0 ? '—' : t('history.changed');
  // A board's linked scenes and locations (5.4), kept by id: said as how many (its characters are counted below).
  if (prop === 'scene_ids' && Array.isArray(value)) return tn('count.scenes', value.filter((id) => typeof id === 'string').length);
  if (prop === 'location_ids' && Array.isArray(value)) return tn('count.locations', value.filter((id) => typeof id === 'string').length);
  // A scene's characters (3.13), kept by id: said as how many.
  if (prop === 'character_ids' && Array.isArray(value)) return tn('count.characters', value.filter((id) => typeof id === 'string').length);
  // A frame's gear or a day's list (3.9b), kept by item id: said as how many.
  if (prop === 'gear_ids' && Array.isArray(value)) return tn('count.gearItems', gearIdsOf({ gear_ids: value }).length);
  // A gear item's department and whose it is (3.9a), in words rather than their stored ids.
  if (prop === 'department' && isDepartment(value)) return DEPARTMENT_LABELS[value];
  if (prop === 'source' && (value === 'owned' || value === 'rental')) return GEAR_SOURCE_LABEL[value];
  // A shoot day's date (3.7), as the Days tile writes it.
  if (prop === 'date' && typeof value === 'string') return dayDateLabel(value) || value;
  // A location's hospital (4.5): where it came from and whether it has an emergency room, in words; its country by name.
  if (prop === 'hospital_source' && value === 'osm') return t('history.searchSource');
  if (prop === 'hospital_emergency' && typeof value === 'boolean') return value ? t('hospital.emergencyRoom') : t('history.emergencyUnknown');
  if (prop === 'country_code' && typeof value === 'string' && /^[A-Z]{2}$/.test(value)) return countryName(value, getLocale());
  // A connector's ends (5.2): an item, or a point; the id means nothing to a person.
  if ((prop === 'from' || prop === 'to') && isObject(value) && (typeof value.item === 'string' || (typeof value.x === 'number' && typeof value.y === 'number'))) {
    return typeof value.item === 'string' ? t('history.anItem') : t('moodboard.connector.point');
  }
  if (prop === 'media_id') return t('history.aPicture');
  if (prop === 'clip') return t('history.aClip');
  // A video's LUT (2.5), kept by the id of its row.
  if (prop === 'lut') return t('history.aLut');
  // The production company (3.2) by its name as copied, never its ids or contact details.
  if (prop === 'company' && isObject(value)) return typeof value.name === 'string' && value.name !== '' ? value.name : t('history.aCompany');
  if (prop === 'lens_mm' && typeof value === 'number') return t('history.lens', { mm: value });
  if (prop === 't_stop' && typeof value === 'number') return t('history.tStop', { stop: value });
  // A scene's length, as a breakdown sheet reads it ("1 3/8 pg"), never its stored count of eighths.
  if (prop === 'page_eighths' && typeof value === 'number') return pageLabel(value);
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.map((v) => (typeof v === 'string' ? choiceLabel(prop, v) : JSON.stringify(v))).join(', ');
  // A scene's palette (polish PP): its colours in order, a locked one marked, so steps can be told apart.
  if (prop === 'palette' && isObject(value)) return paletteText(value);
  if (typeof value === 'object') return prop === 'custom' ? Object.keys(value).join(', ') || '—' : t('history.changed');
  if (typeof value === 'boolean') return value ? t('history.on') : t('history.off');
  return typeof value === 'string' ? choiceLabel(prop, value) : String(value);
}

const valuePart = (prop: string, value: JsonValue | undefined): Part => {
  const label = valueLabel(prop, value);
  return isMono(prop) && label !== '—' ? { mono: label } : label;
};

const isBlank = (value: JsonValue | undefined) => value === undefined || value === null || value === '';

/** What a change of a frame's picture did, since its value is only an id. */
export const pictureChange = (change: FieldChange): string =>
  isBlank(change.before) ? t('history.pictureSet') : isBlank(change.after) ? t('history.pictureRemoved') : t('history.pictureReplaced');

/** The props an update changed, by name. */
export function changedProps(before: SbdRecord, after: SbdRecord): string[] {
  const keys = new Set([...Object.keys(before.props), ...Object.keys(after.props)]);
  return [...keys].filter((key) => JSON.stringify(before.props[key]) !== JSON.stringify(after.props[key]));
}

/**
 * One field's change. A custom field is one entry of the frame's `custom` prop (1.19), so it's a change of its own,
 * named by the field's name: putting back "Drone" must leave "VFX" as it is now. A department's status (polish 6) is
 * one entry of `department_status` in the same way, named by the department.
 */
export interface FieldChange {
  prop: string;
  /** A custom field's name in `custom`; a department's id; a client contact's field (3.1); a deliverable's id (3.1). */
  key?: string;
  before: JsonValue | undefined;
  after: JsonValue | undefined;
  /** Said only as set, changed or removed, never as itself: a person's notes and own fields (3.5), which may hold
   * anything from an agent's phone to an allergy. */
  private?: true;
  /** A call sheet's note (4.1): `notes` there is the General notes, not the plain "notes" other records have. */
  sheet?: true;
  /** A board item's (5.0): its x and y are one position and its width and height one size, which a video's width isn't. */
  item?: true;
  /** A plan item's prop (6.2a), named as the Selection tile names it. */
  planItem?: true;
  /** A connector's (5.2): its width is a line's, not a size, and its route and heads have words of their own. */
  connector?: true;
}

const entriesOf = (props: Props, prop: string): Readonly<Record<string, JsonValue>> => {
  const value = props[prop];
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
};

/** Props kept as one object whose entries History lists one by one: the project's client contact (3.1) too. */
const BY_ENTRY = new Set(['custom', 'department_status', 'department_approvals', 'client']);

/** A client contact's fields by name; only its name and company are shown in History (3.1). */
const CLIENT_FIELD: Readonly<Record<string, string>> = labels({
  name: 'history.client.name',
  company: 'history.client.company',
  email: 'history.client.email',
  phone: 'history.client.phone',
});
/** Shown in History; any other client field (an email, a phone, one a later version adds) never is: History feeds notifications. */
const SHOWN_CLIENT_FIELDS = new Set(['name', 'company']);
const isClient = (change: FieldChange): change is FieldChange & { key: string } => change.prop === 'client' && change.key !== undefined;
const isDeliverable = (change: FieldChange): change is FieldChange & { key: string } => change.prop === 'deliverables' && change.key !== undefined;
/** A client field's value: a private one said only as set, changed or removed, never as itself. */
function clientValue(change: FieldChange & { key: string }, value: JsonValue | undefined, full: boolean): string {
  if (SHOWN_CLIENT_FIELDS.has(change.key)) return full ? valueText('', value) : valueLabel('', value);
  if (isBlank(value)) return '—';
  // Both sides set: it changed; one side: set or removed reads from the other side's `—`.
  return !isBlank(change.before) && !isBlank(change.after) ? t('history.changed') : t('history.notShown');
}

/** Every field an op changed, each custom field and each department's status on its own. */
export function fieldChanges(before: SbdRecord, after: SbdRecord): FieldChange[] {
  const changes = changedProps(before, after).flatMap((prop): FieldChange[] => {
    const byId = prop === 'deliverables';
    if (after.type === 'callsheet' && SHEET_TIMES.has(prop)) return sheetTimeChanges(prop, before.props[prop], after.props[prop]);
    if (!BY_ENTRY.has(prop) && !byId) return [{ prop, before: before.props[prop], after: after.props[prop] }];
    const was = byId ? deliverablesById(before.props) : entriesOf(before.props, prop);
    const now = byId ? deliverablesById(after.props) : entriesOf(after.props, prop);
    const entries = [...new Set([...Object.keys(was), ...Object.keys(now)])]
      .filter((key) => JSON.stringify(was[key]) !== JSON.stringify(now[key]))
      .map((key) => ({ prop, key, before: was[key], after: now[key] }));
    // A checklist that changed with no item changed (reordered, or an entry without an id): the list as a whole.
    return byId && entries.length === 0 ? [{ prop, before: before.props[prop], after: after.props[prop] }] : entries;
  });
  // The notes' text is never shown (they may hold a gate code or an allergy); call times are, before and after.
  if (after.type === 'callsheet') {
    return changes.map((change) => (SHEET_NOTES.has(change.prop) ? { ...change, sheet: true as const, private: true as const } : { ...change, sheet: true as const }));
  }
  if (after.type === 'plan_item') return changes.map((change) => ({ ...change, planItem: true as const }));
  if (after.type === 'board_item') {
    return changes.map((change) => ({ ...change, item: true as const, ...(isConnector(after) ? { connector: true as const } : {}) }));
  }
  return after.type === 'person' ? changes.map((change) => (PERSON_PRIVATE.has(change.prop) ? { ...change, private: true } : change)) : changes;
}

/** A call sheet's two notes: private, said only as set, changed or removed. */
const SHEET_NOTES: ReadonlySet<string> = new Set(['notes', 'safety_notes']);
/** The props holding a call sheet's times (4.2): department calls, and people's call, HMU ready and on set. */
const SHEET_TIMES: ReadonlySet<string> = new Set(['department_calls', 'person_times']);
const SHEET_PERSON_TIMES = ['call', 'hmu_ready', 'on_set'] as const;
const timeText = (value: JsonValue | undefined): string => (typeof value === 'string' ? value : '');

/**
 * A call sheet's times one by one: a department's call is the entry named by the department; a person's times are
 * three entries named `<person id>:call`, `:hmu_ready` and `:on_set`. A time not set reads as '' (shown `—`).
 */
function sheetTimeChanges(prop: string, was: JsonValue | undefined, now: JsonValue | undefined): FieldChange[] {
  const before = isObject(was) ? was : {};
  const after = isObject(now) ? now : {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  if (prop === 'department_calls') {
    return keys.filter((key) => timeText(before[key]) !== timeText(after[key])).map((key) => ({ prop, key, before: timeText(before[key]), after: timeText(after[key]) }));
  }
  return keys.flatMap((id) => {
    const a = isObject(before[id]) ? before[id] : {};
    const b = isObject(after[id]) ? after[id] : {};
    return SHEET_PERSON_TIMES.filter((field) => timeText(a[field]) !== timeText(b[field])).map((field) => ({ prop, key: `${id}:${field}`, before: timeText(a[field]), after: timeText(b[field]) }));
  });
}

/** The name of a person a step names, from the records it carries (`around`); "a person" when it can't say. */
function personNameIn(around: ReadonlyMap<string, SbdRecord> | undefined, id: string): string {
  const name = around?.get(id)?.props.name;
  return typeof name === 'string' && name !== '' ? name : t('history.aPerson');
}

const SHEET_TIME_LINE = { call: 'history.callOfPerson', hmu_ready: 'history.hmuReadyOfPerson', on_set: 'history.onSetOfPerson' } as const;

/** A call sheet's time as a field name: "Camera’s call", "Ana Ruiz’s call", "Ana Ruiz’s HMU ready". */
function sheetTimeLabel(change: FieldChange & { key: string }, around?: ReadonlyMap<string, SbdRecord>): string {
  if (change.prop === 'department_calls') return t('history.callOfDepartment', { department: departmentName(change.key) });
  const [id = '', field = 'call'] = change.key.split(':');
  const key = Object.hasOwn(SHEET_TIME_LINE, field) ? SHEET_TIME_LINE[field as keyof typeof SHEET_TIME_LINE] : SHEET_TIME_LINE.call;
  return t(key, { name: personNameIn(around, id) });
}

/** A call sheet's names for its two notes (4.1). */
const CALLSHEET_FIELD: Readonly<Record<string, string>> = labels({
  notes: 'history.field.callsheetNotes',
  safety_notes: 'history.field.callsheetSafety',
});

/** A person's props said only as set, changed or removed (3.5): their notes and own fields, besides PRIVATE_PROPS. */
const PERSON_PRIVATE: ReadonlySet<string> = new Set(['notes', 'custom']);

const isStatus = (change: FieldChange): change is FieldChange & { key: string } => change.prop === 'department_status' && change.key !== undefined;
/** A department's approvals of a scene (3.6b), one entry of `department_approvals`, named by the department too. */
const isSceneApproval = (change: FieldChange): change is FieldChange & { key: string } =>
  change.prop === 'department_approvals' && change.key !== undefined;

/** A board item's props by the words a person uses (5.0). */
const BOARD_ITEM_FIELD: Readonly<Record<string, string>> = labels({
  x: 'history.field.position',
  y: 'history.field.position',
  width: 'history.field.boardSize',
  height: 'history.field.boardSize',
  text: 'history.field.boardText',
  fill: 'history.field.fill',
  stroke: 'history.field.stroke',
  color: 'history.field.colour',
  font_family: 'history.field.font',
  font_weight: 'history.field.fontStyle',
  font_italic: 'history.field.fontStyle',
  font_size: 'history.field.fontSize',
  align: 'history.field.alignment',
  name: 'history.field.sectionName',
});

/** A plan item's props by the Selection tile's words (6.2a). */
const PLAN_ITEM_FIELD: Readonly<Record<string, string>> = labels({
  x: 'history.field.position',
  y: 'history.field.position',
  width: 'history.field.wallLength',
  height: 'history.field.wallThickness',
  height_m: 'history.field.wallHeight',
  rotation: 'history.field.rotation',
  name: 'history.field.planName',
  // A door's or window's (6.2b).
  along_m: 'history.field.alongWall',
  width_m: 'history.field.openingWidth',
  hinge: 'history.field.hinge',
  swing: 'history.field.swing',
  wall_id: 'history.field.wall',
});

/** A connector's props by the words a person uses (5.2). */
const CONNECTOR_FIELD: Readonly<Record<string, string>> = labels({
  route: 'history.field.route',
  start_head: 'history.field.startHead',
  end_head: 'history.field.endHead',
  label: 'history.field.label',
  width: 'history.field.lineWidth',
  color: 'history.field.colour',
  from: 'history.field.connectorStart',
  to: 'history.field.connectorEnd',
});

/** Tidy up's steps by what they made (5.3). */
const TIDIED = { row: 'history.boardItemsTidiedRow', column: 'history.boardItemsTidiedColumn', grid: 'history.boardItemsTidiedGrid' } as const;

/** What a board item is called in a line: "a rectangle", "a text box" (5.1a). */
const A_BOARD_ITEM: Readonly<Record<ItemKind, MessageKey>> = {
  rect: 'history.aRectangle',
  ellipse: 'history.aEllipse',
  triangle: 'history.aTriangle',
  diamond: 'history.aDiamond',
  text: 'history.aTextBox',
  sticky: 'history.aSticky',
  picture: 'history.aPicture',
  video: 'history.aVideoCard',
  link: 'history.aLinkCard',
  section: 'history.aSection',
  shot_card: 'history.aShotCard',
  scene_card: 'history.aSceneCard',
  palette_card: 'history.aPaletteCard',
  brand_card: 'history.aBrandCard',
  page: 'history.aPage',
  field_card: 'history.aFieldCard',
};

/** A field's name in a line: a custom field by its own name, a department's status by the department's. */
export const changeLabel = (change: FieldChange, around?: ReadonlyMap<string, SbdRecord>): string =>
  change.connector === true && Object.hasOwn(CONNECTOR_FIELD, change.prop)
    ? (CONNECTOR_FIELD[change.prop] ?? change.prop)
    : change.planItem === true && Object.hasOwn(PLAN_ITEM_FIELD, change.prop)
    ? (PLAN_ITEM_FIELD[change.prop] ?? change.prop)
    : change.item === true && Object.hasOwn(BOARD_ITEM_FIELD, change.prop)
    ? (BOARD_ITEM_FIELD[change.prop] ?? change.prop)
    : change.sheet === true && change.key !== undefined && SHEET_TIMES.has(change.prop)
    ? sheetTimeLabel({ ...change, key: change.key }, around)
    : change.sheet === true && change.key === undefined && Object.hasOwn(CALLSHEET_FIELD, change.prop)
    ? (CALLSHEET_FIELD[change.prop] ?? change.prop)
    : isStatus(change) || isSceneApproval(change)
    ? departmentName(change.key)
    : isClient(change)
      ? (CLIENT_FIELD[change.key] ?? t('history.client.unknownField', { field: change.key }))
      : isDeliverable(change)
        ? t('history.deliverable')
        : (change.key ?? fieldLabel(change.prop));
/**
 * A change's value. A custom field that isn't on the frame at all reads "no field", apart from an empty one (`—`):
 * putting back one takes the field off, the other keeps it.
 */
/**
 * Contact details and addresses (a location's, 3.3; call sheets treat them as private): History names the field and
 * says it was set, changed or removed, never the value, since History feeds notifications.
 */
// A location's place on the map (3.4) says where its address is, so it's kept as the address is.
const PRIVATE_PROPS: ReadonlySet<string> = new Set(['address', 'latitude', 'longitude', 'map_name', 'contact_phone', 'contact_email', 'phone', 'email', 'hospital_address', 'hospital_phone', 'hospital_latitude', 'hospital_longitude']);
const isPrivate = (change: FieldChange): boolean => change.private === true || (change.key === undefined && PRIVATE_PROPS.has(change.prop));
const privateValue = (change: FieldChange, value: JsonValue | undefined): string =>
  isBlank(value) ? '—' : !isBlank(change.before) && !isBlank(change.after) ? t('history.changed') : t('history.notShown');

/** A plan item's lengths in the unit this computer shows (3.50 m, 12' 6"), its rotation in degrees (6.2a); null for its other props. */
const PLAN_LENGTHS: ReadonlySet<string> = new Set(['x', 'y', 'width', 'height', 'height_m', 'along_m', 'width_m']);
/** A door's hinge and swing (6.2b) in the Selection tile's words. */
const OPENING_WORDS: Readonly<Record<string, string>> = labels({
  'hinge:start': 'selection.hinge.start',
  'hinge:end': 'selection.hinge.end',
  'swing:left': 'selection.swing.left',
  'swing:right': 'selection.swing.right',
});
function planItemValue(change: FieldChange, value: JsonValue | undefined): string | null {
  if (change.planItem !== true || change.key !== undefined) return null;
  if (typeof value === 'string' && (change.prop === 'hinge' || change.prop === 'swing')) return OPENING_WORDS[`${change.prop}:${value}`] ?? null;
  if (typeof value !== 'number') return null;
  if (PLAN_LENGTHS.has(change.prop)) return formatLength(value, planUnitNow());
  if (change.prop === 'rotation') return t('plan.degrees', { value: String(Math.round(value * 100) / 100) });
  return null;
}

export const changeValue = (change: FieldChange, value: JsonValue | undefined): string =>
  planItemValue(change, value) ??
  (isPrivate(change)
    ? privateValue(change, value)
    : isStatus(change)
    ? statusText(value)
    : isSceneApproval(change)
    ? sceneApprovalText(value)
    : isClient(change)
      ? clientValue(change, value, false)
      : isDeliverable(change)
        ? deliverableText(value, false)
        : change.key === undefined ? valueLabel(change.prop, value) : value === undefined ? t('history.noField') : valueLabel('', value));
/** A change's value in full, for an item's own history and its Put back: never cut short. */
export const changeText = (change: FieldChange, value: JsonValue | undefined): string =>
  planItemValue(change, value) ??
  (isPrivate(change)
    ? privateValue(change, value)
    : isStatus(change)
    ? statusText(value)
    : isSceneApproval(change)
    ? sceneApprovalText(value)
    : isClient(change)
      ? clientValue(change, value, true)
      : isDeliverable(change)
        ? deliverableText(value, true)
        : change.key === undefined ? valueText(change.prop, value) : value === undefined ? t('history.noField') : valueText('', value));
const changeValuePart = (change: FieldChange, value: JsonValue | undefined): Part => {
  // A wall's length is a technical value: mono.
  const planned = planItemValue(change, value);
  if (planned !== null) return { mono: planned };
  return change.key === undefined && !isPrivate(change) ? valuePart(change.prop, value) : changeValue(change, value);
};

/** Props that keep another record by id, and what a step calls it when that record can't be named. */
const KEPT_BY_ID: ReadonlyMap<string, MessageKey> = new Map<string, MessageKey>([
  ['location_id', 'history.aLocation'],
  ['cast_id', 'history.aPerson'],
  ['shoot_day_id', 'history.aShootDay'],
  ['setup_id', 'history.aSetup'],
  ['lens_id', 'history.aLens'],
  ['room_id', 'history.aRoom'],
  // A door's or window's wall (6.2b): never shown by its id.
  ['wall_id', 'history.aWall'],
]);

/** A setup as History names one (6.0), by its name: its number is its place among the scene's setups now, not then. */
export function setupName(record: SbdRecord): string {
  const name = typeof record.props.name === 'string' ? record.props.name.trim() : '';
  return name === '' ? t('history.aSetup') : t('history.setupCalled', { name });
}

/**
 * What an item's own history calls a record a frame or a scene keeps by id (`location_id`, `shoot_day_id`,
 * `setup_id`), as the board has it now; null when it has no name to give.
 */
export function namedById(record: SbdRecord | undefined): string | null {
  // A shoot day (3.7) by its date, as History names one.
  if (record?.type === 'shoot_day') return dayDateLabel(shootDayFields(record.props).date) || t('history.undatedDay');
  if (record?.type === 'setup') return setupName(record);
  // A room (6.2a) by its name, as a location is.
  if (record?.type === 'plan') return typeof record.props.name === 'string' && record.props.name.trim() !== '' ? record.props.name.trim() : null;
  return record?.type === 'location' && typeof record.props.name === 'string' && record.props.name !== '' ? record.props.name : null;
}

const SENSOR_PICK = new Set(['sensor_mode', 'sensor_width_mm', 'sensor_height_mm', 'focal_equivalent']);

/**
 * The steps of 6.1's bodies and lenses that change more than one prop at once, each in one line: a frame's lens
 * picked (its focal length with it), an item made a body (its letter with it), a recording mode picked from the table,
 * a lens's range. Null for any other step.
 */
function cameraGearLine(op: LoggedOp, around: ReadonlyMap<string, SbdRecord>): Part[] | null {
  const { before, after } = op;
  if (!before || !after) return null;
  const changed = changedProps(before, after);
  if (changed.length === 0) return null;
  const who = capitalise(nameOf(after, around));
  if (after.type === 'shot' && changed.includes('lens_id') && changed.every((prop) => prop === 'lens_id' || prop === 'lens_mm')) {
    const id = after.props.lens_id;
    if (typeof id !== 'string' || id === '') return line('history.lensCleared', { who });
    const lens = around.get(id);
    const name = lens ? nameOf(lens) : t('history.aLens');
    // The focal length too when the pick changed it (a prime's own, a zoom's nearer end).
    const mm = after.props.lens_mm;
    if (changed.includes('lens_mm') && typeof mm === 'number') return line('history.lensPickedAt', { who, lens: name, mm: { mono: t('history.mmValue', { mm }) } });
    return line('history.lensPicked', { who, lens: name });
  }
  if (after.type !== 'gear_item') return null;
  if (changed.includes('kind') && changed.every((prop) => prop === 'kind' || prop === 'camera_letter')) {
    return line('history.gearKindChange', { who }, { kind: GEAR_KIND_LABEL[gearKind(after.props)] });
  }
  if (changed.length > 1 && changed.every((prop) => SENSOR_PICK.has(prop))) {
    const mode = typeof after.props.sensor_mode === 'string' ? modeLabel(after.props.sensor_mode) : '—';
    const [width, height] = [after.props.sensor_width_mm, after.props.sensor_height_mm];
    const size = typeof width === 'number' && typeof height === 'number' ? t('history.sensorSize', { width, height }) : '—';
    return line('history.sensorModePicked', { who, size: { mono: size } }, { mode });
  }
  if (changed.length > 1 && changed.every((prop) => prop === 'focal_min_mm' || prop === 'focal_max_mm')) {
    return line('history.lensRange', { who, range: { mono: focalLabel(lensFields(after.props).range) || '—' } });
  }
  return null;
}

/** A room as History names one (6.2a): by its name as the step left it. */
function roomName(record: SbdRecord | null | undefined): string {
  const name = typeof record?.props.name === 'string' ? record.props.name.trim() : '';
  return name === '' ? t('history.aRoom') : t('history.roomCalled', { name });
}

/**
 * One line for a plan's step (6.2a), or null when the step isn't only a plan's: a room started (with its scene's
 * `room_id`) or renamed; walls drawn, moved, turned, resized, changed, reordered, deleted or restored, counted.
 */
function planLine(ops: readonly LoggedOp[], around: ReadonlyMap<string, SbdRecord>): Line | null {
  const record = (op: LoggedOp) => op.after ?? op.before;
  const isPlan = (op: LoggedOp) => record(op)?.type === 'plan' || record(op)?.type === 'plan_item';
  const roomLink = (op: LoggedOp) =>
    op.kind === 'update' && op.before?.type === 'scene' && op.after !== null && changedProps(op.before, op.after).every((prop) => prop === 'room_id');
  // A scene set in a room already drawn (6.2b): its `room_id` alone.
  if (ops.length === 1 && ops[0] && roomLink(ops[0]) && !ops.some(isPlan)) {
    const scene = record(ops[0]);
    const roomId = scene?.props.room_id;
    const room = typeof roomId === 'string' ? (around.get(roomId) ?? null) : null;
    return line('history.roomChosen', { scene: nameOf(scene, around) }, { name: roomName(room) });
  }
  if (!ops.some(isPlan)) return null;
  if (!ops.every((op) => isPlan(op) || roomLink(op))) return null;
  const items = ops.filter((op) => record(op)?.type === 'plan_item');
  const started = ops.find((op) => op.kind === 'create' && op.after?.type === 'plan' && op.after.props.kind === 'room');
  if (started) {
    const linked = ops.find(roomLink);
    const scene = linked ? record(linked) : null;
    // A room made with items in it is a separate copy of another (6.2b).
    if (items.length > 0) return line('history.roomCopied', { scene: nameOf(scene, around) }, { name: roomName(started.after) });
    return line('history.roomStarted', { scene: nameOf(scene, around) }, { name: roomName(started.after) });
  }
  const renamed = ops.find((op) => op.kind === 'update' && op.before?.type === 'plan' && op.after !== null);
  if (renamed?.before && renamed.after) {
    const name = typeof renamed.after.props.name === 'string' ? renamed.after.props.name.trim() : '';
    return [t('history.roomRenamed', { from: roomName(renamed.before), name })];
  }
  // A room deleted or restored with its items (6.2b: Delete room).
  const roomGone = ops.find((op) => (op.kind === 'trash' || op.kind === 'restore') && record(op)?.type === 'plan');
  if (roomGone) return [t(roomGone.kind === 'trash' ? 'history.roomDeleted' : 'history.roomRestored', { name: roomName(record(roomGone)) })];
  const n = new Set(items.map((op) => op.recordId)).size;
  if (n === 0) return null;
  const all = (kind: LoggedOp['kind']) => items.every((op) => op.kind === kind);
  const planKindOf = (id: string | null | undefined): unknown => {
    if (!id) return undefined;
    const made = ops.find((op) => op.recordId === id && op.after?.type === 'plan');
    return (made?.after ?? around.get(id))?.props.kind;
  };
  // Moved to another plan (6.2b): into one setup's own, or back to every setup.
  const moves = items.filter((op) => op.kind === 'move' && op.before && op.after && op.before.parentId !== op.after.parentId);
  const rewalled = items.some((op) => op.kind === 'update' && op.before && op.after && changedProps(op.before, op.after).includes('wall_id'));
  if (moves.length > 0 && !rewalled && items.every((op) => op.kind === 'move' || op.kind === 'update')) {
    const intoSetup = moves.every((op) => planKindOf(op.after?.parentId) === 'setup');
    return [tn(intoSetup ? 'history.toSetupOnly' : 'history.backToEverySetup', moves.length)];
  }
  // Copied from another setup (6.2b): items made in a setup's own plan.
  if (all('create') && items.every((op) => planKindOf(op.after?.parentId) === 'setup')) return [tn('history.setupCopied', n)];
  // Doors and windows (6.2b), named as what they are; a wall's openings that go and come back with it aren't counted.
  const kinds = new Set(items.map((op) => record(op)?.props.kind));
  const openingOnly = [...kinds].every((kind) => kind === 'door' || kind === 'window');
  if (openingOnly) {
    const mixed = kinds.size > 1;
    const one = mixed ? 'history.anOpening' : kinds.has('door') ? 'history.aDoor' : 'history.aWindow';
    const many = mixed ? 'history.openingsNoun' : kinds.has('door') ? 'history.doorsNoun' : 'history.windowsNoun';
    const say = (base: Parameters<typeof tn>[0]) => [tn(base, n, { what: t(n === 1 ? one : many) })];
    if (all('create')) return say('history.openingsPlaced');
    if (all('trash')) return say('history.openingsDeleted');
    if (all('restore')) return say('history.openingsRestored');
    if (!items.every((op) => op.kind === 'update' || op.kind === 'move')) return null;
    const props = new Set(items.flatMap((op) => (op.before && op.after ? changedProps(op.before, op.after) : [])));
    const only = (allowed: readonly string[]) => props.size > 0 && [...props].every((prop) => allowed.includes(prop));
    if (only(['along_m', 'wall_id'])) return say('history.openingsMoved');
    if (only(['width_m', 'along_m'])) return say('history.openingsResized');
    if (only(['hinge', 'swing'])) return say('history.openingsFlipped');
    return say('history.openingsChanged');
  }
  const walls = items.filter((op) => record(op)?.props.kind === 'wall');
  const w = new Set(walls.map((op) => op.recordId)).size;
  if (all('create')) return [tn('history.wallsDrawn', w > 0 ? w : n)];
  if (all('trash')) return [tn('history.wallsDeleted', w > 0 ? w : n)];
  if (all('restore')) return [tn('history.wallsRestored', w > 0 ? w : n)];
  if (all('move')) return [tn('history.planItemsReordered', n)];
  if (!all('update')) return null;
  const props = new Set(items.flatMap((op) => (op.before && op.after ? changedProps(op.before, op.after) : [])));
  const only = (allowed: readonly string[]) => props.size > 0 && [...props].every((prop) => allowed.includes(prop));
  if (only(['x', 'y'])) return [tn('history.wallsMoved', n)];
  if (props.has('rotation') && only(['x', 'y', 'rotation'])) return [tn('history.wallsRotated', n)];
  if (only(['x', 'y', 'width', 'height', 'rotation'])) return [tn('history.wallsResized', n)];
  return [tn('history.wallsChanged', n)];
}

/** How a record is named in a step: a frame by its number, a scene by its slate label. */
function nameOf(record: SbdRecord | null, around: ReadonlyMap<string, SbdRecord> = new Map()): Part {
  if (!record) return t('history.anItem');
  switch (record.type) {
    case 'shot': {
      const number = shotFields(record.props).number;
      return number ? { mono: number } : t('history.aFrame');
    }
    case 'scene':
      return { mono: sceneLabel(sceneFields(record.props).number) };
    case 'note':
      return t('history.aNote');
    case 'location':
      return typeof record.props.name === 'string' ? record.props.name : t('history.aLocation');
    case 'character':
      return typeof record.props.name === 'string' ? record.props.name : t('history.aCharacter');
    case 'person':
      return typeof record.props.name === 'string' && record.props.name !== '' ? record.props.name : t('history.aPerson');
    case 'gear_item':
      return typeof record.props.name === 'string' && record.props.name !== '' ? record.props.name : t('history.aGearItem');
    case 'setup':
      return setupName(record);
    case 'shoot_day': {
      // By its date (3.7); its number belongs to the order the days are in now.
      const date = dayDateLabel(shootDayFields(record.props).date);
      return date || t('history.undatedDay');
    }
    case 'callsheet': {
      // By its day, as the step left it (`around`): "Call sheet · Mon, Nov 16".
      const day = record.parentId ? around.get(record.parentId) : undefined;
      return day ? t('history.callsheetOf', { day: dayDateLabel(shootDayFields(day.props).date) || t('history.undatedDay') }) : t('history.aCallsheet');
    }
    case 'plan':
      return roomName(record);
    case 'plan_item':
      return t(record.props.kind === 'door' ? 'history.aDoor' : record.props.kind === 'window' ? 'history.aWindow' : 'history.aWall');
    case 'board':
      return boardTitle(record);
    case 'board_item': {
      const fields = itemFields(record.props);
      const kind = fields?.kind;
      if (!kind && isConnector(record)) return t('history.aConnector');
      // A live card (5.4) is named by the frame or scene it shows, as it was then (`around`): "shot card 4A".
      if (fields?.kind === 'shot_card') {
        const shot = around.get(fields.shotId);
        const number = shot ? shotFields(shot.props).number : '';
        if (number !== '') return t('history.shotCardNumbered', { number });
      }
      if (fields?.kind === 'scene_card' || fields?.kind === 'palette_card') {
        const scene = around.get(fields.sceneId);
        if (scene) return t(fields.kind === 'scene_card' ? 'history.sceneCardNamed' : 'history.paletteCardNamed', { name: sceneLabel(sceneFields(scene.props).number) });
      }
      // A deck's page is named by its name (5.5) and a field card by its field.
      if (fields?.kind === 'page' && fields.name.trim() !== '') return t('history.pageNamed', { name: fields.name.trim() });
      if (fields?.kind === 'field_card' && fields.field !== '') return t('history.fieldCardNamed', { field: DECK_FIELD_LABEL[fields.field] });
      return t(kind ? A_BOARD_ITEM[kind] : 'history.aRectangle');
    }
    case 'project':
      return t('history.theProject');
    case 'media': {
      // A PDF or a link (3.11), by its name.
      const attachment = attachmentFields(record.props);
      if (attachment) return attachment.name || (attachment.kind === 'link' ? attachment.url : t('assets.unnamedPdf'));
      return t('history.aPicture');
    }
    default:
      // Never the record type itself: it's an English word in the file ("gear_item"), wrong in any language. The
      // types a step can show today are named above; later phases add their own words (P7's low).
      return t('history.anItem');
  }
}

const capitalise = (part: Part): Part => (typeof part === 'string' ? part.charAt(0).toUpperCase() + part.slice(1) : part);

/** A count of a kind of record: "3 frames". */
const COUNT: Readonly<Partial<Record<SbdRecord['type'], PluralBase>>> = {
  shot: 'count.frames',
  scene: 'count.scenes',
  note: 'count.notes',
  location: 'count.locations',
  character: 'count.characters',
  person: 'count.people',
  shoot_day: 'count.shootDays',
  setup: 'count.setups',
  gear_item: 'count.gearItems',
  board: 'count.boards',
  board_item: 'count.rectangles',
  plan_item: 'count.planItems',
  stroke: 'count.strokes',
  media: 'count.pictures',
};
const count = (type: SbdRecord['type'], n: number): string => {
  const base = COUNT[type];
  return base ? tn(base, n) : tn('count.items', n);
};
/** Board items counted by what they are: rectangles while all are (5.0), items once other kinds are among them. */
const itemsCount = (records: readonly (SbdRecord | null | undefined)[], n: number): string =>
  records.every((r) => r && itemFields(r.props)?.kind === 'rect') ? tn('count.rectangles', n) : tn('count.boardItems', n);

/** What a step did to one record of a kind, each sentence whole so a language can agree its words with the noun. */
const ONE: Readonly<Record<'create' | 'trash' | 'restore', Readonly<Record<'scene' | 'shot' | 'location' | 'character' | 'person' | 'shoot_day' | 'gear_item' | 'board' | 'board_item', MessageKey>>>> = {
  create: { scene: 'history.added.scene', shot: 'history.added.shot', location: 'history.added.location', character: 'history.added.character', person: 'history.added.person', shoot_day: 'history.added.shootDay', gear_item: 'history.added.gearItem', board: 'history.added.board', board_item: 'history.added.boardItem' },
  trash: { scene: 'history.deleted.scene', shot: 'history.deleted.shot', location: 'history.deleted.location', character: 'history.deleted.character', person: 'history.deleted.person', shoot_day: 'history.deleted.shootDay', gear_item: 'history.deleted.gearItem', board: 'history.deleted.board', board_item: 'history.deleted.boardItem' },
  restore: { scene: 'history.restored.scene', shot: 'history.restored.shot', location: 'history.restored.location', character: 'history.restored.character', person: 'history.restored.person', shoot_day: 'history.restored.shootDay', gear_item: 'history.restored.gearItem', board: 'history.restored.board', board_item: 'history.restored.boardItem' },
};
const MANY: Readonly<Record<'create' | 'trash' | 'restore', MessageKey>> = {
  create: 'history.addedCount',
  trash: 'history.deletedCount',
  restore: 'history.restoredCount',
};
const A_NOTE: Readonly<Record<'create' | 'trash' | 'restore', MessageKey>> = {
  create: 'history.added.note',
  trash: 'history.deleted.note',
  restore: 'history.restored.note',
};
const LOST: Readonly<Record<'create' | 'trash' | 'restore', MessageKey>> = {
  create: 'history.lostAdded',
  trash: 'history.lostDeleted',
  restore: 'history.lostRestored',
};

/**
 * An op whose record Empty Trash deleted for good: it keeps its kind, but not the record before and after (1.21), so
 * neither its type nor its name is known any more.
 */
const purged = (op: LoggedOp) => op.kind !== 'purge' && op.before === null && op.after === null;

const idsOf = (value: JsonValue | undefined): string[] | null => (Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : null);

/** The ids a change to a day's `people_ids` added and took off; `before` is null for a day that had no list. */
export function peopleDiff(before: JsonValue | undefined, after: JsonValue | undefined): { before: string[] | null; added: string[]; removed: string[] } {
  const was = idsOf(before);
  const now = idsOf(after) ?? [];
  return { before: was, added: now.filter((id) => !(was ?? []).includes(id)), removed: (was ?? []).filter((id) => !now.includes(id)) };
}

/** A step that changed who is on a day: "Added Ana Ruiz to Mon, Nov 16", "Took Ana Ruiz off …", "Added everyone to …". */
function peopleLine(change: FieldChange, day: Part, around: ReadonlyMap<string, SbdRecord>): Part[] {
  const { before, added, removed } = peopleDiff(change.before, change.after);
  const person = added.length === 1 && removed.length === 0 ? added[0] : removed.length === 1 && added.length === 0 ? removed[0] : undefined;
  // A day with no list (before 4.2) gets everyone at once; so does an add of several.
  if (before === null || (added.length > 1 && removed.length === 0)) return line('history.addedEveryoneToDay', { day });
  if (person !== undefined) return line(added.length === 1 ? 'history.addedToDay' : 'history.tookOffDay', { day }, { name: personNameIn(around, person) });
  return line('history.peopleChangedDay', { day });
}

/**
 * One line for an edit group, from its ops. `stored` holds the pictures still in the file; `around`, records the step
 * names without writing them (a sketch's frame, a scene's location), as they were then.
 */
export function describeEdit(opsIn: readonly LoggedOp[], stored: ReadonlySet<string>, around: ReadonlyMap<string, SbdRecord> = new Map()): Line {
  if (opsIn.length === 0) return [t('history.noChange')];
  // A call sheet made with its first note reads as that note being set, not as a call sheet added (4.1): its create
  // is read as an update from a record with no props.
  const ops = opsIn.map((op): LoggedOp =>
    op.kind === 'create' && op.after?.type === 'callsheet' ? { ...op, kind: 'update', before: { ...op.after, props: {} } } : op,
  );
  const record = (op: LoggedOp) => op.after ?? op.before;
  // A plan's steps (6.2a): a room started or renamed, walls drawn, moved, turned, resized, deleted or restored.
  const planned = planLine(ops, around);
  if (planned) return planned;
  // An issued call sheet (4.7): one line for the group (the PDF, the call sheet made with it, the scenes it locked),
  // named by its day and version, never by what the PDF holds.
  const issued = ops.find((op) => op.kind === 'create' && op.after?.type === 'media' && typeof op.after.props.issue_version === 'number');
  if (issued?.after) {
    const sheetId = issued.after.parentId;
    const sheet = ops.find((op) => op.recordId === sheetId);
    const sheetRecord = (sheet ? record(sheet) : null) ?? (sheetId ? (around.get(sheetId) ?? null) : null);
    const day = sheetRecord?.parentId ? around.get(sheetRecord.parentId) : undefined;
    return line('history.issuedCallsheet', {}, { day: day ? dayDateLabel(shootDayFields(day.props).date) || t('history.undatedDay') : t('history.aShootDay'), version: Number(issued.after.props.issue_version) });
  }
  const of = (kind: LoggedOp['kind'], type?: SbdRecord['type']) => ops.filter((op) => op.kind === kind && (!type || record(op)?.type === type));
  const items = (n: number) => tn('history.items', n);
  const removed = ops.some((op) => {
    const media = record(op);
    const sha = media?.type === 'media' ? mediaFields(media.props)?.sha256 : undefined;
    return sha !== undefined && !stored.has(sha);
  });
  const tag = removed ? t('history.pictureRemovedTag') : '';
  // A change of look: the theme, with or without a new logo.
  if (ops.some((op) => op.after?.type === 'project' && op.before && JSON.stringify(op.before.props.theme) !== JSON.stringify(op.after.props.theme))) {
    return [t('history.changedTheme', { tag })];
  }
  // The production company (3.2), with or without its logo: by its name, never its details.
  const company = ops.find((op) => record(op)?.type === 'project' && op.before && op.after && JSON.stringify(op.before.props.company) !== JSON.stringify(op.after.props.company));
  if (company) {
    const name = (value: JsonValue | undefined) => (isObject(value) && typeof value.name === 'string' && value.name !== '' ? value.name : t('history.aCompany'));
    const before = company.before?.props.company;
    const after = company.after?.props.company;
    if (before === undefined) return [...line('history.companyAttached', { name: name(after) }), tag];
    if (after === undefined) return [...line('history.companyDetached', { name: name(before) }), tag];
    const same = isObject(before) && isObject(after) && before.profile_id === after.profile_id;
    return [...line(same ? 'history.companyUpdated' : 'history.companyAttached', { name: name(after) }), tag];
  }
  const watermark = ops.find((op) => record(op)?.type === 'project' && op.before && op.after && JSON.stringify(op.before.props.watermark) !== JSON.stringify(op.after.props.watermark));
  if (watermark) return [`${describeWatermark(watermark.before?.props.watermark, watermark.after?.props.watermark)}${tag}`];

  // A video linked to a frame (2.2b), found by the still it put there, so a video the project had already reads the
  // same; or a video pointed at its file again.
  const grabs = ops.filter((op) => op.kind === 'create' && op.after?.type === 'media' && isObject(op.after.props.from_video));
  const linkedVideos = new Set(grabs.map((op) => {
    const from = op.after?.props.from_video;
    return isObject(from) && typeof from.video_id === 'string' ? from.video_id : op.recordId;
  }));
  if (linkedVideos.size > 1) return [t('history.videosLinked', { count: linkedVideos.size }), tag];
  const [grabbed] = grabs;
  if (grabbed) {
    const from = grabbed.after?.props.from_video;
    const name = isObject(from) && typeof from.source_name === 'string' ? from.source_name : '';
    const shot = ops.find((op) => record(op)?.type === 'shot');
    return [...line('history.videoLinked', { name: { mono: name }, frame: nameOf(shot ? record(shot) : null) }), tag];
  }
  const relinked = ops.find(
    (op) =>
      op.kind === 'update' &&
      op.after?.type === 'media' &&
      op.after.props.kind === 'video' &&
      VIDEO_FILE_PROPS.some((prop) => JSON.stringify(op.before?.props[prop]) !== JSON.stringify(op.after?.props[prop])),
  );
  if (relinked) {
    const name = relinked.after?.props.source_name;
    return line('history.videoRelinked', { name: { mono: typeof name === 'string' ? name : '' } });
  }

  // Most telling first: what was made, deleted, brought back or moved; then what changed.
  for (const kind of ['create', 'trash', 'restore'] as const) {
    for (const type of ['scene', 'shot', 'setup', 'note', 'media', 'stroke', 'location', 'character', 'person', 'shoot_day', 'gear_item', 'board', 'board_item'] as const) {
      const found = of(kind, type);
      if (found.length === 0) continue;
      // A picture or video card's media is written with its item (5.1b): the item is the news, named by its kind.
      if (type === 'media' && of(kind, 'board_item').length > 0) continue;
      if (type === 'media') {
        // A PDF or a link attached (3.11): named by its own name, wherever it's attached.
        const first = found[0];
        const attached = first ? record(first) : null;
        if (attached && attachmentFields(attached.props)) {
          if (found.length > 1) return [t(MANY[kind], { things: tn('count.attachments', found.length) })];
          const what = kind === 'create' ? 'history.added.attachment' : kind === 'trash' ? 'history.deleted.attachment' : 'history.restored.attachment';
          return line(what, { name: nameOf(attached) });
        }
        // A location's photos (3.3): named by their location, as the step left it or as it was then (`around`).
        const parentId = found[0]?.after?.parentId ?? found[0]?.before?.parentId ?? null;
        const written = ops.find((op) => op.recordId === parentId);
        const parent = written ? record(written) : parentId === null ? null : (around.get(parentId) ?? null);
        if (parent?.type === 'location') {
          // Restored with its location: the location coming back is the news.
          if (kind === 'restore' && written?.kind === 'restore') return line(ONE.restore.location, { name: nameOf(parent) });
          const what = kind === 'create' ? 'history.locationPhotos.added' : kind === 'trash' ? 'history.locationPhotos.removed' : 'history.locationPhotos.restored';
          return [...line(what, { name: nameOf(parent) }, { photos: tn('count.photos', found.length) }), tag];
        }
        const shot = ops.find((op) => op.kind === 'update' && record(op)?.type === 'shot');
        const what = kind === 'create' ? 'history.pictureOf.set' : kind === 'trash' ? 'history.pictureOf.removed' : 'history.pictureOf.restored';
        return [...line(what, { name: nameOf(shot ? record(shot) : null) }), tag];
      }
      if (type === 'stroke') {
        // A stroke is all a sketch writes, so its frame is named from the frame as it was then (`around`).
        const shotId = found[0]?.after?.parentId ?? found[0]?.before?.parentId ?? null;
        const written = ops.find((op) => op.recordId === shotId);
        const shot = written ? record(written) : shotId === null ? null : (around.get(shotId) ?? null);
        const frame = shot ? nameOf(shot) : t('history.aFrame');
        if (kind === 'create') return line('history.sketchedOn', { frame });
        return line(kind === 'trash' ? 'history.erasedOn' : 'history.restoredStrokesOn', { frame }, { strokes: tn('count.strokes', found.length) });
      }
      if (type === 'board_item') {
        // Connectors (5.2): one drawn between two items is "Connected 2 items"; made with a copy of an item (quick-create)
        // it is named with the item; trashed or restored with their items, they are not counted again.
        const joins = found.filter((op) => isConnector(record(op)));
        const others = found.filter((op) => !isConnector(record(op)));
        const only = joins[0];
        if (kind === 'create' && joins.length === 1 && only && others.length === 0) {
          const ends = connectorFields(record(only)?.props ?? {});
          return ends && 'item' in ends.from && 'item' in ends.to ? [t('history.connected')] : [...line('history.added.boardItem', { name: nameOf(record(only)) }), tag];
        }
        const copy = others[0];
        if (kind === 'create' && joins.length === 1 && copy && others.length === 1) return [...line('history.addedWithConnector', { name: nameOf(record(copy)) }), tag];
        if (joins.length > 0 && others.length > 0) found.splice(0, found.length, ...others);
        // A page and what it held, made together (Duplicate page, 5.5): named after the page.
        const madePages = others.filter((op) => itemFields(record(op)?.props ?? {})?.kind === 'page');
        const madePage = madePages[0];
        if (kind === 'create' && madePages.length === 1 && madePage && others.length > 1) return [...line('history.pageDuplicated', { name: nameOf(record(madePage)) }), tag];
      }
      if (type === 'setup') return setupStep(kind, found, ops, around);
      const first = found[0];
      // A deck (5.5) says so: the pages and cards made with it are not the news.
      if (type === 'board' && first && record(first)?.props.kind === 'deck') {
        return line(kind === 'create' ? 'history.added.deck' : kind === 'trash' ? 'history.deleted.deck' : 'history.restored.deck', { name: nameOf(record(first)) });
      }
      if (found.length > 1 || !first) return [t(MANY[kind], { things: type === 'board_item' ? itemsCount(found.map((op) => record(op)), found.length) : count(type, found.length) })];
      if (type === 'board_item') return [...line(ONE[kind][type], { name: nameOf(record(first), around) }), tag];
      return type === 'note' ? [t(A_NOTE[kind])] : line(ONE[kind][type], { name: nameOf(record(first)) });
    }
    // Checked before the moves and updates below: a delete renumbers the frames after it in the same step, and once
    // the deleted frame is gone for good those renumbers are all that's left to read, so it would pass for an edit.
    const lost = ops.filter((op) => op.kind === kind && purged(op));
    if (lost.length > 0) return [t(LOST[kind], { items: items(lost.length), tag })];
  }
  const moves = of('move');
  const moved = moves[0];
  if (moved) {
    // One page moved to another place in the deck (5.5).
    if (moves.length === 1 && itemFields(record(moved)?.props ?? {})?.kind === 'page') return [...line('history.moved', { name: nameOf(record(moved)) }), tag];
    // A scene's setups put in another order (6.0): their numbers follow.
    if (moves.every((op) => record(op)?.type === 'setup')) return line('history.setupsReordered', { scene: setupScene(record(moved), ops, around) });
    // A board's items sent forward or back (5.0): their stacking order, not a move across the board.
    if (moves.every((op) => record(op)?.type === 'board_item')) return [t('history.boardItemsReordered', { things: itemsCount(moves.map((op) => record(op)), new Set(moves.map((op) => op.recordId)).size) })];
    if (moves.length > 1) return [t('history.movedCount', { things: tn('count.items', moves.length) })];
    return purged(moved) ? [t('history.movedLost')] : line('history.moved', { name: nameOf(record(moved)) });
  }
  const updates = ops.filter((op) => op.kind === 'update' && op.before && op.after);
  const lostUpdates = ops.filter((op) => op.kind === 'update' && purged(op));
  // A connector's label typed, its ends moved, or its look changed (5.2).
  if (updates.length > 0 && updates.every((op) => isConnector(op.after ?? undefined))) {
    const props = new Set(updates.flatMap((op) => (op.before && op.after ? changedProps(op.before, op.after) : [])));
    const only = (allowed: readonly string[]) => [...props].every((prop) => allowed.includes(prop));
    if (props.size > 0 && only(['label'])) return [t('history.connectorLabelChanged')];
    if (props.size > 0 && only(['from', 'to'])) return [t('history.connectorReconnected')];
    if (props.size > 0) return [t('history.connectorChanged')];
  }
  // A board's items moved, resized or turned by one gesture (5.0): one line for the group, named by what it did.
  if (updates.length > 0 && updates.every((op) => op.before?.type === 'board_item' && op.after)) {
    // The connectors that went with a moved section (their free ends) are not the news: the items are.
    const moved = updates.filter((op) => !isConnector(op.after ?? undefined));
    const mine = moved.length > 0 ? moved : updates;
    const props = new Set(mine.flatMap((op) => (op.before && op.after ? changedProps(op.before, op.after) : [])));
    const only = (allowed: readonly string[]) => [...props].every((prop) => allowed.includes(prop));
    const things = itemsCount(mine.map((op) => record(op)), new Set(mine.map((op) => op.recordId)).size);
    // Align, distribute and Tidy up (5.3): the group covers every item the command did, so the step can be told from a drag.
    const rows = mine.flatMap((op) => (op.before && op.after ? [{ id: op.recordId, before: op.before.props, after: op.after.props, op }] : []));
    const covered = coveredRows(rows);
    const arranged = arrangedAs(covered);
    if (arranged) {
      // Counted by the items the command covered, not those a moved section carried.
      const named = itemsCount(covered.map((row) => record(row.op)), new Set(covered.map((row) => row.id)).size);
      if (arranged === 'align') return [t('history.boardItemsAligned', { things: named })];
      if (arranged === 'distribute') return [t('history.boardItemsDistributed', { things: named })];
      return [t(TIDIED[arranged], { things: named })];
    }
    if (props.size > 0 && only(['x', 'y'])) return [t('history.boardItemsMoved', { things })];
    if (props.has('rotation') && only(['x', 'y', 'rotation'])) return [t('history.boardItemsRotated', { things })];
    if ((props.has('width') || props.has('height')) && only(['x', 'y', 'width', 'height'])) return [t('history.boardItemsResized', { things })];
    // Text typed into a box (its height follows it), or a style set on several items at once (5.1a).
    if (props.has('text') && only(['text', 'height', 'x', 'y'])) return [t('history.boardTextEdited', { things })];
    if (mine.length > 1 && !props.has('text')) return [t('history.boardItemsChanged', { things })];
  }
  if (updates.length === 0 && lostUpdates.length > 0) return [t('history.lostChanged', { items: items(new Set(lostUpdates.map((op) => op.recordId)).size), tag })];
  // A setup named, renamed or its name taken off (6.0).
  const renamed = updates.length === 1 ? updates[0] : undefined;
  if (renamed?.before?.type === 'setup' && renamed.after && changedProps(renamed.before, renamed.after).every((prop) => prop === 'name')) {
    const scene = setupScene(renamed.after, ops, around);
    const name = typeof renamed.after.props.name === 'string' ? renamed.after.props.name.trim() : '';
    if (name === '') return line('history.setupNameRemoved', { setup: nameOf(renamed.before), scene });
    return line('history.setupRenamed', { setup: nameOf(renamed.before), scene }, { name });
  }
  // Frames put into a setup, or taken out of theirs (6.0), together.
  const joining = framesSetupLine(updates, around);
  if (joining) return [...joining, tag];
  if (updates.length === 1 || new Set(updates.map((op) => op.recordId)).size === 1) {
    const op = updates[0];
    const camera = updates.length === 1 && op ? cameraGearLine(op, around) : null;
    if (camera) return [...camera, tag];
    if (op?.before && op.after) {
      const changes = fieldChanges(op.before, op.after);
      const who = capitalise(nameOf(op.after, around));
      const [only] = changes;
      // A custom field put on or taken off; a department's status reads as a change ("Camera: — → Priority") below.
      if (changes.length === 1 && only?.prop === 'custom' && only.key !== undefined && (only.before === undefined || only.after === undefined)) {
        return line(only.before === undefined ? 'history.fieldAdded' : 'history.fieldRemoved', { who }, { field: only.key, tag });
      }
      if (changes.length === 1 && only?.prop === 'media_id') return line('history.whoDid', { who }, { what: pictureChange(only), tag });
      // Who's on a shoot day (4.2): the person added or taken off, by name as the step left it (`around`).
      if (changes.length === 1 && only?.prop === 'people_ids' && op.after.type === 'shoot_day') return [...peopleLine(only, nameOf(op.after), around), tag];
      if (changes.length === 1 && only) {
        const value = (v: JsonValue | undefined): Part => {
          // Kept by id: named as the step left it (`around`), a location or the person cast (3.5b).
          const fallback = KEPT_BY_ID.get(only.prop);
          if (fallback === undefined || typeof v !== 'string' || v === '') return changeValuePart(only, v);
          const named = around.get(v);
          return named ? nameOf(named) : t(fallback);
        };
        return [...line('history.fieldChange', { who, before: value(only.before), after: value(only.after) }, { field: changeLabel(only, around) }), tag];
      }
      return line('history.whoDid', { who }, { what: [...new Set(changes.map((c) => changeLabel(c, around)))].join(', '), tag });
    }
  }
  // Frames moved into one shoot day, or out of every day, together (3.7: a scene's frames added at once).
  const scheduled = updates.every(
    (op) => op.before?.type === 'shot' && op.after && changedProps(op.before, op.after).every((prop) => prop === 'shoot_day_id'),
  );
  const to = updates[0]?.after?.props.shoot_day_id;
  if (updates.length > 1 && scheduled && updates.every((op) => op.after?.props.shoot_day_id === to)) {
    const frames = tn('count.frames', updates.length);
    if (typeof to !== 'string') return [t('history.framesUnscheduled', { frames, tag })];
    const day = around.get(to);
    return [...line('history.framesScheduled', { day: day ? nameOf(day) : t('history.aShootDay') }, { frames, tag })];
  }
  if (updates.length > 0) {
    // A renumber or a lock touches many frames: named by the scene they share when they share one.
    return [t('history.changedCount', { things: tn('count.items', new Set(updates.map((op) => op.recordId)).size), tag })];
  }
  return [t('history.changes', { things: tn('count.changes', ops.length), tag })];
}

/** The scene a setup sits in, as the step left it or as it was then (`around`): `SC 04`, or "a scene". */
function setupScene(setup: SbdRecord | null, ops: readonly LoggedOp[], around: ReadonlyMap<string, SbdRecord>): Part {
  const sceneId = setup?.parentId ?? null;
  if (sceneId === null) return t('history.aScene');
  const written = ops.find((op) => op.recordId === sceneId);
  const scene = (written ? (written.after ?? written.before) : null) ?? around.get(sceneId) ?? null;
  return scene?.type === 'scene' ? nameOf(scene) : t('history.aScene');
}

/**
 * A setup made, deleted or restored (6.0): "Added a setup to SC 04", "Made a setup in SC 04 from 3 frames" (New setup
 * from the board's selected frames), "Deleted setup “Window side” from SC 04".
 */
function setupStep(kind: 'create' | 'trash' | 'restore', found: readonly LoggedOp[], ops: readonly LoggedOp[], around: ReadonlyMap<string, SbdRecord>): Line {
  const first = found[0];
  if (!first || found.length > 1) return [t(MANY[kind], { things: tn('count.setups', found.length) })];
  const setup = first.after ?? first.before;
  const parts = { setup: nameOf(setup), scene: setupScene(setup, ops, around) };
  if (kind === 'trash') return line('history.setupDeleted', parts);
  if (kind === 'restore') return line('history.setupRestored', parts);
  const joined = ops.filter((op) => op.kind === 'update' && op.after?.type === 'shot' && op.after.props.setup_id === first.recordId).length;
  return joined > 0 ? line('history.setupMadeFrom', parts, { frames: tn('count.frames', joined) }) : line('history.setupAdded', parts);
}

/**
 * Frames into one setup, or out of theirs, and nothing else changed: "Added 4A to setup “Window side” in SC 04",
 * "Took 2 frames out of a setup in SC 04". Null for any other step.
 */
function framesSetupLine(updates: readonly LoggedOp[], around: ReadonlyMap<string, SbdRecord>): Part[] | null {
  if (updates.length === 0) return null;
  const only = updates.every((op) => op.before?.type === 'shot' && op.after && changedProps(op.before, op.after).every((prop) => prop === 'setup_id'));
  if (!only) return null;
  const ids = new Set(updates.map((op) => op.after?.props.setup_id));
  const [to] = [...ids];
  if (ids.size !== 1) return null;
  const firstShot = updates[0]?.after ?? null;
  const frames: Part = updates.length === 1 && firstShot ? nameOf(firstShot) : tn('count.frames', updates.length);
  const sceneId = firstShot?.parentId ?? null;
  const sceneRecord = sceneId ? around.get(sceneId) : undefined;
  const scene: Part = sceneRecord?.type === 'scene' ? nameOf(sceneRecord) : t('history.aScene');
  if (typeof to === 'string') {
    const setup = around.get(to);
    return line('history.framesJoinedSetup', { frames, setup: setup ? nameOf(setup) : t('history.aSetup'), scene });
  }
  // Out: named by the setup they left, when they all left the same one.
  const left = new Set(updates.map((op) => op.before?.props.setup_id));
  const [from] = [...left];
  const setup = left.size === 1 && typeof from === 'string' ? around.get(from) : undefined;
  return line('history.framesLeftSetup', { frames, setup: setup ? nameOf(setup) : t('history.aSetup'), scene });
}

/**
 * A step's line. Undo and redo say what they took back or did again; a restore, the point it went back to; Empty
 * Trash, how many items it deleted for good.
 */
export function describeGroup(
  group: OpGroup,
  ops: readonly LoggedOp[],
  titles: ReadonlyMap<string, Line>,
  stored: ReadonlySet<string>,
  around: ReadonlyMap<string, SbdRecord> = new Map(),
): Line {
  switch (group.kind) {
    case 'edit':
      return describeEdit(ops, stored, around);
    case 'undo':
      return [t('history.undid'), ...(titles.get(group.targetGroupId ?? '') ?? [t('history.aStep')])];
    case 'redo':
      return [t('history.redid'), ...(titles.get(group.targetGroupId ?? '') ?? [t('history.aStep')])];
    case 'restore':
      return group.restoreTo === null
        ? [t('history.restoredToStart')]
        : [t('history.restoredTo'), ...(titles.get(group.restoreTo) ?? [t('history.anEarlierStep')])];
    case 'empty_trash':
      return [t('history.emptiedTrash', { items: tn('count.items', ops.length) })];
  }
}

/** Who a step is by: the name the edit carried, or nothing for one without (every edit before names were kept). */
export const who = (author: string): string => (author === 'local' ? '' : author);

/** One line of an item's own history: a field's change, or a whole step (added, moved, deleted). */
export interface FrameRow {
  key: string;
  op: LoggedOp;
  /** What happened, as the Change column says it. */
  change: string;
  /** The field it changed; null for a whole step. */
  field: FieldChange | null;
}

/** What a write did to a record as a whole, by the kind of edit it reversed or repeated. */
const KIND_LINE: Readonly<Record<LoggedOp['kind'], string>> = labels({
  create: 'history.kind.create',
  update: 'history.kind.update',
  move: 'history.kind.move',
  retype: 'history.kind.retype',
  trash: 'history.kind.trash',
  restore: 'history.kind.restore',
  revert: 'history.kind.revert',
  purge: 'history.kind.purge',
});

/** A field changed by going back and forth through History says so beside its name. */
const FIELD_HOW: Readonly<Record<GroupKind, MessageKey>> = {
  edit: 'history.how.edit',
  undo: 'history.how.undo',
  redo: 'history.how.redo',
  restore: 'history.how.restore',
  empty_trash: 'history.how.edit',
};

/** What Restore to here did to a record as a whole: its op is a `revert` whatever it changed. */
function revertLine(before: SbdRecord | null, after: SbdRecord | null): string | null {
  if (!before) return t('history.revert.added');
  if (!after) return t('history.revert.taken');
  if (before.trashedAt === null && after.trashedAt !== null) return t('history.revert.toTrash');
  if (before.trashedAt !== null && after.trashedAt === null) return t('history.revert.fromTrash');
  if (before.parentId !== after.parentId || before.sortKey !== after.sortKey) return t('history.revert.moved');
  return null;
}

/** The whole-step line for an op, or null when its field rows say it all. */
function stepLine(op: LoggedOp): string | null {
  if (op.kind === 'revert') {
    const line = revertLine(op.before, op.after);
    // An undone restore's ops are reverts too: worded as the restore they take back, not what it did.
    if (op.groupKind === 'restore' || line === null) return line;
    return t(op.groupKind === 'undo' ? 'history.undidStep' : 'history.redidStep', { step: KIND_LINE.revert });
  }
  if (op.kind === 'update') return null;
  // Undo and redo ops keep the kind they reverse (src/core/ops/ops.ts), so the group says which way it went.
  const base = KIND_LINE[op.kind];
  return op.groupKind === 'undo' ? t('history.undidStep', { step: base }) : op.groupKind === 'redo' ? t('history.redidStep', { step: base }) : base;
}

/** What a step did to a frame's sketch or picture, which are records of their own under it. */
function childLine(type: SbdRecord['type'] | undefined, kind: LoggedOp['kind'], n: number): string {
  if (type === 'media') {
    const what: Partial<Record<LoggedOp['kind'], MessageKey>> = { create: 'history.picture.set', trash: 'history.picture.removed', restore: 'history.picture.restored' };
    const key = what[kind];
    return key ? t(key) : kind === 'revert' ? t('history.revert.picture') : t('history.picture.changed');
  }
  switch (kind) {
    case 'create':
      return n === 1 ? t('history.sketched') : t('history.sketchedStrokes', { strokes: tn('count.strokes', n) });
    case 'trash':
      return t('history.erasedStrokes', { strokes: tn('count.strokes', n) });
    case 'restore':
      return t('history.restoredStrokes', { strokes: tn('count.strokes', n) });
    case 'revert':
      return t('history.revert.sketch');
    default:
      return t('history.sketchChanged');
  }
}

/**
 * Ops by the step they're in, each step's in the order given. Pushed onto, never copied: one step can be tens of
 * thousands of ops (a Restore to here, an Empty Trash, a big erase), and copying a step's list for every op in it takes
 * seconds there, on the UI thread, every time History is read again.
 */
export function byStep(ops: readonly LoggedOp[]): Map<string, LoggedOp[]> {
  const steps = new Map<string, LoggedOp[]>();
  for (const op of ops) {
    const list = steps.get(op.groupId);
    if (list) list.push(op);
    else steps.set(op.groupId, [op]);
  }
  return steps;
}

/**
 * Every change to one item, newest first, field by field. Its number is listed too, though the board keeps it in
 * step and it isn't put back on its own, so an editor matching a slate can see when a frame was renumbered.
 *
 * `ops` may hold its children's ops too (a frame's strokes and picture): each step's are one whole-step row,
 * "Sketched" or "Erased 2 strokes", since sketching writes only the stroke and would otherwise never show here. A
 * picture's own ops are left out where the frame's `picture` row already says it. Rows are keyed by op, so a new
 * step above them never makes them other rows.
 */
export function frameRows(ops: readonly LoggedOp[], itemId: string): FrameRow[] {
  const ownGroups = new Set(ops.filter((op) => op.recordId === itemId).map((op) => op.groupId));
  const children = byStep(
    ops.filter((op) => op.recordId !== itemId && !((op.after ?? op.before)?.type === 'media' && ownGroups.has(op.groupId))),
  );
  const listed = new Set<string>();
  return [...ops].reverse().flatMap((op): FrameRow[] => {
    if (op.recordId !== itemId) {
      const group = children.get(op.groupId);
      if (!group || listed.has(op.groupId)) return [];
      listed.add(op.groupId);
      const first = group[0] ?? op;
      const type = (first.after ?? first.before)?.type;
      const same = group.filter((o) => o.kind === first.kind && (o.after ?? o.before)?.type === type).length;
      const base = childLine(type, first.kind, same);
      const change = op.groupKind === 'undo' ? t('history.undidStep', { step: base }) : op.groupKind === 'redo' ? t('history.redidStep', { step: base }) : base;
      return [{ key: `${op.groupId}:children`, op, change, field: null }];
    }
    const rows: FrameRow[] = [];
    const line = stepLine(op);
    if (line !== null) rows.push({ key: op.id, op, change: line, field: null });
    if (op.before && op.after) {
      // Props one thing is kept in (a place on the map's three) read as one row, as the step's summary reads them.
      const named = new Set<string>();
      for (const field of fieldChanges(op.before, op.after)) {
        const name = field.prop === 'media_id' ? pictureChange(field) : changeLabel(field);
        if (field.key === undefined && named.has(name)) continue;
        named.add(name);
        rows.push({ key: `${op.id}:${field.prop}:${field.key ?? ''}`, op, change: t(FIELD_HOW[op.groupKind], { field: name }), field });
      }
    }
    // An update that changed nothing a person sees still happened: say so rather than drop it.
    if (rows.length === 0) rows.push({ key: op.id, op, change: KIND_LINE[op.kind], field: null });
    return rows;
  });
}

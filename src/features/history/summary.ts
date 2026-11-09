import { mediaFields } from '../../core/media/store';
import { departmentName, statusText } from '../../core/model/departmentStatus';
import { sceneApprovalText } from '../../core/model/sceneApprovals';
import { dayDateLabel, shootDayFields } from '../../core/model/shootDay';
import { DEPARTMENT_LABELS, isDepartment } from '../../core/model/department';
import { GEAR_SOURCE_LABEL, gearIdsOf } from '../../core/model/gear';
import { attachmentFields } from '../../core/model/attachment';
import { LOCATION_STATUS_LABEL } from '../../core/model/location';
import { PROJECT_STAGE_LABEL } from '../../core/model/projectDetails';
import { ROLE_LABELS } from '../../core/model/role';
import type { JsonValue, Props, SbdRecord } from '../../core/model/record';
import { SHOT_STATUS_LABELS } from '../../core/model/shotStatus';
import { HEIGHT_LABEL, MOVE_LABEL, pageLabel, sceneFields, sceneLabel, SHOT_SIZE_LABEL, shotFields, SUPPORT_LABEL } from '../../core/model/storyboard';
import type { GroupKind, LoggedOp, OpGroup } from '../../core/ops/ops';
import { POSITION_LABEL, POSITIONS } from '../export/watermark';
import { labels, t, tn, type MessageKey, type Params, type PluralBase } from '../../core/i18n';

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
  date: 'history.field.date',
  call_time: 'history.field.callTime',
  wrap_time: 'history.field.wrapTime',
  setup_minutes: 'history.field.setupMinutes',
  crew: 'history.field.crew',
  quantity: 'history.field.quantity',
  source: 'history.field.source',
  owner: 'history.field.owner',
  day_rate: 'history.field.dayRate',
  department: 'history.field.department',
  currency: 'history.field.currency',
  gear_ids: 'history.field.gearIds',
  full_view: 'history.field.fullView',
  characters: 'history.field.characters',
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
  phone: 'history.field.phone',
  email: 'history.field.email',
  role: 'history.field.role',
  power: 'history.field.power',
});

/** Values that are slate and camera data, set in mono wherever a line shows them. */
const MONO = new Set(['number', 'lens_mm', 't_stop']);

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
  // Who's confirmed for a shoot day (3.8), kept by person id: said as how many.
  if (prop === 'crew' && isObject(value)) return tn('history.crewConfirmed', Object.values(value).filter((v) => v === 'confirmed').length);
  // A frame's gear or a day's list (3.9b), kept by item id: said as how many.
  if (prop === 'gear_ids' && Array.isArray(value)) return tn('count.gearItems', gearIdsOf({ gear_ids: value }).length);
  // A gear item's department and whose it is (3.9a), in words rather than their stored ids.
  if (prop === 'department' && isDepartment(value)) return DEPARTMENT_LABELS[value];
  if (prop === 'source' && (value === 'owned' || value === 'rental')) return GEAR_SOURCE_LABEL[value];
  // A shoot day's date (3.7), as the Days tile writes it.
  if (prop === 'date' && typeof value === 'string') return dayDateLabel(value) || value;
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
    if (!BY_ENTRY.has(prop) && !byId) return [{ prop, before: before.props[prop], after: after.props[prop] }];
    const was = byId ? deliverablesById(before.props) : entriesOf(before.props, prop);
    const now = byId ? deliverablesById(after.props) : entriesOf(after.props, prop);
    const entries = [...new Set([...Object.keys(was), ...Object.keys(now)])]
      .filter((key) => JSON.stringify(was[key]) !== JSON.stringify(now[key]))
      .map((key) => ({ prop, key, before: was[key], after: now[key] }));
    // A checklist that changed with no item changed (reordered, or an entry without an id): the list as a whole.
    return byId && entries.length === 0 ? [{ prop, before: before.props[prop], after: after.props[prop] }] : entries;
  });
  return after.type === 'person' ? changes.map((change) => (PERSON_PRIVATE.has(change.prop) ? { ...change, private: true } : change)) : changes;
}

/** A person's props said only as set, changed or removed (3.5): their notes and own fields, besides PRIVATE_PROPS. */
const PERSON_PRIVATE: ReadonlySet<string> = new Set(['notes', 'custom']);

const isStatus = (change: FieldChange): change is FieldChange & { key: string } => change.prop === 'department_status' && change.key !== undefined;
/** A department's approvals of a scene (3.6b), one entry of `department_approvals`, named by the department too. */
const isSceneApproval = (change: FieldChange): change is FieldChange & { key: string } =>
  change.prop === 'department_approvals' && change.key !== undefined;

/** A field's name in a line: a custom field by its own name, a department's status by the department's. */
export const changeLabel = (change: FieldChange): string =>
  isStatus(change) || isSceneApproval(change)
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
const PRIVATE_PROPS: ReadonlySet<string> = new Set(['address', 'contact_phone', 'contact_email', 'phone', 'email']);
const isPrivate = (change: FieldChange): boolean => change.private === true || (change.key === undefined && PRIVATE_PROPS.has(change.prop));
const privateValue = (change: FieldChange, value: JsonValue | undefined): string =>
  isBlank(value) ? '—' : !isBlank(change.before) && !isBlank(change.after) ? t('history.changed') : t('history.notShown');

export const changeValue = (change: FieldChange, value: JsonValue | undefined): string =>
  isPrivate(change)
    ? privateValue(change, value)
    : isStatus(change)
    ? statusText(value)
    : isSceneApproval(change)
    ? sceneApprovalText(value)
    : isClient(change)
      ? clientValue(change, value, false)
      : isDeliverable(change)
        ? deliverableText(value, false)
        : change.key === undefined ? valueLabel(change.prop, value) : value === undefined ? t('history.noField') : valueLabel('', value);
/** A change's value in full, for an item's own history and its Put back: never cut short. */
export const changeText = (change: FieldChange, value: JsonValue | undefined): string =>
  isPrivate(change)
    ? privateValue(change, value)
    : isStatus(change)
    ? statusText(value)
    : isSceneApproval(change)
    ? sceneApprovalText(value)
    : isClient(change)
      ? clientValue(change, value, true)
      : isDeliverable(change)
        ? deliverableText(value, true)
        : change.key === undefined ? valueText(change.prop, value) : value === undefined ? t('history.noField') : valueText('', value);
const changeValuePart = (change: FieldChange, value: JsonValue | undefined): Part =>
  change.key === undefined && !isPrivate(change) ? valuePart(change.prop, value) : changeValue(change, value);

/** How a record is named in a step: a frame by its number, a scene by its slate label. */
function nameOf(record: SbdRecord | null): Part {
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
    case 'shoot_day': {
      // By its date (3.7); its number belongs to the order the days are in now.
      const date = dayDateLabel(shootDayFields(record.props).date);
      return date || t('history.undatedDay');
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
  gear_item: 'count.gearItems',
  stroke: 'count.strokes',
  media: 'count.pictures',
};
const count = (type: SbdRecord['type'], n: number): string => {
  const base = COUNT[type];
  return base ? tn(base, n) : tn('count.items', n);
};

/** What a step did to one record of a kind, each sentence whole so a language can agree its words with the noun. */
const ONE: Readonly<Record<'create' | 'trash' | 'restore', Readonly<Record<'scene' | 'shot' | 'location' | 'character' | 'person' | 'shoot_day' | 'gear_item', MessageKey>>>> = {
  create: { scene: 'history.added.scene', shot: 'history.added.shot', location: 'history.added.location', character: 'history.added.character', person: 'history.added.person', shoot_day: 'history.added.shootDay', gear_item: 'history.added.gearItem' },
  trash: { scene: 'history.deleted.scene', shot: 'history.deleted.shot', location: 'history.deleted.location', character: 'history.deleted.character', person: 'history.deleted.person', shoot_day: 'history.deleted.shootDay', gear_item: 'history.deleted.gearItem' },
  restore: { scene: 'history.restored.scene', shot: 'history.restored.shot', location: 'history.restored.location', character: 'history.restored.character', person: 'history.restored.person', shoot_day: 'history.restored.shootDay', gear_item: 'history.restored.gearItem' },
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

/**
 * One line for an edit group, from its ops. `stored` holds the pictures still in the file; `around`, records the step
 * names without writing them (a sketch's frame, a scene's location), as they were then.
 */
export function describeEdit(ops: readonly LoggedOp[], stored: ReadonlySet<string>, around: ReadonlyMap<string, SbdRecord> = new Map()): Line {
  if (ops.length === 0) return [t('history.noChange')];
  const record = (op: LoggedOp) => op.after ?? op.before;
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
    for (const type of ['scene', 'shot', 'note', 'media', 'stroke', 'location', 'character', 'person', 'shoot_day', 'gear_item'] as const) {
      const found = of(kind, type);
      if (found.length === 0) continue;
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
      const first = found[0];
      if (found.length > 1 || !first) return [t(MANY[kind], { things: count(type, found.length) })];
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
    if (moves.length > 1) return [t('history.movedCount', { things: tn('count.items', moves.length) })];
    return purged(moved) ? [t('history.movedLost')] : line('history.moved', { name: nameOf(record(moved)) });
  }
  const updates = ops.filter((op) => op.kind === 'update' && op.before && op.after);
  const lostUpdates = ops.filter((op) => op.kind === 'update' && purged(op));
  if (updates.length === 0 && lostUpdates.length > 0) return [t('history.lostChanged', { items: items(new Set(lostUpdates.map((op) => op.recordId)).size), tag })];
  if (updates.length === 1 || new Set(updates.map((op) => op.recordId)).size === 1) {
    const op = updates[0];
    if (op?.before && op.after) {
      const changes = fieldChanges(op.before, op.after);
      const who = capitalise(nameOf(op.after));
      const [only] = changes;
      // A custom field put on or taken off; a department's status reads as a change ("Camera: — → Priority") below.
      if (changes.length === 1 && only?.prop === 'custom' && only.key !== undefined && (only.before === undefined || only.after === undefined)) {
        return line(only.before === undefined ? 'history.fieldAdded' : 'history.fieldRemoved', { who }, { field: only.key, tag });
      }
      if (changes.length === 1 && only?.prop === 'media_id') return line('history.whoDid', { who }, { what: pictureChange(only), tag });
      if (changes.length === 1 && only) {
        const value = (v: JsonValue | undefined): Part => {
          // Kept by id: named as the step left it (`around`), a location or the person cast (3.5b).
          if ((only.prop !== 'location_id' && only.prop !== 'cast_id' && only.prop !== 'shoot_day_id') || typeof v !== 'string' || v === '') return changeValuePart(only, v);
          const named = around.get(v);
          return named ? nameOf(named) : t(only.prop === 'cast_id' ? 'history.aPerson' : only.prop === 'shoot_day_id' ? 'history.aShootDay' : 'history.aLocation');
        };
        return [...line('history.fieldChange', { who, before: value(only.before), after: value(only.after) }, { field: changeLabel(only) }), tag];
      }
      return line('history.whoDid', { who }, { what: [...new Set(changes.map(changeLabel))].join(', '), tag });
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
      for (const field of fieldChanges(op.before, op.after)) {
        const name = field.prop === 'media_id' ? pictureChange(field) : changeLabel(field);
        rows.push({ key: `${op.id}:${field.prop}:${field.key ?? ''}`, op, change: t(FIELD_HOW[op.groupKind], { field: name }), field });
      }
    }
    // An update that changed nothing a person sees still happened: say so rather than drop it.
    if (rows.length === 0) rows.push({ key: op.id, op, change: KIND_LINE[op.kind], field: null });
    return rows;
  });
}
